/*
 * TaskQuest service worker: web push only.
 *
 * It is registered only after a user turns on "Push notifications" in Settings, shows the notification the
 * server sends, and opens the right page when it is clicked. It has no fetch handler and caches nothing, so it
 * never changes how the app loads or updates.
 */

self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

/** A page on our own origin, or "/" for anything else (a notification must never open a foreign site). */
function safeTarget(url) {
  try {
    const target = new URL(typeof url === "string" ? url : "/", self.location.origin);
    return target.origin === self.location.origin ? target.href : new URL("/", self.location.origin).href;
  } catch {
    return new URL("/", self.location.origin).href;
  }
}

self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { body: event.data ? event.data.text() : "" };
  }
  const title = String(data.title || "TaskQuest").slice(0, 100);
  event.waitUntil(
    self.registration.showNotification(title, {
      body: String(data.body || "").slice(0, 300),
      icon: "/taskquest-icon.svg",
      data: { url: safeTarget(data.url) },
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = event.notification.data && event.notification.data.url ? event.notification.data.url : safeTarget("/");
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((windows) => {
      for (const win of windows) {
        if (win.url === url && "focus" in win) return win.focus();
      }
      // Reuse the tab the person is looking at, not whichever window happens to be first (a background tab
      // in the middle of a game or a form).
      const open = windows.find((win) => win.focused && "navigate" in win) || windows.find((win) => win.visibilityState === "visible" && "navigate" in win);
      // navigate() rejects for a window this worker does not control: fall back to a new one instead of doing nothing.
      if (open) return open.navigate(url).then((w) => (w || open).focus()).catch(() => self.clients.openWindow(url));
      return self.clients.openWindow(url);
    }),
  );
});

function keyBytes(value) {
  const padded = value + "=".repeat((4 - (value.length % 4)) % 4);
  const raw = atob(padded.replace(/-/g, "+").replace(/_/g, "/"));
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

/**
 * The browser rotated or expired this subscription. Without a new one reminders stop silently (the server keeps a dead
 * endpoint), so subscribe again with the server's public key and tell the server. Best effort: if the person is signed
 * out the request is refused and the next time they open Settings they can turn push on again.
 */
self.addEventListener("pushsubscriptionchange", (event) => {
  event.waitUntil(
    (async () => {
      try {
        const config = await (await fetch("/api/push/config", { credentials: "include" })).json();
        if (!config.enabled || !config.publicKey) return;
        const subscription =
          event.newSubscription ||
          (await self.registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(config.publicKey) }));
        await fetch("/api/push/subscribe", {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json", Accept: "application/json" },
          body: JSON.stringify({ subscription: subscription.toJSON() }),
        });
      } catch {
        /* nothing more to do from a worker */
      }
    })(),
  );
});
