// 做菜計時器：從步驟文字找出「20 分鐘」「半小時」這類時間，變成可以按的計時按鈕。
// 計時器存在 localStorage，App 重開或切到別的畫面也不會不見。

const CN_DIGITS = { 零: 0, 一: 1, 二: 2, 兩: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 };
// 數字 + 可省略的「個」 + 可省略的「半」 + 單位，例如：20 分鐘、半小時、一個半小時、十五分
const DURATION_RE = /(\d+(?:\.\d+)?|[零一二兩三四五六七八九十半]+)\s*(個)?(半)?\s*(小時|鐘頭|分鐘|分(?!之|熟|量|鐘)|秒鐘|秒)(半)?/g;
const UNIT_SECONDS = { 小時: 3600, 鐘頭: 3600, 分鐘: 60, 分: 60, 秒鐘: 1, 秒: 1 };

function cnToNumber(s) {
  if (/^\d/.test(s)) return parseFloat(s);
  if (s === '半') return 0.5;
  if (s.includes('十')) {
    const [tens, ones] = s.split('十');
    return (tens ? CN_DIGITS[tens] ?? NaN : 1) * 10 + (ones ? CN_DIGITS[ones] ?? NaN : 0);
  }
  return s.length === 1 ? CN_DIGITS[s] ?? NaN : NaN;
}

// 回傳 [{ index, length, text, seconds }]
export function findDurations(text) {
  const out = [];
  for (const m of String(text).matchAll(DURATION_RE)) {
    const [whole, num, , half1, unit, half2] = m;
    let n = cnToNumber(num);
    if (!Number.isFinite(n)) continue;
    if (half1 || half2) n += 0.5;
    const seconds = Math.round(n * UNIT_SECONDS[unit]);
    if (seconds < 5 || seconds > 24 * 3600) continue;
    out.push({ index: m.index, length: whole.length, text: whole, seconds });
  }
  return out;
}

// 把步驟文字轉成 HTML，時間的地方變成計時按鈕
export function stepWithTimers(text, label, esc) {
  let html = '';
  let last = 0;
  for (const d of findDurations(text)) {
    html += esc(text.slice(last, d.index));
    html += `<button type="button" class="timer-chip" data-action="timer-start" data-sec="${d.seconds}" data-label="${esc(label)}">⏱ ${esc(d.text)}</button>`;
    last = d.index + d.length;
  }
  return html + esc(text.slice(last));
}

// ---------- 執行中的計時器 ----------

const KEY = 'rb.timers';
let timers = load();
let audio = null;
let ticking = null;
let onDone = null;
const alerted = new Set();

export function initTimers(handler) {
  onDone = handler;
  renderTimers();
}

function load() {
  try {
    return JSON.parse(localStorage.getItem(KEY)) || [];
  } catch {
    return [];
  }
}
function save() {
  try {
    localStorage.setItem(KEY, JSON.stringify(timers));
  } catch {
    /* 存不了也沒關係 */
  }
}

const fmt = ms => {
  const s = Math.max(0, Math.ceil(ms / 1000));
  const h = Math.floor(s / 3600);
  const mm = String(Math.floor((s % 3600) / 60)).padStart(2, '0');
  const ss = String(s % 60).padStart(2, '0');
  return h ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
};

export function startTimer(seconds, label) {
  // iPhone 要在使用者點按時才能啟用聲音，所以在這裡先準備好
  try {
    audio = audio || new (window.AudioContext || window.webkitAudioContext)();
    audio.resume();
  } catch {
    audio = null;
  }
  const id = Date.now().toString(36);
  timers.push({ id, label, seconds, endsAt: Date.now() + seconds * 1000 });
  save();
  renderTimers();
}

export function stopTimer(id) {
  timers = timers.filter(t => t.id !== id);
  alerted.delete(id);
  save();
  renderTimers();
}

function beep() {
  if (!audio) return;
  const now = audio.currentTime;
  for (let i = 0; i < 3; i++) {
    const osc = audio.createOscillator();
    const gain = audio.createGain();
    osc.frequency.value = 880;
    osc.connect(gain);
    gain.connect(audio.destination);
    const t = now + i * 0.45;
    gain.gain.setValueAtTime(0.001, t);
    gain.gain.exponentialRampToValueAtTime(0.4, t + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.35);
    osc.start(t);
    osc.stop(t + 0.36);
  }
}

export function renderTimers() {
  const el = document.getElementById('timers');
  if (!el) return;
  const now = Date.now();
  el.innerHTML = timers
    .map(t => {
      const left = t.endsAt - now;
      const done = left <= 0;
      if (done && !alerted.has(t.id)) {
        alerted.add(t.id);
        beep();
        navigator.vibrate?.([300, 150, 300]);
        onDone?.(t);
      }
      return `<div class="timer ${done ? 'done' : ''}">
        <span class="t-label">${done ? '⏰ 時間到！' : '⏱'} ${t.label.replace(/[&<>"']/g, '')}</span>
        <b>${done ? '' : fmt(left)}</b>
        <button type="button" data-action="timer-stop" data-id="${t.id}" aria-label="關閉計時器">${done ? '好了' : '✕'}</button>
      </div>`;
    })
    .join('');
  document.body.classList.toggle('has-timers', timers.length > 0);
  if (timers.length && !ticking) ticking = setInterval(renderTimers, 1000);
  if (!timers.length && ticking) {
    clearInterval(ticking);
    ticking = null;
  }
}
