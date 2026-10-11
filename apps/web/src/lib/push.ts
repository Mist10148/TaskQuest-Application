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
  if (permission !== "granted") throw new Error(PUSH_STATUS_TEXT.denied);
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

/** Forget this browser on the server, then in the browser. */
export async function disablePush(): Promise<void> {
  const subscription = await currentSubscription();
  if (!subscription) return;
  await pushApi.unsubscribe(subscription.endpoint);
  await subscription.unsubscribe();
}
