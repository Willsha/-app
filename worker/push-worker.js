// 小廚房的通知伺服器（Cloudflare Worker）
//
// App 送出點餐時會把「要通知的手機」和通知內容傳到這裡，
// 這裡用 VAPID 私鑰簽名、依 Web Push 標準加密後，交給 Apple 的推播伺服器送到 iPhone。
//
// 設定方式見 README「新訂單通知」。需要一個 Secret：
//   VAPID_PRIVATE_JWK  ── 私鑰（JSON），公鑰會從裡面算出來
// 可選的變數：
//   ALLOWED_ORIGINS    ── 允許呼叫的網站，逗號分隔（預設 https://willsha.github.io）
//
// 每日過期提醒（選填，再加一個「每小時」的 Cron Trigger：0 * * * *）：
//   KITCHEN_ID          ── 廚房代碼（建議設成 Secret）
//   TIMEZONE            ── 手機沒回報時區時用的預設時區，預設 Asia/Hong_Kong
// 每支手機會回報自己的時區（tz）和想收到提醒的時間（remindHour，預設 9 點），
// Worker 每小時執行一次，只通知「現在剛好是它提醒時間」的手機。
//   FIREBASE_PROJECT_ID / FIREBASE_API_KEY ── 換 Firebase 專案時才需要設定，預設用下面這組
//
// Firebase 的網頁設定本來就公開在 App 的 config.js 裡，所以直接寫在這裡當預設值。
const DEFAULT_FIREBASE = { projectId: 'cooking-app-50515', apiKey: 'AIzaSyCY_9dadglR5yDDMbplEwGsV8duOdP3xVI' };

const DEFAULT_ORIGINS = 'https://willsha.github.io';
// 只轉送到各家瀏覽器的推播伺服器，避免被拿去打任意網址
const PUSH_HOSTS = /(^|\.)(push\.apple\.com|fcm\.googleapis\.com|push\.services\.mozilla\.com|notify\.windows\.com)$/;
const MAX_SUBSCRIPTIONS = 10;

export default {
  async fetch(request, env) {
    const allowed = (env.ALLOWED_ORIGINS || DEFAULT_ORIGINS).split(',').map(s => s.trim());
    const origin = request.headers.get('Origin') || '';
    const cors = {
      'Access-Control-Allow-Origin': allowed.includes(origin) ? origin : allowed[0],
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'content-type',
      Vary: 'Origin',
    };

    if (request.method === 'OPTIONS') return new Response(null, { headers: cors });
    if (request.method === 'GET') {
      const ready = Boolean(env.VAPID_PRIVATE_JWK);
      return new Response(ready ? '小廚房通知伺服器運作中 ✅' : '還沒設定 VAPID_PRIVATE_JWK ⚠️', {
        headers: { ...cors, 'content-type': 'text/plain; charset=utf-8' },
      });
    }
    if (request.method !== 'POST' || !allowed.includes(origin)) {
      return new Response('forbidden', { status: 403, headers: cors });
    }

    // App 裡的「現在檢查一次試試」：不看時間，直接檢查並通知所有手機
    if (new URL(request.url).pathname === '/expiry-check') {
      try {
        return Response.json(await expiryReminder(env, { scheduled: false }), { headers: cors });
      } catch (err) {
        return Response.json({ error: String(err.message || err) }, { status: 500, headers: cors });
      }
    }

    let input;
    try {
      input = await request.json();
    } catch {
      return new Response('bad json', { status: 400, headers: cors });
    }
    const payload = input.payload || {};
    const message = JSON.stringify({
      title: String(payload.title || '我們的小廚房').slice(0, 80),
      body: String(payload.body || '').slice(0, 300),
      url: String(payload.url || './').slice(0, 200),
      tag: String(payload.tag || '').slice(0, 40),
    });

    const vapid = await loadVapid(env.VAPID_PRIVATE_JWK);
    const subs = Array.isArray(input.subscriptions) ? input.subscriptions.slice(0, MAX_SUBSCRIPTIONS) : [];
    const results = await Promise.all(
      subs.map(sub =>
        sendPush(sub, message, vapid).then(
          status => ({ status }),
          err => ({ status: 0, error: String(err && err.message ? err.message : err) }),
        ),
      ),
    );
    return Response.json({ results }, { headers: cors });
  },

  // Cron Trigger（每小時）：通知現在剛好到提醒時間的手機
  async scheduled(event, env, ctx) {
    ctx.waitUntil(expiryReminder(env, { scheduled: true, now: new Date(event.scheduledTime || Date.now()) }));
  },
};

