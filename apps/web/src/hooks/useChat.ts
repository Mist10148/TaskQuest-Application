/**
 * Chat state: streams assistant tokens over SSE, tracks tool activity and the
 * confirmation the assistant is waiting on, and refreshes task/XP data after
 * confirmed writes. Nothing is applied without the user's click: write actions
 * arrive as `confirm` events and only run after `respond(true)`.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { aiApi, type AiConfirmAction, type AiSource, type AiToolEvent, type ChatEvent } from '@/lib/api';
import { isPendingConflict, PENDING_CONFIRM_NOTICE, withoutFailedTurn } from '@/lib/chatTurn';
import { invalidateProgress, showAchievementNotifications, showError, showXPNotification } from '@/hooks/useApi';

export interface ChatMessage {
    id: string;
    role: 'user' | 'assistant';
    text: string;
    sources: AiSource[];
    tools: AiToolEvent[];
    streaming?: boolean;
}

const newId = () => (typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : String(Math.random()));

/** Apply one SSE event to the message list (pure, so it can be tested). */
export function applyEvent(messages: ChatMessage[], event: ChatEvent): ChatMessage[] {
    if (event.event === 'done' || event.event === 'confirm') {
        return messages.map((m, i) => (i === messages.length - 1 ? { ...m, streaming: false } : m));
    }
    const last = messages[messages.length - 1];
    if (!last || last.role !== 'assistant') return messages;
    const update = (patch: Partial<ChatMessage>) => [...messages.slice(0, -1), { ...last, ...patch }];
    switch (event.event) {
        case 'token':
            return update({ text: last.text + event.data.text });
        case 'sources': {
            const known = new Set(last.sources.map((s) => s.id));
            return update({ sources: [...last.sources, ...event.data.filter((s) => !known.has(s.id))] });
        }
        case 'tool':
            return update({ tools: [...last.tools, event.data] });
        case 'error':
            return update({ text: last.text || event.data.message, streaming: false });
        default:
            return messages;
    }
}

export function useChat(initialThreadId: string | null) {
    const qc = useQueryClient();
    const [threadId, setThreadId] = useState<string | null>(initialThreadId);
    const [messages, setMessages] = useState<ChatMessage[]>([]);
    const [pending, setPending] = useState<AiConfirmAction[]>([]);
    const [isStreaming, setIsStreaming] = useState(false);
    // Inline message when the server refuses a message because a confirmation is still pending (HTTP 409).
    const [notice, setNotice] = useState<string | null>(null);
    const abortRef = useRef<AbortController | null>(null);
    const threadRef = useRef<string | null>(initialThreadId);
    // The thread whose history is already on screen (a new thread is adopted when its first turn ends).
    const loadedFor = useRef<string | null>(null);
    // Set once the user sends before history resolves, so the late history never overwrites live messages.
    const touchedRef = useRef(false);
    // Id of a thread the stream itself just created (the only case where the URL should adopt it).
    const [createdThreadId, setCreatedThreadId] = useState<string | null>(null);

    // Load history (and any confirmation still waiting) when a thread is opened.
    useEffect(() => {
        if (initialThreadId === loadedFor.current) return;
        loadedFor.current = initialThreadId;
        abortRef.current?.abort();
        threadRef.current = initialThreadId;
        touchedRef.current = false;
        setCreatedThreadId(null);
        setThreadId(initialThreadId);
        setPending([]);
        if (!initialThreadId) {
            setMessages([]);
            return;
        }
        let cancelled = false;
        aiApi
            .thread(initialThreadId)
            .then((t) => {
                if (cancelled || touchedRef.current) return;
                setMessages(t.messages.map((m) => ({ id: newId(), role: m.role, text: m.text, sources: [], tools: [] })));
                setPending(t.pendingConfirm);
            })
            .catch(showError);
        return () => {
            cancelled = true;
        };
    }, [initialThreadId]);

    useEffect(() => () => abortRef.current?.abort(), []);

    const handleEvent = useCallback(
        (event: ChatEvent) => {
            setMessages((prev) => applyEvent(prev, event));
            if (event.event === 'confirm') setPending((p) => [...p, event.data]);
            if (event.event === 'tool') {
                const { xpResult, newAchievements, status } = event.data;
                if (status === 'done') {
                    // A confirmed write may have changed tasks, XP and achievements.
                    qc.invalidateQueries({ queryKey: ['lists'] });
                    invalidateProgress(qc);
                    showXPNotification({ xpResult: xpResult ?? null }, 'Done via chat!', '🤖');
                    showAchievementNotifications(newAchievements, qc);
                }
            }
            if (event.event === 'done') {
                if (threadRef.current !== event.data.threadId) setCreatedThreadId(event.data.threadId);
                threadRef.current = event.data.threadId;
                loadedFor.current = event.data.threadId;
                setThreadId(event.data.threadId);
                qc.invalidateQueries({ queryKey: ['ai', 'threads'] });
            }
        },
        [qc]
    );

    const run = useCallback(
        async (start: (signal: AbortSignal) => Promise<void>): Promise<'ok' | 'blocked'> => {
            setNotice(null);
            abortRef.current?.abort();
            const controller = new AbortController();
            abortRef.current = controller;
            setIsStreaming(true);
            try {
                await start(controller.signal);
            } catch (err) {
                if (isPendingConflict(err)) {
                    // Another tab or the bot left an action waiting: show it and keep the typed message.
                    setMessages((prev) => withoutFailedTurn(prev));
                    setNotice(PENDING_CONFIRM_NOTICE);
                    const id = threadRef.current;
                    if (id) aiApi.thread(id).then((t) => setPending(t.pendingConfirm)).catch(() => undefined);
                    return 'blocked';
                }
                if ((err as Error).name !== 'AbortError') {
                    showError(err);
                    setMessages((prev) => applyEvent(prev, { event: 'error', data: { message: 'The assistant could not answer. Please try again.' } }));
                }
            } finally {
                if (abortRef.current === controller) setIsStreaming(false);
            }
            return 'ok';
        },
        []
    );

    const send = useCallback(
        async (text: string): Promise<'ok' | 'blocked'> => {
            const message = text.trim();
            if (!message || isStreaming) return 'ok';
            if (pending.length) {
                setNotice(PENDING_CONFIRM_NOTICE);
                return 'blocked';
            }
            touchedRef.current = true;
            setMessages((prev) => [
                ...prev,
                { id: newId(), role: 'user', text: message, sources: [], tools: [] },
                { id: newId(), role: 'assistant', text: '', sources: [], tools: [], streaming: true },
            ]);
            return run((signal) => aiApi.chatStream({ threadId: threadRef.current ?? undefined, message }, handleEvent, signal));
        },
        [handleEvent, isStreaming, pending.length, run]
    );

    /** Answer the confirmation card: approve runs the change, cancel leaves everything untouched. */
    const respond = useCallback(
        async (approved: boolean) => {
            const id = threadRef.current;
            if (!id || !pending.length || isStreaming) return;
            setPending([]);
            setNotice(null);
            setMessages((prev) => [...prev, { id: newId(), role: 'assistant', text: '', sources: [], tools: [], streaming: true }]);
            await run((signal) => aiApi.resumeStream(id, approved, handleEvent, signal));
        },
        [handleEvent, isStreaming, pending.length, run]
    );

    const stop = useCallback(() => {
        abortRef.current?.abort();
        setIsStreaming(false);
        setMessages((prev) => prev.map((m) => ({ ...m, streaming: false })));
    }, []);

    return { threadId, createdThreadId, messages, pending, isStreaming, notice, send, respond, stop };
}
