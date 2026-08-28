/* ============================================================
   玻璃工作台 · 云同步层（传输层）
   - 后端：Supabase（REST API，纯 fetch，无 SDK、无 CDN）
   - 策略：本地优先；模块级 last-write-wins（合并逻辑在 app.js）
   - 未配置时自动降级为纯本地模式
   ============================================================ */
window.Sync = (function () {
  'use strict';

  const LS_KEY = 'workbench_sync_config_v1';
  const POLL_MS = 12000;        // 轮询周期
  const PUSH_DEBOUNCE_MS = 1500; // 推送防抖

  /* ---------- 配置 ---------- */
  let config = loadConfig();
  let status = config.valid ? 'ok' : 'off';
  let pollTimer = null;
  const statusListeners = [];
  const remoteListeners = [];

  function loadConfig() {
    try {
      const raw = JSON.parse(localStorage.getItem(LS_KEY) || '{}');
      return normalizeConfig(raw);
    } catch (_) { return normalizeConfig({}); }
  }
  function normalizeConfig(raw) {
    const url = String(raw.url || '').trim().replace(/\/+$/, '');
    const key = String(raw.key || '').trim();
    const code = String(raw.code || '').trim();
    return { url, key, code, valid: !!(url && key && code) };
  }
  function persistConfig() {
    try { localStorage.setItem(LS_KEY, JSON.stringify(config)); } catch (_) {}
  }

  function setStatus(next) {
    if (status === next) return;
    status = next;
    statusListeners.forEach((cb) => { try { cb(status); } catch (_) {} });
  }

  /* ---------- 底层请求 ---------- */
  async function request(path, options = {}, timeoutMs = 10000) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const res = await fetch(config.url + path, {
        ...options,
        signal: ctrl.signal,
        headers: {
          apikey: config.key,
          Authorization: 'Bearer ' + config.key,
          'Content-Type': 'application/json',
          ...(options.headers || {})
        }
      });
      if (!res.ok) {
        const text = await res.text().catch(() => '');
        throw new Error('HTTP ' + res.status + (text ? ' · ' + text.slice(0, 140) : ''));
      }
      return res;
    } finally { clearTimeout(timer); }
  }

  /* ---------- 对外 API ---------- */

  /* 拉取全部模块行：成功返回 [{module,payload,updated_at}] */
  async function pullAll() {
    if (!config.valid) return null;
    setStatus('busy');
    try {
      const res = await request('/rest/v1/workbench_sync?sync_code=eq.' + encodeURIComponent(config.code) + '&select=*');
      const rows = await res.json();
      setStatus('ok');
      return rows;
    } catch (err) {
      setStatus('error');
      throw err;
    }
  }

  /* 推送若干模块行（立即，不做防抖） */
  async function pushRows(rows) {
    if (!config.valid || !rows.length) return;
    setStatus('busy');
    try {
      await request('/rest/v1/workbench_sync?on_conflict=sync_code,module', {
        method: 'POST',
        headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
        body: JSON.stringify(rows.map((r) => ({
          sync_code: config.code,
          module: r.module,
          payload: r.payload,
          updated_at: new Date(r.updatedAt || Date.now()).toISOString()
        })))
      });
      setStatus('ok');
    } catch (err) {
      setStatus('error');
      throw err;
    }
  }

  /* 带防抖的模块推送：app 在每次本地变更后调用 */
  const pushTimers = {};
  function pushModule(module, payload, updatedAt) {
    if (!config.valid) return;
    clearTimeout(pushTimers[module]);
    pushTimers[module] = setTimeout(() => {
      pushRows([{ module, payload, updatedAt }]).catch(() => {});
    }, PUSH_DEBOUNCE_MS);
  }

  /* 轮询远端：发现更新即通知 app 合并 */
  async function pollOnce(silent) {
    try {
      const rows = await pullAll();
      if (rows && rows.length) remoteListeners.forEach((cb) => { try { cb(rows); } catch (_) {} });
    } catch (err) {
      if (!silent) console.warn('[同步] 拉取失败：', err.message);
    }
  }
  function startPolling() {
    stopPolling();
    if (!config.valid) return;
    pollTimer = setInterval(() => pollOnce(true), POLL_MS);
    document.addEventListener('visibilitychange', () => { if (!document.hidden) pollOnce(true); });
  }
  function stopPolling() { if (pollTimer) { clearInterval(pollTimer); pollTimer = null; } }

  /* 保存配置并验证连接 */
  async function saveAndConnect(raw) {
    config = normalizeConfig(raw);
    if (!config.valid) throw new Error('请完整填写项目 URL、Anon Key 与同步码');
    persistConfig();
    // 验证：尝试拉一次（表不存在会返回 4xx，借此给出准确提示）
    await pullAll();
    startPolling();
    return true;
  }
  function disconnect() {
    config = { url: '', key: '', code: '', valid: false };
    persistConfig();
    stopPolling();
    setStatus('off');
  }

  return {
    getConfig: () => ({ ...config }),
    saveAndConnect,
    disconnect,
    pushModule,
    pullAll,
    pollOnce,
    startPolling,
    onStatus: (cb) => statusListeners.push(cb),
    onRemoteChange: (cb) => remoteListeners.push(cb),
    getStatus: () => status
  };
})();