// ---------- 每日過期提醒 ----------

async function expiryReminder(env, { scheduled = false, now = new Date() } = {}) {
  if (!env.KITCHEN_ID) return { skipped: 'KITCHEN_ID not set' };
  const [pantry, devices] = await Promise.all([listDocs(env, 'pantry'), listDocs(env, 'devices')]);
  const fallbackTz = validTz(env.TIMEZONE) || 'Asia/Hong_Kong';

  const targets = devices.filter(d => {
    if (!d || !d.sub || !d.sub.endpoint) return false;
    if (!scheduled) return true; // 手動測試：全部都送
    if (d.remind === false) return false;
    const hour = Number.isInteger(d.remindHour) ? d.remindHour : 9;
    return hourIn(validTz(d.tz) || fallbackTz, now) === hour;
  });
  if (!targets.length) return { due: 0, sent: 0 };

  const vapid = await loadVapid(env.VAPID_PRIVATE_JWK);
  let due = 0;
  let sent = 0;
  for (const d of targets) {
    // 「今天」用這支手機所在地的日期來算
    const list = dueItems(pantry, todayIn(validTz(d.tz) || fallbackTz, now));
    if (!list.length) continue;
    due = Math.max(due, list.length);
    const status = await sendPush(d.sub, expiryMessage(list), vapid).catch(() => 0);
    if (status >= 200 && status < 300) sent++;
  }
  return { due, sent };
}

function dueItems(pantry, today) {
  return pantry
    .filter(p => p && p.name && /^\d{4}-\d{2}-\d{2}$/.test(p.expires || ''))
    .map(p => ({ name: p.name, days: daysBetween(today, p.expires) }))
    .filter(p => p.days <= 2 && p.days >= -3) // 過期太久的就不再提醒
    .sort((a, b) => a.days - b.days);
}

function expiryMessage(list) {
  const when = d => (d < 0 ? '已過期' : d === 0 ? '今天到期' : d === 1 ? '明天到期' : `${d} 天後到期`);
  return JSON.stringify({
    title: '⏰ 食材快過期了',
    body: list.slice(0, 6).map(p => `${p.name}（${when(p.days)}）`).join('、') + (list.length > 6 ? ' …' : ''),
    url: './#/pantry',
    tag: 'expiry',
  });
}

// 用 Firestore REST API 讀取廚房裡的資料（Firestore 規則允許知道廚房代碼的人讀取）
async function listDocs(env, collection) {
  const project = env.FIREBASE_PROJECT_ID || DEFAULT_FIREBASE.projectId;
  const key = env.FIREBASE_API_KEY || DEFAULT_FIREBASE.apiKey;
  const url =
    `https://firestore.googleapis.com/v1/projects/${encodeURIComponent(project)}/databases/(default)/documents/` +
    `kitchens/${encodeURIComponent(env.KITCHEN_ID)}/${collection}?pageSize=300&key=${encodeURIComponent(key)}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Firestore ${res.status}`);
  const json = await res.json();
  return (json.documents || []).map(d => decodeValue({ mapValue: { fields: d.fields || {} } }));
}

function decodeValue(v) {
  if ('stringValue' in v) return v.stringValue;
  if ('integerValue' in v) return Number(v.integerValue);
  if ('doubleValue' in v) return v.doubleValue;
  if ('booleanValue' in v) return v.booleanValue;
  if ('timestampValue' in v) return v.timestampValue;
  if ('mapValue' in v) return Object.fromEntries(Object.entries(v.mapValue.fields || {}).map(([k, x]) => [k, decodeValue(x)]));
  if ('arrayValue' in v) return (v.arrayValue.values || []).map(decodeValue);
  return null;
}

function validTz(tz) {
  if (!tz || typeof tz !== 'string') return '';
  try {
    new Intl.DateTimeFormat('en', { timeZone: tz });
    return tz;
  } catch {
    return '';
  }
}
// en-CA 的日期格式剛好是 YYYY-MM-DD
const todayIn = (timeZone, now = new Date()) =>
  new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
