/**
 * Chat state: streams assistant tokens over SSE, tracks tool activity and the
 * confirmation the assistant is waiting on, and refreshes task/XP data after
 * confirmed writes. Nothing is applied without the user's click: write actions
 * arrive as `confirm` events and only run after `respond(true)`.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { aiApi, ApiError, type AiConfirmAction, type AiSource, type AiToolEvent, type ChatEvent } from '@/lib/api';
import { isPendingConflict, PENDING_CONFIRM_NOTICE, withoutFailedTurn } from '@/lib/chatTurn';
import { invalidateProgress, showAchievementNotifications, showError, showXPNotification } from '@/hooks/useApi';
import { isSessionExpired } from '@/lib/session';

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
    // The chat calls the API directly, outside React Query's cache, so a 401 here must end the session the same way App does.
    const endSessionIfExpired = useCallback(
        (err: unknown) => {
            if (!isSessionExpired(err)) return false;
            qc.setQueryData(['auth', 'me'], null);
            return true;
        },
        [qc]
    );
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
    // History of an opened thread: loading, failed (retryable) or gone (deleted / never existed).
    const [history, setHistory] = useState<'idle' | 'loading' | 'error' | 'missing'>('idle');
    const [reloadKey, setReloadKey] = useState(0);

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
        setMessages([]);
        if (!initialThreadId) {
            setHistory('idle');
            return;
        }
        setHistory('loading');
        let cancelled = false;
        aiApi
            .thread(initialThreadId)
            .then((t) => {
                if (cancelled) return;
                setHistory('idle');
                if (touchedRef.current) return;
                setMessages(t.messages.map((m) => ({ id: newId(), role: m.role, text: m.text, sources: [], tools: [] })));
                setPending(t.pendingConfirm);
            })
            .catch((err) => {
                // A request for a thread the reader already left must not toast or change the screen.
                if (cancelled) return;
                if (endSessionIfExpired(err)) return;
                if (err instanceof ApiError && err.status === 404) {
                    showError(err);
                    setHistory('missing');
                } else {
                    setHistory('error');
                }
            });
        return () => {
            cancelled = true;
        };
    }, [initialThreadId, reloadKey, endSessionIfExpired]);

    /** Try loading the open thread's history again after a failure. */
    const retryHistory = useCallback(() => {
        loadedFor.current = null;
        setReloadKey((k) => k + 1);
    }, []);

    /** The page has moved the URL to the thread the stream created; forget it so it is never adopted again. */
    const acknowledgeCreated = useCallback(() => setCreatedThreadId(null), []);

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
                // Only a stream that started without a thread created one; the URL adopts it once.
                if (threadRef.current === null) setCreatedThreadId(event.data.threadId);
                threadRef.current = event.data.threadId;
                loadedFor.current = event.data.threadId;
                setThreadId(event.data.threadId);
                qc.invalidateQueries({ queryKey: ['ai', 'threads'] });
            }
        },
        [qc]
    );

    const run = useCallback(
        async (start: (signal: AbortSignal) => Promise<void>, onFail?: () => void): Promise<'ok' | 'blocked'> => {
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
                    // Only while that conversation is still open: a card from another thread would answer the wrong one.
                    if (id) aiApi.thread(id).then((t) => { if (threadRef.current === id) setPending(t.pendingConfirm); }).catch(() => undefined);
                    return 'blocked';
                }
                if (endSessionIfExpired(err)) return 'ok';
                if ((err as Error).name !== 'AbortError') {
                    onFail?.();
                    showError(err);
                    setMessages((prev) => applyEvent(prev, { event: 'error', data: { message: 'The assistant could not answer. Please try again.' } }));
                }
            } finally {
                if (abortRef.current === controller) {
                    setIsStreaming(false);
                    // A stream that ended without a done or error event must not leave a message "typing" forever.
                    setMessages((prev) => (prev.some((m) => m.streaming) ? prev.map((m) => ({ ...m, streaming: false })) : prev));
                }
            }
            return 'ok';
        },
        [endSessionIfExpired]
    );

    const send = useCallback(
        async (text: string): Promise<'ok' | 'blocked'> => {
            const message = text.trim();
            if (!message) return 'ok';
            if (isStreaming || history === 'loading') return 'blocked';
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
        [handleEvent, history, isStreaming, pending.length, run]
    );

    /** Answer the confirmation card: approve runs the change, cancel leaves everything untouched. */
    const respond = useCallback(
        async (approved: boolean) => {
            const id = threadRef.current;
            if (!id || !pending.length || isStreaming) return;
            const waiting = pending;
            setPending([]);
            setNotice(null);
            setMessages((prev) => [...prev, { id: newId(), role: 'assistant', text: '', sources: [], tools: [], streaming: true }]);
            // If the answer never reached the server, the action is still waiting there: show the card again.
            await run((signal) => aiApi.resumeStream(id, approved, handleEvent, signal), () => setPending(waiting));
        },
        [handleEvent, isStreaming, pending, run]
    );

    const stop = useCallback(() => {
        abortRef.current?.abort();
        setIsStreaming(false);
        setMessages((prev) => prev.map((m) => ({ ...m, streaming: false })));
    }, []);

    /**
     * Start an empty conversation: stops a reply in flight and clears the screen. "New chat" needs this on /chat itself, where the
     * URL (and so the thread id) does not change, for example after a first message that failed.
     */
    const reset = useCallback(() => {
        abortRef.current?.abort();
        abortRef.current = null;
        threadRef.current = null;
        loadedFor.current = null;
        touchedRef.current = false;
        setThreadId(null);
        setCreatedThreadId(null);
        setMessages([]);
        setPending([]);
        setNotice(null);
        setIsStreaming(false);
        setHistory('idle');
    }, []);

    return {
        threadId,
        createdThreadId,
        acknowledgeCreated,
        messages,
        pending,
        isStreaming,
        notice,
        historyLoading: history === 'loading',
        historyFailed: history === 'error',
        historyMissing: history === 'missing',
        retryHistory,
        send,
        respond,
        stop,
        reset,
    };
}
