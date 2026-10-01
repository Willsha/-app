import { CONFIG } from './config.js';
import { createStore, readLocal } from './store.js';
import { initTimers, startTimer, stepWithTimers, stopTimer } from './timers.js';
import { LIBRARY, LIBRARY_CATEGORY } from './library.js';
import { checkExpiryNow, pushConfigured, pushPermission, pushSupported, sendPush, subscribePush, unsubscribePush } from './push.js';

const CATEGORIES = ['家常菜', '湯品', '麵飯', '早午餐', '甜點', '飲料', '其他'];
const MEALS = ['早餐', '午餐', '晚餐', '宵夜', '隨時'];
const STATUS = { pending: '等待中', cooking: '製作中', done: '已完成' };
const EMOJIS = ['🍳', '🍜', '🍲', '🥘', '🍛', '🍝', '🥗', '🍣', '🥟', '🍤', '🍗', '🥩', '🐟', '🥬', '🥦', '🥣', '🍰', '🧋'];
const WISH = '💕 想吃';
const TOP = '⭐ 高評分';
const WEEKDAYS = ['日', '一', '二', '三', '四', '五', '六'];

const SAMPLES = [
  {
    id: 'sample-tomato-egg',
    name: '番茄炒蛋',
    emoji: '🍳',
    category: '家常菜',
    time: '15',
    servings: '2',
    ingredients: [
      { name: '番茄', amount: '2 顆' },
      { name: '雞蛋', amount: '3 顆' },
      { name: '蔥', amount: '1 根' },
      { name: '糖', amount: '1 小匙' },
      { name: '鹽', amount: '適量' },
    ],
    steps: [
      '番茄切塊，蔥切蔥花，雞蛋加一小撮鹽打散。',
      '熱鍋下油，倒入蛋液，炒到半熟就先盛起來。',
      '原鍋再加一點油，放番茄炒到出汁變軟。',
      '加糖和鹽調味，把炒蛋倒回去拌勻。',
      '撒上蔥花，起鍋！',
    ],
    notes: '番茄先用熱水燙一下去皮，口感會更滑順。',
  },
  {
    id: 'sample-scallion-noodles',
    name: '蔥油拌麵',
    emoji: '🍜',
    category: '麵飯',
    time: '20',
    servings: '2',
    ingredients: [
      { name: '細麵', amount: '2 人份' },
      { name: '蔥', amount: '6 根' },
      { name: '醬油', amount: '3 大匙' },
      { name: '老抽', amount: '1 大匙' },
      { name: '糖', amount: '1.5 大匙' },
    ],
    steps: [
      '蔥洗淨擦乾，切成段，蔥白和蔥綠分開。',
      '冷油小火先放蔥白，炸到微黃再放蔥綠。',
      '蔥炸到焦黃酥脆後撈出，油留在鍋裡。',
      '倒入醬油、老抽和糖，小火煮到冒泡就關火。',
      '麵煮好瀝乾，淋上蔥油醬、放上蔥酥拌勻。',
    ],
    notes: '蔥油可以一次多做一點，放冰箱能保存一週。',
  },
];

// ---------- 小工具 ----------

const $ = (sel, el = document) => el.querySelector(sel);
const enc = encodeURIComponent;
const esc = s =>
  String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
const safePhoto = p => (typeof p === 'string' && /^data:image\/[a-z+]+;base64,[A-Za-z0-9+/=]+$/.test(p) ? p : '');

function load(key, fallback) {
  try {
    return JSON.parse(localStorage.getItem('rb.' + key)) ?? fallback;
  } catch {
    return fallback;
  }
}
function save(key, value) {
  try {
    localStorage.setItem('rb.' + key, JSON.stringify(value));
  } catch {
    /* 私密瀏覽等情況存不了，不影響使用 */
  }
}

function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => t.classList.remove('show'), 2400);
}

function fmtTime(ts) {
  const d = new Date(ts);
  const now = new Date();
  const hm = d.toLocaleTimeString('zh-TW', { hour: '2-digit', minute: '2-digit', hour12: false });
  if (d.toDateString() === now.toDateString()) return `今天 ${hm}`;
  const y = new Date(now);
  y.setDate(now.getDate() - 1);
  if (d.toDateString() === y.toDateString()) return `昨天 ${hm}`;
  return `${d.getMonth() + 1}/${d.getDate()} ${hm}`;
}

function defaultMeal() {
  const h = new Date().getHours();
  return h < 10 ? '早餐' : h < 14 ? '午餐' : h < 21 ? '晚餐' : '宵夜';
}

function newKitchenCode() {
  const abc = 'abcdefghjkmnpqrstuvwxyz23456789';
  const bytes = crypto.getRandomValues(new Uint8Array(12));
  const s = [...bytes].map(b => abc[b % abc.length]).join('');
  return `${s.slice(0, 4)}-${s.slice(4, 8)}-${s.slice(8)}`;
}

