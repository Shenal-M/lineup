// Lineup service worker: phone notifications only. There is deliberately no fetch
// handler, so pages and API calls always come from the network (no stale app).
const ICON = "/icons/icon-192.png";
// Android draws the status-bar badge from the alpha channel only.
const BADGE = "/icons/badge-96.png";
// Reminders mostly arrive while the phone is idle, when Android may not fetch the
// icon in time and falls back to Chrome's. Both images are kept here at install
// and handed to the notification inline, so every push shows the Lineup mark.
const ASSETS = "lineup-notify-v1";

self.addEventListener("install", (event) => {
  self.skipWaiting();
  event.waitUntil(
    caches
      .open(ASSETS)
      .then((cache) => cache.addAll([ICON, BADGE]))
      .catch(() => {}),
  );
});

// The image as a data: URL, from the cache (refilled if missing); the plain path if
// neither the cache nor the network can supply it.
async function inline(path) {
  try {
    const cache = await caches.open(ASSETS);
    let res = await cache.match(path);
    if (!res) {
      res = await fetch(path);
      if (!res.ok) return path;
      await cache.put(path, res.clone());
    }
    const bytes = new Uint8Array(await res.arrayBuffer());
    let binary = "";
    for (let i = 0; i < bytes.length; i += 0x8000)
      binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    return `data:${res.headers.get("content-type") || "image/png"};base64,${btoa(binary)}`;
  } catch {
    return path;
  }
}
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
    (async () => {
      const [icon, badge] = await Promise.all([inline(ICON), inline(BADGE)]);
      await self.registration.showNotification(data.title || "Lineup", {
        body: data.body || "",
        icon,
        badge,
        tag: data.tag || undefined,
        data: { url: data.url || "/" },
      });
    })(),
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
