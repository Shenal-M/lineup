// Lineup service worker: phone notifications only. There is deliberately no fetch
// handler, so pages and API calls always come from the network (no stale app).
const ICON = "/icons/icon-192.png";
// Android draws the status-bar badge from the alpha channel only.
const BADGE = "/icons/badge-96.png";

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));

// Payload: { title, body, tag, url } (src/push.ts).
self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { body: event.data ? event.data.text() : "" };
  }
  event.waitUntil(
    self.registration.showNotification(data.title || "Lineup", {
      body: data.body || "",
      icon: ICON,
      badge: BADGE,
      tag: data.tag || undefined,
      data: { url: data.url || "/" },
    }),
  );
});

// Focuses an open Lineup window and navigates it to the notification's page, or opens one.
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = new URL(event.notification.data?.url || "/", self.location.origin).href;
  event.waitUntil(
    (async () => {
      const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      const open = windows.find((w) => new URL(w.url).origin === self.location.origin);
      if (open) {
        await open.focus();
        if (open.url !== url) await open.navigate(url).catch(() => {});
        return;
      }
      await self.clients.openWindow(url);
    })(),
  );
});

// The browser rotated the subscription: subscribe again with the same key and tell the
// server (the session cookie goes with same-origin requests).
self.addEventListener("pushsubscriptionchange", (event) => {
  const key = event.oldSubscription?.options?.applicationServerKey;
  if (!key) return;
  event.waitUntil(
    (async () => {
      const sub = await self.registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: key,
      });
      await fetch("/api/push/subscribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(sub),
      });
    })(),
  );
});