async function compressImage(file, max = 900, quality = 0.72) {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise((resolve, reject) => {
      const i = new Image();
      i.onload = () => resolve(i);
      i.onerror = reject;
      i.src = url;
    });
    const scale = Math.min(1, max / Math.max(img.width, img.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(img.width * scale);
    canvas.height = Math.round(img.height * scale);
    canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL('image/jpeg', quality);
  } finally {
    URL.revokeObjectURL(url);
  }
}

// ---------- 狀態 ----------

const prefs = { role: null, kitchenId: '', seeded: false, migrate: false, shopPlan: true, ...load('prefs', {}) };
const savePrefs = () => save('prefs', prefs);
if (!prefs.deviceId) {
  prefs.deviceId = uid();
  savePrefs();
}
let cart = load('cart', []); // [{ recipeId, qty }]
let data = { recipes: [], orders: [], photos: [], plans: [], devices: [], meta: [], pantry: [], loaded: false };
const scales = {}; // 份量換算：食譜id → 目前選的人份（食譜沒寫人份時是倍數）
let cookChecks = load('cookChecks', {}); // 做菜清單勾選 { 食譜id: { ing: { 0: true }, step: { 2: true } } }
let stats = new Map(); // 每道菜的評分與做過次數，每次畫面更新時重算
let store = null;
let storeError = '';
const ui = { category: '全部', q: '', randCat: '全部', randId: null, weekOffset: 0, planDate: null, planMeal: '晚餐', planQ: '' };
let pendingPhoto = null; // 剛選好、還沒存的相簿照片
let draft = null; // 編輯中的食譜（照片等表單外的欄位）
let cook = null; // 做菜模式 { id, step, showIng }
let wakeLock = null;

// 邀請連結：?k=廚房代碼
const inviteCode = new URLSearchParams(location.search).get('k');
if (inviteCode) {
  prefs.kitchenId = inviteCode.trim().toLowerCase();
  savePrefs();
  history.replaceState(null, '', location.pathname + location.hash);
}

const hasCloudConfig = () => Boolean(CONFIG.firebase && CONFIG.firebase.apiKey);
const isChef = () => prefs.role === 'chef';
const recipeById = id => data.recipes.find(r => r.id === id);
const cartCount = () => cart.reduce((n, i) => n + i.qty, 0);
const activeOrders = () => data.orders.filter(o => o.status !== 'done');
const otherRole = () => (isChef() ? 'diner' : 'chef');

// ----- 共用設定（分類、常買清單）存在 meta 集合 -----
const metaDoc = id => data.meta.find(m => m.id === id);
const categories = () => (metaDoc('categories')?.items?.length ? metaDoc('categories').items : CATEGORIES);
const saveCategories = items => persist('meta', { id: 'categories', items, updatedAt: Date.now() }).catch(() => {});
// 目前有菜的分類（包含已經從清單移除、但還有菜在用的舊分類）
const usedCategories = () => [...new Set([...categories(), ...data.recipes.map(r => r.category).filter(Boolean)])].filter(c => data.recipes.some(r => r.category === c));
const shopMeta = () => ({ extra: [], favorites: [], ...(metaDoc('shopping') || {}) });
const saveShop = patch => persist('meta', { ...shopMeta(), ...patch, id: 'shopping', updatedAt: Date.now() }).catch(() => {});
// 買菜清單的打勾也存在共用資料，兩支手機同步（存成名字陣列；和常買清單分開存，兩個人同時改比較不會互相蓋掉）
const checkedNames = () => new Set(metaDoc('shopChecked')?.names || []);
const isChecked = name => checkedNames().has(name);
const saveChecked = names => persist('meta', { id: 'shopChecked', names: [...names], updatedAt: Date.now() }).catch(() => {});
function setChecked(name, on) {
  const names = checkedNames();
  if (on === names.has(name)) return;
  if (on) names.add(name);
  else names.delete(name);
  saveChecked(names);
}

// ----- 做菜清單 -----
const checksOf = rid => cookChecks[rid] || { ing: {}, step: {} };
function setCheck(rid, kind, i, on) {
  const c = checksOf(rid);
  cookChecks[rid] = { ...c, [kind]: { ...c[kind], [i]: on || undefined } };
  save('cookChecks', cookChecks);
}
function resetChecks(rid) {
  delete cookChecks[rid];
  save('cookChecks', cookChecks);
}
const countChecked = (rid, kind, total) => Object.keys(checksOf(rid)[kind]).filter(i => checksOf(rid)[kind][i] && i < total).length;

function computeStats() {
  const map = new Map();
  const get = id => {
    if (!map.has(id)) map.set(id, { cooked: 0, total: 0, n: 0, avg: 0, reviews: [] });
    return map.get(id);
  };
  for (const o of data.orders) {
    if (o.status !== 'done') continue;
    for (const item of o.items || []) get(item.recipeId).cooked++;
    for (const [rid, rv] of Object.entries(o.reviews || {})) {
      const st = get(rid);
      if (rv.stars) {
        st.total += rv.stars;
        st.n++;
      }
      st.reviews.push({ ...rv, at: rv.at || o.createdAt });
    }
  }
  for (const st of map.values()) {
    st.avg = st.n ? st.total / st.n : 0;
    st.reviews.sort((a, b) => b.at - a.at);
  }
  return map;
}
const statOf = id => stats.get(id) || { cooked: 0, n: 0, avg: 0, reviews: [] };
const starsText = avg => `★ ${avg.toFixed(avg % 1 ? 1 : 0)}`;

function topRecipes(limit = 5) {
  return data.recipes
    .filter(r => statOf(r.id).n)
    .sort((a, b) => statOf(b.id).avg - statOf(a.id).avg || statOf(b.id).n - statOf(a.id).n || statOf(b.id).cooked - statOf(a.id).cooked)
    .slice(0, limit);
}

// 通知另一半（有設定通知伺服器、且對方有開通知時才會送）
function notify(role, payload) {
  const targets = data.devices.filter(d => d.role === role && d.id !== prefs.deviceId && d.sub);
  if (!pushConfigured() || !targets.length) return;
  sendPush(targets, payload)
    .then(dead => dead.forEach(id => destroy('devices', id)))
    .catch(err => console.warn('push failed', err));
}
const itemsText = items => (items || []).map(i => `${i.name}${i.qty > 1 ? ` ×${i.qty}` : ''}`).join('、');

function persist(collection, doc) {
  // Firebase 的寫入在離線時要等到連線才會完成，所以不等它；本機模式等它，才能抓到空間不足
  const p = store.put(collection, doc);
  if (store.mode === 'local') return p.catch(err => (toast(err.message), Promise.reject(err)));
  p.catch(err => toast('同步失敗：' + err.message));
  return Promise.resolve();
}
function destroy(collection, id) {
  store.remove(collection, id).catch(err => toast('刪除失敗：' + err.message));
}

// ---------- 路由與畫面 ----------

function route() {
  const [, name = 'menu', id] = (location.hash || '#/menu').split('/');
  return { name, id: id && decodeURIComponent(id) };
}

const VIEWS = {
  menu: menuView,
  recipe: recipeView,
  new: editView,
  edit: editView,
  cook: cookView,
  cart: cartView,
  orders: ordersView,
  shopping: shoppingView,
  settings: settingsView,
  random: randomView,
  album: albumView,
  week: weekView,
  pantry: pantryView,
  library: libraryView,
};

function render() {
  const app = $('#app');
  if (!prefs.role) {
    app.innerHTML = roleView();
    return;
  }
  stats = computeStats();
  const r = route();
  const view = VIEWS[r.name] || menuView;
  // 做菜模式和編輯食譜不需要分頁列（編輯頁有自己的儲存／取消）
  app.innerHTML = view(r) + (['cook', 'edit', 'new'].includes(r.name) ? '' : tabbar(r.name));
  if (view === menuView) renderMenuList();
  if (r.name === 'cook') requestWakeLock();
  else releaseWakeLock();
}

// 資料更新時重畫，保留捲動位置
function refresh() {
  const y = window.scrollY;
  render();
  window.scrollTo(0, y);
}

const header = (title, left = '', right = '') =>
  `<header class="top"><div class="side">${left}</div><h1>${esc(title)}</h1><div class="side right">${right}</div></header>`;
const backLink = (href, label = '‹ 返回') => `<a class="icon-btn" href="${href}">${label}</a>`;

function thumb(r, cls = 'thumb') {
  const photo = safePhoto(r.photo);
  return photo
    ? `<div class="${cls}" style="background-image:url('${photo}')"></div>`
    : `<div class="${cls} emoji"><span>${esc(r.emoji || '🍽️')}</span></div>`;
}

function tabbar(active) {
  const pending = activeOrders().length;
  const tabs = isChef()
    ? [
        ['menu', '📖', '菜單'],
        ['orders', '🔔', '訂單', pending],
        ['week', '📅', '一週菜單'],
        ['shopping', '🛒', '買菜'],
        ['album', '📸', '相簿'],
      ]
    : [
        ['menu', '📖', '菜單'],
        ['cart', '🧺', '點餐', cartCount()],
        ['orders', '💌', '訂單', pending],
        ['week', '📅', '一週菜單'],
        ['album', '📸', '相簿'],
      ];
  const current = { recipe: 'menu', edit: 'menu', new: 'menu', random: 'menu', settings: 'menu', pantry: 'shopping', library: 'menu' }[active] || active;
  return `<nav class="tabbar">${tabs
    .map(
      ([name, icon, label, badge]) =>
        `<a href="#/${name}" class="${current === name ? 'on' : ''}"><span class="ti">${icon}${
          badge ? `<b class="badge">${badge}</b>` : ''
        }</span>${label}</a>`,
    )
    .join('')}</nav>`;
}

function roleView() {
  return `<div class="welcome">
    <img class="logo" src="icons/icon.svg" alt="">
    <h1>我們的小廚房</h1>
    <p class="muted">你是哪一位？（之後可以在設定裡更改）</p>
    <button class="role-card" data-action="role" data-role="chef">
      <span class="big">👨‍🍳</span><span><b>我是廚師</b><small>管理食譜、看訂單、產生買菜清單</small></span>
    </button>
    <button class="role-card" data-action="role" data-role="diner">
      <span class="big">🥰</span><span><b>我是來點餐的</b><small>看菜單點菜、新增想吃的料理</small></span>
    </button>
  </div>`;
}

// ----- 菜單 -----

function menuView() {
  const cats = ['全部', WISH, ...usedCategories()];
  return (
    header(
      '我們的菜單',
      `<a class="icon-btn big-icon" href="#/settings" aria-label="設定">⚙️</a>`,
      `<a class="icon-btn big-icon" href="#/random" aria-label="今天吃什麼">🎲</a><a class="icon-btn strong" href="#/new">＋ 新增</a>`,
    ) +
    `<main class="page">
      ${expiryBanner()}
      <a class="random-banner" href="#/random"><span>🎲</span><b>今天吃什麼？</b><small>選擇困難就交給骰子</small></a>
      ${libraryBanner()}
      ${topStrip()}
      <input class="search" type="search" placeholder="🔍 搜尋菜名或食材" value="${esc(ui.q)}" data-input="search">
      <div class="chips">${cats
        .map(c => `<button class="chip ${ui.category === c ? 'on' : ''}" data-action="cat" data-cat="${esc(c)}">${esc(c)}</button>`)
        .join('')}</div>
      <div id="recipe-list" class="grid"></div>
    </main>` +
    cartBar()
  );
}

function topStrip() {
  const top = topRecipes();
  if (!top.length) return '';
  return `<section class="top5"><h2 class="section">💕 最愛 Top ${top.length}</h2><div class="top5-row">${top
    .map(
      (r, i) => `<a class="top5-card" href="#/recipe/${enc(r.id)}">${thumb(r, 'mini')}<span class="rank">${i + 1}</span>
        <b>${esc(r.name)}</b><small>${starsText(statOf(r.id).avg)} · 做過 ${statOf(r.id).cooked} 次</small></a>`,
    )
    .join('')}</div></section>`;
}

function filteredRecipes() {
  const q = ui.q.trim().toLowerCase();
  return data.recipes
    .filter(r => {
      if (ui.category === WISH) return r.addedBy === 'diner';
      return ui.category === '全部' || r.category === ui.category;
    })
    .filter(
      r =>
        !q ||
        r.name.toLowerCase().includes(q) ||
        (r.ingredients || []).some(i => i.name.toLowerCase().includes(q)),
    )
    .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
}

function renderMenuList() {
  const el = $('#recipe-list');
  if (!el) return;
  const list = filteredRecipes();
  if (!data.loaded && !data.recipes.length) el.innerHTML = '<p class="empty">載入中…</p>';
  else if (!data.recipes.length)
    el.innerHTML = `<div class="empty"><p>菜單還是空的</p><a class="btn primary" href="#/new">新增第一道菜</a>
      <p><a class="btn" href="#/library">📚 從推薦食譜庫挑幾道</a></p></div>`;
  else if (!list.length) el.innerHTML = '<p class="empty">找不到符合的菜 🤔</p>';
  else el.innerHTML = list.map(recipeCard).join('');
}

function recipeCard(r) {
  const inCart = cart.find(i => i.recipeId === r.id);
  const needsWork = isChef() && !(r.steps || []).length;
  return `<article class="card">
    <a href="#/recipe/${enc(r.id)}" class="card-link">
      ${thumb(r)}
      <div class="card-body">
        <h3>${esc(r.name)}</h3>
        <p class="meta">${esc(r.category || '')}${r.time ? ` · ${esc(r.time)} 分` : ''}</p>
        ${cardStats(r)}
        ${r.addedBy === 'diner' ? `<span class="tag love">${WISH}</span>` : ''}
        ${needsWork ? '<span class="tag warn">待補做法</span>' : ''}
      </div>
    </a>
    ${
      isChef()
        ? ''
        : `<button class="add-btn ${inCart ? 'on' : ''}" data-action="add-cart" data-id="${esc(r.id)}" aria-label="加入點餐">${
            inCart ? inCart.qty : '＋'
          }</button>`
    }
  </article>`;
}

function cardStats(r) {
  const st = statOf(r.id);
  const parts = [st.n && `<span class="stars">${starsText(st.avg)}</span>`, st.cooked && `做過 ${st.cooked} 次`].filter(Boolean);
  return parts.length ? `<p class="meta">${parts.join(' · ')}</p>` : '';
}

function cartBar() {
  const n = cartCount();
  if (isChef() || !n) return '';
  return `<a class="cart-bar" href="#/cart"><span>🧺 已選 ${n} 道</span><span>去點餐 →</span></a>`;
}

// ----- 食譜內容 -----

function notFound(title = '找不到') {
  return (
    header(title, backLink('#/menu')) +
    `<main class="page"><p class="empty">${data.loaded ? '這道菜不見了 😢' : '載入中…'}</p></main>`
  );
}

function recipeView({ id }) {
  const r = recipeById(id);
  if (!r) return notFound();
  const ings = r.ingredients || [];
  const steps = r.steps || [];
  const meta = [r.category, r.time && `${r.time} 分鐘`, r.servings && `${r.servings} 人份`].filter(Boolean);
  return (
    header(r.name, backLink('#/menu'), `<a class="icon-btn" href="#/edit/${enc(r.id)}">編輯</a>`) +
    `<main class="page recipe">
      ${thumb(r, 'hero')}
      <div class="recipe-head">
        <h2>${esc(r.name)}</h2>
        <p class="meta">${meta.map(esc).join(' · ')}</p>
        ${cardStats(r)}
        ${r.addedBy === 'diner' ? `<span class="tag love">${WISH}</span>` : ''}
      </div>
      ${r.notes ? `<p class="notes">📝 ${esc(r.notes)}</p>` : ''}
      ${
        countChecked(r.id, 'ing', ings.length) || countChecked(r.id, 'step', steps.length)
          ? `<button class="btn small ghost reset-checks" data-action="cook-reset" data-id="${esc(r.id)}">↺ 清除打勾，重新開始</button>`
          : ''
      }
      <section class="panel">
        <h3>🥕 備料 <small>${ings.length ? `${countChecked(r.id, 'ing', ings.length)} / ${ings.length}` : ''}</small></h3>
        ${ings.length ? servingsControl(r) : ''}
        ${ings.length ? ingChecklist(r) : `<p class="muted">還沒填食材${isChef() ? '，點右上角「編輯」補上吧' : ''}</p>`}
      </section>
      <section class="panel">
        <h3>👩‍🍳 步驟 <small>${steps.length ? `${countChecked(r.id, 'step', steps.length)} / ${steps.length}` : ''}</small></h3>
        ${
          steps.length
            ? `<ol class="steps">${steps
                .map((s, i) => {
                  const done = checksOf(r.id).step[i];
                  return `<li class="${done ? 'done' : ''}"><label class="step-check"><input type="checkbox" data-change="cook-check" data-rid="${esc(
                    r.id,
                  )}" data-kind="step" data-i="${i}" ${done ? 'checked' : ''}><span>${stepWithTimers(s, `${r.name} · 步驟 ${i + 1}`, esc)}</span></label></li>`;
                })
                .join('')}</ol>`
            : `<p class="muted">還沒寫做法${isChef() ? '，點右上角「編輯」補上吧' : '，交給廚師研究 😘'}</p>`
        }
      </section>
      ${reviewsPanel(r)}
      ${recipePhotos(r)}
      <div class="actions">
        ${
          isChef()
            ? `<a class="btn primary block" href="#/cook/${enc(r.id)}">開始做菜 🔥</a>`
            : `<button class="btn primary block" data-action="add-cart" data-id="${esc(r.id)}">加入點餐 🧺</button>`
        }
        ${photoButton({ recipe: r.id }, '📸 拍一張成品照', 'btn block')}
        <button class="btn ghost danger block" data-action="delete-recipe" data-id="${esc(r.id)}">刪除這道菜</button>
      </div>
    </main>` +
    cartBar()
  );
}

function ingChecklist(r) {
  return `<ul class="ings">${(r.ingredients || [])
    .map((x, i) => {
      const on = checksOf(r.id).ing[i];
      return `<li class="${on ? 'done' : ''}"><label><input type="checkbox" data-change="cook-check" data-rid="${esc(r.id)}" data-kind="ing" data-i="${i}" ${
        on ? 'checked' : ''
      }><span class="n">${esc(x.name)}${inPantry(x.name) ? ' <small class="have-tag">家裡有</small>' : ''}</span><span class="a">${esc(
        scaleAmount(x.amount, scaleFactor(r)),
      )}</span></label></li>`;
    })
    .join('')}</ul>`;
}

// ----- 份量換算 -----
const baseServings = r => (parseFloat(r.servings) > 0 ? parseFloat(r.servings) : 0);
const currentServings = r => scales[r.id] || baseServings(r) || 1;
const scaleFactor = r => (baseServings(r) ? currentServings(r) / baseServings(r) : currentServings(r));
const fmtNum = n => String(Math.round(n * 100) / 100);
const CN_AMOUNT = { 半: 0.5, 一: 1, 二: 2, 兩: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 十: 10 };

// 「2 顆」×2 → 「4 顆」、「1/2 杯」×2 → 「1 杯」、「三瓣」×2 → 「6瓣」；「適量」這種沒有數字的不變
function scaleAmount(text, f) {
  if (!text || f === 1) return text || '';
  let changed = false;
  let out = String(text).replace(/(\d+(?:\.\d+)?)\s*\/\s*(\d+)|\d+(?:\.\d+)?/g, (m, a, b) => {
    changed = true;
    return fmtNum((b ? parseFloat(a) / parseFloat(b) : parseFloat(m)) * f);
  });
  if (!changed)
    out = out.replace(/([一二兩三四五六七八九十])分之([一二兩三四五六七八九十])/, (m, d, n) => {
      changed = true;
      return fmtNum((CN_AMOUNT[n] / CN_AMOUNT[d]) * f);
    });
  if (!changed) out = out.replace(/^[半一二兩三四五六七八九十](?![\d分之])/, m => fmtNum(CN_AMOUNT[m] * f));
  return out;
}

function servingsControl(r) {
  const base = baseServings(r);
  const cur = currentServings(r);
  const min = base ? 1 : 0.5;
  return `<div class="serv"><span>${base ? '幾人份' : '份量'}</span>
    <div class="stepper"><button data-action="serv" data-id="${esc(r.id)}" data-d="-1" ${cur <= min ? 'disabled' : ''} aria-label="減少">−</button>
      <b>${base ? `${fmtNum(cur)} 人份` : `×${fmtNum(cur)}`}</b>
      <button data-action="serv" data-id="${esc(r.id)}" data-d="1" aria-label="增加">＋</button></div>
    ${scaleFactor(r) !== 1 ? `<button class="icon-btn" data-action="serv-reset" data-id="${esc(r.id)}">還原</button>` : ''}</div>`;
}

// ----- 家裡存貨 -----
const PLACES = ['冷藏', '冷凍', '常溫', '調味料'];
const PLACE_ICON = { 冷藏: '🧊', 冷凍: '❄️', 常溫: '🧺', 調味料: '🧂' };
const normFood = s => String(s || '').trim().toLowerCase();
// 「雞蛋」和「土雞蛋」算同一樣；只有一個字的（像「蔥」）要完全一樣，才不會把「洋蔥」算成「蔥」
function sameFood(a, b) {
  a = normFood(a);
  b = normFood(b);
  if (!a || !b) return false;
  if (a === b) return true;
  const [short, long] = a.length <= b.length ? [a, b] : [b, a];
  return short.length >= 2 && long.includes(short);
}
const inPantry = name => data.pantry.find(p => sameFood(p.name, name));
function daysLeft(date) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date || '')) return null;
  return Math.round((parseKey(date) - parseKey(dateKey(new Date()))) / 86400000);
}
function expiryLabel(d) {
  if (d === null) return '';
  if (d < 0) return `已過期 ${-d} 天`;
  if (d === 0) return '今天到期';
  if (d === 1) return '明天到期';
  return `${d} 天後到期`;
}
const expiringSoon = () =>
  data.pantry
    .filter(p => daysLeft(p.expires) !== null && daysLeft(p.expires) <= 3)
    .sort((a, b) => daysLeft(a.expires) - daysLeft(b.expires));
