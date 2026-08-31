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
  const MODULES = ['settings', 'profile', 'todos', 'pomodoro', 'mood', 'notes', 'navLinks', 'ledger', 'study', 'vocab', 'goals', 'life', 'schedule'];

  const DEFAULT_STATE = {
    settings: { palette: 'US-00', intensity: .55, ambientStrength: .42, surfaceTint: .28, fluidQuality: 'auto' },
    profile: { name: '' },
    todos: [],
    pomodoro: { workMin: 25, restMin: 5, daily: {} },
    mood: { days: {} },
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
    life: {
      visions: [],
      milestones: [
        { key: 'start', title: '启程', note: '完成一件一直不敢开始的难事', done: false },
        { key: 'journey', title: '远征', note: '持续深耕一个领域三年以上', done: false },
        { key: 'arrive', title: '抵达', note: '活成自己敬佩的样子', done: false }
      ],
      bucket: []
    },
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
    /* 每次进入学习页都重新读取真实今日，重绘14天时间轴（跨天自动更新） */
    if (id === 'study' && $('#recallAxis')) {
      renderRecall();
    }
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
      // 轻微倾斜（±1.6deg），手机端忽略
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

    const moodToday = moodEntries(t).length;
    setFluidCard('mood', { num: moodToday, fmt: (n) => String(Math.round(n)), unit: '条', changeText: `今日已记录 ${moodToday} 次` });

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

  /* ================= 番茄钟（已由状态记录替代，历史数据保留在 state.pomodoro） ================= */

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
      saveModule('schedule'); renderTimetable(); renderTodayAgenda(); toast('已添加到周' + WEEK_ZH[Number(dayKey) - 1]);
    });
    $$('[data-ttdel]', wrap).forEach((btn) => btn.addEventListener('click', () => {
      const [dayKey, id] = btn.dataset.ttdel.split('|');
      state.schedule[dayKey] = (state.schedule[dayKey] || []).filter((s) => s.id !== id);
      saveModule('schedule'); renderTimetable(); renderTodayAgenda();
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

  /* ================= 人生目标（三张独立卡片，全部内联可编辑） ================= */
  function renderLife() {
    const life = state.life || { visions: [], milestones: [], bucket: [] };
    /* 兼容旧单条愿景：迁移为数组 */
    if (!Array.isArray(life.visions)) {
      life.visions = (life.vision && life.vision.trim())
        ? [{ id: 'v' + Date.now().toString(36), text: life.vision.trim() }] : [];
      saveModule('life');
    }
    /* 多愿景列表：每条点文字直接编辑，✕ 删除，底部 + 新增 */
    const inner = $('#lifeVisionEdit');
    if (inner) {
      const list = $('#lifeVisionList');
      if (list) {
        list.innerHTML = life.visions.length ? life.visions.map((v, i) => `
          <div class="vision-item">
            <p class="life-vision-text" contenteditable="true" data-vi="${i}" spellcheck="false">${esc(v.text || '')}</p>
            <button class="vision-del" data-vdel="${i}" type="button" aria-label="删除愿景">✕</button>
          </div>`).join('') : '<p class="hint">还没有愿景，点下方「＋ 新增愿景」写下第一个</p>';
        $$('p.life-vision-text', list).forEach((el) => el.addEventListener('keydown', (e) => {
          if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); el.blur(); }
        }));
        $$('p.life-vision-text', list).forEach((el) => el.addEventListener('blur', () => {
          const v = life.visions[Number(el.dataset.vi)];
          if (!v) return;
          v.text = (el.textContent || '').trim();
          el.textContent = v.text;
          saveModule('life');
        }));
        $$('[data-vdel]', list).forEach((btn) => btn.addEventListener('click', () => {
          life.visions.splice(Number(btn.dataset.vdel), 1);
          saveModule('life');
          renderLife();
          toast('愿景已删除');
        }));
      }
      const add = $('#lifeVisionAdd');
      if (add && !add.dataset.bound) {
        add.dataset.bound = '1';
        add.addEventListener('click', () => {
          const t = prompt('一条新的愿景（一生所向）：', '');
          if (t === null) return;
          const text = (t || '').trim();
          if (!text) { toast('愿景不能为空'); return; }
          life.visions.push({ id: 'v' + Date.now().toString(36), text });
          saveModule('life');
          renderLife();
          toast('愿景已新增');
        });
      }
      const meta = $('#lifeVisionMeta');
      if (meta) meta.textContent = life.visions.length ? `共 ${life.visions.length} 条 · 点击文字编辑` : '点击文字编辑 · 可增可删';
      const lMeta = $('#lifeMeta');
      if (lMeta) lMeta.textContent = `愿景 ${life.visions.length} 条`;
    }
    // 里程碑：三段，可编辑标题/描述，点圆点切换完成
    const ms = $('#lifeMilestonesBody');
    if (ms) {
      ms.innerHTML = life.milestones.map((m) => `
        <div class="ms-card ${m.done ? 'done' : ''}">
          <button type="button" class="ms-toggle" data-ms="${m.key}" aria-label="切换完成">${m.done ? '✓' : ''}</button>
          <b class="ms-title" contenteditable="true" data-ms-key="${m.key}" spellcheck="false">${esc(m.title)}</b>
          <small class="ms-note" contenteditable="true" data-ms-key="${m.key}" spellcheck="false">${esc(m.note || '')}</small>
          <button type="button" class="ms-del" data-msdel="${m.key}" aria-label="删除里程碑">✕</button>
        </div>`).join('');
      $$('[data-ms]', ms).forEach((btn) => btn.addEventListener('click', () => {
        const m = life.milestones.find((x) => x.key === btn.dataset.ms);
        if (!m) return;
        m.done = !m.done;
        saveModule('life');
        renderLife();
        toast(m.done ? `里程碑「${m.title}」达成 ✦` : `「${m.title}」回到未完成`);
      }));
      $$('[data-msdel]', ms).forEach((btn) => btn.addEventListener('click', () => {
        const m = life.milestones.find((x) => x.key === btn.dataset.msdel);
        if (!m) return;
        if (!confirm(`删除里程碑「${m.title}」？`)) return;
        life.milestones = life.milestones.filter((x) => x.key !== m.key);
        saveModule('life');
        renderLife();
        toast('里程碑已删除');
      }));
      $$('[data-ms-key]', ms).forEach((el) => el.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); el.blur(); }
      }));
      $$('[data-ms-key]', ms).forEach((el) => el.addEventListener('blur', () => {
        const m = life.milestones.find((x) => x.key === el.dataset.msKey);
        if (!m) return;
        if (el.classList.contains('ms-title')) m.title = (el.textContent || '').trim() || m.title;
        else m.note = (el.textContent || '').trim();
        el.textContent = el.classList.contains('ms-title') ? m.title : m.note;
        saveModule('life');
      }));
    }
    // 新增里程碑按钮（渲染在里程碑卡底部）
    if (ms) {
      const addBtn = document.createElement('button');
      addBtn.type = 'button';
      addBtn.className = 'ms-add-btn';
      addBtn.textContent = '＋ 新增里程碑';
      if (!addBtn.dataset.bound) {
        addBtn.dataset.bound = '1';
        addBtn.addEventListener('click', () => {
          const title = prompt('新里程碑名称（如：掌握一门外语）', '');
          if (!title || !title.trim()) return;
          const note = prompt('一句描述（可留空）', '');
          life.milestones.push({
            key: 'ms' + Date.now().toString(36),
            title: title.trim(),
            note: (note || '').trim(),
            done: false
          });
          saveModule('life');
          renderLife();
          toast('里程碑已新增');
        });
      }
      ms.appendChild(addBtn);
    }
    // 此生清单：添加 / 勾选 / 点文字编辑 / 删除
    const list = $('#bucketList');
    if (list) {
      list.innerHTML = life.bucket.length ? life.bucket.map((b, i) => `
        <li class="${b.done ? 'done' : ''}">
          <input type="checkbox" data-bi="${i}" ${b.done ? 'checked' : ''}>
          <span contenteditable="true" data-bi="${i}" spellcheck="false">${esc(b.text)}</span>
          <button class="del" data-bdel="${i}" type="button" aria-label="删除">✕</button>
        </li>`).join('') : '<li class="vocab-empty">还没有想做的事，往清单里加一笔吧</li>';
      $$('input[type="checkbox"]', list).forEach((cb) => cb.addEventListener('change', () => {
        const b = life.bucket[Number(cb.dataset.bi)];
        if (!b) return;
        b.done = cb.checked;
        saveModule('life');
        renderLife();
        if (b.done) toast('「' + b.text + '」已完成 ✓');
      }));
      $$('span[contenteditable="true"]', list).forEach((el) => el.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); el.blur(); }
      }));
      $$('span[contenteditable="true"]', list).forEach((el) => el.addEventListener('blur', () => {
        const b = life.bucket[Number(el.dataset.bi)];
        if (!b) return;
        b.text = (el.textContent || '').trim() || b.text;
        el.textContent = b.text;
        saveModule('life');
      }));
      $$('[data-bdel]', list).forEach((btn) => btn.addEventListener('click', () => {
        life.bucket.splice(Number(btn.dataset.bdel), 1);
        saveModule('life');
        renderLife();
      }));
    }
    const form = $('#bucketForm');
    if (form && !form.dataset.bound) {
      form.dataset.bound = '1';
      form.addEventListener('submit', (e) => {
        e.preventDefault();
        const t = $('#bucketInput').value.trim();
        if (!t) { toast('写一件想做的事'); return; }
        life.bucket.push({ text: t, done: false });
        $('#bucketInput').value = '';
        saveModule('life');
        renderLife();
        toast('已加入此生清单');
      });
    }
    const meta = $('#lifeMeta'), vMeta = $('#lifeVisionMeta'), bMeta = $('#bucketMeta');
    if (meta) {
      const doneMs = life.milestones.filter((m) => m.done).length;
      meta.textContent = `里程碑 ${doneMs}/${life.milestones.length}`;
    }
    if (vMeta) vMeta.textContent = life.vision ? '点击文字直接编辑' : '点击写下愿景';
    if (bMeta) {
      const doneB = life.bucket.filter((b) => b.done).length;
      bMeta.textContent = life.bucket.length ? `${doneB}/${life.bucket.length} 已完成` : '';
    }
  }


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

  /* ================= 动态添加表单（学习/目标/导航/便签） ================= */
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

  }

  /* ================= 状态与心情记录 ================= */
  const MOODS = [
    { k: 'happy', n: '开心', c: '#ff9f0a', v: 5 },
    { k: 'flow',  n: '高效', c: '#0a84ff', v: 5 },
    { k: 'focus', n: '专注', c: '#34c759', v: 4 },
    { k: 'calm',  n: '平静', c: '#30b0c7', v: 3 },
    { k: 'tired', n: '疲惫', c: '#8e8e93', v: 2 },
    { k: 'exhausted', n: '好累', c: '#6b7280', v: 2 },
    { k: 'irr',   n: '烦躁', c: '#e0673c', v: 2 },
    { k: 'down',  n: '低落', c: '#5e5ce6', v: 1 }
  ];
  const moodOf = (k) => MOODS.find((m) => m.k === k);
  /* 某天的记录列表（兼容旧版单条格式，统一为数组） */
  function moodEntries(d) {
    const v = (state.mood.days || {})[d];
    if (!v) return [];
    return Array.isArray(v) ? v : [v];
  }
  /* 今日心情总结：根据记录的状态生成一句话 */

  function renderMood() {
    const t = todayStr();
    const days = state.mood.days || {};
    const todayList = moodEntries(t);
    const latest = todayList[todayList.length - 1];

  /* ================= 今日心情总结话术库 =================
     支持复杂心情：按当天出现的心情集合匹配话术；当天内稳定，隔日更换 */
  const SUMMARY_SINGLE = {
    happy: [
      '今天的开心是真的开心，把这一页翻得慢一点，让它多留一会儿。',
      '心情明亮的一天，这样的日子值得被好好记住。',
      '笑出来的次数变多了，今天的你比昨天更懂得取悦自己。',
      '开心的情绪在扩散，趁状态好，去做一点平时不敢做的事。',
      '今天是那种很多年后想起来还会嘴角上扬的日子。',
      '快乐的证据藏在今天的记录里，这样的日子多多益善。',
      '情绪在高点，记得拥抱一下身边分享这份好心情的人。',
      '今天的世界对你温柔，你也把温柔还给了它。'
    ],
    flow: [
      '今天进入了难得的心流，事情一件件被推平，这种手感要趁热记录下来。',
      '状态拉满的一天，效率本身就是最好的正反馈。',
      '今天的你像上了发条，但步调依然是自己的，很难得。',
      '思绪清晰、推进顺畅，把今天的工作方式复盘一下，它值得复用。',
      '高效不是偶然，今天的节奏值得被写进你的方法库里。',
      '今天的执行力和判断力都在线，敢想也敢做。',
      '一个个任务被清空的感觉太好了，这就是掌控感。',
      '高效的秘诀今天又被你验证了一遍：开始做，就已经赢了一半。'
    ],
    focus: [
      '今天的注意力很集中，世界很吵，但你没有被打断。',
      '专注是你今天送给自己的礼物，沉进去的时间最值钱。',
      '能坐得住、沉得下，今天的深度超过大多数人。',
      '今天的专注像一层滤镜，把杂音都隔在了外面。',
      '专注的时间过得最快，也最让人踏实。',
      '今天的心很定，坐下来就能进入状态，这是可以练出来的超能力。',
      '专注让你忘记了时间，这样的时刻越多越好。',
      '不被打扰的一天，效率与满足感双双在线。'
    ],
    calm: [
      '今天心里很静，像湖面没有风，适合想清楚一些事。',
      '平静不是没有波澜，而是波澜被你稳稳接住了。',
      '今天节奏不快，但每一步都踩得很稳。',
      '情绪在线、心态松弛，这种平衡感是长期修炼的结果。',
      '平静的一天也有它的分量，它让你有力气走更远。',
      '今天的松弛感很难得，不慌不忙也是一种生产力。',
      '心里不装事，脚步就轻，今天的你做到了。',
      '淡而稳定的一天，像温水一样滋养人。'
    ],
    tired: [
      '今天的疲惫是真实存在的，别硬撑，先把电量充回来。',
      '身体在提醒你慢一点，休息不是偷懒，是节奏的一部分。',
      '今天电量见底了，允许自己早点收工，明天再战。',
      '累的时候降低期待，完成比完美重要。',
      '疲惫被你记下来了，它会帮你找到更适合自己的强度。',
      '今天累意袭来，别硬扛，安排一件小事犒劳自己。',
      '疲惫也是身体的诚实反馈，听它的，慢下来。',
      '今天的倦意提醒你：节奏可以调，方向没变就很好。'
    ],
    irr: [
      '今天有点烦躁，情绪来了不用赶，它待一会儿自己会走。',
      '烦躁是信号不是敌人，它在告诉你有些事该调整了。',
      '今天的火气记得找个出口，运动、音乐或者早点睡都行。',
      '被小事点燃的一天，先深呼吸，重要决定明天再做。',
      '烦躁被记录下来就够了，能觉察它的人已经很厉害。',
      '今天的小情绪不影响你是个好人，深呼吸，翻篇。',
      '烦躁上了头也没关系，你已经学会了给它记一笔。',
      '今天有点上头，睡前放下它，明天又是新的一天。'
    ],
    down: [
      '今天情绪偏低，允许自己慢一点，你不需要每天都满电。',
      '低落的日子也是日子的一部分，你今天能记录下来，已经是自救。',
      '今天辛苦了，哪怕什么都没做成，好好活着就值得肯定。',
      '把难过写下来之后，它就轻了一点，明天试试晒晒太阳。',
      '低谷不是终点，它只是节奏里的一个休止符。',
      '今天心情有点沉，记得给自己一个拥抱，你已经做得够好了。',
      '低落被你温柔地记下，它会成为明天好转的伏笔。',
      '情绪的雨天总会放晴，今天先照顾好自己。'
    ]
  };
  const SUMMARY_COMBO = {
    'happy+flow': [
      '又开心又高效，这种双倍的好日子要好好存档，它是你的黄金配方。',
      '心情好、推进快，今天的你几乎无懈可击。',
      '开心和效率互相成就，今天的节奏请务必复盘留存。'
    ],
    'focus+flow': [
      '专注加持心流，今天的深度和速度都在线，这是最理想的运转模式。',
      '既沉得下又跑得动，今天的你处于满血运转状态。'
    ],
    'happy+focus': [
      '带着好心情深度专注，今天的产出会格外让你满意。',
      '开心的情绪没有打散专注，反而推了你一把，很难得。'
    ],
    'happy+calm': [
      '开心又平静，不亢奋也不低落，今天的情绪质感非常好。',
      '这种轻盈的愉悦最持久，今天适合把重要的事慢慢做。'
    ],
    'calm+flow': [
      '平静地高效着，不急不躁地推进，今天的状态很高级。'
    ],
    'happy+tired': [
      '虽然累，但今天笑得很真，累得有价值的日子不算亏。',
      '开心和疲惫并存，说明今天过得用力，记得早点休息。'
    ],
    'tired+flow': [
      '身体有点累，但事情在推进，这种疲惫是值得的，今晚好好补觉。',
      '累着也在前进，今天辛苦了，别忘了犒劳自己。'
    ],
    'happy+irr': [
      '今天有开心也有烦躁，情绪像天气一样变化，这很正常，也很真实。',
      '笑与烦躁交替的一天，说明你在认真生活，而不是麻木地过。'
    ],
    'happy+down': [
      '今天既有开心也有低落，情绪在两极之间，你不必只选一种。',
      '笑中带丧的一天也很完整，阴晴都是你。'
    ],
    'focus+calm': [
      '平静且专注，今天的注意力像深水，安静但有力。'
    ],
    'focus+tired': [
      '专注透支了电量，今天的坚持很有分量，接下来交给休息。',
      '累但专注着收尾，这种责任感值得肯定，别熬太晚。'
    ],
    'focus+irr': [
      '烦躁但没有跑偏，你顶着情绪完成了专注，这很了不起。',
      '带着火气还能沉下来，今天的自控力值得记录。'
    ],
    'focus+down': [
      '情绪不高但你依然在专注，这份定力比结果更珍贵。',
      '低落没有击穿你的专注，今天你赢了自己一次。'
    ],
    'calm+tired': [
      '累但心态平稳，今天的你没有内耗，这已经是很好的应对。'
    ],
    'calm+irr': [
      '烦躁被你的平静托住了，情绪有波动但没翻船。'
    ],
    'calm+down': [
      '低落但安静，你在用自己的节奏消化它，这样很好。',
      '平静地面对低落，今天的你很温柔也很坚强。'
    ],
    'tired+irr': [
      '又累又烦躁，今天对自己好一点，先把最基本的事做完就好。',
      '电量低火气高，减少安排、多喝水，今天及格线是活着。'
    ],
    'tired+down': [
      '疲惫叠加低落，今天别要求太多，能记录下心情已经是积极的信号。',
      '今天很难，但你撑过来并且记录了，这一步很重要。'
    ],
    'irr+down': [
      '烦躁和低落一起来了，它们都会过去，今晚先好好休息。'
    ],
    'flow+irr': [
      '带着烦躁依然推进高效，情绪没有拖垮你的行动力，很硬核。'
    ],
    'flow+down': [
      '情绪偏低但事情在推进，用行动拉着情绪走，今天很有韧性。'
    ]
  };
  const SUMMARY_COMPLEX = [
    '今天的心情很丰富，像天气一样多变——这不代表不稳定，而是你在认真地生活。',
    '多种情绪在一天里轮番登场，能全部接住的你，比想象中更有韧性。',
    '今天情绪的层次很多，好的坏的最后都成了你的经历，都值得被记录。',
    '复杂的一天不必强行总结，你已经如实记下了它，这就够了。',
      '今天的情绪像调色盘，多种颜色混在一起，但都是你画下的。',
      '一天里经历了这么多起伏，你的内心比想象中辽阔。',
      '情绪的多与杂不是负担，是你对生活认真感受的证据。',
      '复杂的日常正在塑造一个更立体的你，继续记录下去。'
  ];
  const SUMMARY_MIX2 = [
    '今天{a}和{b}交织在一起，情绪不是单选题，你的感受都很真实。',
    '{a}与{b}同一天出现，说明今天过得并不平淡，你体验得很充分。',
    '在{a}和{b}之间切换的一天，能同时容纳两种情绪，说明你的内核很稳。',
      '今天{a}和{b}轮流登场，一天之内尝到两种滋味，这就是真实的日常。',
      '{a}里掺着{b}，复杂但有味道，这样的日子反而让人记得牢。',
      '一半{a}一半{b}，你的情绪光谱今天很宽。'
  ];
  function pickSummary(pool, seed) {
    return pool[Math.abs(seed) % pool.length];
  }
  /* 按当日心情集合生成总结：单状态 / 双状态组合 / 复杂混合 */
  function moodSummaryDay(list) {
    if (!list || !list.length) return '今天还没记录状态，选一个贴切的心情吧';
    const keys = [...new Set(list.map((r) => r.m))].filter((k) => moodOf(k));
    if (!keys.length) return '已记录今天的状态';
    const seed = keys.join('').split('').reduce((a, c) => a + c.charCodeAt(0), keys.length * 7) + new Date().getDate();
    if (keys.length >= 3) return pickSummary(SUMMARY_COMPLEX, seed);
    if (keys.length === 2) {
      const combo = SUMMARY_COMBO[keys.join('+')] || SUMMARY_COMBO[[...keys].reverse().join('+')];
      if (combo) return pickSummary(combo, seed);
      return pickSummary(SUMMARY_MIX2, seed)
        .replace('{a}', moodOf(keys[0]).n).replace('{b}', moodOf(keys[1]).n);
    }
    return pickSummary(SUMMARY_SINGLE[keys[0]] || ['已记录今天的状态'], seed);
  }

    // 今日总结（按最新一条）
    const sum = $('#moodSummary');
    if (sum) sum.textContent = moodSummaryDay(todayList);
    // 今日状态 chips（随时可追加记录）
    const chips = $('#moodChips');
    if (chips) {
      chips.innerHTML = MOODS.map((m) => {
        const on = latest && latest.m === m.k;
        return `<button type="button" class="mood-chip ${on ? 'on' : ''}" data-mood="${m.k}" title="记录一次「${m.n}」"><i style="background:${m.c}"></i>${m.n}</button>`;
      }).join('');
      $$('button', chips).forEach((b) => b.addEventListener('click', () => {
        const k = b.dataset.mood;
        state.mood.days = state.mood.days || {};
        const now = new Date();
        const entry = { m: k, at: `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}` };
        state.mood.days[t] = [...moodEntries(t), entry];
        saveModule('mood');
        renderMood(); renderRhythm();
        toast(`已记录 ${entry.at} · ${moodOf(k).n}`);
      }));
    }
    // 近 14 天柱状：颜色=当天占比最大的心情；五五开体现两种
    const bars = $('#moodBars');
    if (bars) {
      const cols = Array.from({ length: 14 }, (_, i) => {
        const d = new Date(); d.setDate(d.getDate() - (13 - i));
        const key = todayStr(d);
        const list = moodEntries(key);
        const tally = {};
        for (const r of list) { const m = moodOf(r.m); if (m) tally[m.k] = (tally[m.k] || 0) + 1; }
        const ranked = Object.entries(tally).sort((a, b) => b[1] - a[1]).map(([k]) => moodOf(k)).filter(Boolean);
        const top = ranked[0] || null;
        const tie = ranked.length > 1 && ranked[0].v === undefined ? false : (ranked.length > 1 && top && ranked[1] && tally[ranked[0].k] === tally[ranked[1].k]);
        return { key, label: `${d.getMonth() + 1}/${d.getDate()}`, m: top, tie, second: tie ? ranked[1] : null, cnt: list.length, today: key === t };
      });
      bars.innerHTML = cols.map((c) => {
        let bg = 'rgba(20,30,60,.1)';
        if (c.m && c.tie && c.second) bg = `linear-gradient(180deg, ${c.m.c} 50%, ${c.second.c} 50%)`;
        else if (c.m) bg = c.m.c;
        return `
        <span class="mood-bar ${c.today ? 'today' : ''}" title="${c.key}${c.m ? ' · ' + c.m.n + (c.tie ? ' / ' + c.second.n : '') : ' · 未记录'}">
          <i style="height:${c.m ? Math.round((c.m.v / 5) * 100) : 6}%;background:${bg}"></i>
          <em>${c.label.split('/')[1]}</em>
        </span>`;
      }).join('');
    }
    // 近 14 天总结（按记录数据生成洞察）
    const weekSum = $('#moodWeekSummary');
    if (weekSum) {
      const keys14 = Array.from({ length: 14 }, (_, i) => { const d = new Date(); d.setDate(d.getDate() - (13 - i)); return todayStr(d); });
      const recDays = keys14.filter((k) => (state.mood.days || {})[k]).length;
      const tally14 = {};
      for (const k of keys14) for (const r of moodEntries(k)) { const m = moodOf(r.m); if (m) tally14[m.k] = (tally14[m.k] || 0) + 1; }
      const total14 = Object.values(tally14).reduce((a, b) => a + b, 0);
      const ranked = Object.entries(tally14).sort((a, b) => b[1] - a[1]).map(([k, c]) => ({ m: moodOf(k), c }));
      const pos = (tally14['happy'] || 0) + (tally14['flow'] || 0) + (tally14['focus'] || 0) + (tally14['calm'] || 0);
      const posRate = total14 ? Math.round((pos / total14) * 100) : 0;
      let txt;
      if (!recDays) txt = '近 14 天还没有记录，从今天开始，慢慢积累属于你的状态曲线。';
      else {
        const top = ranked[0];
        const head = `近 14 天记录了 ${recDays} 天、共 ${total14} 条状态`;
        if (top) {
          const tail = posRate >= 60
            ? `正向状态占比 ${posRate}%，你的整体节奏相当健康，继续保持。`
            : posRate >= 40
              ? `正向占比 ${posRate}%，有起有落，注意在低落日给自己留缓冲。`
              : `正向占比只有 ${posRate}%，最近压力不小，安排点让自己开心的事。`;
          txt = `${head}，主导状态是「${top.m.n}」（${top.c} 条）。${tail}`;
        } else txt = head + '。';
      }
      weekSum.textContent = txt;
    }

    // 状态分布饼图（全部记录分布）+ 柔和空态 + 数据重置
    const pie = $('#moodPie');
    if (pie) {
      const tally = {};
      let total = 0;
      for (const d of Object.keys(days)) {
        for (const rec of moodEntries(d)) {
          if (!moodOf(rec.m)) continue;
          tally[rec.m] = (tally[rec.m] || 0) + 1;
          total++;
        }
      }
      let acc = 0; const stops = [];
      for (const m of MOODS) {
        if (!tally[m.k]) continue;
        const from = (acc / Math.max(total, 1)) * 360; acc += tally[m.k];
        const to = (acc / Math.max(total, 1)) * 360;
        stops.push(`${m.c} ${from.toFixed(1)}deg ${to.toFixed(1)}deg`);
      }
      pie.style.background = total ? `conic-gradient(${stops.join(',')})` : 'rgba(20,30,60,.06)';
      const top = Object.entries(tally).sort((a, b) => b[1] - a[1])[0];
      const topM = top ? moodOf(top[0]) : null;
      const stat = $('#moodStat');
      if (stat) stat.innerHTML = total
        ? `<b>${Object.keys(days).length}</b> 天 · <b>${total}</b> 条 · 最常
           <b style="color:${topM ? topM.c : 'inherit'}">${topM.n} ${Math.round((top[1] / total) * 100)}%</b>`
        : '<span class="hint">还没有留下心情记录</span>';
      const meta = $('#moodMeta');
      if (meta) meta.textContent = total ? `共 ${total} 条` : '';
      const reset = $('#moodResetBtn');
      if (reset) {
        reset.hidden = false;
        if (!reset.dataset.bound) {
          reset.dataset.bound = '1';
          reset.addEventListener('click', () => {
            if (!confirm('确定清空全部心情记录吗？此操作不可恢复。')) return;
            state.mood.days = {};
            saveModule('mood');
            renderMood(); renderRecall(); renderRhythm();
            toast('心情数据已重置');
          });
        }
      }
    }
  }

  /* ================= 碎片寄语（5600 句真实名言，5 分钟轮换 + 点击随机） ================= */
  let quoteTimer = 0;
  function showQuote(idx) {
    const list = window.QUOTES || [];
    if (!list.length) return;
    const q = list[((idx % list.length) + list.length) % list.length];
    const textEl = $('#quoteText'), metaEl = $('#quoteMeta');
    if (!textEl) return;
    textEl.textContent = q.t;
    const parts = [q.a && q.a !== '佚名' ? q.a : '佚名', q.n, q.f].filter(Boolean);
    metaEl.textContent = parts.join(' · ');
  }
  function randomQuote() {
    const list = window.QUOTES || [];
    if (!list.length) return;
    showQuote(Math.floor(Math.random() * list.length));
  }
  function renderQuote() {
    const card = $('#quoteCard');
    if (!card) return;
    if (!card.dataset.bound) {
      card.dataset.bound = '1';
      card.addEventListener('click', () => {
        randomQuote();
        card.classList.remove('flip');
        void card.offsetWidth;
        card.classList.add('flip');
      });
      quoteTimer = setInterval(randomQuote, 300000); // 5 分钟轮换
      /* 异步加载寄语库 JSON（fetch 需 http(s) 环境） */
      fetch('quotes-data.json').then((r) => r.json()).then((list) => {
        window.QUOTES = list;
        randomQuote();
      }).catch(() => {
        const m = $('#quoteMeta');
        if (m) m.textContent = '寄语库加载失败（请通过本地服务或线上访问）';
      });
    }
    randomQuote();
  }

  /* ================= 心情回顾（学习页时间轴 + 弹窗 + 学习联动） ================= */
  function renderRecall() {
    const axis = $('#recallAxis');
    if (!axis) return;
    const days = state.mood.days || {};
    const cols = Array.from({ length: 14 }, (_, i) => {
      const d = new Date(); d.setDate(d.getDate() - (13 - i));
      const key = todayStr(d);
      const list = moodEntries(key);
      const tally = {};
      for (const r of list) { const m = moodOf(r.m); if (m) tally[m.k] = (tally[m.k] || 0) + 1; }
      const ranked = Object.entries(tally).sort((a, b) => b[1] - a[1]).map(([k]) => moodOf(k)).filter(Boolean);
      const tie = ranked.length > 1 && tally[ranked[0].k] === tally[ranked[1].k];
      const top = ranked[0] || null;
      return { key, label: `${d.getMonth() + 1}/${d.getDate()}`, dow: '周' + WEEK_ZH[(d.getDay() + 6) % 7], list, top, tie, second: tie ? ranked[1] : null, today: key === todayStr() };
    });
    axis.innerHTML = cols.map((c) => {
      let dot = '<i class="rd-dot none"></i>';
      if (c.top && c.tie && c.second) dot = `<i class="rd-dot split" style="background:linear-gradient(180deg, ${c.top.c} 50%, ${c.second.c} 50%)"></i>`;
      else if (c.top) dot = `<i class="rd-dot" style="background:${c.top.c}"></i>`;
      return `<button type="button" class="rd-cell ${c.today ? 'today' : ''} ${c.list.length ? 'has' : ''}" data-day="${c.key}">
        ${dot}
        <b>${c.label}</b>
        <small>${c.dow}${c.list.length ? ' · ' + c.list.length : ''}</small>
      </button>`;
    }).join('');
    $$('[data-day]', axis).forEach((btn) => btn.addEventListener('click', () => openDayModal(btn.dataset.day)));
    const metaEl = $('#recallMeta');
    if (metaEl) metaEl.textContent = `近 14 天 · 已记录 ${cols.filter((c) => c.list.length).length} 天 · 点击某一天回溯`;

    // 情绪 × 学习联动洞察（真实数据：各主导心情日的待办完成量对比）
    const insight = $('#moodLinkInsight');
    if (insight) {
      const byMood = {};
      for (const k of keys14Helper()) {
        const list = moodEntries(k);
        if (!list.length) continue;
        const tally2 = {};
        for (const r of list) { const m = moodOf(r.m); if (m) tally2[m.k] = (tally2[m.k] || 0) + 1; }
        const top2 = Object.entries(tally2).sort((a, b) => b[1] - a[1])[0];
        if (!top2) continue;
        const done = state.todos.filter((x) => x.done && x.doneAt === k).length;
        byMood[top2[0]] = byMood[top2[0]] || { days: 0, done: 0 };
        byMood[top2[0]].days++; byMood[top2[0]].done += done;
      }
      const ranked = Object.entries(byMood).filter(([, v]) => v.days >= 1).sort((a, b) => b[1].done / b[1].days - a[1].done / a[1].days);
      if (ranked.length >= 2) {
        const best = moodOf(ranked[0][0]), worst = moodOf(ranked[ranked.length - 1][0]);
        const bd = (ranked[0][1].done / ranked[0][1].days).toFixed(1);
        const wd = (ranked[ranked.length - 1][1].done / ranked[ranked.length - 1][1].days).toFixed(1);
        insight.textContent = `数据联动：处于「${best.n}」状态的日子，你的待办日均完成 ${bd} 项；而「${worst.n}」状态的日子日均只有 ${wd} 项。把难事安排在自己的高能状态日，效率会更高。`;
      } else if (ranked.length === 1) {
        const m = moodOf(ranked[0][0]);
        insight.textContent = `数据联动：目前「${m.n}」状态日的待办日均完成 ${(ranked[0][1].done / ranked[0][1].days).toFixed(1)} 项，继续积累记录后可对比不同状态的学习效率。`;
      } else {
        insight.textContent = '继续记录心情与待办，积累几天后这里会告诉你：哪种状态下你的学习效率最高。';
      }
    }
  }
  function keys14Helper() {
    return Array.from({ length: 14 }, (_, i) => { const d = new Date(); d.setDate(d.getDate() - (13 - i)); return todayStr(d); });
  }
  /* 当日心情回溯弹窗 */
  function openDayModal(dayKey) {
    const list = moodEntries(dayKey);
    let dlg = $('#dayModal');
    if (!dlg) {
      dlg = document.createElement('div');
      dlg.id = 'dayModal';
      dlg.className = 'modal-backdrop';
      dlg.addEventListener('click', (e) => { if (e.target === dlg) dlg.hidden = true; });
      document.body.appendChild(dlg);
    }
    const d = new Date(dayKey + 'T12:00:00');
    const title = `${d.getMonth() + 1} 月 ${d.getDate()} 日 · ${list.length ? list.length + ' 条记录' : '暂无记录'}`;
    dlg.innerHTML = `<div class="modal day-modal"><div class="modal-head"><h2>${title}</h2><button class="icon-btn" data-close type="button" aria-label="关闭">✕</button></div>
      <div class="modal-body">
        ${list.length ? list.map((r, i) => { const m = moodOf(r.m) || MOODS[0]; return `<div class="day-rec-row"><i style="background:${m.c}"></i><b>${r.at || '--:--'}</b><span>${m.n}</span><button class="btn ghost small" data-del="${i}" type="button">删除</button></div>`; }).join('') : '<p class="hint">这一天没有心情记录。</p>'}
      </div></div>`;
    dlg.hidden = false;
    $$('[data-close]', dlg).forEach((b) => b.addEventListener('click', () => { dlg.hidden = true; }));
    $$('[data-del]', dlg).forEach((b) => b.addEventListener('click', () => {
      const list2 = moodEntries(dayKey);
      list2.splice(Number(b.dataset.del), 1);
      if (list2.length) state.mood.days[dayKey] = list2; else delete state.mood.days[dayKey];
      saveModule('mood');
      renderMood(); renderRecall(); renderRhythm();
      dlg.hidden = true;
      toast('已删除该条记录');
    }));
  }

  /* ================= 今日节奏（Apple 活动环） ================= */
  function setRing(sel, pct, c) {
    const el = $(sel);
    if (!el) return;
    const p = Math.min(1, Math.max(0, pct || 0));
    el.style.strokeDasharray = c.toFixed(1);
    el.style.strokeDashoffset = (c * (1 - p)).toFixed(1);
  }
  function renderRhythm() {
    const t = todayStr();
    const todoDone = state.todos.filter((x) => x.done).length;
    const todoTotal = state.todos.length;
    const mastered = state.vocab.words.filter((w) => w.done).length;
    const vocabTotal = state.vocab.words.length;
    setRing('#ringTodo', todoTotal ? todoDone / todoTotal : 0, 2 * Math.PI * 52);
    const monthKey = t.slice(0, 7);
    const moodDays = Object.keys(state.mood.days || {}).filter((k) => k.startsWith(monthKey)).length;
    const moodTarget = Number(t.slice(8)); // 本月至今天的天数
    setRing('#ringPomo', moodTarget ? Math.min(1, moodDays / moodTarget) : 0, 2 * Math.PI * 40);
    setRing('#ringVocab', vocabTotal ? mastered / vocabTotal : 0, 2 * Math.PI * 28);
    const pct = todoTotal ? Math.round((todoDone / todoTotal) * 100) : 0;
    const pctEl = $('#rhythmPct');
    if (pctEl) pctEl.textContent = pct + '%';
    const rl = [['#rlTodo', `${todoDone}/${todoTotal}`], ['#rlPomo', `打卡 ${moodDays}/${moodTarget} 天`], ['#rlVocab', `${mastered}/${vocabTotal} 词`]];
    rl.forEach(([sel, txt]) => { const el = $(sel); if (el) el.textContent = txt; });
    const meta = $('#rhythmMeta');
    if (meta) meta.textContent = '番茄日目标 4 个';
  }

  /* ================= 全量渲染 ================= */
  function renderAll() {
    window.__rs = ['start'];
    window.__rs = window.__rs || []; try { renderTodos(); } catch (e) { window.__rs.push('FAIL:' + name + ':' + e.message); throw e; } window.__rs.push(name);
    window.__rs = window.__rs || []; try { renderNotes(); } catch (e) { window.__rs.push('FAIL:' + name + ':' + e.message); throw e; } window.__rs.push(name);
    window.__rs = window.__rs || []; try { renderStudy(); } catch (e) { window.__rs.push('FAIL:' + name + ':' + e.message); throw e; } window.__rs.push(name);
    window.__rs = window.__rs || []; try { renderVocab(); } catch (e) { window.__rs.push('FAIL:' + name + ':' + e.message); throw e; } window.__rs.push(name);
    window.__rs = window.__rs || []; try { renderTimetable(); } catch (e) { window.__rs.push('FAIL:' + name + ':' + e.message); throw e; } window.__rs.push(name);
    window.__rs = window.__rs || []; try { renderLedger(); } catch (e) { window.__rs.push('FAIL:' + name + ':' + e.message); throw e; } window.__rs.push(name);
    window.__rs = window.__rs || []; try { renderLife(); } catch (e) { window.__rs.push('FAIL:' + name + ':' + e.message); throw e; } window.__rs.push(name);
    window.__rs = window.__rs || []; try { renderGoals(); } catch (e) { window.__rs.push('FAIL:' + name + ':' + e.message); throw e; } window.__rs.push(name);
    window.__rs = window.__rs || []; try { renderWeekStats(); } catch (e) { window.__rs.push('FAIL:' + name + ':' + e.message); throw e; } window.__rs.push(name);
    window.__rs = window.__rs || []; try { renderNavGrid(); } catch (e) { window.__rs.push('FAIL:' + name + ':' + e.message); throw e; } window.__rs.push(name);
    window.__rs = window.__rs || []; try { renderTodayAgenda(); } catch (e) { window.__rs.push('FAIL:' + name + ':' + e.message); throw e; } window.__rs.push(name);
    window.__rs = window.__rs || []; try { renderRhythm(); } catch (e) { window.__rs.push('FAIL:' + name + ':' + e.message); throw e; } window.__rs.push(name);
    window.__rs = window.__rs || []; try { renderMood(); } catch (e) { window.__rs.push('FAIL:' + name + ':' + e.message); throw e; } window.__rs.push(name);
    window.__rs = window.__rs || []; try { renderRecall(); } catch (e) { window.__rs.push('FAIL:' + name + ':' + e.message); throw e; } window.__rs.push(name);
    window.__rs = window.__rs || []; try { renderQuote(); } catch (e) { window.__rs.push('FAIL:' + name + ':' + e.message); throw e; } window.__rs.push(name);
    window.__rs = window.__rs || []; try { updateFluidCards(); } catch (e) { window.__rs.push('FAIL:' + name + ':' + e.message); throw e; } window.__rs.push(name);
    window.__rs = window.__rs || []; try { initSpotlight(); } catch (e) { window.__rs.push('FAIL:' + name + ':' + e.message); throw e; } window.__rs.push(name);
  }

  /* ================= 跨天实时刷新 ================= */
  let dayWatcher = null;
  function startDayWatcher() {
    if (dayWatcher) return;
    let lastDay = todayStr();
    dayWatcher = setInterval(() => {
      const now = todayStr();
      if (now !== lastDay) {
        lastDay = now;
        /* 日期已变：重绘时间轴/概览/节奏环/心情/指标卡 */
        if ($('#recallAxis')) renderRecall();
        if (typeof renderRhythm === 'function') renderRhythm();
        if (typeof renderMood === 'function') renderMood();
        if (typeof renderTodayAgenda === 'function') renderTodayAgenda();
        if (typeof updateFluidCards === 'function') updateFluidCards();
        if (typeof renderQuote === 'function') renderQuote();
        toast('新的一天开始啦，视图已更新');
      }
    }, 30000);
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
    try {
      if (!requireLogin()) return;
      $('#openSettingsBtn').innerHTML = ICONS.gear;
      $('#openSettingsBtnM').innerHTML = ICONS.gear;
      applyPalette();
      if (window.FluidGlassMaterial && state.settings.fluidQuality && state.settings.fluidQuality !== 'auto') {
        window.FluidGlassMaterial.setQuality(state.settings.fluidQuality);
      }
      renderNav();
      switchView('overview');
      renderPaletteGrid();
      bindSliders();
      bindSettings();
      bindData();
      bindAddForms();
      renderAll();
      renderGreet();
      tickClock();
      setInterval(tickClock, 1000);
      renderLedgerCats();
      registerSW();
      if (Sync.getConfig().valid) {
        Sync.startPolling();
        Sync.pollOnce(false).catch(() => {});
      }
      /* 跨天实时刷新：30秒检查一次真实日期，变化则重绘所有日期相关组件 */
      startDayWatcher();
    } catch (e) {
      console.error('INIT 失败:', e);
      const st = (e && e.stack ? e.stack : '').split(String.fromCharCode(10));

      document.title = 'ERR: ' + (e && e.message ? e.message : e) + ' @ ' + st.trim().slice(0, 80);
      const el = document.getElementById('viewTitle');
      if (el) el.textContent = '初始化出错';
    }
  }
  document.addEventListener('DOMContentLoaded', init);
})();
