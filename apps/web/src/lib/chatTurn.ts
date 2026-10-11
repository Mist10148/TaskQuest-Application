/** Pure helpers for a chat turn the server refused (kept out of the hook so they can be unit tested). */

import { ApiError } from "./api";

/** Shown inline when the assistant is still waiting for the user's approval of an earlier action. */
export const PENDING_CONFIRM_NOTICE = "Approve or cancel the pending action first.";

/** HTTP 409 from /api/ai/chat: a confirmation is still pending, so no new message is accepted. */
export function isPendingConflict(err: unknown): boolean {
  return err instanceof ApiError && err.status === 409;
}

interface TurnMessage {
  role: "user" | "assistant";
  text: string;
}

/**
 * Remove the optimistic user message and empty assistant placeholder of a turn the server rejected,
 * so no unanswered bubble is left behind. Anything else is returned unchanged.
 */
export function withoutFailedTurn<T extends TurnMessage>(messages: T[]): T[] {
  const n = messages.length;
  if (n >= 2 && messages[n - 1].role === "assistant" && messages[n - 1].text === "" && messages[n - 2].role === "user") {
    return messages.slice(0, n - 2);
  }
  return messages;
}