const recipesUsing = name => data.recipes.filter(r => (r.ingredients || []).some(i => sameFood(i.name, name)));

function expiryBanner() {
  const list = expiringSoon();
  if (!list.length) return '';
  const uses = [...new Set(list.flatMap(p => recipesUsing(p.name).map(r => r.name)))].slice(0, 3);
  return `<a class="expiry-banner" href="#/pantry"><b>⏰ 快過期了</b>
    <span>${list
      .slice(0, 4)
      .map(p => `${esc(p.name)}（${expiryLabel(daysLeft(p.expires))}）`)
      .join('、')}${list.length > 4 ? ' …' : ''}</span>
    ${uses.length ? `<small>可以做：${uses.map(esc).join('、')}</small>` : ''}</a>`;
}

function reviewsPanel(r) {
  const st = statOf(r.id);
  const withText = st.reviews.filter(rv => rv.comment || rv.stars);
  if (!withText.length) return '';
  return `<section class="panel"><h3>⭐ 評價 <small>${st.n ? `平均 ${st.avg.toFixed(1)} · ${st.n} 則` : ''}</small></h3>
    <ul class="reviews">${withText
      .slice(0, 10)
      .map(
        rv => `<li><span class="stars">${'★'.repeat(rv.stars || 0)}<i>${'★'.repeat(5 - (rv.stars || 0))}</i></span>
          ${rv.comment ? `<p>${esc(rv.comment)}</p>` : ''}<time>${fmtTime(rv.at)}</time></li>`,
      )
      .join('')}</ul></section>`;
}

function recipePhotos(r) {
  const photos = data.photos.filter(p => p.recipeId === r.id).sort((a, b) => b.createdAt - a.createdAt);
  if (!photos.length) return '';
  return `<section class="panel"><h3>📸 做過的樣子 <small>${photos.length} 張</small></h3>
    <div class="photo-strip">${photos.map(photoTile).join('')}</div></section>`;
}

// ----- 新增 / 編輯 -----

const ingRow = (i = {}) =>
  `<div class="ing-row"><input class="ing-name" placeholder="食材，例如：雞蛋" value="${esc(i.name)}"><input class="ing-amt" placeholder="份量" value="${esc(
    i.amount,
  )}"><button type="button" class="x" data-action="remove-row" aria-label="刪除">✕</button></div>`;
const stepRow = (s = '') =>
  `<li class="step-row"><textarea class="step-text" rows="2" placeholder="這一步要做什麼…">${esc(
    s,
  )}</textarea><button type="button" class="x" data-action="remove-row" aria-label="刪除">✕</button></li>`;

function editView({ name, id }) {
  const existing = name === 'edit' ? recipeById(id) : null;
  if (name === 'edit' && !existing) return notFound('編輯食譜');
  const d = existing || {
    name: '',
    emoji: '🍳',
    category: categories()[0],
    time: '',
    servings: '',
    ingredients: [{}, {}, {}],
    steps: [''],
    notes: '',
  };
  draft = {
    id: existing?.id,
    photo: safePhoto(existing?.photo),
    addedBy: existing?.addedBy,
    createdAt: existing?.createdAt,
  };
  const cancel = existing ? `#/recipe/${enc(existing.id)}` : '#/menu';
  return (
    header(existing ? '編輯食譜' : '新增食譜', backLink(cancel, '取消'), `<button class="icon-btn strong" data-action="save-recipe">儲存</button>`) +
    `<main class="page">
      ${!existing && !isChef() ? '<p class="hint">不知道怎麼做也沒關係，寫下菜名就好，廚師會補上做法 😘</p>' : ''}
      <form id="recipe-form" class="form" autocomplete="off">
        <div id="photo-slot">${photoPicker()}</div>
        <label>菜名<input name="name" value="${esc(d.name)}" placeholder="例如：番茄炒蛋" enterkeyhint="done"></label>
        <div class="field"><span>沒有照片時顯示的圖示</span>
          <div class="emoji-row">${EMOJIS.map(
            e => `<label><input type="radio" name="emoji" value="${e}" ${e === d.emoji ? 'checked' : ''}><span>${e}</span></label>`,
          ).join('')}</div>
        </div>
        <div class="row3">
          <label>分類<select name="category" data-change="category">${[...new Set([...categories(), d.category].filter(Boolean))]
            .map(c => `<option ${c === d.category ? 'selected' : ''}>${esc(c)}</option>`)
            .join('')}<option value="__new__">＋ 新增分類…</option></select></label>
          <label>時間(分)<input name="time" inputmode="numeric" value="${esc(d.time)}" placeholder="20"></label>
          <label>幾人份<input name="servings" inputmode="numeric" value="${esc(d.servings)}" placeholder="2"></label>
        </div>
        <div class="field"><span>食材</span>
          <div id="ing-list">${(d.ingredients.length ? d.ingredients : [{}]).map(ingRow).join('')}</div>
          <button type="button" class="btn ghost small" data-action="add-ing">＋ 加一樣食材</button>
        </div>
        <div class="field"><span>步驟</span>
          <ol id="step-list">${(d.steps.length ? d.steps : ['']).map(stepRow).join('')}</ol>
          <button type="button" class="btn ghost small" data-action="add-step">＋ 加一個步驟</button>
        </div>
        <label>備註<textarea name="notes" rows="3" placeholder="小撇步、口味偏好…">${esc(d.notes)}</textarea></label>
        <button type="button" class="btn primary block" data-action="save-recipe">儲存</button>
      </form>
    </main>`
  );
}

function photoPicker() {
  return draft.photo
    ? `<div class="photo-box has" style="background-image:url('${draft.photo}')"></div>
       <div class="photo-actions"><label class="btn ghost small">換照片<input type="file" accept="image/*" data-change="photo" hidden></label>
       <button type="button" class="btn ghost small danger" data-action="remove-photo">移除照片</button></div>`
    : `<label class="photo-box">📷<small>加一張照片</small><input type="file" accept="image/*" data-change="photo" hidden></label>`;
}

async function saveRecipe() {
  const form = $('#recipe-form');
  const fd = new FormData(form);
  const name = String(fd.get('name') || '').trim();
  if (!name) {
    toast('請先輸入菜名');
    form.elements.name.focus();
    return;
  }
  const now = Date.now();
  const recipe = {
    id: draft.id || uid(),
    name,
    emoji: fd.get('emoji') || '🍽️',
    photo: draft.photo || '',
    category: fd.get('category') || '其他',
    time: String(fd.get('time') || '').trim(),
    servings: String(fd.get('servings') || '').trim(),
    ingredients: [...form.querySelectorAll('.ing-row')]
      .map(row => ({ name: $('.ing-name', row).value.trim(), amount: $('.ing-amt', row).value.trim() }))
      .filter(i => i.name),
    steps: [...form.querySelectorAll('.step-text')].map(t => t.value.trim()).filter(Boolean),
    notes: String(fd.get('notes') || '').trim(),
    addedBy: draft.addedBy || prefs.role,
    createdAt: draft.createdAt || now,
    updatedAt: now,
  };
  try {
    await persist('recipes', recipe);
  } catch {
    return;
  }
  toast('已儲存 ✨');
  location.hash = `#/recipe/${enc(recipe.id)}`;
}

// ----- 做菜模式（廚師） -----

function cookView({ id }) {
  const r = recipeById(id);
  if (!r) return notFound('做菜');
  if (!cook || cook.id !== id) cook = { id, step: 0, showIng: true };
  const steps = (r.steps || []).length ? r.steps : ['還沒寫步驟，自由發揮吧！'];
  const i = Math.min(cook.step, steps.length - 1);
  const last = i === steps.length - 1;
  const ings = r.ingredients || [];
  return `<div class="cook">
    <header class="top"><div class="side"><a class="icon-btn" href="#/recipe/${enc(r.id)}">✕ 結束</a></div>
      <h1>${esc(r.name)}</h1><div class="side right"><span class="muted">${i + 1} / ${steps.length}</span></div></header>
    <div class="progress"><i style="width:${((i + 1) / steps.length) * 100}%"></i></div>
    ${
      ings.length
        ? `<details class="cook-ing panel" ${cook.showIng ? 'open' : ''}><summary>🥕 備料（${countChecked(r.id, 'ing', ings.length)} / ${ings.length}）</summary>
            ${servingsControl(r)}${ingChecklist(r)}</details>`
        : ''
    }
    <div class="step-dots">${steps
      .map((_, k) => `<button class="${k === i ? 'on' : ''} ${checksOf(r.id).step[k] ? 'done' : ''}" data-action="cook-goto" data-i="${k}" aria-label="步驟 ${k + 1}">${checksOf(r.id).step[k] ? '✓' : k + 1}</button>`)
      .join('')}</div>
    <div class="cook-step"><div class="num">步驟 ${i + 1}${checksOf(r.id).step[i] ? ' ✓ 已完成' : ''}</div><p>${stepWithTimers(steps[i], `${r.name} · 步驟 ${i + 1}`, esc)}</p></div>
    <div class="cook-nav">
      <button class="btn" data-action="cook-step" data-d="-1" ${i === 0 ? 'disabled' : ''}>← 上一步</button>
      ${
        last
          ? `<a class="btn primary" href="#/orders" data-action="cook-finish">完成 🎉</a>`
          : `<button class="btn primary" data-action="cook-step" data-d="1">下一步 →</button>`
      }
    </div>
  </div>`;
}

