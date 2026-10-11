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
      const open = windows.find((win) => "navigate" in win && "focus" in win);
      if (open) return open.navigate(url).then((w) => (w || open).focus());
      return self.clients.openWindow(url);
    }),
  );
});
