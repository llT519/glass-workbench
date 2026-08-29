/* ============================================================
   玻璃工作台 · 应用逻辑
   - 状态管理：localStorage 本地优先，模块级云同步（last-write-wins）
   - 视觉：棱镜玻璃调色引擎（整页换肤）+ 流体玻璃指标卡（canonical 内核）+ 3D 卡片环（iframe）
   ============================================================ */
(() => {
  'use strict';

  /* ================= 工具 ================= */
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
  const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  const pad = (n) => String(n).padStart(2, '0');
  const todayStr = (d = new Date()) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const money = (n) => (Math.round(n * 100) / 100).toLocaleString('zh-CN');
  const WEEK_ZH = ['一', '二', '三', '四', '五', '六', '日']; // 周一为一周开始

  let toastTimer = 0;
  function toast(msg) {
    const el = $('#toast');
    el.textContent = msg;
    el.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove('show'), 2200);
  }

  /* ================= 状态管理 ================= */
  const STORE_KEY = 'workbench_state_v1';
  const TS_KEY = 'workbench_module_ts_v1';
  const MODULES = ['settings', 'profile', 'todos', 'pomodoro', 'notes', 'navLinks', 'ledger', 'study', 'vocab', 'goals', 'schedule'];

  const DEFAULT_STATE = {
    settings: { palette: 'US-00', intensity: .55, ambientStrength: .42, surfaceTint: .28, fluidQuality: 'auto' },
    profile: { name: '' },
    todos: [],
    pomodoro: { workMin: 25, restMin: 5, daily: {} },
    notes: [],
    navLinks: [
      { id: 'n1', name: 'Bing 搜索', url: 'https://www.bing.com' },
      { id: 'n2', name: 'GitHub', url: 'https://github.com' },
      { id: 'n3', name: '哔哩哔哩', url: 'https://www.bilibili.com' },
      { id: 'n4', name: '知乎', url: 'https://www.zhihu.com' }
    ],
    ledger: { records: [] },
    study: { items: [] },
    vocab: { words: [] },
    goals: [],
    schedule: { '1': [], '2': [], '3': [], '4': [], '5': [], '6': [], '7': [] }
  };

  function deepMerge(base, patch) {
    if (Array.isArray(base) || Array.isArray(patch)) return patch ?? base;
    if (typeof base === 'object' && base && typeof patch === 'object' && patch) {
      const out = { ...base };
      for (const k of Object.keys(patch)) out[k] = deepMerge(base[k], patch[k]);
      return out;
    }
    return patch === undefined ? base : patch;
  }

  function loadState() {
    try {
      const raw = JSON.parse(localStorage.getItem(STORE_KEY) || '{}');
      const out = {};
      for (const mod of MODULES) out[mod] = deepMerge(DEFAULT_STATE[mod], raw[mod]);
      return out;
    } catch (_) {
      return JSON.parse(JSON.stringify(DEFAULT_STATE));
    }
  }
  function loadTs() {
    try { return JSON.parse(localStorage.getItem(TS_KEY) || '{}'); } catch (_) { return {}; }
  }

  let state = loadState();
  let moduleTs = loadTs();
  MODULES.forEach((m) => { if (!moduleTs[m]) moduleTs[m] = 0; });

  function persist() {
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify(state));
      localStorage.setItem(TS_KEY, JSON.stringify(moduleTs));
    } catch (e) { console.warn('[存储] 写入失败：', e); }
  }
  /* 模块变更统一入口：记录时间戳 → 持久化 → 云端推送 */
  function saveModule(mod) {
    moduleTs[mod] = Date.now();
    persist();
    Sync.pushModule(mod, state[mod], moduleTs[mod]);
  }

  /* 远端合并：模块级 last-write-wins */
  let mergeToastTimer = 0;
  Sync.onRemoteChange((rows) => {
    let changed = false;
    for (const row of rows) {
      const mod = row && row.module;
      if (!MODULES.includes(mod)) continue;
      const remoteMs = new Date(row.updated_at).getTime();
      if (Number.isFinite(remoteMs) && remoteMs > (moduleTs[mod] || 0)) {
        state[mod] = deepMerge(DEFAULT_STATE[mod], row.payload);
        moduleTs[mod] = remoteMs;
        changed = true;
      }
    }
    if (changed) {
      persist();
      applyPalette();
      renderAll();
      updateFluidCards();
      clearTimeout(mergeToastTimer);
      mergeToastTimer = setTimeout(() => toast('☁ 已同步其他设备的最新数据'), 300);
    }
  });
  Sync.onStatus((s) => {
    const textMap = { off: '本地模式', ok: '已同步', busy: '同步中…', error: '同步异常' };
    $('#syncText').textContent = textMap[s] || s;
    $('#syncDot').dataset.state = s;
    $('#syncDotM').dataset.state = s;
  });

  /* ================= 内联 SVG 图标集（统一 1.8 描边，24 viewBox） ================= */
  const I = (paths) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths}</svg>`;
  const ICONS = {
    home: I('<path d="M3 10.5 12 3l9 7.5"/><path d="M5 9.5V21h14V9.5"/>'),
    study: I('<path d="M2 4h6a4 4 0 0 1 4 4v12a3 3 0 0 0-3-3H2z"/><path d="M22 4h-6a4 4 0 0 0-4 4v12a3 3 0 0 1 3-3h7z"/>'),
    ledger: I('<path d="M21 12V7H5a2 2 0 0 1 0-4h14v4"/><path d="M3 5v14a2 2 0 0 0 2 2h16v-5"/><path d="M18 12a2 2 0 0 0 0 4h4v-4z"/>'),
    goals: I('<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1"/>'),
    nav: I('<circle cx="12" cy="12" r="10"/><path d="m16.2 7.8-2.1 6.3-6.3 2.1 2.1-6.3z"/>'),
    todo: I('<path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/><path d="m9 11 3 3L22 4"/>'),
    pomo: I('<path d="M10 2h4"/><circle cx="12" cy="14" r="8"/><path d="M12 14v-4"/>'),
    pin: I('<path d="M12 17v5"/><path d="M9 10.8a2 2 0 0 1-1.1 1.8l-1.8.9A2 2 0 0 0 5 15.3V16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-.7a2 2 0 0 0-1.1-1.8l-1.8-.9A2 2 0 0 1 15 10.8V7h1a2 2 0 0 0 2-2V4a1 1 0 0 0-1-1H7a1 1 0 0 0-1 1v1a2 2 0 0 0 2 2h1z"/>'),
    note: I('<path d="M15 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h9l7-7V5a2 2 0 0 0-2-2z"/><path d="M15 21v-5a2 2 0 0 1 2-2h5"/>'),
    trend: I('<path d="m22 7-8.5 8.5-5-5L2 17"/><path d="M16 7h6v6"/>'),
    cap: I('<path d="M22 10 12 5 2 10l10 5 10-5z"/><path d="M6 12v5c3 3 9 3 12 0v-5"/>'),
    calendar: I('<rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/>'),
    edit: I('<path d="M17 3a2.8 2.8 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5z"/>'),
    chart: I('<path d="M12 20v-9"/><path d="M18 20V5"/><path d="M6 20v-5"/>'),
    receipt: I('<path d="M4 2v20l2-1 2 1 2-1 2 1 2-1 2 1 2-1 2 1V2l-2 1-2-1-2 1-2-1-2 1-2-1-2 1z"/><path d="M8 7h8"/><path d="M8 11h8"/>'),
    flame: I('<path d="M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.4-.5-2-1-3 1.1-2.1 2.5-3.5 4.5-4.5-.9 2.5-.4 4 .6 5.5a6 6 0 1 1-10 4c0-1 .5-2 1.5-3z"/>'),
    db: I('<ellipse cx="12" cy="5" rx="9" ry="3"/><path d="M21 12c0 1.7-4 3-9 3s-9-1.3-9-3"/><path d="M3 5v14c0 1.7 4 3 9 3s9-1.3 9-3V5"/>'),
    box: I('<path d="M21 8a2 2 0 0 0-1-1.7l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.7l7 4a2 2 0 0 0 2 0l7-4a2 2 0 0 0 1-1.7z"/><path d="M3.3 7 12 12l8.7-5"/><path d="M12 22V12"/>'),
    gear: I('<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1a2 2 0 1 1-2.9 2.9l-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1-1.6 1.7 1.7 0 0 0-1.9.3l-.1.1a2 2 0 1 1-2.9-2.9l.1-.1a1.7 1.7 0 0 0 .3-1.9 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.6-1 1.7 1.7 0 0 0-.3-1.9l-.1-.1a2 2 0 1 1 2.9-2.9l.1.1a1.7 1.7 0 0 0 1.9.3h.1a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5h.1a1.7 1.7 0 0 0 1.9-.3l.1-.1a2 2 0 1 1 2.9 2.9l-.1.1a1.7 1.7 0 0 0-.3 1.9v.1a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>'),
    view3d: I('<path d="M21 8a2 2 0 0 0-1-1.7l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.7l7 4a2 2 0 0 0 2 0l7-4a2 2 0 0 0 1-1.7z"/><path d="M3.3 7 12 12l8.7-5"/><path d="M12 22V12"/>'),
    gearSm: I('<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1a2 2 0 1 1-2.9 2.9l-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1-1.6 1.7 1.7 0 0 0-1.9.3l-.1.1a2 2 0 1 1-2.9-2.9l.1-.1a1.7 1.7 0 0 0 .3-1.9 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.6-1 1.7 1.7 0 0 0-.3-1.9l-.1-.1a2 2 0 1 1 2.9-2.9l.1.1a1.7 1.7 0 0 0 1.9.3h.1a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5h.1a1.7 1.7 0 0 0 1.9-.3l.1-.1a2 2 0 1 1 2.9 2.9l-.1.1a1.7 1.7 0 0 0-.3 1.9v.1a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>')
  };

  /* ================= 强调色系统（浅色 Apple 风，替代暗色调色引擎） ================= */
  const ACCENTS = {
    sky:    { name: '天空蓝', a: '#0a7cff', aRgb: '10,124,255',  b: '#5ac8fa', bRgb: '90,200,250',  h: '#bfe3ff', hRgb: '191,227,255' },
    mint:   { name: '薄荷青', a: '#0ab5a5', aRgb: '10,181,165',  b: '#5adbc8', bRgb: '90,219,200',  h: '#c8f5ef', hRgb: '200,245,239' },
    violet: { name: '浪漫紫', a: '#7c5cff', aRgb: '124,92,255',  b: '#b39bff', bRgb: '179,155,255', h: '#e4dcff', hRgb: '228,220,255' },
    rose:   { name: '蔷薇粉', a: '#ff5c8a', aRgb: '255,92,138',  b: '#ff9ab5', bRgb: '255,154,181', h: '#ffd9e5', hRgb: '255,217,229' },
    sunset: { name: '落日橙', a: '#ff8a3c', aRgb: '255,138,60',  b: '#ffb35c', bRgb: '255,179,92',  h: '#ffe6c7', hRgb: '255,230,199' }
  };

  /* ================= 视图路由 ================= */
  const VIEWS = [
    { id: 'overview', name: '概览', icon: 'home', title: '概览' },
    { id: 'study', name: '学习', icon: 'study', title: '学习' },
    { id: 'ledger', name: '记账', icon: 'ledger', title: '记账' },
    { id: 'goals', name: '目标', icon: 'goals', title: '目标' },
    { id: 'nav', name: '导航', icon: 'nav', title: '导航与工具' }
  ];
  let currentView = 'overview';

  function renderNav() {
    $('#sideNav').innerHTML = VIEWS.map((v) =>
      `<button type="button" data-view="${v.id}" class="${v.id === currentView ? 'active' : ''}" aria-label="${v.name}">${ICONS[v.icon]}<span class="nav-label">${v.name}</span></button>`).join('');
    $('#tabbar').innerHTML = VIEWS.map((v) =>
      `<button type="button" data-view="${v.id}" class="${v.id === currentView ? 'active' : ''}">${ICONS[v.icon]}<span class="nav-label">${v.name}</span></button>`).join('');
    $$('#sideNav button, #tabbar button').forEach((btn) => {
      btn.addEventListener('click', () => switchView(btn.dataset.view));
    });
  }
  function switchView(id) {
    currentView = id;
    $$('.view').forEach((sec) => { sec.hidden = sec.dataset.view !== id; });
    const v = VIEWS.find((x) => x.id === id);
    $('#viewTitle').textContent = v.title;
    $$('#sideNav button, #tabbar button').forEach((btn) => btn.classList.toggle('active', btn.dataset.view === id));
  }

  /* ================= 调色引擎（浅色主题：强调色系统） ================= */
  function applyPalette() {
    /* 浅色 Liquid Glass 主题：仅切换强调色，画布与玻璃由 CSS Token 固定 */
    const key = ACCENTS[state.settings.palette] ? state.settings.palette : 'sky';
    const a = ACCENTS[key];
    const root = document.documentElement;
    root.style.setProperty('--accent-primary', a.a);
    root.style.setProperty('--accent-primary-rgb', a.aRgb);
    root.style.setProperty('--accent-secondary', a.b);
    root.style.setProperty('--accent-secondary-rgb', a.bRgb);
    root.style.setProperty('--highlight', a.h);
    root.style.setProperty('--highlight-rgb', a.hRgb);
    root.dataset.palette = key;
  }

  function renderPaletteGrid() {
    const grid = $('#paletteGrid');
    grid.innerHTML = Object.entries(ACCENTS).map(([id, a]) => `
      <button type="button" data-pid="${id}" class="${(ACCENTS[state.settings.palette] ? state.settings.palette : 'sky') === id ? 'active' : ''}">
        <span class="palette-strip"><i style="background:${a.a}"></i><i style="background:${a.b}"></i><i style="background:${a.h}"></i></span>
        <span>${esc(a.name)}</span>
      </button>`).join('');
    $$('button', grid).forEach((btn) => btn.addEventListener('click', () => {
      state.settings.palette = btn.dataset.pid;
      saveModule('settings');
      applyPalette();
      renderPaletteGrid();
    }));
  }

  function bindSliders() {
    const fq = $('#optFluidQuality');
    fq.value = state.settings.fluidQuality || 'auto';
    fq.addEventListener('change', () => {
      state.settings.fluidQuality = fq.value;
      saveModule('settings');
      if (window.FluidGlassMaterial) window.FluidGlassMaterial.setQuality(fq.value);
    });
    const nick = $('#optNickname');
    nick.value = state.profile.name || '';
    nick.addEventListener('change', () => {
      state.profile.name = nick.value.trim();
      saveModule('profile');
      renderGreet();
    });
  }

  /* ================= 视觉增强：光晕跟随 + 卡片微倾斜 ================= */
  function initSpotlight() {
    const cards = $$('.card');
    cards.forEach((c) => {
      if (!c.querySelector(':scope > .spot')) {
        const s = document.createElement('i');
        s.className = 'spot';
        s.setAttribute('aria-hidden', 'true');
        c.appendChild(s);
      }
    });
    if (window.__spotBound) return;
    window.__spotBound = true;
    document.addEventListener('pointermove', (e) => {
      const card = e.target && e.target.closest ? e.target.closest('.card') : null;
      if (!card || !card.isConnected) return;
      const r = card.getBoundingClientRect();
      const px = e.clientX - r.left, py = e.clientY - r.top;
      card.style.setProperty('--mx', px.toFixed(1) + 'px');
      card.style.setProperty('--my', py.toFixed(1) + 'px');
      // 轻微 3D 倾斜（±1.6deg），手机端忽略
      if (matchMedia('(hover:hover)').matches && innerWidth > 860) {
        const rx = ((py / r.height) - .5) * -3.2;
        const ry = ((px / r.width) - .5) * 3.2;
        card.style.setProperty('--rx', rx.toFixed(2) + 'deg');
        card.style.setProperty('--ry', ry.toFixed(2) + 'deg');
      }
    }, { passive: true });
  }

  /* ================= 流体玻璃指标卡 ================= */
  /* 数值滚动动画：从旧值插值到新值 */
  function animateNum(el, from, to, fmt) {
    if (from === to) { el.textContent = fmt(to); return; }
    const start = performance.now(), dur = 550;
    const step = (now) => {
      const t = Math.min(1, (now - start) / dur);
      const eased = 1 - Math.pow(1 - t, 3);
      el.textContent = fmt(from + (to - from) * eased);
      if (t < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }
  function setFluidCard(key, { num, fmt = (n) => String(Math.round(n)), text, unit, changeText, positive }) {
    const el = document.querySelector(`[data-fluid-glass-key="${key}"]`);
    if (!el) return;
    if (num !== undefined) {
      const vEl = $('.fg-value', el);
      const to = Number(num);
      const from = Number(vEl.dataset.v || 0);
      if (Number.isFinite(to) && Number.isFinite(from)) {
        animateNum(vEl, from, to, fmt);
      } else {
        vEl.textContent = fmt(to);
      }
      vEl.dataset.v = String(to);
    }
    if (text !== undefined) $('.fg-value', el).textContent = text;
    if (unit !== undefined) $('.fg-unit', el).textContent = unit;
    if (changeText !== undefined) {
      $('.fg-change', el).innerHTML = `<span class="${positive === false ? 'fg-change-negative' : 'fg-change-positive'}">${esc(changeText)}</span>`;
    }
  }

  function updateFluidCards() {
    const t = todayStr();
    const doneCount = state.todos.filter((x) => x.done).length;
    const rate = state.todos.length ? Math.round((doneCount / state.todos.length) * 100) : 0;
    setFluidCard('todo', { num: doneCount, fmt: (n) => String(Math.round(n)), unit: `项 · 共 ${state.todos.length}`, changeText: `完成率 ${rate}%` });

    const pomoToday = state.pomodoro.daily?.[t] || 0;
    setFluidCard('pomo', { num: pomoToday, fmt: (n) => String(Math.round(n)), unit: '个', changeText: `今日第 ${pomoToday} 个番茄` });

    const due = vocabDue().length;
    const mastered = state.vocab.words.filter((w) => w.done).length;
    setFluidCard('vocab', { num: due, fmt: (n) => String(Math.round(n)), unit: '词', changeText: `已掌握 ${mastered} 词` });

    const month = t.slice(0, 7);
    let outSum = 0, inSum = 0;
    for (const r of state.ledger.records) {
      if ((r.date || '').startsWith(month)) {
        if (r.type === 'expense') outSum += Number(r.amount) || 0; else inSum += Number(r.amount) || 0;
      }
    }
    setFluidCard('expense', { num: outSum, fmt: (n) => money(n), unit: '元', changeText: `本月收入 ${money(inSum)} 元` });
    /* 数据变化同步镜像到 3D 视界卡片 */
    if (typeof push3dCards === 'function') push3dCards();
  }

  /* ================= 时钟问候 ================= */
  function renderGreet() {
    const h = new Date().getHours();
    const nick = state.profile.name ? '，' + state.profile.name : '';
    let greet = '你好' + nick, sub = '开始高效的一天';
    if (h < 5) { greet = '夜深了' + nick; sub = '注意休息'; }
    else if (h < 9) { greet = '早上好' + nick; sub = '新的一天，元气满满'; }
    else if (h < 12) { greet = '上午好' + nick; sub = '保持专注'; }
    else if (h < 14) { greet = '中午好' + nick; sub = '劳逸结合'; }
    else if (h < 18) { greet = '下午好' + nick; sub = '继续加油'; }
    else if (h < 23) { greet = '晚上好' + nick; sub = '回顾今天，规划明天'; }
    else { greet = '夜深了' + nick; sub = '早点休息'; }
    $('#heroGreet').textContent = greet;
    $('#heroGreetSub').textContent = sub;
  }
  function tickClock() {
    const d = new Date();
    $('#clockTime').textContent = `${pad(d.getHours())}:${pad(d.getMinutes())}`;
    $('#clockSec').textContent = pad(d.getSeconds());
    $('#topbarClock').textContent = `${d.getMonth() + 1} 月 ${d.getDate()} 日 星期${WEEK_ZH[(d.getDay() + 6) % 7]}`;
    const weekText = ['日', '一', '二', '三', '四', '五', '六'][d.getDay()];
    $('#clockDate').textContent = `${d.getFullYear()} 年 ${d.getMonth() + 1} 月 ${d.getDate()} 日 · 星期${weekText}`;
  }

  /* ================= 待办 ================= */
  function renderTodos() {
    const list = $('#todoList');
    const items = state.todos;
    list.innerHTML = items.length ? items.map((t) => `
      <li class="todo-item ${t.done ? 'done' : ''}">
        <input type="checkbox" data-id="${t.id}" ${t.done ? 'checked' : ''}>
        <span class="txt">${esc(t.text)}</span>
        <button class="del" data-del="${t.id}" type="button" aria-label="删除">✕</button>
      </li>`).join('') : '<li class="vocab-empty">还没有待办，添加一条吧</li>';
    const done = items.filter((x) => x.done).length;
    $('#todoMeta').textContent = items.length ? `${done}/${items.length} 已完成` : '';
    $$('input[type="checkbox"]', list).forEach((cb) => cb.addEventListener('change', () => {
      const t = items.find((x) => x.id === cb.dataset.id);
      if (!t) return;
      t.done = cb.checked;
      t.doneAt = cb.checked ? todayStr() : null;
      saveModule('todos');
      renderTodos(); updateFluidCards(); renderWeekStats();
    }));
    $$('[data-del]', list).forEach((btn) => btn.addEventListener('click', () => {
      state.todos = items.filter((x) => x.id !== btn.dataset.del);
      saveModule('todos');
      renderTodos(); updateFluidCards(); renderWeekStats();
    }));
  }

  /* ================= 番茄钟 ================= */
  const POMO_RING_C = 326.7;
  let pomo = { mode: 'work', remain: 25 * 60, total: 25 * 60, running: false, timer: 0 };
  function pomoDuration() { return (pomo.mode === 'work' ? state.pomodoro.workMin : state.pomodoro.restMin) * 60; }
  function pomoPaint() {
    $('#pomoTime').textContent = `${pad(Math.floor(pomo.remain / 60))}:${pad(pomo.remain % 60)}`;
    $('#pomoMode').textContent = pomo.mode === 'work' ? '专注' : '休息';
    $('#pomoRing').style.strokeDashoffset = String(POMO_RING_C * (1 - pomo.remain / Math.max(pomo.total, 1)));
    $('.pomo-ring').classList.toggle('rest', pomo.mode === 'rest');
    $('#pomoStart').textContent = pomo.running ? '暂停' : '开始';
  }
  function pomoTick() {
    pomo.remain--;
    if (pomo.remain <= 0) {
      if (pomo.mode === 'work') {
        const t = todayStr();
        state.pomodoro.daily[t] = (state.pomodoro.daily[t] || 0) + 1;
        saveModule('pomodoro');
        updateFluidCards(); renderWeekStats();
        toast('🍅 完成一个番茄！休息一下');
        pomo.mode = 'rest';
      } else {
        toast('休息结束，开始新的专注');
        pomo.mode = 'work';
      }
      pomo.total = pomoDuration();
      pomo.remain = pomo.total;
    }
    pomoPaint();
  }
  function bindPomo() {
    $('#pomoStart').addEventListener('click', () => {
      pomo.running = !pomo.running;
      clearInterval(pomo.timer);
      if (pomo.running) pomo.timer = setInterval(pomoTick, 1000);
      pomoPaint();
    });
    $('#pomoReset').addEventListener('click', () => {
      clearInterval(pomo.timer);
      pomo.running = false; pomo.mode = 'work';
      pomo.total = pomoDuration(); pomo.remain = pomo.total;
      pomoPaint();
    });
    $('#pomoSkip').addEventListener('click', () => {
      clearInterval(pomo.timer);
      pomo.running = false; pomo.mode = 'work';
      pomo.total = pomoDuration(); pomo.remain = pomo.total;
      pomoPaint();
    });
    const wk = $('#pomoWork'), rs = $('#pomoRest');
    wk.value = state.pomodoro.workMin; rs.value = state.pomodoro.restMin;
    const onCfg = () => {
      state.pomodoro.workMin = Math.min(90, Math.max(5, Number(wk.value) || 25));
      state.pomodoro.restMin = Math.min(30, Math.max(1, Number(rs.value) || 5));
      wk.value = state.pomodoro.workMin; rs.value = state.pomodoro.restMin;
      saveModule('pomodoro');
      if (!pomo.running && pomo.mode === 'work') { pomo.total = pomoDuration(); pomo.remain = pomo.total; pomoPaint(); }
    };
    wk.addEventListener('change', onCfg); rs.addEventListener('change', onCfg);
    $('#pomoMeta').textContent = `今日 ${state.pomodoro.daily?.[todayStr()] || 0} 个`;
    pomo.total = pomoDuration(); pomo.remain = pomo.total;
    pomoPaint();
  }

  /* ================= 便签 ================= */
  function renderNotes() {
    const wrap = $('#noteList');
    if (!state.notes.length) {
      wrap.innerHTML = '<p class="hint">点击右上角「+ 新便签」记录想法，内容会自动保存并云同步。</p>';
      return;
    }
    wrap.innerHTML = state.notes.map((n) => `
      <div class="note">
        <textarea data-id="${n.id}" placeholder="写点什么…">${esc(n.text)}</textarea>
        <div class="note-foot"><small>更新于 ${esc(n.updatedAt || '')}</small><button class="del" data-del="${n.id}" type="button">删除</button></div>
      </div>`).join('');
    $$('textarea', wrap).forEach((ta) => {
      let timer = 0;
      ta.addEventListener('input', () => {
        clearTimeout(timer);
        timer = setTimeout(() => {
          const n = state.notes.find((x) => x.id === ta.dataset.id);
          if (!n) return;
          n.text = ta.value;
          n.updatedAt = todayStr();
          saveModule('notes');
          $('.note-foot small', ta.closest('.note')).textContent = '更新于 ' + n.updatedAt;
        }, 500);
      });
    });
    $$('[data-del]', wrap).forEach((btn) => btn.addEventListener('click', () => {
      state.notes = state.notes.filter((x) => x.id !== btn.dataset.del);
      saveModule('notes'); renderNotes();
    }));
  }

  /* ================= 学习进度 ================= */
  function studyStreak(logs) {
    let streak = 0;
    const d = new Date();
    for (;;) {
      if (logs && logs[todayStr(d)]) { streak++; d.setDate(d.getDate() - 1); }
      else break;
    }
    return streak;
  }
  function renderStudy() {
    const wrap = $('#studyList');
    if (!state.study.items.length) {
      wrap.innerHTML = '<p class="hint">点击右上角「+ 新项目」添加学习目标（如：英语六级、Python 入门）。</p>';
      return;
    }
    wrap.innerHTML = state.study.items.map((it) => {
      const streak = studyStreak(it.logs);
      const bars = Array.from({ length: 7 }, (_, i) => {
        const d = new Date(); d.setDate(d.getDate() - (6 - i));
        const on = it.logs && it.logs[todayStr(d)];
        return `<i class="${on ? 'on' : ''}" title="${todayStr(d)}"></i>`;
      }).join('');
      return `
      <div class="study-item">
        <div class="study-top"><b>${esc(it.name)}</b><small>连续打卡 ${streak} 天</small></div>
        <div class="bar"><i style="width:${Math.min(100, it.progress)}%"></i></div>
        <div class="study-ops">
          <button class="btn ghost small" data-study="-" data-id="${it.id}" type="button">−10%</button>
          <button class="btn ghost small" data-study="+" data-id="${it.id}" type="button">+10%</button>
          <span class="pct">${Math.min(100, it.progress)}%</span>
          <button class="btn ghost small" data-study="log" data-id="${it.id}" type="button">${it.logs?.[todayStr()] ? '✓ 今日已打卡' : '今日打卡'}</button>
          <button class="btn ghost small" data-study="del" data-id="${it.id}" type="button">删除</button>
        </div>
        <div class="study-logs">${bars}</div>
      </div>`;
    }).join('');
    $$('[data-study]', wrap).forEach((btn) => btn.addEventListener('click', () => {
      const it = state.study.items.find((x) => x.id === btn.dataset.id);
      if (!it) return;
      const act = btn.dataset.study;
      if (act === '+') it.progress = Math.min(100, (it.progress || 0) + 10);
      else if (act === '-') it.progress = Math.max(0, (it.progress || 0) - 10);
      else if (act === 'log') {
        it.logs = it.logs || {};
        const t = todayStr();
        if (it.logs[t]) delete it.logs[t]; else it.logs[t] = 30;
      } else if (act === 'del') {
        state.study.items = state.study.items.filter((x) => x.id !== it.id);
      }
      saveModule('study'); renderStudy(); updateFluidCards();
    }));
  }

  /* ================= 艾宾浩斯背单词 ================= */
  const EB_INTERVALS = [1, 2, 4, 7, 15, 30, 60]; // 记忆间隔（天）
  let vocabFace = null; // 当前复习的词（内存态）
  function vocabDue() {
    const t = todayStr();
    return state.vocab.words.filter((w) => !w.done && (!w.nextReview || w.nextReview <= t));
  }
  function renderVocab() {
    const wrap = $('#vocabReview');
    const due = vocabDue();
    const mastered = state.vocab.words.filter((w) => w.done).length;
    $('#vocabMeta').textContent = `待复习 ${due.length} · 词库 ${state.vocab.words.length} · 已掌握 ${mastered}`;
    if (!vocabFace || !state.vocab.words.find((w) => w.id === vocabFace.id && !w.done)) {
      vocabFace = due[0] || null;
    }
    if (!vocabFace) {
      wrap.innerHTML = '<div class="vocab-empty">🎉 今日复习任务已全部完成<br><small>新添加的单词将从明天起按遗忘曲线安排复习</small></div>';
    } else {
      const showMeaning = vocabFace._reveal;
      const stage = vocabFace.done ? '已掌握' : `第 ${vocabFace.box + 1} 阶段`;
      wrap.innerHTML = `
        <div class="vocab-face">
          <b>${esc(vocabFace.word)}</b>
          <div class="meaning">${showMeaning ? esc(vocabFace.meaning || '（未填写释义）') : '释义已隐藏，先自己回忆'}</div>
          <div class="boxinfo">记忆阶段：${stage} · 下次复习：${esc(vocabFace.nextReview || '今天')}</div>
        </div>
        <div class="vocab-ops">
          ${showMeaning
            ? `<button class="btn primary" data-vocab="ok" type="button">😊 认识了</button>
               <button class="btn danger" data-vocab="no" type="button">😵 忘记了</button>`
            : `<button class="btn primary" data-vocab="reveal" type="button">显示释义</button>
               <button class="btn ghost" data-vocab="skip" type="button">跳过</button>`}
        </div>`;
      $$('[data-vocab]', wrap).forEach((btn) => btn.addEventListener('click', () => {
        const act = btn.dataset.vocab;
        const w = state.vocab.words.find((x) => x.id === vocabFace.id);
        if (!w) return;
        if (act === 'reveal') { vocabFace._reveal = true; }
        else if (act === 'skip') { vocabFace = null; }
        else if (act === 'ok') {
          w.box = (w.box || 0) + 1;
          if (w.box >= EB_INTERVALS.length) { w.done = true; toast('🎉 恭喜，「' + w.word + '」已进入长期记忆'); }
          else w.nextReview = addDays(todayStr(), EB_INTERVALS[w.box]);
          vocabFace = null;
        } else if (act === 'no') {
          w.box = 0;
          w.nextReview = addDays(todayStr(), 1);
          vocabFace = null;
        }
        if (act !== 'reveal') saveModule('vocab');
        renderVocab(); updateFluidCards();
      }));
    }
    // 词库列表
    const list = $('#vocabList');
    if (!list.hidden) {
      list.innerHTML = state.vocab.words.length ? state.vocab.words.map((w) => `
        <li><span class="w">${esc(w.word)}</span><span class="m">${esc(w.meaning || '')}</span>
        <span class="box">${w.done ? '✓ 掌握' : '第' + (w.box + 1) + '阶'}</span>
        <button class="del" data-vdel="${w.id}" type="button">✕</button></li>`).join('')
        : '<li class="vocab-empty">词库还是空的</li>';
      $$('[data-vdel]', list).forEach((btn) => btn.addEventListener('click', () => {
        state.vocab.words = state.vocab.words.filter((x) => x.id !== btn.dataset.vdel);
        saveModule('vocab'); renderVocab(); updateFluidCards();
      }));
    }
  }
  function addDays(dateStr, days) {
    const d = new Date(dateStr + 'T12:00:00');
    d.setDate(d.getDate() + days);
    return todayStr(d);
  }

  /* ================= 每周时间表 ================= */
  function renderTimetable() {
    const wrap = $('#timetable');
    const jsDay = new Date().getDay();           // 0=周日
    const todayIdx = jsDay === 0 ? 7 : jsDay;    // 1~7（周一~周日）
    const slotsHtml = WEEK_ZH.map((w, i) => {
      const dayKey = String(i + 1);
      const slots = state.schedule[dayKey] || [];
      return `
      <div class="tt-day ${i + 1 === todayIdx ? 'today' : ''}">
        <h3>周${w}${i + 1 === todayIdx ? ' · 今' : ''}</h3>
        ${slots.map((s) => `
          <div class="tt-slot"><b>${esc(s.start)}-${esc(s.end)}</b>${esc(s.text)}
            <button class="del" data-ttdel="${dayKey}|${s.id}" type="button" aria-label="删除">✕</button>
          </div>`).join('') || '<span class="hint" style="text-align:center">—</span>'}
      </div>`;
    }).join('');
    wrap.innerHTML = `
      <div class="tt-week">${slotsHtml}</div>
      <div class="tt-add-row">
        <select class="input" id="ttDay">${WEEK_ZH.map((w, i) => `<option value="${i + 1}" ${i + 1 === todayIdx ? 'selected' : ''}>周${w}</option>`).join('')}</select>
        <input class="input" type="time" id="ttStart" value="08:00">
        <input class="input" type="time" id="ttEnd" value="09:30">
        <input class="input" id="ttText" placeholder="安排内容" maxlength="20" style="grid-column:span 2">
        <button class="btn primary" id="ttSave" type="button" style="grid-column:span 2">添加到时间表</button>
      </div>`;
    $('#ttSave').addEventListener('click', () => {
      const dayKey = $('#ttDay').value;
      const text = $('#ttText').value.trim();
      if (!text) { toast('请填写安排内容'); return; }
      (state.schedule[dayKey] = state.schedule[dayKey] || []).push({
        id: uid(), start: $('#ttStart').value || '08:00', end: $('#ttEnd').value || '09:00', text
      });
      state.schedule[dayKey].sort((a, b) => (a.start || '').localeCompare(b.start || ''));
      saveModule('schedule'); renderTimetable(); toast('已添加到周' + WEEK_ZH[Number(dayKey) - 1]);
    });
    $$('[data-ttdel]', wrap).forEach((btn) => btn.addEventListener('click', () => {
      const [dayKey, id] = btn.dataset.ttdel.split('|');
      state.schedule[dayKey] = (state.schedule[dayKey] || []).filter((s) => s.id !== id);
      saveModule('schedule'); renderTimetable();
    }));
  }

  /* ================= 记账 ================= */
  const CATS = {
    expense: ['餐饮', '交通', '购物', '娱乐', '学习', '居住', '医疗', '其他'],
    income: ['工资', '兼职', '理财', '红包', '其他']
  };
  const CAT_ICON = { 餐饮: '🍜', 交通: '🚌', 购物: '🛍', 娱乐: '🎮', 学习: '📚', 居住: '🏠', 医疗: '💊', 其他: '📦', 工资: '💼', 兼职: '💻', 理财: '📈', 红包: '🧧' };
  let ledgerType = 'expense';

  function renderLedgerCats() {
    $('#ledgerCategory').innerHTML = CATS[ledgerType].map((c) => `<option>${c}</option>`).join('');
    $$('#ledgerTypeSeg .chip').forEach((c) => c.classList.toggle('active', c.dataset.type === ledgerType));
  }
  function renderLedger() {
    const t = todayStr();
    const month = t.slice(0, 7);
    const recs = state.ledger.records;
    let outSum = 0, inSum = 0;
    const catSum = {};
    for (const r of recs) {
      if (!(r.date || '').startsWith(month)) continue;
      const amt = Number(r.amount) || 0;
      if (r.type === 'expense') { outSum += amt; catSum[r.category] = (catSum[r.category] || 0) + amt; }
      else inSum += amt;
    }
    $('#ledgerMonthMeta').textContent = `${month.slice(0, 4)} 年 ${Number(month.slice(5))} 月`;
    const maxCat = Math.max(1, ...Object.values(catSum));
    const topCats = Object.entries(catSum).sort((a, b) => b[1] - a[1]).slice(0, 5);
    // 近 7 日支出
    const days = Array.from({ length: 7 }, (_, i) => {
      const d = new Date(); d.setDate(d.getDate() - (6 - i));
      return { key: todayStr(d), label: `${d.getMonth() + 1}/${d.getDate()}`, sum: 0 };
    });
    for (const r of recs) {
      if (r.type !== 'expense') continue;
      const day = days.find((x) => x.key === r.date);
      if (day) day.sum += Number(r.amount) || 0;
    }
    const maxDay = Math.max(1, ...days.map((x) => x.sum));
    $('#ledgerStats').innerHTML = `
      <div class="ledger-stats">
        <div class="stat-2col">
          <div class="stat-box"><small>本月支出</small><b class="out">¥ ${money(outSum)}</b></div>
          <div class="stat-box"><small>本月收入</small><b class="in">¥ ${money(inSum)}</b></div>
        </div>
        <div>
          <small class="hint" style="display:block;margin-bottom:8px">分类占比（支出）</small>
          ${topCats.length ? topCats.map(([name, sum]) => `
            <div class="cat-row"><span class="name">${name}</span>
              <span class="bar"><i style="width:${Math.round((sum / maxCat) * 100)}%"></i></span>
              <span class="amt">¥${money(sum)}</span></div>`).join('')
          : '<small class="hint">本月还没有支出记录</small>'}
        </div>
        <div>
          <small class="hint" style="display:block;margin-bottom:4px">近 7 日支出趋势</small>
          <div class="spark">${days.map((d) => `<i style="height:${Math.max(4, Math.round((d.sum / maxDay) * 100))}%" title="${d.label} ¥${money(d.sum)}"><em>${d.label}</em></i>`).join('')}</div>
        </div>
      </div>`;
    // 列表（最近 30 条）
    const sorted = [...recs].sort((a, b) => (b.date || '').localeCompare(a.date || '') || (b.id > a.id ? 1 : -1)).slice(0, 30);
    $('#ledgerListMeta').textContent = recs.length ? `共 ${recs.length} 条` : '';
    $('#ledgerList').innerHTML = sorted.length ? sorted.map((r) => `
      <li>
        <span class="ico">${CAT_ICON[r.category] || '📦'}</span>
        <span class="mid"><b>${esc(r.note || r.category)}</b><small>${esc(r.date)} · ${esc(r.category)}</small></span>
        <span class="amt ${r.type}">${r.type === 'expense' ? '-' : '+'}¥${money(r.amount)}</span>
        <button class="del" data-ledel="${r.id}" type="button">✕</button>
      </li>`).join('') : '<li class="vocab-empty">还没有记录</li>';
    $$('[data-ledel]').forEach((btn) => btn.addEventListener('click', () => {
      state.ledger.records = recs.filter((x) => x.id !== btn.dataset.ledel);
      saveModule('ledger'); renderLedger(); updateFluidCards();
    }));
  }

  /* ================= 目标 ================= */
  function renderGoals() {
    const wrap = $('#goalList');
    if (!state.goals.length) {
      wrap.innerHTML = '<p class="hint">点击右上角「+ 新目标」，设定你的目标与截止日期，用进度条追踪完成情况。</p>';
      return;
    }
    const t = todayStr();
    wrap.innerHTML = state.goals.map((g) => {
      let remainHtml = '';
      if (g.deadline) {
        const diff = Math.round((new Date(g.deadline + 'T12:00:00') - new Date(t + 'T12:00:00')) / 86400000);
        remainHtml = diff > 0
          ? `<small class="${diff <= 3 ? 'urgent' : ''}">剩 ${diff} 天</small>`
          : diff === 0 ? '<small class="urgent">今天截止</small>' : '<small class="overdue">已过期</small>';
      }
      return `
      <div class="goal-item ${g.done ? 'done' : ''}">
        <div class="goal-top">
          <b>${esc(g.title)}</b>
          <span>${remainHtml}<small>${g.deadline ? ' · 截止 ' + esc(g.deadline) : ''}</small></span>
        </div>
        ${g.note ? `<div class="goal-note">${esc(g.note)}</div>` : ''}
        <div class="bar"><i class="gold" style="width:${Math.min(100, g.progress || 0)}%"></i></div>
        <div class="goal-ops">
          <button class="btn ghost small" data-goal="done" data-id="${g.id}" type="button">${g.done ? '↩ 恢复' : '✓ 完成'}</button>
          <button class="btn ghost small" data-goal="+" data-id="${g.id}" type="button">+10%</button>
          <button class="btn ghost small" data-goal="-" data-id="${g.id}" type="button">−10%</button>
          <span class="pct">${Math.min(100, g.progress || 0)}%</span>
          <button class="btn ghost small" data-goal="del" data-id="${g.id}" type="button">删除</button>
        </div>
      </div>`;
    }).join('');
    $$('[data-goal]', wrap).forEach((btn) => btn.addEventListener('click', () => {
      const g = state.goals.find((x) => x.id === btn.dataset.id);
      if (!g) return;
      const act = btn.dataset.goal;
      if (act === '+') g.progress = Math.min(100, (g.progress || 0) + 10);
      else if (act === '-') g.progress = Math.max(0, (g.progress || 0) - 10);
      else if (act === 'done') { g.done = !g.done; if (g.done) { g.progress = 100; toast('🏆 目标达成！'); } }
      else if (act === 'del') state.goals = state.goals.filter((x) => x.id !== g.id);
      saveModule('goals'); renderGoals();
    }));
  }

  /* ================= 近 7 天完成统计（目标页） ================= */
  function renderWeekStats() {
    const wrap = $('#weekStats');
    const days = Array.from({ length: 7 }, (_, i) => {
      const d = new Date(); d.setDate(d.getDate() - (6 - i));
      return { key: todayStr(d), label: `周${WEEK_ZH[(d.getDay() + 6) % 7]}`, cnt: 0 };
    });
    for (const td of state.todos) {
      if (!td.done || !td.doneAt) continue;
      const day = days.find((x) => x.key === td.doneAt);
      if (day) day.cnt++;
    }
    for (const [date, cnt] of Object.entries(state.pomodoro.daily || {})) {
      const day = days.find((x) => x.key === date);
      if (day) day.cnt += cnt;
    }
    const max = Math.max(1, ...days.map((d) => d.cnt));
    wrap.innerHTML = `<div class="week-stats">
      ${days.map((d) => `
        <div class="ws-row"><span class="day">${d.label}</span>
          <span class="bar"><i style="width:${Math.round((d.cnt / max) * 100)}%"></i></span>
          <span class="cnt">${d.cnt} 项</span></div>`).join('')}
    </div>
    <p class="hint">统计口径：已完成待办 + 番茄钟数量。</p>`;
  }

  /* ================= 快捷导航 ================= */
  function renderNavGrid() {
    const wrap = $('#navGrid');
    wrap.innerHTML = state.navLinks.map((n) => {
      const ch = (n.name || '?').trim().charAt(0).toUpperCase();
      return `
      <a class="nav-tile" href="${esc(n.url)}" target="_blank" rel="noopener">
        <span class="ico">${esc(ch)}</span><span>${esc(n.name)}</span>
        <button class="del" data-ndel="${n.id}" type="button" aria-label="删除">✕</button>
      </a>`;
    }).join('');
    $$('[data-ndel]', wrap).forEach((btn) => btn.addEventListener('click', (e) => {
      e.preventDefault(); e.stopPropagation();
      state.navLinks = state.navLinks.filter((x) => x.id !== btn.dataset.ndel);
      saveModule('navLinks'); renderNavGrid();
    }));
  }

  /* ================= 设置弹窗 ================= */
  function openSettings() {
    const cfg = Sync.getConfig();
    $('#optSyncUrl').value = cfg.url; $('#optSyncKey').value = cfg.key; $('#optSyncCode').value = cfg.code;
    $('#syncStatusText').textContent = cfg.valid
      ? '✓ 当前已连接云同步，多设备使用同一同步码即可共享数据。'
      : '当前为本地模式：数据仅保存在本设备浏览器中。';
    $('#settingsBackdrop').hidden = false;
  }
  function closeSettings() { $('#settingsBackdrop').hidden = true; }

  function bindSettings() {
    $('#openSettingsBtn').addEventListener('click', openSettings);
    $('#openSettingsBtnM').addEventListener('click', openSettings);
    $('#settingsClose').addEventListener('click', closeSettings);
    $('#settingsBackdrop').addEventListener('click', (e) => { if (e.target === $('#settingsBackdrop')) closeSettings(); });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && !$('#settingsBackdrop').hidden) closeSettings();
    });
    $('#syncSaveBtn').addEventListener('click', async () => {
      const btn = $('#syncSaveBtn');
      btn.disabled = true;
      $('#syncStatusText').textContent = '正在连接…';
      try {
        await Sync.saveAndConnect({
          url: $('#optSyncUrl').value,
          key: $('#optSyncKey').value,
          code: $('#optSyncCode').value
        });
        $('#syncStatusText').textContent = '✓ 连接成功！正在拉取云端数据…';
        await Sync.pollOnce(false);
        toast('☁ 云同步已连接');
        closeSettings();
      } catch (err) {
        $('#syncStatusText').textContent = '✕ 连接失败：' + err.message + '（请检查 URL/Key/同步码，以及是否已执行建表 SQL）';
      } finally {
        btn.disabled = false;
      }
    });
    $('#syncOffBtn').addEventListener('click', () => {
      Sync.disconnect();
      $('#syncStatusText').textContent = '已断开云同步，回到本地模式。';
      toast('已断开云同步');
    });
  }

  /* ================= 3D 视界：工作台数据镜像到卡片环 ================= */
  function studyMaxStreak() {
    return state.study.items.reduce((max, it) => Math.max(max, studyStreak(it.logs || {})), 0);
  }
  function build3dNotes() {
    const t = todayStr();
    const todoOpen = state.todos.filter((x) => !x.done).length;
    const todoDone = state.todos.filter((x) => x.done).length;
    const pomoToday = state.pomodoro.daily?.[t] || 0;
    const due = vocabDue().length;
    const mastered = state.vocab.words.filter((w) => w.done).length;
    const month = t.slice(0, 7);
    let outSum = 0, inSum = 0;
    for (const r of state.ledger.records) {
      if (!(r.date || '').startsWith(month)) continue;
      if (r.type === 'expense') outSum += Number(r.amount) || 0; else inSum += Number(r.amount) || 0;
    }
    const jsDay = new Date().getDay();
    const todaySlots = state.schedule[String(jsDay === 0 ? 7 : jsDay)] || [];
    const activeGoals = state.goals.filter((g) => !g.done).length;
    return [
      { code: 'TODO',   name: '今日待办', count: todoOpen,  countText: `${todoOpen} 项待办`,      status: todoOpen ? '进行中' : '已清空' },
      { code: 'DONE',   name: '今日完成', count: todoDone,  countText: `${todoDone} 项`,          status: '今日成果' },
      { code: 'FOCUS',  name: '番茄专注', count: pomoToday, countText: `${pomoToday} 个番茄`,     status: pomoToday ? '持续专注' : '等待启动' },
      { code: 'WORD',   name: '待复习',   count: due,       countText: `${due} 个单词`,           status: '遗忘曲线' },
      { code: 'MASTER', name: '已掌握',   count: mastered,  countText: `${mastered} 个单词`,      status: '长期记忆' },
      { code: 'OUT',    name: '本月支出', count: 0,         countText: `¥ ${money(outSum)}`,      status: '支出口径' },
      { code: 'IN',     name: '本月收入', count: 0,         countText: `¥ ${money(inSum)}`,       status: '收入口径' },
      { code: 'STUDY',  name: '学习项目', count: state.study.items.length, countText: `${state.study.items.length} 个进行中`, status: '学习进度' },
      { code: 'GOAL',   name: '活跃目标', count: activeGoals, countText: `${activeGoals} 个目标`, status: '里程碑' },
      { code: 'PLAN',   name: '今日安排', count: todaySlots.length, countText: `${todaySlots.length} 个时间块`, status: '时间表' },
      { code: 'NOTE',   name: '便签',     count: state.notes.length, countText: `${state.notes.length} 张便签`, status: '灵感速记' },
      { code: 'STREAK', name: '连续打卡', count: studyMaxStreak(), countText: `最长 ${studyMaxStreak()} 天`, status: '习惯养成' }
    ];
  }
  function push3dCards() {
    const notes = build3dNotes();
    try {
      $('#threedEmbedFrame')?.contentWindow?.postMessage({ type: 'workbench-cards', notes }, '*');
      if (!$('#threedOverlay').hidden) $('#threedFrame')?.contentWindow?.postMessage({ type: 'workbench-cards', notes }, '*');
    } catch (_) {}
  }
  function open3d() {
    $('#threedFrame').src = '三维卡片环/index.html';
    $('#threedOverlay').hidden = false;
    setTimeout(push3dCards, 700);
  }
  function renderTodayAgenda() {
    const jsDay = new Date().getDay();
    const key = String(jsDay === 0 ? 7 : jsDay);
    const all = state.schedule[key] || [];
    $('#agendaMeta').textContent = `周${WEEK_ZH[(jsDay + 6) % 7]} · 共 ${all.length} 项`;
    const slots = all.slice(0, 6);
    $('#todayAgenda').innerHTML = slots.length
      ? `<div class="mini-agenda">${slots.map((s) =>
          `<div class="slot"><b>${esc(s.start)}-${esc(s.end)}</b><span>${esc(s.text)}</span></div>`).join('')}
          ${all.length > 6 ? `<div class="empty">还有 ${all.length - 6} 项，见「学习」页时间表</div>` : ''}</div>`
      : '<div class="empty">今天暂无安排，去「学习」页规划吧</div>';
  }

  /* ================= 数据管理 ================= */
  function bindData() {
    $('#exportBtn').addEventListener('click', () => {
      const d = new Date();
      const name = `玻璃工作台备份-${todayStr(d)}-${pad(d.getHours())}${pad(d.getMinutes())}.json`;
      const blob = new Blob([JSON.stringify({ exportedAt: d.toISOString(), state }, null, 2)], { type: 'application/json' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = name;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 1200);
      toast('已导出：' + name);
    });
    $('#importBtn').addEventListener('click', () => $('#importFile').click());
    $('#importFile').addEventListener('change', async (e) => {
      const file = e.target.files[0];
      if (!file) return;
      try {
        const data = JSON.parse(await file.text());
        const incoming = data.state || data;
        if (!confirm('导入将覆盖当前本地数据，确定继续吗？')) return;
        for (const mod of MODULES) {
          if (incoming[mod] !== undefined) {
            state[mod] = deepMerge(DEFAULT_STATE[mod], incoming[mod]);
            saveModule(mod);
          }
        }
        applyPalette(); renderAll();
        toast('✓ 导入完成');
      } catch (err) {
        toast('导入失败：' + err.message);
      } finally {
        e.target.value = '';
      }
    });
    $('#resetBtn').addEventListener('click', () => {
      if (!confirm('确定清空本地全部数据吗？此操作不可恢复（云端数据不受影响，重连后会拉回）。')) return;
      localStorage.removeItem(STORE_KEY);
      localStorage.removeItem(TS_KEY);
      location.reload();
    });
  }

  /* ================= 动态添加表单（学习/目标/导航/便签/3D） ================= */
  function bindAddForms() {
    $('#todoForm').addEventListener('submit', (e) => {
      e.preventDefault();
      const text = $('#todoInput').value.trim();
      if (!text) return;
      state.todos.push({ id: uid(), text, done: false, createdAt: todayStr(), doneAt: null });
      $('#todoInput').value = '';
      saveModule('todos'); renderTodos(); updateFluidCards(); renderWeekStats();
    });
    $('#todoClearDone').addEventListener('click', () => {
      state.todos = state.todos.filter((x) => !x.done);
      saveModule('todos'); renderTodos(); updateFluidCards(); renderWeekStats();
    });

    $('#noteAdd').addEventListener('click', () => {
      state.notes.unshift({ id: uid(), text: '', updatedAt: todayStr() });
      saveModule('notes'); renderNotes();
    });

    $('#studyAdd').addEventListener('click', () => {
      const name = prompt('学习项目名称（如：英语六级）');
      if (!name || !name.trim()) return;
      state.study.items.push({ id: uid(), name: name.trim(), progress: 0, logs: {} });
      saveModule('study'); renderStudy();
    });

    $('#vocabForm').addEventListener('submit', (e) => {
      e.preventDefault();
      const word = $('#vocabWord').value.trim();
      const meaning = $('#vocabMeaning').value.trim();
      if (!word) { toast('请填写单词'); return; }
      if (state.vocab.words.some((w) => w.word.toLowerCase() === word.toLowerCase())) {
        toast('该单词已在词库中'); return;
      }
      state.vocab.words.push({ id: uid(), word, meaning, box: 0, addedAt: todayStr(), nextReview: addDays(todayStr(), 1), done: false });
      $('#vocabWord').value = ''; $('#vocabMeaning').value = '';
      saveModule('vocab'); renderVocab(); updateFluidCards();
      toast('已加入词库，明天开始第一次复习');
    });
    $('#vocabToggleList').addEventListener('click', () => {
      const list = $('#vocabList');
      list.hidden = !list.hidden;
      $('#vocabToggleList').textContent = list.hidden ? '查看词库' : '收起词库';
      if (!list.hidden) renderVocab();
    });

    $('#ttAdd').addEventListener('click', () => {
      $('#ttText')?.focus();
      $('#ttText')?.scrollIntoView({ block: 'center', behavior: 'smooth' });
    });

    $('#goalAdd').addEventListener('click', () => {
      const title = prompt('目标名称（如：通过 PMP 考试）');
      if (!title || !title.trim()) return;
      const deadline = prompt('截止日期（格式 YYYY-MM-DD，可留空）', '');
      state.goals.push({ id: uid(), title: title.trim(), deadline: deadline && /^\d{4}-\d{2}-\d{2}$/.test(deadline) ? deadline : '', note: '', progress: 0, done: false, createdAt: todayStr() });
      saveModule('goals'); renderGoals();
    });

    $('#navAdd').addEventListener('click', () => {
      const name = prompt('网站名称（如：Bing 搜索）');
      if (!name || !name.trim()) return;
      let url = prompt('网址（如 https://www.bing.com）', 'https://');
      if (!url || !url.trim()) return;
      url = url.trim();
      if (!/^https?:\/\//i.test(url)) url = 'https://' + url;
      state.navLinks.push({ id: uid(), name: name.trim(), url });
      saveModule('navLinks'); renderNavGrid();
    });

    $('#ledgerTypeSeg').addEventListener('click', (e) => {
      const chip = e.target.closest('.chip');
      if (!chip) return;
      ledgerType = chip.dataset.type;
      renderLedgerCats();
    });
    $('#ledgerDate').value = todayStr();
    $('#ledgerForm').addEventListener('submit', (e) => {
      e.preventDefault();
      const amount = Number($('#ledgerAmount').value);
      if (!amount || amount <= 0) { toast('请输入有效金额'); return; }
      state.ledger.records.push({
        id: uid(), type: ledgerType, amount,
        category: $('#ledgerCategory').value,
        date: $('#ledgerDate').value || todayStr(),
        note: $('#ledgerNote').value.trim()
      });
      $('#ledgerAmount').value = ''; $('#ledgerNote').value = '';
      saveModule('ledger'); renderLedger(); updateFluidCards();
      toast('✓ 已记账');
    });

    /* 3D 模式：嵌入版常驻概览页，这里处理全屏入口与数据桥 */
    $('#open3dBtn').addEventListener('click', open3d);
    $('#embed3dFullscreen').addEventListener('click', open3d);
    $('#threedEmbedFrame').addEventListener('load', () => setTimeout(push3dCards, 400));
    $('#threedFrame').addEventListener('load', () => setTimeout(push3dCards, 400));
    $('#close3dBtn').addEventListener('click', () => {
      $('#threedOverlay').hidden = true;
      $('#threedFrame').src = '';
    });
  }

  /* ================= 全量渲染 ================= */
  function renderAll() {
    renderTodos();
    renderNotes();
    renderStudy();
    renderVocab();
    renderTimetable();
    renderLedger();
    renderGoals();
    renderWeekStats();
    renderNavGrid();
    renderTodayAgenda();
    $('#pomoMeta').textContent = `今日 ${state.pomodoro.daily?.[todayStr()] || 0} 个`;
    updateFluidCards();
    push3dCards();
    initSpotlight();
  }

  /* ================= PWA ================= */
  function registerSW() {
    if (!('serviceWorker' in navigator)) return;
    if (location.protocol !== 'https:' && !['localhost', '127.0.0.1'].includes(location.hostname)) return; // 非 https/localhost 时浏览器不支持，静默跳过
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }

  /* ================= 登录门禁 ================= */
  const AUTH_KEY = 'workbench_auth_v1';
  const AUTH_USER = 'llt519';   // 账号（不区分大小写）
  const AUTH_PASS = '519403';   // 密码

  function loggedIn() {
    try { return localStorage.getItem(AUTH_KEY) === 'ok'; } catch (_) { return false; }
  }
  /* 返回 true = 已通过登录，继续初始化主界面 */
  function requireLogin() {
    if (loggedIn()) return true;
    const gate = $('#loginGate'), form = $('#loginForm'), err = $('#loginError');
    gate.hidden = false;
    const onSubmit = (e) => {
      e.preventDefault();
      const u = $('#loginUser').value.trim().toLowerCase();
      const p = $('#loginPass').value.trim();
      if (u === AUTH_USER && p === AUTH_PASS) {
        try { localStorage.setItem(AUTH_KEY, 'ok'); } catch (_) {}
        gate.hidden = true;
        form.removeEventListener('submit', onSubmit);
        init();
        toast('欢迎回来');
      } else {
        err.hidden = false;
        $('#loginPass').value = '';
        $('#loginPass').focus();
      }
    };
    form.addEventListener('submit', onSubmit);
    setTimeout(() => $('#loginUser').focus(), 100);
    return false;
  }

  /* ================= 初始化 ================= */
  function init() {
    if (!requireLogin()) return;
    applyPalette();
    /* 应用已保存的流体玻璃渲染质量 */
    if (window.FluidGlassMaterial && state.settings.fluidQuality && state.settings.fluidQuality !== 'auto') {
      window.FluidGlassMaterial.setQuality(state.settings.fluidQuality);
    }
    renderNav();
    switchView('overview');
    renderPaletteGrid();
    bindSliders();
    bindPomo();
    bindSettings();
    bindData();
    bindAddForms();
    renderAll();
    renderGreet();
    tickClock();
    setInterval(tickClock, 1000);
    renderLedgerCats();
    registerSW();
    /* 已配置云同步：启动轮询并立即拉取合并 */
    if (Sync.getConfig().valid) {
      Sync.startPolling();
      Sync.pollOnce(false).catch(() => {});
    }
  }

  document.addEventListener('DOMContentLoaded', init);
})();