async function requestWakeLock() {
  try {
    if (!wakeLock && 'wakeLock' in navigator) {
      wakeLock = await navigator.wakeLock.request('screen');
      wakeLock.addEventListener('release', () => (wakeLock = null));
    }
  } catch {
    /* 舊版 iOS 不支援，做菜時螢幕會照常變暗 */
  }
}
function releaseWakeLock() {
  wakeLock?.release().catch(() => {});
  wakeLock = null;
}

// ----- 點餐（點餐的人） -----

function cartView() {
  const items = cart.map(i => ({ ...i, r: recipeById(i.recipeId) })).filter(i => i.r);
  return (
    header('點餐') +
    `<main class="page">${
      items.length
        ? `<ul class="list">${items
            .map(
              i => `<li class="cart-item">${thumb(i.r, 'mini')}<a class="grow" href="#/recipe/${enc(i.r.id)}">${esc(i.r.name)}</a>
              <div class="stepper"><button data-action="qty" data-id="${esc(i.r.id)}" data-d="-1" aria-label="減少">−</button><b>${i.qty}</b><button data-action="qty" data-id="${esc(
                i.r.id,
              )}" data-d="1" aria-label="增加">＋</button></div></li>`,
            )
            .join('')}</ul>
          <div class="field"><span>什麼時候要吃？</span>
            <div class="chips wrap">${MEALS.map(
              m => `<label class="chip-radio"><input type="radio" name="meal" value="${m}" ${m === defaultMeal() ? 'checked' : ''}><span>${m}</span></label>`,
            ).join('')}</div>
          </div>
          <label class="field"><span>想跟廚師說的話</span><textarea id="order-note" rows="3" placeholder="少辣一點、多放蔥、愛你～"></textarea></label>
          <button class="btn primary block big" data-action="submit-order">送出點餐 💌</button>`
        : `<div class="empty"><p>🧺 還沒選菜</p><a class="btn primary" href="#/menu">去看看菜單</a></div>`
    }</main>`
  );
}

function addToCart(id) {
  const r = recipeById(id);
  if (!r) return;
  const item = cart.find(i => i.recipeId === id);
  if (item) item.qty++;
  else cart.push({ recipeId: id, qty: 1 });
  save('cart', cart);
  toast(`已加入：${r.name}`);
  refresh();
}

async function submitOrder() {
  const items = cart
    .map(i => ({ ...i, r: recipeById(i.recipeId) }))
    .filter(i => i.r)
    .map(i => ({ recipeId: i.r.id, name: i.r.name, qty: i.qty }));
  if (!items.length) return;
  const order = {
    id: uid(),
    items,
    meal: document.querySelector('input[name=meal]:checked')?.value || '隨時',
    note: $('#order-note').value.trim(),
    status: 'pending',
    by: prefs.role,
    createdAt: Date.now(),
  };
  try {
    await persist('orders', order);
  } catch {
    return;
  }
  cart = [];
  save('cart', cart);
  notify('chef', { title: '💌 有新的點餐', body: `${order.meal}：${itemsText(items)}${order.note ? `\n💬 ${order.note}` : ''}`, url: './#/orders', tag: 'order' });
  toast('已送出！等廚師上菜 🥰');
  location.hash = '#/orders';
}

// ----- 訂單 -----

function ordersView() {
  const sorted = [...data.orders].sort((a, b) => b.createdAt - a.createdAt);
  const active = sorted.filter(o => o.status !== 'done');
  const done = sorted.filter(o => o.status === 'done').slice(0, 20);
  return (
    header(isChef() ? '訂單' : '我的訂單') +
    `<main class="page">
      ${todayPlanCard()}
      ${
        !data.orders.length
          ? `<div class="empty"><p>${isChef() ? '目前沒有人點餐 🍵' : '還沒點過餐'}</p>${
              isChef() ? '' : '<a class="btn primary" href="#/menu">去點餐</a>'
            }</div>`
          : ''
      }
      ${active.length ? `<h2 class="section">進行中</h2>${active.map(orderCard).join('')}` : ''}
      ${done.length ? `<h2 class="section">已完成</h2>${done.map(orderCard).join('')}` : ''}
    </main>`
  );
}

function orderCard(o) {
  const btn = (label, action, extra = '', cls = '') =>
    `<button class="btn small ${cls}" data-action="${action}" data-id="${esc(o.id)}" ${extra}>${label}</button>`;
  let actions = '';
  if (isChef()) {
    if (o.status === 'pending') actions = btn('開始做 🔥', 'order-status', 'data-status="cooking"', 'primary');
    else if (o.status === 'cooking')
      actions = btn('← 退回', 'order-status', 'data-status="pending"', 'ghost') + btn('完成上菜 ✅', 'order-status', 'data-status="done"', 'primary');
    else actions = btn('刪除紀錄', 'delete-order', '', 'ghost danger');
  } else {
    if (o.status === 'pending') actions = btn('取消點餐', 'delete-order', '', 'ghost danger');
    else if (o.status === 'done')
      actions =
        btn('再點一次', 'reorder', '', 'ghost') +
        btn(Object.keys(o.reviews || {}).length ? '改評分' : '⭐ 評分', 'review', '', Object.keys(o.reviews || {}).length ? 'ghost' : 'primary');
  }
  if (o.status === 'done') actions = photoButton({ order: o.id, recipe: o.items?.[0]?.recipeId }) + actions;
  return `<article class="order s-${esc(o.status)}">
    <div class="order-top"><span class="status">${STATUS[o.status] || ''}</span><span class="meal">${esc(o.meal)}</span><time>${fmtTime(o.createdAt)}</time></div>
    <ul class="order-items">${(o.items || [])
      .map(i => {
        const rv = o.reviews?.[i.recipeId];
        return `<li><a href="#/recipe/${enc(i.recipeId)}">${esc(i.name)}</a>${i.qty > 1 ? ` <b>× ${i.qty}</b>` : ''}${
          rv?.stars ? ` <span class="stars">${'★'.repeat(rv.stars)}</span>` : ''
        }${rv?.comment ? `<small class="rv">「${esc(rv.comment)}」</small>` : ''}</li>`;
      })
      .join('')}</ul>
    ${o.note ? `<p class="note">💬 ${esc(o.note)}</p>` : ''}
    ${
      o.status === 'done' && !isChef() && !Object.keys(o.reviews || {}).length
        ? '<p class="hint small">好吃嗎？給廚師一點鼓勵吧 ⭐</p>'
        : ''
    }
    ${data.photos.filter(p => p.orderId === o.id).length ? `<div class="photo-strip">${data.photos.filter(p => p.orderId === o.id).map(photoTile).join('')}</div>` : ''}
    ${actions ? `<div class="order-actions">${actions}</div>` : ''}
  </article>`;
}

function reviewSheet(o) {
  const rows = (o.items || [])
    .map(i => {
      const cur = o.reviews?.[i.recipeId] || {};
      return `<div class="rate-row" data-rid="${esc(i.recipeId)}">
        <b>${esc(i.name)}</b>
        <div class="rate-stars" data-val="${cur.stars || 0}">${[1, 2, 3, 4, 5]
          .map(n => `<button type="button" data-action="star" data-n="${n}" class="${n <= (cur.stars || 0) ? 'on' : ''}" aria-label="${n} 顆星">★</button>`)
          .join('')}</div>
        <input class="rate-comment" maxlength="80" placeholder="一句話心得（選填）" value="${esc(cur.comment)}">
      </div>`;
    })
    .join('');
  openSheet(`<h3>好吃嗎？給廚師評分</h3>${rows}
    <button class="btn primary block big" data-action="save-review" data-id="${esc(o.id)}">送出評分 💕</button>`);
}

function saveReview(orderId) {
  const o = data.orders.find(x => x.id === orderId);
  if (!o) return;
  const reviews = {};
  for (const row of document.querySelectorAll('#sheet .rate-row')) {
    const stars = Number($('.rate-stars', row).dataset.val);
    const comment = $('.rate-comment', row).value.trim();
    if (stars || comment) reviews[row.dataset.rid] = { stars, comment, by: prefs.role, at: Date.now() };
  }
  if (!Object.keys(reviews).length) {
    toast('點星星評分吧');
    return;
  }
  persist('orders', { ...o, reviews }).catch(() => {});
  closeSheet();
  toast('謝謝你的評分 💕');
  const summary = (o.items || [])
    .filter(i => reviews[i.recipeId])
    .map(i => `${i.name} ${'★'.repeat(reviews[i.recipeId].stars)}${reviews[i.recipeId].comment ? `「${reviews[i.recipeId].comment}」` : ''}`)
    .join('\n');
  notify(otherRole(), { title: '⭐ 收到評分了', body: summary, url: './#/orders', tag: 'review' });
}

// ----- 買菜清單（廚師） -----

function shoppingList() {
  const map = new Map();
  const missing = new Set();
  const sources = activeOrders().flatMap(o => (o.items || []).map(item => ({ recipeId: item.recipeId, qty: item.qty, when: '' })));
  if (prefs.shopPlan) {
    for (const date of nextDays(7)) {
      for (const item of planFor(date).items) sources.push({ recipeId: item.recipeId, qty: 1, when: dayLabel(date, true) });
    }
  }
  for (const x of shopMeta().extra) {
    const key = x.name.trim();
    if (!map.has(key)) map.set(key, { name: key, uses: [] });
    map.get(key).uses.push('自己加的');
    map.get(key).extra = true;
  }
  for (const { recipeId, qty, when } of sources) {
    const r = recipeById(recipeId);
    if (!r) continue;
    if (!(r.ingredients || []).length) missing.add(r.name);
    for (const ing of r.ingredients || []) {
      const key = ing.name.trim();
      if (!map.has(key)) map.set(key, { name: key, uses: [] });
      map.get(key).uses.push(`${r.name}${ing.amount ? ` ${ing.amount}` : ''}${qty > 1 ? ` ×${qty}` : ''}${when ? `（${when}）` : ''}`);
    }
  }
  const all = [...map.values()].sort((a, b) => Number(isChecked(a.name)) - Number(isChecked(b.name)));
  // 家裡已經有的（自己加的不算，那是你特地要買的）
  const have = all.filter(i => !i.extra && inPantry(i.name));
  const items = all.filter(i => !have.includes(i));
  return { items, have, missing: [...missing] };
}

function favoritesRow() {
  const { favorites, extra } = shopMeta();
  if (!favorites.length) return '';
  const inList = new Set(extra.map(x => x.name));
  return `<div class="favs"><div class="favs-head"><b>常買</b><small>點一下加入清單</small>
      <button class="icon-btn" data-action="fav-edit">${ui.favEdit ? '完成' : '編輯'}</button></div>
    <div class="chips wrap">${[...favorites]
      .sort((a, b) => a.localeCompare(b, 'zh-Hant'))
      .map(name =>
        ui.favEdit
          ? `<button class="chip edit" data-action="fav-remove" data-name="${esc(name)}">${esc(name)} ✕</button>`
          : `<button class="chip ${inList.has(name) ? 'on' : ''}" data-action="fav-add" data-name="${esc(name)}">${inList.has(name) ? '✓ ' : '＋ '}${esc(name)}</button>`,
      )
      .join('')}</div></div>`;
}

function addShopItem(name) {
  name = name.trim();
  if (!name) return;
  const { extra, favorites } = shopMeta();
  saveShop({
    extra: extra.some(x => x.name === name) ? extra : [...extra, { name, at: Date.now() }],
    favorites: favorites.includes(name) ? favorites : [...favorites, name], // 自動存進常買，下次點一下就好
  });
  setChecked(name, false);
}

