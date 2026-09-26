// 新訂單通知（Web Push）：在 iPhone 主畫面 App 裡訂閱通知，並透過 Cloudflare Worker 傳送。

import { CONFIG } from './config.js';

const cfg = () => CONFIG.push || {};

export const pushConfigured = () => Boolean(cfg().server && cfg().publicKey);
// iPhone 只有從主畫面打開的 App（iOS 16.4 以上）才有 PushManager
export const pushSupported = () => 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
export const pushPermission = () => ('Notification' in window ? Notification.permission : 'unsupported');

function keyBytes(b64url) {
  const s = atob(b64url.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((b64url.length + 3) % 4));
  return Uint8Array.from(s, c => c.charCodeAt(0));
}

// 必須在使用者點按按鈕時呼叫（iPhone 的規定）
export async function subscribePush() {
  const permission = await Notification.requestPermission();
  if (permission !== 'granted') throw new Error('沒有允許通知，可以到 iPhone 的「設定 → 通知 → 小廚房」打開');
  const reg = await navigator.serviceWorker.ready;
  const existing = await reg.pushManager.getSubscription();
  const sub = existing || (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(cfg().publicKey) }));
  return sub.toJSON();
}

export async function unsubscribePush() {
  const reg = await navigator.serviceWorker.ready;
  const sub = await reg.pushManager.getSubscription();
  await sub?.unsubscribe();
}

// devices: [{ id, role, sub }]；回傳已失效（應該刪除）的裝置 id
export async function sendPush(devices, payload) {
  if (!pushConfigured() || !devices.length) return [];
  const res = await fetch(cfg().server, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ subscriptions: devices.map(d => d.sub), payload }),
  });
  if (!res.ok) throw new Error(`通知伺服器錯誤 ${res.status}`);
  const { results = [] } = await res.json();
  return devices.filter((d, i) => [404, 410].includes(results[i]?.status)).map(d => d.id);
}

// 請通知伺服器馬上檢查一次快過期的存貨（測試每日提醒用）
export async function checkExpiryNow() {
  const res = await fetch(cfg().server.replace(/\/$/, '') + '/expiry-check', { method: 'POST' });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error || `通知伺服器錯誤 ${res.status}`);
  return json;
}
