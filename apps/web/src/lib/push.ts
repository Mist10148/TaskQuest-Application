/**
 * Web push in the browser: what the Settings section shows and the subscribe / unsubscribe steps.
 * The pure parts (key decoding, status) are unit-tested; the browser calls are thin wrappers.
 * The service worker (public/sw.js) is registered only when the user turns notifications on.
 */

import { pushApi } from "@/lib/api";

export type PushStatus =
  /** This browser has no service workers, push or notifications. */
  | "unsupported"
  /** The server has no VAPID keys. */
  | "server-off"
  /** The user blocked notifications for this site in the browser. */
  | "denied"
  /** Subscribed: reminders arrive here. */
  | "on"
  /** Supported and allowed to ask, but not subscribed. */
  | "off";

/** The status to show, from what the browser, the permission and the server say. */
export function pushStatus(input: { supported: boolean; serverEnabled: boolean; permission: NotificationPermission | "unsupported"; subscribed: boolean }): PushStatus {
  if (!input.supported) return "unsupported";
  if (!input.serverEnabled) return "server-off";
  if (input.permission === "denied") return "denied";
  return input.subscribed && input.permission === "granted" ? "on" : "off";
}

export const PUSH_STATUS_TEXT: Record<PushStatus, string> = {
  unsupported: "This browser does not support push notifications.",
  "server-off": "Push notifications are not enabled on this server.",
  denied: "Notifications are blocked for this site. Allow them in your browser's site settings, then try again.",
  on: "On for this browser. Reminders arrive here as well as on Discord.",
  off: "Off for this browser.",
};

/** The permission prompt was closed without an answer (not the same as blocking the site). */
export const PUSH_DISMISSED_TEXT = "Notifications were not turned on because the permission prompt was closed. Try again and choose Allow.";

/** The VAPID public key (base64url) as the bytes pushManager.subscribe expects. */
export function urlBase64ToUint8Array(value: string): Uint8Array<ArrayBuffer> {
  const padded = value + "=".repeat((4 - (value.length % 4)) % 4);
  const raw = atob(padded.replace(/-/g, "+").replace(/_/g, "/"));
  const out = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

export const browserSupportsPush = (): boolean =>
  typeof window !== "undefined" && "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;

export const currentPermission = (): NotificationPermission | "unsupported" => (browserSupportsPush() ? Notification.permission : "unsupported");

/** This browser's existing subscription, without registering anything. */
export async function currentSubscription(): Promise<PushSubscription | null> {
  if (!browserSupportsPush()) return null;
  const registration = await navigator.serviceWorker.getRegistration("/sw.js");
  return registration ? registration.pushManager.getSubscription() : null;
}

/** Ask permission, register the worker, subscribe and tell the server. Throws a readable Error when it cannot. */
export async function enablePush(publicKey: string): Promise<void> {
  if (!browserSupportsPush()) throw new Error(PUSH_STATUS_TEXT.unsupported);
  const permission = await Notification.requestPermission();
  if (permission !== "granted") throw new Error(permission === "default" ? PUSH_DISMISSED_TEXT : PUSH_STATUS_TEXT.denied);
  const registration = await navigator.serviceWorker.register("/sw.js");
  await navigator.serviceWorker.ready;
  const subscription =
    (await registration.pushManager.getSubscription()) ??
    (await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array(publicKey) }));
  try {
    await pushApi.subscribe(subscription.toJSON());
  } catch (err) {
    await subscription.unsubscribe().catch(() => {});
    throw err;
  }
}

/** Whether a "your AI result is ready" notice should be shown: only when nobody is looking at the page and notifications are allowed. */
export function shouldAnnounceResult(input: { hidden: boolean; permission: NotificationPermission | "unsupported" }): boolean {
  return input.hidden && input.permission === "granted";
}

/**
 * Tell the player a slow AI result (a summary, a ranking) has arrived while they were on another tab. It is a local
 * notification shown through the service worker that "Push notifications" in Settings registered, so it needs no server push:
 * the request is still running in this page, which is the only time it is useful. It never asks for permission and never shows
 * anything while the page is visible or when push was not turned on; it never throws.
 * @returns whether a notification was shown
 */
export async function announceResult(message: { title: string; body: string }): Promise<boolean> {
  try {
    if (typeof document === "undefined") return false;
    if (!shouldAnnounceResult({ hidden: document.visibilityState === "hidden", permission: currentPermission() })) return false;
    const registration = await navigator.serviceWorker.getRegistration("/sw.js");
    if (!registration) return false;
    await registration.showNotification(message.title.slice(0, 100), {
      body: message.body.slice(0, 300),
      icon: "/taskquest-icon.svg",
      tag: "ai-result", // a second result replaces the first instead of stacking
      data: { url: window.location.href }, // absolute and ours: the service worker only opens pages of this origin
    });
    return true;
  } catch {
    return false;
  }
}

/** Forget this browser on the server, then in the browser. */
export async function disablePush(): Promise<void> {
  const subscription = await currentSubscription();
  if (!subscription) return;
  await pushApi.unsubscribe(subscription.endpoint);
  await subscription.unsubscribe();
}