function shoppingView() {
  const { items, have, missing } = shoppingList();
  const doneCount = items.filter(i => isChecked(i.name)).length;
  return (
    header('買菜清單', '', doneCount ? `<button class="icon-btn" data-action="clear-checked">清除勾選</button>` : '') +
    `<main class="page">
      ${shopTabs('shopping')}
      <p class="muted">根據「進行中」的訂單${prefs.shopPlan ? '和未來 7 天的一週菜單' : ''}自動整理需要的食材。</p>
      <label class="switch-row"><input type="checkbox" data-change="shop-plan" ${prefs.shopPlan ? 'checked' : ''}><span>包含一週菜單（未來 7 天）</span></label>
      <div class="shop-add"><input id="shop-new" placeholder="自己加：牛奶、衛生紙…" enterkeyhint="done" data-enter="shop-add"><button class="btn primary" data-action="shop-add">加入</button></div>
      ${favoritesRow()}
      ${
        items.length
          ? `<p class="progress-text">已買 ${doneCount} / ${items.length}</p><ul class="shop">${items
              .map(
                i => `<li><label class="${isChecked(i.name) ? 'done' : ''}"><input type="checkbox" data-change="shop" data-key="${esc(i.name)}" ${
                  isChecked(i.name) ? 'checked' : ''
                }><span><b>${esc(i.name)}</b><small>${i.uses.map(esc).join('、')}</small></span></label></li>`,
              )
              .join('')}</ul>`
          : `<div class="empty"><p>🛒 目前不用買菜</p></div>`
      }
      ${doneCount ? `<button class="btn block" data-action="bought-to-pantry">🧊 把買好的放進家裡存貨</button>` : ''}
      ${
        have.length
          ? `<details class="have"><summary>🧊 家裡已經有（${have.length}）</summary><ul>${have
              .map(i => `<li><b>${esc(i.name)}</b><small>${esc(inPantry(i.name).qty || '')} ${esc(inPantry(i.name).place || '')}</small></li>`)
              .join('')}</ul></details>`
          : ''
      }
      ${missing.length ? `<p class="hint">⚠️ 這些菜還沒填食材：${missing.map(esc).join('、')}</p>` : ''}
    </main>`
  );
}

const shopTabs = active => `<div class="seg page-seg">
  <a href="#/shopping" class="${active === 'shopping' ? 'on' : ''}">🛒 買菜清單</a>
  <a href="#/pantry" class="${active === 'pantry' ? 'on' : ''}">🧊 家裡存貨${data.pantry.length ? `（${data.pantry.length}）` : ''}</a></div>`;

// ----- 家裡存貨 -----

const byExpiry = (a, b) => (a.expires || '9999').localeCompare(b.expires || '9999') || a.name.localeCompare(b.name, 'zh-Hant');

function pantryView() {
  const groups = PLACES.map(pl => [pl, data.pantry.filter(p => (PLACES.includes(p.place) ? p.place : '冷藏') === pl).sort(byExpiry)]).filter(
    ([, list]) => list.length,
  );
  const canTest = pushConfigured() && store?.mode === 'firebase';
  return (
    header('家裡存貨') +
    `<main class="page">
      ${shopTabs('pantry')}
      <button class="btn primary block" data-action="pantry-new">＋ 新增存貨</button>
      ${
        groups.length
          ? groups
              .map(
                ([pl, list]) =>
                  `<h2 class="section">${PLACE_ICON[pl]} ${pl}<small> · ${list.length} 樣</small></h2><ul class="pantry">${list.map(pantryRow).join('')}</ul>`,
              )
              .join('')
          : `<div class="empty"><p>🧊 還沒有記錄存貨</p><p class="muted">把冰箱和櫃子裡的東西記下來，買菜清單會自動扣掉家裡已經有的；填了到期日還會提醒你</p></div>`
      }
      ${
        canTest
          ? `<p class="muted small center">每天早上的過期通知要在 Cloudflare 設定（見 README）<br><button class="icon-btn" data-action="expiry-test">現在檢查一次試試</button></p>`
          : ''
      }
    </main>`
  );
}

function pantryRow(p) {
  const d = daysLeft(p.expires);
  const uses = d !== null && d <= 3 ? recipesUsing(p.name).slice(0, 3) : [];
  return `<li class="${d === null ? '' : d < 0 ? 'expired' : d <= 3 ? 'soon' : ''}">
    <div class="pantry-row">
      <button class="pantry-main" data-action="pantry-edit" data-id="${esc(p.id)}"><b>${esc(p.name)}</b>${p.qty ? `<small>${esc(p.qty)}</small>` : ''}
        ${d !== null ? `<span class="exp">${expiryLabel(d)}</span>` : ''}</button>
      <button class="btn small ghost" data-action="pantry-used" data-id="${esc(p.id)}">用完了</button>
    </div>
    ${uses.length ? `<p class="uses">可以做：${uses.map(r => `<a href="#/recipe/${enc(r.id)}">${esc(r.name)}</a>`).join('、')}</p>` : ''}
  </li>`;
}

function pantrySheet(p = null) {
  const x = p || { name: '', qty: '', place: '冷藏', expires: '' };
  const names = [...new Set([...data.recipes.flatMap(r => (r.ingredients || []).map(i => i.name.trim())), ...shopMeta().favorites])].filter(Boolean);
  openSheet(`<h3>${p ? '編輯存貨' : '新增存貨'}</h3>
    <label class="field"><span>是什麼？</span><input id="pt-name" value="${esc(x.name)}" placeholder="牛奶、雞蛋、豆腐…" list="pt-names" autocomplete="off"></label>
    <datalist id="pt-names">${names.map(n => `<option value="${esc(n)}">`).join('')}</datalist>
    <label class="field"><span>數量（選填）</span><input id="pt-qty" value="${esc(x.qty)}" placeholder="1 瓶、半盒…"></label>
    <div class="field"><span>放在哪裡</span><div class="chips wrap">${PLACES.map(
      pl => `<label class="chip-radio"><input type="radio" name="pt-place" value="${pl}" ${pl === (x.place || '冷藏') ? 'checked' : ''}><span>${PLACE_ICON[pl]} ${pl}</span></label>`,
    ).join('')}</div></div>
    <div class="field"><span>到期日（選填）</span>
      <input id="pt-exp" type="date" value="${esc(x.expires)}">
      <div class="chips wrap">${[
        [2, '2 天後'],
        [3, '3 天後'],
        [7, '1 週後'],
        [30, '1 個月後'],
      ]
        .map(([n, l]) => `<button type="button" class="chip" data-action="pt-days" data-n="${n}">${l}</button>`)
        .join('')}<button type="button" class="chip" data-action="pt-days" data-n="">不填</button></div>
    </div>
    <button class="btn primary block big" data-action="pantry-save" data-id="${p ? esc(p.id) : ''}">儲存</button>
    ${p ? `<button class="btn ghost danger block" data-action="pantry-used" data-id="${esc(p.id)}">用完了（刪除）</button>` : ''}`);
}

// ----- 推薦食譜庫 -----

const libraryMissing = () => LIBRARY.filter(r => !recipeById(r.id));

function libraryBanner() {
  const n = libraryMissing().length;
  if (!n) return '';
  return `<a class="lib-banner" href="#/library"><span>📚</span><b>推薦食譜庫</b><small>${n} 道健康餐，像是${esc(
    libraryMissing()[0].name,
  )}</small></a>`;
}

function libraryView() {
  const missing = libraryMissing();
  return (
    header('推薦食譜庫', backLink('#/menu')) +
    `<main class="page">
      <p class="muted">精選的健康家常菜，按「加入菜單」就會放進你們的菜單，兩支手機都看得到；加入後也可以自己修改。</p>
      ${missing.length > 1 ? `<button class="btn primary block" data-action="lib-add-all">全部加入（${missing.length} 道）</button>` : ''}
      <div class="lib-list">${LIBRARY.map(libraryCard).join('')}</div>
    </main>`
  );
}

function libraryCard(r) {
  const added = recipeById(r.id);
  const health = (r.notes.match(/每份[^。]*/) || [''])[0];
  return `<article class="lib-card">
    <div class="lib-top">${thumb(r, 'mini')}<div class="grow"><h3>${esc(r.name)}</h3>
      <p class="meta">${esc(r.time)} 分鐘 · ${esc(r.servings)} 人份 · ${r.ingredients.length} 樣食材</p></div></div>
    ${health ? `<p class="lib-health">💪 ${esc(health)}</p>` : ''}
    <p class="lib-ings">${r.ingredients.slice(0, 6).map(i => esc(i.name)).join('、')}${r.ingredients.length > 6 ? '…' : ''}</p>
    ${
      added
        ? `<a class="btn small ghost" href="#/recipe/${enc(r.id)}">✓ 已在菜單，看做法</a>`
        : `<button class="btn small primary" data-action="lib-add" data-id="${esc(r.id)}">＋ 加入菜單</button>`
    }
  </article>`;
}

function addFromLibrary(list) {
  if (!list.length) return;
  if (!categories().includes(LIBRARY_CATEGORY)) saveCategories([...categories(), LIBRARY_CATEGORY]);
  const now = Date.now();
  list.forEach((r, i) =>
    persist('recipes', { ...r, category: LIBRARY_CATEGORY, photo: '', addedBy: 'chef', createdAt: now - i, updatedAt: now - i }).catch(() => {}),
  );
  toast(list.length === 1 ? `已加入：${list[0].name}` : `已加入 ${list.length} 道菜 🎉`);
}

// ----- 彈出視窗 -----

function openSheet(html) {
  const el = $('#sheet');
  el.innerHTML = `<div class="sheet-backdrop" data-action="close-sheet"></div><div class="sheet-card" role="dialog" aria-modal="true">${html}</div>`;
  el.classList.add('open');
  document.body.classList.add('sheet-open');
}
function closeSheet() {
  const el = $('#sheet');
  el.classList.remove('open');
  el.innerHTML = '';
  document.body.classList.remove('sheet-open');
}

// ----- 今天吃什麼 -----

let spinning = false;

function randomPool() {
  return data.recipes.filter(r => {
    if (ui.randCat === '全部') return true;
    if (ui.randCat === WISH) return r.addedBy === 'diner';
    if (ui.randCat === TOP) return statOf(r.id).avg >= 4;
    return r.category === ui.randCat;
  });
}

const slotFace = r => `<div class="slot-face">${thumb(r, 'slot-thumb')}<b>${esc(r.name)}</b>${cardStats(r)}</div>`;

function randomView() {
  const cats = ['全部', WISH, TOP, ...usedCategories()];
  const pick = ui.randId && recipeById(ui.randId);
  const pool = randomPool();
  return (
    header('今天吃什麼？', backLink('#/menu')) +
    `<main class="page random">
      <div class="chips wrap center">${cats
        .map(c => `<button class="chip ${ui.randCat === c ? 'on' : ''}" data-action="rand-cat" data-cat="${esc(c)}">${esc(c)}</button>`)
        .join('')}</div>
      <div class="slot" id="slot">${
        pick
          ? slotFace(pick)
          : `<div class="slot-face"><span class="slot-emoji">🎲</span><b>${pool.length ? `從 ${pool.length} 道菜裡抽一道` : '這個分類還沒有菜'}</b></div>`
      }</div>
      <button class="btn primary big block" data-action="spin" ${pool.length ? '' : 'disabled'}>${pick ? '🎲 再抽一次' : '🎲 抽一道！'}</button>
      <div id="rand-actions">${
        pick
          ? `<div class="two">${
              isChef()
                ? `<a class="btn" href="#/recipe/${enc(pick.id)}">看做法 📖</a>`
                : `<button class="btn" data-action="add-cart" data-id="${esc(pick.id)}">加入點餐 🧺</button>`
            }<button class="btn" data-action="rand-plan" data-id="${esc(pick.id)}">排進今天 📅</button></div>`
          : ''
      }</div>
    </main>`
  );
}

function spin() {
  const pool = randomPool();
  if (!pool.length || spinning) return;
  spinning = true;
  const others = pool.length > 1 ? pool.filter(r => r.id !== ui.randId) : pool;
  const final = others[Math.floor(Math.random() * others.length)];
  const slot = $('#slot');
  $('#rand-actions').innerHTML = '';
  let delay = 50;
  let elapsed = 0;
  const step = () => {
    if (elapsed >= 1600) {
      spinning = false;
      ui.randId = final.id;
      refresh();
      $('#slot')?.classList.add('pop');
      return;
    }
    if (slot.isConnected) slot.innerHTML = slotFace(pool[Math.floor(Math.random() * pool.length)]);
    elapsed += delay;
    delay *= 1.13;
    setTimeout(step, delay);
  };
  step();
}

// ----- 一週菜單 -----

