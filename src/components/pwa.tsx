"use client";
import { useEffect } from "react";
import { api } from "./types";

// Registers the service worker (public/sw.js) that shows phone notifications. It has no
// fetch handler, so it never serves cached pages. updateViaCache "none" makes every
// update check fetch sw.js from the network.
const register = () =>
  navigator.serviceWorker.register("/sw.js", { scope: "/", updateViaCache: "none" });
export function Pwa() {
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;
    register().catch((e) => console.warn("Service worker registration failed:", e));
  }, []);
  return null;
}

// ---------- Phone notifications (used by Settings) ----------
export type PushState =
  | "loading"
  | "unsupported"
  | "unconfigured"
  | "blocked"
  | "off"
  | "on";

export const pushSupported = () =>
  typeof window !== "undefined" &&
  "serviceWorker" in navigator &&
  "PushManager" in window &&
  "Notification" in window;

// The VAPID public key is base64url; PushManager wants the raw bytes.
function keyBytes(base64url: string) {
  const base64 = (base64url + "=".repeat((4 - (base64url.length % 4)) % 4))
    .replace(/-/g, "+")
    .replace(/_/g, "/");
  return Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
}
// Registering again returns the existing registration (and surfaces a failed one as an
// error rather than a `ready` promise that never settles).
const registration = async () => {
  await register();
  return navigator.serviceWorker.ready;
};
const sameKey = (a: ArrayBuffer | null | undefined, b: Uint8Array) => {
  const x = a ? new Uint8Array(a) : null;
  return !!x && x.length === b.length && x.every((v, i) => v === b[i]);
};

// This device's state. A subscription the browser still has is re-sent to the server
// (it keeps its original date), so a device the server dropped heals itself.
export async function pushState(): Promise<PushState> {
  if (!pushSupported()) return "unsupported";
  const { key } = await api<{ key: string | null }>("push/key");
  if (!key) return "unconfigured";
  if (Notification.permission === "denied") return "blocked";
  const sub = await (await registration()).pushManager.getSubscription();
  if (
    !sub ||
    Notification.permission !== "granted" ||
    !sameKey(sub.options.applicationServerKey, keyBytes(key))
  )
    return "off";
  await api("push/subscribe", "POST", sub.toJSON());
  return "on";
}

// Must run from a click: the permission prompt needs a user gesture.
export async function enablePush(): Promise<PushState> {
  const permission = await Notification.requestPermission();
  if (permission === "denied") return "blocked";
  if (permission !== "granted") return "off";
  const { key } = await api<{ key: string | null }>("push/key");
  if (!key) return "unconfigured";
  const reg = await registration();
  let sub = await reg.pushManager.getSubscription();
  // A subscription made with another key (e.g. rotated VAPID keys) can't be reused.
  if (sub && !sameKey(sub.options.applicationServerKey, keyBytes(key))) {
    await sub.unsubscribe();
    sub = null;
  }
  sub ??= await reg.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: keyBytes(key),
  });
  await api("push/subscribe", "POST", sub.toJSON());
  return "on";
}

export async function disablePush(): Promise<PushState> {
  const sub = await (await registration()).pushManager.getSubscription();
  if (sub) {
    await api("push/subscribe", "DELETE", { endpoint: sub.endpoint });
    await sub.unsubscribe();
  }
  return "off";
}
