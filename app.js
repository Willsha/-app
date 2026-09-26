import { CONFIG } from './config.js';
import { createStore, readLocal } from './store.js';

const CATEGORIES = ['家常菜', '湯品', '麵飯', '早午餐', '甜點', '飲料', '其他'];
const MEALS = ['早餐', '午餐', '晚餐', '宵夜', '隨時'];
const STATUS = { pending: '等待中', cooking: '製作中', done: '已完成' };
const EMOJIS = ['🍳', '🍜', '🍲', '🥘', '🍛', '🍝', '🥗', '🍣', '🥟', '🍤', '🍗', '🥩', '🐟', '🥬', '🍰', '🧋'];
const WISH = '💕 想吃';

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

const prefs = { role: null, kitchenId: '', seeded: false, migrate: false, ...load('prefs', {}) };
const savePrefs = () => save('prefs', prefs);
let cart = load('cart', []); // [{ recipeId, qty }]
let checked = load('checked', {}); // 買菜清單勾選狀態 { 食材名: true }
let data = { recipes: [], orders: [], loaded: false };
let store = null;
let storeError = '';
const ui = { category: '全部', q: '' };
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
};

function render() {
  const app = $('#app');
  if (!prefs.role) {
    app.innerHTML = roleView();
    return;
  }
  const r = route();
  const view = VIEWS[r.name] || menuView;
  app.innerHTML = view(r) + (r.name === 'cook' ? '' : tabbar(r.name));
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
        ['shopping', '🛒', '買菜清單'],
        ['settings', '⚙️', '設定'],
      ]
    : [
        ['menu', '📖', '菜單'],
        ['cart', '🧺', '點餐', cartCount()],
        ['orders', '💌', '我的訂單', pending],
        ['settings', '⚙️', '設定'],
      ];
  const current = { recipe: 'menu', edit: 'menu', new: 'menu' }[active] || active;
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
  const cats = ['全部', WISH, ...CATEGORIES.filter(c => data.recipes.some(r => r.category === c))];
  return (
    header('我們的菜單', '', `<a class="icon-btn strong" href="#/new">＋ 新增</a>`) +
    `<main class="page">
      <input class="search" type="search" placeholder="🔍 搜尋菜名或食材" value="${esc(ui.q)}" data-input="search">
      <div class="chips">${cats
        .map(c => `<button class="chip ${ui.category === c ? 'on' : ''}" data-action="cat" data-cat="${esc(c)}">${esc(c)}</button>`)
        .join('')}</div>
      <div id="recipe-list" class="grid"></div>
    </main>` +
    cartBar()
  );
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
  if (!data.loaded) el.innerHTML = '<p class="empty">載入中…</p>';
  else if (!data.recipes.length)
    el.innerHTML = `<div class="empty"><p>菜單還是空的</p><a class="btn primary" href="#/new">新增第一道菜</a></div>`;
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
        ${r.addedBy === 'diner' ? `<span class="tag love">${WISH}</span>` : ''}
      </div>
      ${r.notes ? `<p class="notes">📝 ${esc(r.notes)}</p>` : ''}
      <section class="panel">
        <h3>🥕 食材 <small>${ings.length ? `${ings.length} 樣` : ''}</small></h3>
        ${
          ings.length
            ? `<ul class="ings">${ings
                .map(i => `<li><label><input type="checkbox"><span class="n">${esc(i.name)}</span><span class="a">${esc(i.amount)}</span></label></li>`)
                .join('')}</ul>`
            : `<p class="muted">還沒填食材${isChef() ? '，點右上角「編輯」補上吧' : ''}</p>`
        }
      </section>
      <section class="panel">
        <h3>👩‍🍳 步驟</h3>
        ${
          steps.length
            ? `<ol class="steps">${steps.map(s => `<li>${esc(s)}</li>`).join('')}</ol>`
            : `<p class="muted">還沒寫做法${isChef() ? '，點右上角「編輯」補上吧' : '，交給廚師研究 😘'}</p>`
        }
      </section>
      <div class="actions">
        ${
          isChef()
            ? `<a class="btn primary block" href="#/cook/${enc(r.id)}">開始做菜 🔥</a>`
            : `<button class="btn primary block" data-action="add-cart" data-id="${esc(r.id)}">加入點餐 🧺</button>`
        }
        <button class="btn ghost danger block" data-action="delete-recipe" data-id="${esc(r.id)}">刪除這道菜</button>
      </div>
    </main>` +
    cartBar()
  );
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
    category: CATEGORIES[0],
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
          <label>分類<select name="category">${CATEGORIES.map(
            c => `<option ${c === d.category ? 'selected' : ''}>${c}</option>`,
          ).join('')}</select></label>
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
        ? `<details class="cook-ing panel" ${cook.showIng ? 'open' : ''}><summary>🥕 食材（${ings.length} 樣）</summary>
            <ul class="ings">${ings
              .map(x => `<li><label><input type="checkbox"><span class="n">${esc(x.name)}</span><span class="a">${esc(x.amount)}</span></label></li>`)
              .join('')}</ul></details>`
        : ''
    }
    <div class="cook-step"><div class="num">步驟 ${i + 1}</div><p>${esc(steps[i])}</p></div>
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
    else if (o.status === 'done') actions = btn('刪除紀錄', 'delete-order', '', 'ghost danger') + btn('再點一次', 'reorder', '', 'primary');
  }
  return `<article class="order s-${esc(o.status)}">
    <div class="order-top"><span class="status">${STATUS[o.status] || ''}</span><span class="meal">${esc(o.meal)}</span><time>${fmtTime(o.createdAt)}</time></div>
    <ul class="order-items">${(o.items || [])
      .map(i => `<li><a href="#/recipe/${enc(i.recipeId)}">${esc(i.name)}</a>${i.qty > 1 ? ` <b>× ${i.qty}</b>` : ''}</li>`)
      .join('')}</ul>
    ${o.note ? `<p class="note">💬 ${esc(o.note)}</p>` : ''}
    ${actions ? `<div class="order-actions">${actions}</div>` : ''}
  </article>`;
}

// ----- 買菜清單（廚師） -----

function shoppingList() {
  const map = new Map();
  const missing = new Set();
  for (const o of activeOrders()) {
    for (const item of o.items || []) {
      const r = recipeById(item.recipeId);
      if (!r) continue;
      if (!(r.ingredients || []).length) missing.add(r.name);
      for (const ing of r.ingredients || []) {
        const key = ing.name.trim();
        if (!map.has(key)) map.set(key, { name: key, uses: [] });
        map.get(key).uses.push(`${r.name}${ing.amount ? ` ${ing.amount}` : ''}${item.qty > 1 ? ` ×${item.qty}` : ''}`);
      }
    }
  }
  const items = [...map.values()].sort((a, b) => Number(!!checked[a.name]) - Number(!!checked[b.name]));
  return { items, missing: [...missing] };
}

function shoppingView() {
  const { items, missing } = shoppingList();
  const doneCount = items.filter(i => checked[i.name]).length;
  return (
    header('買菜清單', '', doneCount ? `<button class="icon-btn" data-action="clear-checked">清除勾選</button>` : '') +
    `<main class="page">
      <p class="muted">根據「進行中」的訂單自動整理需要的食材。</p>
      ${
        items.length
          ? `<p class="progress-text">已買 ${doneCount} / ${items.length}</p><ul class="shop">${items
              .map(
                i => `<li><label class="${checked[i.name] ? 'done' : ''}"><input type="checkbox" data-change="shop" data-key="${esc(i.name)}" ${
                  checked[i.name] ? 'checked' : ''
                }><span><b>${esc(i.name)}</b><small>${i.uses.map(esc).join('、')}</small></span></label></li>`,
              )
              .join('')}</ul>`
          : `<div class="empty"><p>🛒 目前不用買菜</p></div>`
      }
      ${missing.length ? `<p class="hint">⚠️ 這些菜還沒填食材：${missing.map(esc).join('、')}</p>` : ''}
    </main>`
  );
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
    cook.step = Math.max(0, cook.step + Number(el.dataset.d));
    render();
  },
  'cook-finish'() {
    cook = null;
    toast('辛苦了，開飯囉 🎉');
    location.hash = '#/orders';
  },
  'order-status'(el) {
    const o = data.orders.find(x => x.id === el.dataset.id);
    if (!o) return;
    persist('orders', { ...o, status: el.dataset.status, updatedAt: Date.now() }).catch(() => {});
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
  'clear-checked'() {
    checked = {};
    save('checked', checked);
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
  }
});

document.addEventListener('change', async e => {
  const t = e.target;
  if (t.dataset.change === 'shop') {
    if (t.checked) checked[t.dataset.key] = true;
    else delete checked[t.dataset.key];
    save('checked', checked);
    refresh();
  } else if (t.dataset.change === 'photo' && t.files[0]) {
    try {
      draft.photo = await compressImage(t.files[0]);
      $('#photo-slot').innerHTML = photoPicker();
    } catch {
      toast('這張照片讀不了，換一張試試');
    }
  } else if (t.dataset.change === 'import' && t.files[0]) {
    await importBackup(t.files[0]);
    t.value = '';
  }
});

window.addEventListener('hashchange', () => {
  render();
  window.scrollTo(0, 0);
});

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && route().name === 'cook') requestWakeLock();
});

// ---------- 啟動 ----------

function onData(next) {
  data = next;
  if (data.loaded && store) seedIfEmpty();
  // 編輯中不要重畫，免得打到一半的字不見
  const { name } = route();
  if (name === 'edit' || name === 'new') return;
  refresh();
}

function seedIfEmpty() {
  if (prefs.seeded) return;
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