const dateKey = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const parseKey = k => {
  const [y, m, d] = k.split('-').map(Number);
  return new Date(y, m - 1, d, 12);
};
function nextDays(n, from = new Date()) {
  return Array.from({ length: n }, (_, i) => {
    const d = new Date(from);
    d.setHours(12, 0, 0, 0);
    d.setDate(d.getDate() + i);
    return dateKey(d);
  });
}
function weekDays(offset) {
  const d = new Date();
  d.setHours(12, 0, 0, 0);
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7) + offset * 7); // 從週一開始
  return nextDays(7, d);
}
function dayLabel(key, short = false) {
  const d = parseKey(key);
  const [today, tomorrow] = nextDays(2);
  const w = `週${WEEKDAYS[d.getDay()]}`;
  if (short) return key === today ? '今天' : key === tomorrow ? '明天' : w;
  return `${w} ${d.getMonth() + 1}/${d.getDate()}`;
}
const planFor = key => data.plans.find(p => p.id === key) || { id: key, date: key, items: [] };

function weekView() {
  const days = weekDays(ui.weekOffset);
  const today = dateKey(new Date());
  const md = k => `${parseKey(k).getMonth() + 1}/${parseKey(k).getDate()}`;
  const title = { '-1': '上週', 0: '這週', 1: '下週' }[ui.weekOffset] || `${md(days[0])} 那週`;
  return (
    header('一週菜單') +
    `<main class="page">
      <div class="week-nav">
        <button class="btn small ghost" data-action="week" data-d="-1">‹ 上週</button>
        <b>${title}<small>${md(days[0])} – ${md(days[6])}</small></b>
        <button class="btn small ghost" data-action="week" data-d="1">下週 ›</button>
      </div>
      ${days.map(k => dayCard(k, today)).join('')}
    </main>`
  );
}

function dayCard(key, today) {
  const items = [...planFor(key).items]
    .filter(it => recipeById(it.recipeId))
    .sort((a, b) => MEALS.indexOf(a.meal) - MEALS.indexOf(b.meal));
  return `<section class="day ${key === today ? 'today' : ''} ${key < today ? 'past' : ''}">
    <div class="day-head"><b>${dayLabel(key)}</b>${key === today ? '<span class="tag love">今天</span>' : ''}
      <button class="btn small ghost" data-action="plan-add" data-date="${key}">＋ 加菜</button></div>
    ${
      items.length
        ? `<ul class="plan-items">${items
            .map(it => {
              const r = recipeById(it.recipeId);
              return `<li>${thumb(r, 'mini')}<a class="grow" href="#/recipe/${enc(r.id)}">${esc(r.name)}</a>
                <span class="meal-tag">${esc(it.meal)}</span>
                <button class="x" data-action="plan-remove" data-date="${key}" data-uid="${esc(it.uid)}" aria-label="移除">✕</button></li>`;
            })
            .join('')}</ul>`
        : '<p class="muted small">還沒安排</p>'
    }
  </section>`;
}

function planPickItems() {
  const q = ui.planQ.trim().toLowerCase();
  const list = data.recipes
    .filter(r => !q || r.name.toLowerCase().includes(q))
    .sort((a, b) => statOf(b.id).avg - statOf(a.id).avg || a.name.localeCompare(b.name, 'zh-Hant'));
  return (
    list
      .map(
        r => `<li><button data-action="plan-pick" data-id="${esc(r.id)}">${thumb(r, 'mini')}<span class="grow">${esc(r.name)}</span>${
          statOf(r.id).n ? `<span class="stars">${starsText(statOf(r.id).avg)}</span>` : ''
        }<b class="plus">＋</b></button></li>`,
      )
      .join('') || '<p class="muted">沒有符合的菜</p>'
  );
}

function planSheet(date) {
  ui.planDate = date;
  ui.planQ = '';
  openSheet(`<h3>${dayLabel(date)} 要吃什麼？</h3>
    <div class="chips wrap">${MEALS.map(
      m => `<label class="chip-radio"><input type="radio" name="plan-meal" value="${m}" ${m === ui.planMeal ? 'checked' : ''}><span>${m}</span></label>`,
    ).join('')}</div>
    <input class="search" type="search" placeholder="🔍 搜尋菜名" data-input="plan-search">
    <ul class="pick-list" id="plan-pick">${planPickItems()}</ul>`);
}

function addToPlan(date, recipeId, meal) {
  const plan = planFor(date);
  persist('plans', { ...plan, date, items: [...plan.items, { uid: uid(), recipeId, meal }], updatedAt: Date.now() }).catch(() => {});
}

function todayPlanCard() {
  const items = planFor(dateKey(new Date())).items.filter(i => recipeById(i.recipeId));
  if (!items.length) return '';
  return `<a class="today-plan" href="#/week"><b>📅 今天的菜單</b><span>${items
    .map(i => `${esc(i.meal)}・${esc(recipeById(i.recipeId).name)}`)
    .join('　')}</span></a>`;
}

// ----- 料理相簿 -----

const photoTile = p =>
  `<button class="photo-tile" data-action="photo-view" data-id="${esc(p.id)}" style="background-image:url('${safePhoto(p.photo)}')" aria-label="看照片"></button>`;

const photoButton = ({ order = '', recipe = '' } = {}, label = '📸 拍照', cls = 'btn small ghost') =>
  `<label class="${cls}">${label}<input type="file" accept="image/*" data-change="album-photo" data-order="${esc(order)}" data-recipe="${esc(
    recipe,
  )}" hidden></label>`;

function albumView() {
  const photos = [...data.photos].sort((a, b) => b.createdAt - a.createdAt);
  const groups = new Map();
  for (const p of photos) {
    const d = new Date(p.createdAt);
    const k = `${d.getFullYear()} 年 ${d.getMonth() + 1} 月`;
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(p);
  }
  return (
    header('料理相簿', '', photoButton({}, '＋ 新增', 'icon-btn strong')) +
    `<main class="page">${
      photos.length
        ? [...groups]
            .map(([k, ps]) => `<h2 class="section">${k}<small> · ${ps.length} 張</small></h2><div class="album-grid">${ps.map(photoTile).join('')}</div>`)
            .join('')
        : `<div class="empty"><p>📸 還沒有照片</p><p class="muted">每次做好菜拍一張，慢慢累積成你們的美食回憶</p>${photoButton({}, '拍第一張', 'btn primary')}</div>`
    }</main>`
  );
}

function newPhotoSheet() {
  const p = pendingPhoto;
  const recipes = [...data.recipes].sort((a, b) => a.name.localeCompare(b.name, 'zh-Hant'));
  openSheet(`<h3>存到相簿</h3>
    <div class="sheet-photo" style="background-image:url('${p.photo}')"></div>
    <label class="field"><span>是哪道菜？</span><select id="photo-recipe"><option value="">（不指定）</option>${recipes
      .map(r => `<option value="${esc(r.id)}" ${r.id === p.recipeId ? 'selected' : ''}>${esc(r.name)}</option>`)
      .join('')}</select></label>
    <label class="field"><span>說點什麼（選填）</span><input id="photo-caption" maxlength="100" placeholder="第一次做成功！"></label>
    <button class="btn primary block big" data-action="save-photo">存到相簿 📸</button>`);
}

async function savePhoto() {
  if (!pendingPhoto) return;
  const doc = {
    id: uid(),
    photo: pendingPhoto.photo,
    recipeId: $('#photo-recipe').value,
    orderId: pendingPhoto.orderId,
    caption: $('#photo-caption').value.trim(),
    by: prefs.role,
    createdAt: Date.now(),
  };
  try {
    await persist('photos', doc);
  } catch {
    return;
  }
  pendingPhoto = null;
  closeSheet();
  toast('已存到相簿 📸');
  const r = recipeById(doc.recipeId);
  // 這道菜還沒有封面的話，順便用這張
  if (r && !r.photo) persist('recipes', { ...r, photo: doc.photo, updatedAt: Date.now() }).catch(() => {});
  notify(otherRole(), { title: '📸 新的料理照片', body: [r?.name, doc.caption].filter(Boolean).join('：') || '去相簿看看', url: './#/album', tag: 'photo' });
}

function photoViewer(id) {
  const p = data.photos.find(x => x.id === id);
  if (!p) return;
  const r = p.recipeId && recipeById(p.recipeId);
  openSheet(`<div class="viewer-photo" style="background-image:url('${safePhoto(p.photo)}')"></div>
    ${p.caption ? `<p class="caption">${esc(p.caption)}</p>` : ''}
    <p class="muted">${r ? `<a href="#/recipe/${enc(r.id)}">🍽️ ${esc(r.name)}</a> · ` : ''}${fmtTime(p.createdAt)} · ${
      p.by === 'chef' ? '👨‍🍳 廚師' : '🥰 點餐的'
    }拍的</p>
    <div class="two">${r ? `<button class="btn" data-action="photo-cover" data-id="${esc(p.id)}">設為這道菜的封面</button>` : ''}
      <button class="btn ghost danger" data-action="photo-delete" data-id="${esc(p.id)}">刪除照片</button></div>
    <button class="btn block" data-action="close-sheet">關閉</button>`);
}

// ----- 設定 -----

function settingsView() {
  const synced = store?.mode === 'firebase';
  let sync;
  if (!hasCloudConfig()) {
    sync = `<p>目前是 <b>本機模式</b>：資料只存在這支手機。</p>
      <p class="muted">想跟另一半看到同一份菜單和訂單，請依 README 設定免費的 Firebase（大約 5 分鐘）。</p>`;
  } else if (synced) {
    sync = `<p>✅ 已同步。廚房代碼：</p><p class="code">${esc(prefs.kitchenId)}</p>
      <p class="muted">另一半打開 App → 設定 → 輸入這組代碼，就能看到同一份菜單。</p>
      <button class="btn primary block" data-action="invite">📤 傳代碼給另一半</button>
      <button class="btn ghost danger block" data-action="leave-kitchen">離開這個廚房</button>`;
  } else {
    sync = `<p class="muted">第一次使用？由其中一人「建立新廚房」，再把代碼傳給另一半輸入。</p>
      <button class="btn primary block" data-action="new-kitchen">建立新廚房</button>
      <div class="join"><input id="join-code" placeholder="輸入廚房代碼" autocapitalize="off" autocorrect="off"><button class="btn" data-action="join-kitchen">加入</button></div>`;
  }
  return (
    header('設定') +
    `<main class="page">
      <section class="panel"><h3>我的身份</h3>
        <div class="seg">
          <button class="${isChef() ? 'on' : ''}" data-action="role" data-role="chef">👨‍🍳 廚師</button>
          <button class="${!isChef() ? 'on' : ''}" data-action="role" data-role="diner">🥰 點餐的</button>
        </div>
      </section>
      <section class="panel"><h3>兩支手機同步</h3>${sync}
        ${storeError ? `<p class="error">⚠️ ${esc(storeError)}</p>` : ''}
      </section>
      <section class="panel"><h3>🏷️ 分類</h3>
        <ul class="cat-list">${categories()
          .map(
            (c, i, all) => `<li><span class="grow">${esc(c)} <small class="muted">${data.recipes.filter(r => r.category === c).length} 道</small></span>
              <button class="x" data-action="cat-move" data-cat="${esc(c)}" data-d="-1" ${i === 0 ? 'disabled' : ''} aria-label="往上">↑</button>
              <button class="x" data-action="cat-move" data-cat="${esc(c)}" data-d="1" ${i === all.length - 1 ? 'disabled' : ''} aria-label="往下">↓</button>
              <button class="x" data-action="cat-rename" data-cat="${esc(c)}" aria-label="改名">✎</button>
              <button class="x" data-action="cat-remove" data-cat="${esc(c)}" aria-label="刪除">✕</button></li>`,
          )
          .join('')}</ul>
        <div class="join"><input id="cat-new" placeholder="新分類，例如：氣炸鍋" data-enter="cat-add"><button class="btn" data-action="cat-add">新增</button></div>
      </section>
      ${notifySection()}
      <section class="panel"><h3>備份</h3>
        <p class="muted">把所有食譜和訂單存成檔案，換手機或出問題時可以匯入。</p>
        <div class="two">
          <button class="btn" data-action="export">匯出備份</button>
          <label class="btn">匯入備份<input type="file" accept="application/json,.json" data-change="import" hidden></label>
        </div>
      </section>
      <p class="muted center">共 ${data.recipes.length} 道菜 · ${data.orders.length} 筆訂單</p>
    </main>`
  );
}

