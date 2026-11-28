import { createServer } from 'node:http';
import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { manualLaunchCommand } from './paths.mjs';
import { DEFAULT_MODEL_FAMILIES } from './engine.mjs';

function findPreloadJs(env = process.env) {
  const candidates = [
    env.ANTIGRAVITY_APP_DATA_DIR &&
      join(env.ANTIGRAVITY_APP_DATA_DIR, 'lib', 'node_modules', 'sidecar_sdk', 'preload.js'),
    join(homedir(), '.gemini', 'antigravity', 'lib', 'node_modules', 'sidecar_sdk', 'preload.js')
  ].filter(Boolean);
  for (const p of candidates) {
    if (existsSync(p)) {
      try {
        return readFileSync(p, 'utf8');
      } catch {}
    }
  }
  return '';
}

function readJsonBody(req, maxBytes = 8192) {
  return new Promise((resolve, reject) => {
    let raw = '';
    req.on('data', (chunk) => {
      raw += chunk;
      if (raw.length > maxBytes) {
        reject(new Error('请求体过大'));
        req.destroy();
      }
    });
    req.on('end', () => {
      if (!raw.trim()) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(raw));
      } catch {
        reject(new Error('JSON 格式无效'));
      }
    });
    req.on('error', reject);
  });
}

export function renderAuxPaneHtml({ version = '1.0.0', launchCommand = manualLaunchCommand() } = {}) {
  const safeVersion = String(version).replace(/[<>&"']/g, '');
  const safeCmd = JSON.stringify(String(launchCommand || ''));
  const defaultFamiliesJson = JSON.stringify(DEFAULT_MODEL_FAMILIES);
  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>下一句预测</title>
  <script src="/preload.js"></script>
  <style>
    :root {
      color-scheme: light dark;
    }
    * { box-sizing: border-box; }
    [hidden] { display: none !important; }
    body {
      margin: 0;
      padding: 14px;
      background: var(--background, #fafafa);
      color: var(--foreground, #1f2328);
      font: 13px/1.5 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
    }
    .stack {
      display: flex;
      flex-direction: column;
      gap: 12px;
    }
    .header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 8px;
    }
    .title {
      font-size: 14px;
      font-weight: 600;
      display: flex;
      align-items: center;
      gap: 8px;
    }
    .version {
      font-size: 11px;
      color: var(--muted-foreground, #6b7280);
      font-weight: 400;
    }
    .badge {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      font-size: 11.5px;
      padding: 2px 8px;
      border-radius: 999px;
      border: 1px solid var(--border, rgba(127,127,127,0.22));
      background: var(--card, rgba(127,127,127,0.06));
      white-space: nowrap;
    }
    .dot {
      width: 7px;
      height: 7px;
      border-radius: 50%;
      background: #94a3b8;
    }
    .dot.ok { background: #10b981; }
    .dot.warn { background: #f59e0b; }
    .dot.err { background: #ef4444; }
    .card {
      border: 1px solid var(--border, rgba(127,127,127,0.22));
      background: var(--card, rgba(127,127,127,0.04));
      border-radius: 10px;
      padding: 12px;
      display: flex;
      flex-direction: column;
      gap: 10px;
    }
    .row {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 10px;
    }
    .label {
      font-weight: 500;
    }
    .desc {
      font-size: 12px;
      color: var(--muted-foreground, #6b7280);
      margin-top: 2px;
    }
    .switch {
      position: relative;
      width: 36px;
      height: 20px;
      flex: 0 0 auto;
    }
    .switch input {
      opacity: 0;
      width: 0;
      height: 0;
    }
    .slider {
      position: absolute;
      inset: 0;
      border-radius: 999px;
      background: rgba(127,127,127,0.32);
      cursor: pointer;
      transition: background 140ms ease;
    }
    .slider::before {
      content: "";
      position: absolute;
      width: 14px;
      height: 14px;
      left: 3px;
      top: 3px;
      border-radius: 50%;
      background: #ffffff;
      transition: transform 140ms ease;
    }
    .switch input:checked + .slider {
      background: var(--primary, #2563eb);
    }
    .switch input:checked + .slider::before {
      transform: translateX(16px);
    }
    select, button {
      font: inherit;
      color: inherit;
    }
    select {
      width: 100%;
      padding: 6px 8px;
      border-radius: 7px;
      border: 1px solid var(--border, rgba(127,127,127,0.28));
      background: var(--background, transparent);
    }
    .efforts {
      display: flex;
      flex-wrap: wrap;
      gap: 6px;
    }
    .pill {
      padding: 4px 9px;
      border-radius: 6px;
      border: 1px solid var(--border, rgba(127,127,127,0.28));
      background: transparent;
      cursor: pointer;
      font-size: 12px;
    }
    .pill.active {
      border-color: var(--primary, #2563eb);
      background: color-mix(in srgb, var(--primary, #2563eb) 14%, transparent);
      font-weight: 500;
    }
    .btn {
      padding: 5px 10px;
      border-radius: 7px;
      border: 1px solid var(--border, rgba(127,127,127,0.28));
      background: transparent;
      cursor: pointer;
      font-size: 12px;
    }
    .btn:hover {
      background: rgba(127,127,127,0.1);
    }
    .btn:disabled {
      opacity: 0.5;
      cursor: not-allowed;
    }
    .btn-primary {
      border-color: var(--primary, #2563eb);
      background: var(--primary, #2563eb);
      color: #ffffff;
    }
    .btn-primary:hover {
      opacity: 0.9;
      background: var(--primary, #2563eb);
    }
    .actions {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
    }
    .kv-grid {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 8px;
    }
    .kv {
      padding: 8px;
      border-radius: 8px;
      border: 1px solid var(--border, rgba(127,127,127,0.16));
    }
    .kv-k {
      font-size: 11px;
      color: var(--muted-foreground, #6b7280);
    }
    .kv-v {
      font-size: 12.5px;
      font-weight: 500;
      margin-top: 2px;
      word-break: break-all;
    }
    .kbd {
      display: inline-block;
      padding: 1px 5px;
      border-radius: 4px;
      border: 1px solid var(--border, rgba(127,127,127,0.32));
      font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
      font-size: 11px;
    }
    .code {
      padding: 8px;
      border-radius: 7px;
      background: rgba(127,127,127,0.1);
      font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
      font-size: 11.5px;
      word-break: break-all;
    }
    .warn-card {
      border-color: rgba(245, 158, 11, 0.45);
    }
    .toast {
      font-size: 12px;
      color: var(--muted-foreground, #6b7280);
      min-height: 18px;
    }
  </style>
</head>
<body>
  <div class="stack">
    <div class="header">
      <div class="title">
        <span>下一句预测</span>
        <span class="version">v${safeVersion}</span>
      </div>
      <span class="badge"><span id="status-dot" class="dot"></span><span id="status-text">检查中…</span></span>
    </div>

    <div id="cdp-warning" class="card warn-card" hidden>
      <div class="label">未检测到本地调试端口</div>
      <div class="desc">输入框 Ghost Text 需要 Antigravity 开启本地调试端口（DevToolsActivePort）。可直接点击下方按钮带参数重启 Antigravity，或手动复制命令启动：</div>
      <div id="launch-cmd" class="code"></div>
      <div class="actions">
        <button id="btn-relaunch" class="btn btn-primary" type="button">立即带调试端口重启</button>
        <button id="btn-copy-cmd" class="btn" type="button">复制启动命令</button>
      </div>
    </div>

    <div id="agy-warning" class="card warn-card" hidden>
      <div class="label">未检测到 agy CLI</div>
      <div class="desc">预测引擎依赖本地 <code>agy</code> 命令行工具（~/.local/bin/agy 或 PATH），安装并登录 Antigravity CLI 后即可自动恢复。</div>
    </div>

    <div class="card">
      <div class="row">
        <div>
          <div class="label">启用输入框下一句预测</div>
          <div class="desc">回复结束后在空输入框显示 Ghost Text，关闭后立即停止后台进程</div>
        </div>
        <label class="switch">
          <input id="sw-enabled" type="checkbox" checked />
          <span class="slider"></span>
        </label>
      </div>
      <div class="row">
        <div>
          <div class="label">冷启动自动开启调试端口</div>
          <div id="auto-relaunch-desc" class="desc">直接打开原版客户端且无调试端口时，在冷启动窗口内自动带参重启一次（内置防循环与活跃会话保护）</div>
        </div>
        <label class="switch">
          <input id="sw-auto-relaunch" type="checkbox" checked />
          <span class="slider"></span>
        </label>
      </div>
    </div>

    <div class="card">
      <div class="row">
        <div class="label">预测模型与思考强度</div>
        <button id="btn-refresh-models" class="btn" type="button">刷新列表</button>
      </div>
      <select id="sel-family" aria-label="模型系列"></select>
      <div id="effort-wrap" class="efforts" hidden></div>
      <div class="desc">推荐 <strong>Gemini 4 Hydrogen (Low)</strong>，响应快、开销低。切换后自动平滑重启后台进程。</div>
    </div>

    <div class="card">
      <div class="row">
        <div class="label">运行状态</div>
        <button id="btn-clear-cache" class="btn" type="button">清空缓存</button>
      </div>
      <div class="kv-grid">
        <div class="kv">
          <div class="kv-k">已挂载窗口</div>
          <div id="kv-windows" class="kv-v">0</div>
        </div>
        <div class="kv">
          <div class="kv-k">后台进程</div>
          <div id="kv-worker" class="kv-v">-</div>
        </div>
        <div class="kv">
          <div class="kv-k">当前模型</div>
          <div id="kv-model" class="kv-v">-</div>
        </div>
        <div class="kv">
          <div class="kv-k">轮次 / 缓存</div>
          <div id="kv-stats" class="kv-v">0 / 0</div>
        </div>
      </div>
    </div>

    <div class="card">
      <div class="label">快捷键说明</div>
      <div class="desc">
        <span class="kbd">Tab</span> 或 <span class="kbd">→</span> 或点击 <span class="kbd">Tab</span> 徽章填入建议；<span class="kbd">Esc</span> 或直接打字隐藏。新回复完成自动预测，翻看历史会话仅在点击/聚焦空输入框时按需触发，支持主对话、分屏、旁路提问与子智能体独立隔离。
      </div>
    </div>

    <div id="toast" class="toast"></div>
  </div>

  <script>
    (() => {
      const launchCmd = ${safeCmd};
      const params = new URLSearchParams(location.search);
      const token = params.get('token') || '';
      const headers = token ? { 'x-sidecar-token': token } : {};

      const statusDot = document.getElementById('status-dot');
      const statusText = document.getElementById('status-text');
      const cdpWarn = document.getElementById('cdp-warning');
      const agyWarn = document.getElementById('agy-warning');
      const launchCmdEl = document.getElementById('launch-cmd');
      const btnRelaunch = document.getElementById('btn-relaunch');
      const btnCopyCmd = document.getElementById('btn-copy-cmd');
      const swEnabled = document.getElementById('sw-enabled');
      const swAutoRelaunch = document.getElementById('sw-auto-relaunch');
      const autoRelaunchDesc = document.getElementById('auto-relaunch-desc');
      const selFamily = document.getElementById('sel-family');
      const effortWrap = document.getElementById('effort-wrap');
      const btnRefreshModels = document.getElementById('btn-refresh-models');
      const btnClearCache = document.getElementById('btn-clear-cache');
      const kvWindows = document.getElementById('kv-windows');
      const kvWorker = document.getElementById('kv-worker');
      const kvModel = document.getElementById('kv-model');
      const kvStats = document.getElementById('kv-stats');
      const toastEl = document.getElementById('toast');

      launchCmdEl.textContent = launchCmd;

      let families = ${defaultFamiliesJson};
      let currentModel = 'gemini-4-hydrogen-low';
      let toastTimer = null;
      renderModelSelector();

      function showToast(msg) {
        toastEl.textContent = msg || '';
        if (toastTimer) clearTimeout(toastTimer);
        if (msg) {
          toastTimer = setTimeout(() => { toastEl.textContent = ''; }, 2600);
        }
      }

      async function api(path, opts = {}) {
        const res = await fetch(path, {
          ...opts,
          headers: {
            'Content-Type': 'application/json',
            ...headers,
            ...(opts.headers || {})
          }
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error || '请求失败');
        return data;
      }

      function findFamilyForModel(modelId) {
        for (const fam of families) {
          if (fam.singleId && fam.singleId === modelId) return fam;
          if (Array.isArray(fam.efforts) && fam.efforts.some((e) => e.id === modelId)) return fam;
        }
        return families[0] || null;
      }

      function renderModelSelector() {
        selFamily.innerHTML = '';
        for (const fam of families) {
          const opt = document.createElement('option');
          opt.value = fam.key;
          opt.textContent = fam.recommended ? fam.name + '（推荐）' : fam.name;
          selFamily.appendChild(opt);
        }
        const activeFam = findFamilyForModel(currentModel);
        if (!activeFam) {
          effortWrap.hidden = true;
          return;
        }
        selFamily.value = activeFam.key;
        renderEfforts(activeFam);
      }

      function renderEfforts(fam) {
        effortWrap.innerHTML = '';
        if (!fam || !Array.isArray(fam.efforts) || fam.efforts.length === 0) {
          effortWrap.hidden = true;
          return;
        }
        effortWrap.hidden = false;
        for (const eff of fam.efforts) {
          const btn = document.createElement('button');
          btn.type = 'button';
          btn.className = 'pill' + (eff.id === currentModel ? ' active' : '');
          btn.textContent = eff.label;
          btn.addEventListener('click', () => saveModel(eff.id));
          effortWrap.appendChild(btn);
        }
      }

      async function saveModel(modelId) {
        if (!modelId || modelId === currentModel) return;
        currentModel = modelId;
        renderModelSelector();
        try {
          await api('/api/settings', {
            method: 'POST',
            body: JSON.stringify({ model: modelId })
          });
          showToast('已切换模型：' + modelId);
          void refreshStatus();
        } catch (err) {
          showToast('切换失败：' + err.message);
        }
      }

      selFamily.addEventListener('change', () => {
        const fam = families.find((f) => f.key === selFamily.value);
        if (!fam) return;
        if (fam.singleId) {
          void saveModel(fam.singleId);
          return;
        }
        const def =
          fam.efforts.find((e) => e.label === fam.defaultEffort) ||
          fam.efforts[0];
        if (def) void saveModel(def.id);
      });

      swEnabled.addEventListener('change', async () => {
        const next = Boolean(swEnabled.checked);
        try {
          await api('/api/settings', {
            method: 'POST',
            body: JSON.stringify({ enabled: next })
          });
          showToast(next ? '已开启下一句预测' : '已暂停下一句预测');
          void refreshStatus();
        } catch (err) {
          swEnabled.checked = !next;
          showToast('保存失败：' + err.message);
        }
      });

      swAutoRelaunch.addEventListener('change', async () => {
        const next = Boolean(swAutoRelaunch.checked);
        try {
          await api('/api/settings', {
            method: 'POST',
            body: JSON.stringify({ autoRelaunch: next })
          });
          showToast(next ? '已开启冷启动自动补参重启' : '已关闭冷启动自动重启');
          void refreshStatus();
        } catch (err) {
          swAutoRelaunch.checked = !next;
          showToast('保存失败：' + err.message);
        }
      });

      btnRelaunch.addEventListener('click', async () => {
        btnRelaunch.disabled = true;
        btnRelaunch.textContent = '正在重启 Antigravity…';
        try {
          const res = await api('/api/relaunch', { method: 'POST', body: '{}' });
          if (res.scheduled) {
            showToast('已触发后台重启，Antigravity 即将带调试端口重新打开…');
          } else {
            showToast('未能自动重启（' + (res.reason || 'unknown') + '），请复制上方命令手动启动');
            btnRelaunch.disabled = false;
            btnRelaunch.textContent = '立即带调试端口重启';
          }
        } catch (err) {
          showToast('重启失败：' + err.message);
          btnRelaunch.disabled = false;
          btnRelaunch.textContent = '立即带调试端口重启';
        }
      });

      btnRefreshModels.addEventListener('click', async () => {
        btnRefreshModels.disabled = true;
        try {
          await loadModels(true);
          showToast('模型列表已刷新');
        } catch (err) {
          showToast('刷新失败：' + err.message);
        } finally {
          btnRefreshModels.disabled = false;
        }
      });

      btnClearCache.addEventListener('click', async () => {
        try {
          await api('/api/cache/clear', { method: 'POST', body: '{}' });
          showToast('预测缓存已清空');
          void refreshStatus();
        } catch (err) {
          showToast('操作失败：' + err.message);
        }
      });

      btnCopyCmd.addEventListener('click', async () => {
        try {
          await navigator.clipboard.writeText(launchCmd);
          showToast('已复制启动命令');
        } catch {
          showToast('复制失败，请手动复制上方命令');
        }
      });

      async function loadModels(force = false) {
        const data = await api('/api/models' + (force ? '?force=1' : ''));
        if (Array.isArray(data.families) && data.families.length > 0) {
          families = data.families;
          renderModelSelector();
        }
      }

      async function refreshStatus() {
        try {
          const data = await api('/api/status');
          const enabled = data.settings?.enabled !== false;
          const autoRelaunch = data.settings?.autoRelaunch !== false;
          const model = data.settings?.model || currentModel;
          swEnabled.checked = enabled;
          swAutoRelaunch.checked = autoRelaunch;
          if (data.launcher?.powertoolsInstalled) {
            autoRelaunchDesc.textContent = '已检测到 Agy Powertools，冷启动重启会自动避让以防冲突；如需独立使用时仍可自动生效';
          } else {
            autoRelaunchDesc.textContent = '直接打开原版客户端且无调试端口时，在冷启动窗口内自动带参重启一次（内置防循环与活跃会话保护）';
          }
          if (model !== currentModel) {
            currentModel = model;
            if (families.length > 0) renderModelSelector();
          }

          const cdp = data.cdp || {};
          const eng = data.engine || {};
          cdpWarn.hidden = Boolean(cdp.connected || cdp.debugPort);
          agyWarn.hidden = eng.available !== false;

          kvWindows.textContent = String(cdp.windowCount || 0);
          kvModel.textContent = eng.activeModel || model;
          kvStats.textContent = (eng.turns || 0) + ' / ' + (eng.cacheSize || 0);

          if (!enabled) {
            statusDot.className = 'dot';
            statusText.textContent = '已暂停';
            kvWorker.textContent = '已停止';
          } else if (eng.available === false) {
            statusDot.className = 'dot err';
            statusText.textContent = '缺少 agy';
            kvWorker.textContent = '不可用';
          } else if (!cdp.connected) {
            statusDot.className = 'dot warn';
            statusText.textContent = cdp.debugPort ? '正在连接窗口…' : '等待调试端口';
            kvWorker.textContent = eng.running ? '运行中' : '待机';
          } else if (eng.warmed) {
            statusDot.className = 'dot ok';
            statusText.textContent = '运行正常';
            kvWorker.textContent = '已预热就绪';
          } else if (eng.running || eng.starting) {
            statusDot.className = 'dot warn';
            statusText.textContent = '预热中';
            kvWorker.textContent = '正在预热…';
          } else {
            statusDot.className = 'dot ok';
            statusText.textContent = '已连接待机';
            kvWorker.textContent = '按需启动';
          }
        } catch {}
      }

      void loadModels(false);
      void refreshStatus();
      setInterval(refreshStatus, 3000);
    })();
  </script>
</body>
</html>`;
}

export function startSidecarWebUi({
  port = Number(process.env.ANTIGRAVITY_SIDECAR_WEB_PORT || 0),
  token = process.env.ANTIGRAVITY_SIDECAR_UI_TOKEN || '',
  version = '1.2.0',
  getStatus,
  onListModels,
  onSetSettings,
  onClearCache,
  onRelaunch,
  env = process.env
} = {}) {
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    return Promise.resolve(async () => {});
  }
  const preloadJs = findPreloadJs(env);
  const authorized = (req, url) => {
    if (url.pathname === '/preload.js') return true;
    if (!token) return true;
    return (req.headers['x-sidecar-token'] || url.searchParams.get('token')) === token;
  };

  const server = createServer(async (req, res) => {
    const url = new URL(req.url || '/', `http://127.0.0.1:${port}`);
    if (req.method !== 'GET' && !authorized(req, url)) {
      res.writeHead(401, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ error: 'unauthorized' }));
      return;
    }
    if (req.method === 'GET' && url.pathname === '/preload.js') {
      res.writeHead(200, { 'Content-Type': 'application/javascript; charset=utf-8' });
      res.end(preloadJs);
      return;
    }
    if (req.method === 'GET' && url.pathname === '/') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(renderAuxPaneHtml({ version }));
      return;
    }
    if (req.method === 'GET' && url.pathname === '/api/status') {
      if (!authorized(req, url)) {
        res.writeHead(401, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ error: 'unauthorized' }));
        return;
      }
      const status = (await getStatus?.()) || {};
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ version, ...status }));
      return;
    }
    if (req.method === 'GET' && url.pathname === '/api/models') {
      if (!authorized(req, url)) {
        res.writeHead(401, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ error: 'unauthorized' }));
        return;
      }
      try {
        const force = url.searchParams.get('force') === '1';
        const data = (await onListModels?.({ force })) || { available: false, families: [] };
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify(data));
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ error: err.message }));
      }
      return;
    }
    if (req.method === 'POST' && url.pathname === '/api/settings') {
      try {
        const body = await readJsonBody(req);
        const patch = {};
        if (typeof body.enabled === 'boolean') patch.enabled = body.enabled;
        if (typeof body.autoRelaunch === 'boolean') patch.autoRelaunch = body.autoRelaunch;
        if (typeof body.model === 'string' && body.model.trim()) patch.model = body.model.trim();
        const saved = await onSetSettings?.(patch);
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ ok: true, settings: saved }));
      } catch (err) {
        res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ error: err.message }));
      }
      return;
    }
    if (req.method === 'POST' && url.pathname === '/api/relaunch') {
      try {
        const result = (await onRelaunch?.()) || { scheduled: false, reason: 'unavailable' };
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ ok: Boolean(result.scheduled), ...result }));
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ error: err.message }));
      }
      return;
    }
    if (req.method === 'POST' && url.pathname === '/api/cache/clear') {
      try {
        await onClearCache?.();
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ ok: true }));
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ error: err.message }));
      }
      return;
    }
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Not found');
  });

  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => {
      resolve(
        () =>
          new Promise((done) => {
            server.close(() => done());
          })
      );
    });
  });
}