const hourIn = (timeZone, now) => Number(new Intl.DateTimeFormat('en-GB', { timeZone, hour: '2-digit', hourCycle: 'h23' }).format(now));
const daysBetween = (from, to) => Math.round((Date.parse(to) - Date.parse(from)) / 86400000);

// ---------- Web Push（RFC 8291 加密 + RFC 8292 VAPID）----------

const enc = new TextEncoder();

function b64url(bytes) {
  let s = '';
  for (const b of new Uint8Array(bytes)) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function fromB64url(str) {
  const s = atob(str.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((str.length + 3) % 4));
  return Uint8Array.from(s, c => c.charCodeAt(0));
}
function concat(...parts) {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let i = 0;
  for (const p of parts) {
    out.set(p, i);
    i += p.length;
  }
  return out;
}

async function loadVapid(jwkText) {
  if (!jwkText) throw new Error('VAPID_PRIVATE_JWK is not set');
  const jwk = JSON.parse(jwkText);
  const key = await crypto.subtle.importKey('jwk', { ...jwk, ext: true }, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
  const publicKey = b64url(concat(new Uint8Array([4]), fromB64url(jwk.x), fromB64url(jwk.y)));
  return { key, publicKey };
}

async function vapidJwt(audience, vapid) {
  const header = b64url(enc.encode(JSON.stringify({ typ: 'JWT', alg: 'ES256' })));
  const claims = b64url(
    enc.encode(
      JSON.stringify({
        aud: audience,
        exp: Math.floor(Date.now() / 1000) + 12 * 3600,
        sub: 'https://willsha.github.io/-app/',
      }),
    ),
  );
  const unsigned = `${header}.${claims}`;
  const sig = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, vapid.key, enc.encode(unsigned));
  return `${unsigned}.${b64url(sig)}`;
}

async function hkdf(salt, ikm, info, length) {
  const key = await crypto.subtle.importKey('raw', ikm, 'HKDF', false, ['deriveBits']);
  return new Uint8Array(await crypto.subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt, info }, key, length * 8));
}

async function encrypt(plaintext, p256dh, authSecret) {
  const uaPublic = fromB64url(p256dh);
  const auth = fromB64url(authSecret);
  const uaKey = await crypto.subtle.importKey('raw', uaPublic, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
  const local = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
  const asPublic = new Uint8Array(await crypto.subtle.exportKey('raw', local.publicKey));
  const shared = new Uint8Array(await crypto.subtle.deriveBits({ name: 'ECDH', public: uaKey }, local.privateKey, 256));

  const ikm = await hkdf(auth, shared, concat(enc.encode('WebPush: info\0'), uaPublic, asPublic), 32);
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const cek = await hkdf(salt, ikm, enc.encode('Content-Encoding: aes128gcm\0'), 16);
  const nonce = await hkdf(salt, ikm, enc.encode('Content-Encoding: nonce\0'), 12);

  const aesKey = await crypto.subtle.importKey('raw', cek, 'AES-GCM', false, ['encrypt']);
  const padded = concat(enc.encode(plaintext), new Uint8Array([2])); // 0x02 = 最後一段
  const cipher = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce }, aesKey, padded));

  const recordSize = new Uint8Array([0, 0, 16, 0]); // 4096
  return concat(salt, recordSize, new Uint8Array([asPublic.length]), asPublic, cipher);
}

async function sendPush(sub, message, vapid) {
  const endpoint = new URL(sub && sub.endpoint);
  if (endpoint.protocol !== 'https:' || !PUSH_HOSTS.test(endpoint.hostname)) throw new Error('endpoint not allowed');
  if (!sub.keys || !sub.keys.p256dh || !sub.keys.auth) throw new Error('missing keys');

  const body = await encrypt(message, sub.keys.p256dh, sub.keys.auth);
  const jwt = await vapidJwt(endpoint.origin, vapid);
  const res = await fetch(endpoint.href, {
    method: 'POST',
    headers: {
      TTL: '86400',
      Urgency: 'high',
      'Content-Encoding': 'aes128gcm',
      'Content-Type': 'application/octet-stream',
      Authorization: `vapid t=${jwt}, k=${vapid.publicKey}`,
    },
    body,
  });
  return res.status;
}