function notifySection() {
  let body;
  if (store?.mode !== 'firebase') body = '<p class="muted">要先完成上面的「兩支手機同步」才能開通知。</p>';
  else if (!pushConfigured()) body = '<p class="muted">還沒設定通知伺服器（見 README「新訂單通知」）。</p>';
  else if (!pushSupported())
    body = '<p class="muted">這支手機現在不能收通知：請確認 iOS 是 16.4 以上，並且是從<b>主畫面的圖示</b>打開小廚房（不是在 Safari 裡）。</p>';
  else {
    const me = data.devices.find(d => d.id === prefs.deviceId);
    const on = me && pushPermission() === 'granted';
    const partner = data.devices.some(d => d.id !== prefs.deviceId && d.sub);
    body = `${
      on
        ? `<p>✅ 這支手機會收到${isChef() ? '新點餐、評分、照片' : '開始做、上菜、照片'}的通知</p>
           ${remindSettings(me)}
           <div class="two"><button class="btn" data-action="push-test">傳測試通知</button><button class="btn ghost danger" data-action="push-off">關閉通知</button></div>`
        : `<p class="muted">${isChef() ? '另一半點餐時' : '廚師開始做、上菜時'}，手機會跳出通知。</p>
           <button class="btn primary block" data-action="push-on">開啟通知 🔔</button>`
    }<p class="muted small">${partner ? '另一半的手機也開了通知 ✅' : '另一半的手機還沒開通知'}</p>`;
  }
  return `<section class="panel"><h3>🔔 通知</h3>${body}</section>`;
}

// 過期提醒：每支手機自己選幾點收到，依手機目前所在的時區
const myTimeZone = () => Intl.DateTimeFormat().resolvedOptions().timeZone || '';
const remindHourOf = d => (Number.isInteger(d?.remindHour) ? d.remindHour : 9);
const hourLabel = h =>
  h === 0 ? '午夜 12:00' : h < 6 ? `凌晨 ${h}:00` : h < 12 ? `早上 ${h}:00` : h === 12 ? '中午 12:00' : `${h < 18 ? '下午' : '晚上'} ${h - 12}:00`;

function remindSettings(me) {
  const on = me.remind !== false;
  return `<div class="remind">
    <label class="switch-row"><input type="checkbox" data-change="remind-on" ${on ? 'checked' : ''}><span>每天提醒快過期的食材</span></label>
    ${
      on
        ? `<label class="remind-time"><span>提醒時間</span><select data-change="remind-hour">${Array.from(
            { length: 24 },
            (_, h) => `<option value="${h}" ${h === remindHourOf(me) ? 'selected' : ''}>${hourLabel(h)}</option>`,
          ).join('')}</select></label>
          <p class="muted small">跟著手機所在地的時間（目前：${esc(myTimeZone() || '未知')}），換地方會自動調整</p>`
        : ''
    }
  </div>`;
}

function updateMyDevice(patch) {
  const me = data.devices.find(d => d.id === prefs.deviceId);
  if (me) persist('devices', { ...me, ...patch, updatedAt: Date.now() }).catch(() => {});
}

async function enablePush() {
  try {
    const sub = await subscribePush();
    const old = data.devices.find(d => d.id === prefs.deviceId) || {};
    await persist('devices', {
      remind: true,
      remindHour: 9,
      ...old,
      id: prefs.deviceId,
      role: prefs.role,
      sub,
      tz: myTimeZone(),
      updatedAt: Date.now(),
    });
    toast('通知已開啟 🔔');
  } catch (err) {
    toast(err.message || '開啟通知失敗');
  }
}

function setKitchen(code, { migrate = false } = {}) {
  prefs.kitchenId = code;
  prefs.migrate = migrate;
  savePrefs();
  location.reload();
}

async function shareInvite() {
  const link = `${location.origin}${location.pathname}?k=${enc(prefs.kitchenId)}`;
  const text = `來加入我們的小廚房 🍳\n廚房代碼：${prefs.kitchenId}\n（打開 App → 設定 → 輸入代碼）`;
  try {
    if (navigator.share) await navigator.share({ title: '我們的小廚房', text, url: link });
    else {
      await navigator.clipboard.writeText(`${text}\n${link}`);
      toast('已複製，貼給另一半吧');
    }
  } catch {
    /* 使用者取消分享 */
  }
}

function exportBackup() {
  const payload = { app: 'our-kitchen', version: 1, exportedAt: Date.now(), recipes: data.recipes, orders: data.orders };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `小廚房備份-${new Date().toISOString().slice(0, 10)}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

async function importBackup(file) {
  let payload;
  try {
    payload = JSON.parse(await file.text());
  } catch {
    toast('這不是有效的備份檔');
    return;
  }
  const recipes = (payload.recipes || []).filter(r => r && r.id && r.name);
  const orders = (payload.orders || []).filter(o => o && o.id && Array.isArray(o.items));
  if (!confirm(`要匯入 ${recipes.length} 道菜和 ${orders.length} 筆訂單嗎？相同的項目會被覆蓋。`)) return;
  try {
    for (const r of recipes) await persist('recipes', { ...r, photo: safePhoto(r.photo) });
    for (const o of orders) await persist('orders', o);
    toast('匯入完成 🎉');
  } catch {
    /* persist 已經顯示錯誤 */
  }
}

// ---------- 事件 ----------

const actions = {
  role(el) {
    prefs.role = el.dataset.role;
    savePrefs();
    const me = data.devices.find(d => d.id === prefs.deviceId);
    if (me && me.role !== prefs.role) persist('devices', { ...me, role: prefs.role }).catch(() => {});
    if (!location.hash) location.hash = '#/menu';
    refresh();
  },
  cat(el) {
    ui.category = el.dataset.cat;
    refresh();
  },
  'add-cart': el => addToCart(el.dataset.id),
  qty(el) {
    const item = cart.find(i => i.recipeId === el.dataset.id);
    if (!item) return;
    item.qty += Number(el.dataset.d);
    cart = cart.filter(i => i.qty > 0);
    save('cart', cart);
    refresh();
  },
  'submit-order': submitOrder,
  'save-recipe': saveRecipe,
  'delete-recipe'(el) {
    const r = recipeById(el.dataset.id);
    if (!r || !confirm(`確定要刪除「${r.name}」嗎？`)) return;
    destroy('recipes', r.id);
    cart = cart.filter(i => i.recipeId !== r.id);
    save('cart', cart);
    toast('已刪除');
    location.hash = '#/menu';
  },
  'add-ing'() {
    $('#ing-list').insertAdjacentHTML('beforeend', ingRow());
    $('#ing-list .ing-row:last-child .ing-name').focus();
  },
  'add-step'() {
    $('#step-list').insertAdjacentHTML('beforeend', stepRow());
    $('#step-list .step-row:last-child textarea').focus();
  },
  'remove-row'(el) {
    el.parentElement.remove();
  },
  'remove-photo'() {
    draft.photo = '';
    $('#photo-slot').innerHTML = photoPicker();
  },
  'cook-step'(el) {
    cook.showIng = !!$('.cook-ing')?.open;
    const d = Number(el.dataset.d);
    if (d > 0) setCheck(cook.id, 'step', cook.step, true); // 按下一步 = 這一步完成
    cook.step = Math.max(0, cook.step + d);
    render();
  },
  'cook-goto'(el) {
    cook.showIng = !!$('.cook-ing')?.open;
    cook.step = Number(el.dataset.i);
    render();
  },
  'cook-reset'(el) {
    resetChecks(el.dataset.id);
    refresh();
  },
  'cook-finish'() {
    if (cook) resetChecks(cook.id); // 做完了，下次重新開始
    cook = null;
    toast('辛苦了，開飯囉 🎉');
    location.hash = '#/orders';
  },
  'order-status'(el) {
    const o = data.orders.find(x => x.id === el.dataset.id);
    if (!o) return;
    const status = el.dataset.status;
    persist('orders', { ...o, status, updatedAt: Date.now() }).catch(() => {});
    const tag = `order-${o.id}`;
    if (status === 'cooking') notify('diner', { title: '🔥 廚師開始做囉', body: itemsText(o.items), url: './#/orders', tag });
    if (status === 'done') notify('diner', { title: '🍽️ 上菜囉！', body: `${itemsText(o.items)}\n快來吃，吃完記得評分 ⭐`, url: './#/orders', tag });
  },
  review(el) {
    const o = data.orders.find(x => x.id === el.dataset.id);
    if (o) reviewSheet(o);
  },
  star(el) {
    const box = el.parentElement;
    const n = Number(el.dataset.n);
    box.dataset.val = n;
    [...box.children].forEach((b, i) => b.classList.toggle('on', i < n));
  },
  'save-review': el => saveReview(el.dataset.id),
  'close-sheet': closeSheet,
  'timer-start'(el) {
    startTimer(Number(el.dataset.sec), el.dataset.label);
    toast(`⏱ 開始計時 ${el.textContent.replace('⏱', '').trim()}`);
  },
  'timer-stop': el => stopTimer(el.dataset.id),
  'rand-cat'(el) {
    ui.randCat = el.dataset.cat;
    ui.randId = null;
    refresh();
  },
  spin,
  'rand-plan'(el) {
    addToPlan(dateKey(new Date()), el.dataset.id, defaultMeal());
    toast('已排進今天的菜單 📅');
  },
  week(el) {
    ui.weekOffset += Number(el.dataset.d);
    render();
  },
  'plan-add': el => planSheet(el.dataset.date),
  'plan-pick'(el) {
    ui.planMeal = document.querySelector('input[name=plan-meal]:checked')?.value || ui.planMeal;
    addToPlan(ui.planDate, el.dataset.id, ui.planMeal);
    closeSheet();
    toast(`已加到${dayLabel(ui.planDate, true)}的菜單`);
  },
  'plan-remove'(el) {
    const plan = planFor(el.dataset.date);
    persist('plans', { ...plan, items: plan.items.filter(i => i.uid !== el.dataset.uid), updatedAt: Date.now() }).catch(() => {});
  },
  'photo-view': el => photoViewer(el.dataset.id),
  'save-photo': savePhoto,
  'photo-cover'(el) {
    const p = data.photos.find(x => x.id === el.dataset.id);
    const r = p && recipeById(p.recipeId);
    if (!r) return;
    persist('recipes', { ...r, photo: safePhoto(p.photo), updatedAt: Date.now() }).catch(() => {});
    closeSheet();
    toast(`已設為「${r.name}」的封面`);
  },
  'photo-delete'(el) {
    if (!confirm('確定要刪除這張照片嗎？')) return;
    destroy('photos', el.dataset.id);
    closeSheet();
  },
  'shop-add'() {
    const input = $('#shop-new');
    addShopItem(input.value);
    input.value = '';
  },
  'fav-add'(el) {
    const name = el.dataset.name;
    const { extra } = shopMeta();
    if (extra.some(x => x.name === name)) saveShop({ extra: extra.filter(x => x.name !== name) });
    else addShopItem(name);
  },
  'fav-edit'() {
    ui.favEdit = !ui.favEdit;
    refresh();
  },
  'fav-remove'(el) {
    const { favorites } = shopMeta();
    saveShop({ favorites: favorites.filter(n => n !== el.dataset.name) });
  },
  'cat-add'() {
    const input = $('#cat-new');
    const name = input.value.trim();
    if (!name) return;
    if (categories().includes(name)) return toast('已經有這個分類了');
    saveCategories([...categories(), name]);
    input.value = '';
  },
  'cat-rename'(el) {
    const old = el.dataset.cat;
    const name = prompt(`把「${old}」改成：`, old)?.trim();
    if (!name || name === old) return;
    if (categories().includes(name)) return toast('已經有這個分類了');
    saveCategories(categories().map(c => (c === old ? name : c)));
    for (const r of data.recipes.filter(r => r.category === old)) persist('recipes', { ...r, category: name }).catch(() => {});
  },
  'cat-remove'(el) {
    const cat = el.dataset.cat;
    const n = data.recipes.filter(r => r.category === cat).length;
    if (categories().length <= 1) return toast('至少要留一個分類');
    if (!confirm(n ? `刪除「${cat}」？這個分類的 ${n} 道菜會移到「${categories().find(c => c !== cat)}」。` : `刪除「${cat}」？`)) return;
    const rest = categories().filter(c => c !== cat);
    saveCategories(rest);
    for (const r of data.recipes.filter(r => r.category === cat)) persist('recipes', { ...r, category: rest[0] }).catch(() => {});
  },
  'cat-move'(el) {
    const list = [...categories()];
    const i = list.indexOf(el.dataset.cat);
    const j = i + Number(el.dataset.d);
    if (i < 0 || j < 0 || j >= list.length) return;
    [list[i], list[j]] = [list[j], list[i]];
    saveCategories(list);
  },
  'push-on': enablePush,
  async 'push-off'() {
    await unsubscribePush().catch(() => {});
    destroy('devices', prefs.deviceId);
    toast('已關閉通知');
  },
  async 'push-test'() {
    const me = data.devices.find(d => d.id === prefs.deviceId);
    if (!me) return;
    try {
      await sendPush([me], { title: '🔔 測試通知', body: '通知設定成功！之後有新消息就會出現在這裡', url: './#/settings', tag: 'test' });
      toast('已送出，幾秒內會收到（App 開著時可能不會跳出）');
    } catch (err) {
      toast(err.message);
    }
  },
  'delete-order'(el) {
    const o = data.orders.find(x => x.id === el.dataset.id);
    const msg = o?.status === 'pending' ? '確定要取消這筆點餐嗎？' : '刪除這筆紀錄？';
    if (o && confirm(msg)) destroy('orders', o.id);
  },
  reorder(el) {
    const o = data.orders.find(x => x.id === el.dataset.id);
    for (const it of o?.items || []) {
      if (!recipeById(it.recipeId)) continue;
      const item = cart.find(i => i.recipeId === it.recipeId);
      if (item) item.qty += it.qty;
      else cart.push({ recipeId: it.recipeId, qty: it.qty });
    }
    save('cart', cart);
    location.hash = '#/cart';
  },
  serv(el) {
    const r = recipeById(el.dataset.id);
    if (!r) return;
    const base = baseServings(r);
    scales[r.id] = Math.max(base ? 1 : 0.5, currentServings(r) + (base ? 1 : 0.5) * Number(el.dataset.d));
    if (route().name === 'cook') cook.showIng = !!$('.cook-ing')?.open;
    refresh();
  },
  'serv-reset'(el) {
    delete scales[el.dataset.id];
    refresh();
  },
  'pantry-new': () => pantrySheet(),
  'pantry-edit'(el) {
    const p = data.pantry.find(x => x.id === el.dataset.id);
    if (p) pantrySheet(p);
  },
  'pt-days'(el) {
    const n = el.dataset.n;
    $('#pt-exp').value = n ? nextDays(Number(n) + 1)[Number(n)] : '';
  },
  'pantry-save'(el) {
    const name = $('#pt-name').value.trim();
    if (!name) return toast('請輸入是什麼');
    const old = data.pantry.find(x => x.id === el.dataset.id);
    const place = document.querySelector('input[name=pt-place]:checked')?.value || '冷藏';
    persist('pantry', {
      ...(old || {}),
      id: old?.id || uid(),
      name,
      qty: $('#pt-qty').value.trim(),
      place,
      expires: $('#pt-exp').value || '',
      addedAt: old?.addedAt || Date.now(),
      updatedAt: Date.now(),
    }).catch(() => {});
    closeSheet();
    toast(old ? '已更新' : `已放進${place}`);
  },
  'pantry-used'(el) {
    const p = data.pantry.find(x => x.id === el.dataset.id);
    if (!p) return;
    destroy('pantry', p.id);
    closeSheet();
    toast(`${p.name} 用完了 👍`);
  },
  'bought-to-pantry'() {
    const { items } = shoppingList();
    const bought = items.filter(i => isChecked(i.name));
    for (const i of bought) {
      if (!inPantry(i.name)) persist('pantry', { id: uid(), name: i.name, qty: '', place: '冷藏', expires: '', addedAt: Date.now(), updatedAt: Date.now() }).catch(() => {});
    }
    actions['clear-checked']();
    toast(`已把 ${bought.length} 樣放進家裡存貨，記得去補到期日`);
  },
  async 'expiry-test'() {
    try {
      const r = await checkExpiryNow();
      if (r.skipped) toast('還沒在 Cloudflare 設定每日提醒（見 README）');
      else if (!r.due) toast('目前沒有快過期的東西 👍');
      else toast(`有 ${r.due} 樣快過期，已送出 ${r.sent} 則通知`);
    } catch (err) {
      toast(err.message);
    }
  },
  'lib-add'(el) {
    const r = LIBRARY.find(x => x.id === el.dataset.id);
    if (r) addFromLibrary([r]);
  },
  'lib-add-all': () => addFromLibrary(libraryMissing()),
  'clear-checked'() {
    // 自己加的東西勾掉後就從清單拿掉（常買裡還在）
    const { extra } = shopMeta();
    const left = extra.filter(x => !isChecked(x.name));
    if (left.length !== extra.length) saveShop({ extra: left });
    saveChecked([]);
    refresh();
  },
  'new-kitchen'() {
    if (confirm('建立一個新的共用廚房？這支手機上的食譜會一起上傳。')) setKitchen(newKitchenCode(), { migrate: true });
  },
  'join-kitchen'() {
    const code = $('#join-code').value.trim().toLowerCase();
    if (code.length < 14) {
      toast('代碼看起來不完整');
      return;
    }
    setKitchen(code);
  },
  'leave-kitchen'() {
    if (confirm('離開後這支手機會回到本機模式（雲端資料不會被刪除），確定嗎？')) setKitchen('');
  },
  invite: shareInvite,
  export: exportBackup,
};

document.addEventListener('click', e => {
  const el = e.target.closest('[data-action]');
  if (!el) return;
  const fn = actions[el.dataset.action];
  if (!fn) return;
  e.preventDefault();
  fn(el, e);
});

document.addEventListener('input', e => {
  if (e.target.dataset.input === 'search') {
    ui.q = e.target.value;
    renderMenuList();
  } else if (e.target.dataset.input === 'plan-search') {
    ui.planQ = e.target.value;
    $('#plan-pick').innerHTML = planPickItems();
  }
});

document.addEventListener('change', async e => {
  const t = e.target;
  if (t.dataset.change === 'shop') {
    setChecked(t.dataset.key, t.checked);
    refresh();
  } else if (t.dataset.change === 'photo' && t.files[0]) {
    try {
      draft.photo = await compressImage(t.files[0]);
      $('#photo-slot').innerHTML = photoPicker();
    } catch {
      toast('這張照片讀不了，換一張試試');
    }
  } else if (t.dataset.change === 'cook-check') {
    setCheck(t.dataset.rid, t.dataset.kind, t.dataset.i, t.checked);
    if (route().name === 'cook') cook.showIng = !!$('.cook-ing')?.open;
    refresh();
  } else if (t.dataset.change === 'category' && t.value === '__new__') {
    const name = prompt('新分類的名字：')?.trim();
    if (name && !categories().includes(name)) saveCategories([...categories(), name]);
    const opt = [...t.options].find(o => o.value === name);
    if (name && !opt) t.insertAdjacentHTML('afterbegin', `<option>${esc(name)}</option>`);
    t.value = name || categories()[0];
  } else if (t.dataset.change === 'remind-on') {
    updateMyDevice({ remind: t.checked });
  } else if (t.dataset.change === 'remind-hour') {
    updateMyDevice({ remindHour: Number(t.value) });
    toast(`之後每天 ${hourLabel(Number(t.value))} 提醒`);
  } else if (t.dataset.change === 'shop-plan') {
    prefs.shopPlan = t.checked;
    savePrefs();
    refresh();
  } else if (t.dataset.change === 'album-photo' && t.files[0]) {
    try {
      pendingPhoto = { photo: await compressImage(t.files[0], 1200, 0.75), orderId: t.dataset.order, recipeId: t.dataset.recipe };
      newPhotoSheet();
    } catch {
      toast('這張照片讀不了，換一張試試');
    }
    t.value = '';
  } else if (t.dataset.change === 'import' && t.files[0]) {
    await importBackup(t.files[0]);
    t.value = '';
  }
});

document.addEventListener('keydown', e => {
  const action = e.target.dataset?.enter;
  if (e.key === 'Enter' && action && actions[action]) {
    e.preventDefault();
    actions[action](e.target);
  }
});

// iPhone 鍵盤收起後，畫面有時不會回到原位，底部分頁列會卡在鍵盤原本的高度、浮在畫面中間。
// 打字時先藏起分頁列，鍵盤收起後再捲動一下，讓 iPhone 重新計算畫面位置。
const isTextField = el =>
  !!el && (el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || (el.tagName === 'INPUT' && !['checkbox', 'radio', 'file', 'button'].includes(el.type)));
function resetViewport() {
  const y = window.scrollY;
  window.scrollTo(0, y + 1);
  window.scrollTo(0, y);
}
document.addEventListener('focusin', e => {
  if (isTextField(e.target)) document.body.classList.add('typing');
});
document.addEventListener('focusout', e => {
  if (!isTextField(e.target)) return;
  setTimeout(() => {
    if (isTextField(document.activeElement)) return; // 只是換到下一個輸入框
    document.body.classList.remove('typing');
    resetViewport();
  }, 120);
});
window.visualViewport?.addEventListener('resize', () => {
  if (!isTextField(document.activeElement)) resetViewport();
});

window.addEventListener('hashchange', () => {
  closeSheet();
  if (!isTextField(document.activeElement)) document.body.classList.remove('typing');
  render();
  window.scrollTo(0, 0);
});

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && route().name === 'cook') requestWakeLock();
});

// ---------- 啟動 ----------

let tzSynced = false;
let checksMigrated = false;

function onData(next) {
  data = next;
  // 手機換了時區（出國、搬家）就更新，過期提醒才會在當地的時間送到
  // 舊版的打勾存在手機上，第一次載入時併進共用清單
  if (data.loaded && !checksMigrated) {
    checksMigrated = true;
    const old = Object.keys(load('checked', {}));
    if (old.length) {
      saveChecked(new Set([...checkedNames(), ...old]));
      localStorage.removeItem('rb.checked');
    }
  }
  if (data.loaded && !tzSynced) {
    tzSynced = true;
    const me = data.devices.find(d => d.id === prefs.deviceId);
    if (me && myTimeZone() && me.tz !== myTimeZone()) updateMyDevice({ tz: myTimeZone() });
  }
  if (data.loaded && store) seedIfEmpty();
  // 編輯中不要重畫，免得打到一半的字不見
  const { name } = route();
  if (name === 'edit' || name === 'new') return;
  refresh();
}

function seedIfEmpty() {
  // 共用廚房不放範例菜：網路慢時第一次載入可能看起來是空的，會把範例菜塞進另一半的菜單
  if (prefs.seeded || store?.mode !== 'local') return;
  prefs.seeded = true;
  savePrefs();
  if (data.recipes.length) return;
  const now = Date.now();
  SAMPLES.forEach((s, i) => persist('recipes', { ...s, photo: '', addedBy: 'chef', createdAt: now - i, updatedAt: now - i }).catch(() => {}));
}

async function migrateLocalData() {
  prefs.migrate = false;
  savePrefs();
  const recipes = readLocal('recipes');
  for (const r of recipes) await persist('recipes', r).catch(() => {});
  if (recipes.length) toast(`已把 ${recipes.length} 道菜上傳到共用廚房`);
}

async function boot() {
  initTimers(t => toast(`⏰ ${t.label} 時間到！`));
  render();
  const useCloud = hasCloudConfig() && prefs.kitchenId;
  store = await createStore(
    { firebase: useCloud ? CONFIG.firebase : null, kitchenId: prefs.kitchenId },
    onData,
    err => {
      storeError =
        err?.code === 'permission-denied' ? '沒有權限讀取雲端資料，請檢查 Firestore 規則（見 README）' : `雲端同步失敗：${err?.message || err}`;
      toast(storeError);
      refresh();
    },
  );
  if (data.loaded) seedIfEmpty();
  if (store.mode === 'firebase' && prefs.migrate) migrateLocalData();
}

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('./sw.js').catch(() => {});
}

boot();
