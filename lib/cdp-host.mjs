import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { devToolsPortFile } from './paths.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const RUNTIME_TEMPLATE_PATH = path.join(__dirname, 'runtime.js');

const HUB_TITLE_RE =
  /(?:(?:^| - |\(\d+\) )Antigravity(?:\s*(?:\([^)]+\)|\[[^\]]+\]))?|(?:\s|^)(?:\((?:SSH|WSL):\s*[^)]+\)|\[(?:SSH|WSL):\s*[^\]]+\]))$/;
const HUB_PATH_RE =
  /^\/(?:c\/[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}|powertools|customizations|automations)(?:\/|$)/;

export function isLoopbackPageTarget(target) {
  if (!target || target.type !== 'page' || typeof target.url !== 'string') return false;
  try {
    const url = new URL(target.url);
    return (
      (url.protocol === 'https:' || url.protocol === 'http:') &&
      ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)
    );
  } catch {
    return false;
  }
}

export function isHubTarget(target) {
  if (!isLoopbackPageTarget(target)) return false;
  try {
    const pathname = new URL(target.url).pathname;
    return HUB_TITLE_RE.test(String(target.title || '')) || HUB_PATH_RE.test(pathname);
  } catch {
    return false;
  }
}

export function escapeInlineJson(obj) {
  return JSON.stringify(obj).replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
}

let cachedRuntimeTemplate = '';

export function buildRuntimeSource({ version = '1.0.0', enabled = true } = {}) {
  if (!cachedRuntimeTemplate) {
    cachedRuntimeTemplate = fs.readFileSync(RUNTIME_TEMPLATE_PATH, 'utf8');
  }
  const payload = escapeInlineJson({ version, enabled: Boolean(enabled) });
  return cachedRuntimeTemplate.replace('__AGPS_BOOT_PAYLOAD__', payload);
}

export function readDebugPort(portFilePath) {
  try {
    const raw = fs.readFileSync(portFilePath, 'utf8').trim();
    const firstLine = raw.split(/\r?\n/)[0];
    const port = Number(firstLine);
    return Number.isInteger(port) && port >= 1 && port <= 65535 ? port : null;
  } catch {
    return null;
  }
}

export function connectCdp(wsUrl, { timeoutMs = 4000 } = {}) {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(wsUrl);
    const pending = new Map();
    const listeners = new Set();
    let seq = 0;
    let opened = false;

    const timer = setTimeout(() => {
      try { socket.close(); } catch {}
      reject(new Error('CDP 连接超时'));
    }, timeoutMs);

    const rejectAll = (reason) => {
      for (const entry of pending.values()) {
        clearTimeout(entry.timer);
        entry.reject(new Error(reason));
      }
      pending.clear();
    };

    socket.addEventListener('error', () => {
      clearTimeout(timer);
      if (!opened) reject(new Error('CDP 连接失败'));
    });

    socket.addEventListener('close', () => {
      clearTimeout(timer);
      rejectAll('CDP 连接已关闭');
    });

    socket.addEventListener('message', (event) => {
      let msg;
      try {
        msg = JSON.parse(String(event.data));
      } catch {
        return;
      }
      if (msg.id && pending.has(msg.id)) {
        const entry = pending.get(msg.id);
        pending.delete(msg.id);
        clearTimeout(entry.timer);
        if (msg.error) {
          entry.reject(new Error(msg.error.message || 'CDP 调用失败'));
        } else {
          entry.resolve(msg.result);
        }
        return;
      }
      for (const fn of listeners) {
        try {
          fn(msg);
        } catch {}
      }
    });

    socket.addEventListener('open', () => {
      opened = true;
      clearTimeout(timer);
      resolve({
        socket,
        onEvent(fn) {
          listeners.add(fn);
          return () => listeners.delete(fn);
        },
        send(method, params = {}) {
          if (socket.readyState !== WebSocket.OPEN) {
            return Promise.reject(new Error('CDP 连接已断开'));
          }
          return new Promise((res, rej) => {
            const id = ++seq;
            const callTimeout = method === 'Runtime.evaluate' ? 15000 : 5000;
            const t = setTimeout(() => {
              pending.delete(id);
              rej(new Error(`${method} 超时`));
            }, callTimeout);
            pending.set(id, { resolve: res, reject: rej, timer: t });
            socket.send(JSON.stringify({ id, method, params }));
          });
        }
      });
    });
  });
}

export function createCdpHost({
  version = '1.1.0',
  getSettings,
  engine,
  portFile = '',
  pollIntervalMs = 3000,
  connectImpl = connectCdp,
  fetchImpl = fetch,
  onLog = () => {},
  onDebugPortReady = null,
  onMissingDebugPort = null
} = {}) {
  const activePortFile = devToolsPortFile({ portFile });
  const clients = new Map();
  let timer = null;
  let polling = false;
  let stopped = false;
  let lastPort = null;
  let lastError = '';
  let lastPollAt = 0;

  function isEnabled() {
    const cfg = typeof getSettings === 'function' ? getSettings() : null;
    return Boolean(cfg && cfg.enabled !== false);
  }

  async function injectClient(client) {
    const enabled = isEnabled();
    const source = buildRuntimeSource({ version, enabled });
    if (client.scriptId) {
      await client
        .send('Page.removeScriptToEvaluateOnNewDocument', { identifier: client.scriptId })
        .catch(() => {});
      client.scriptId = '';
    }
    const installed = await client.send('Page.addScriptToEvaluateOnNewDocument', { source });
    client.scriptId = installed?.identifier || '';
    const evalRes = await client.send('Runtime.evaluate', { expression: source });
    if (evalRes?.exceptionDetails) {
      throw new Error(evalRes.exceptionDetails.text || '注入脚本执行失败');
    }
    client.injectedEnabled = enabled;
  }

  async function handleSuggestionBinding(client, targetId, event) {
    let req = {};
    try {
      req = event?.params?.payload ? JSON.parse(String(event.params.payload)) : {};
    } catch {}
    const reqId = String(req?.reqId || '');
    const contextId = event?.params?.executionContextId;

    const reply = async (outObj) => {
      if (client.socket.readyState !== WebSocket.OPEN) return;
      const evalParams = {
        expression: `if (typeof window.__agps_on_suggestion === 'function') { window.__agps_on_suggestion(${JSON.stringify(reqId)}, ${escapeInlineJson(outObj)}); }`,
        returnByValue: false
      };
      if (Number.isInteger(contextId)) {
        evalParams.contextId = contextId;
      }
      try {
        await client.send('Runtime.evaluate', evalParams);
      } catch {
        if (evalParams.contextId !== undefined) {
          delete evalParams.contextId;
          await client.send('Runtime.evaluate', evalParams).catch(() => {});
        }
      }
    };

    if (!engine || !isEnabled()) {
      if (reqId) {
        void reply({ ok: false, completed: false, suggestion: '' });
      }
      return;
    }

    const fingerprint = String(req?.fingerprint || '').trim();
    const conversationId = String(req?.conversationId || '').trim().slice(0, 128);
    const scopeId = conversationId || `target:${targetId}`;
    const lastUser = String(req?.lastUser || '').trim().slice(-600);
    const lastAssistant = String(req?.lastAssistant || '').trim().slice(-1400);

    try {
      const res = await engine.suggestWithMeta({
        fingerprint,
        conversationId,
        scopeId,
        lastUser,
        lastAssistant
      });
      await reply({
        ok: true,
        completed: Boolean(res?.completed),
        suggestion: String(res?.suggestion || '')
      });
    } catch (err) {
      await reply({
        ok: false,
        completed: false,
        suggestion: '',
        error: err?.message || String(err || 'prompt suggestion failed')
      });
    }
  }

  async function attach(target) {
    const client = await connectImpl(target.webSocketDebuggerUrl);
    const origin = new URL(target.url).origin;
    client.origin = origin;
    client.endpoint = target.webSocketDebuggerUrl;
    client.title = String(target.title || '');
    client.scriptId = '';
    client.injectedEnabled = null;

    clients.set(target.id, client);
    client.socket.addEventListener('close', () => {
      if (clients.get(target.id) === client) {
        clients.delete(target.id);
      }
    });

    client.onEvent((msg) => {
      if (msg.method === 'Runtime.bindingCalled' && msg.params?.name === '__agpsRequestSuggestion') {
        void handleSuggestionBinding(client, target.id, msg);
      }
    });

    await client.send('Runtime.enable');
    await client.send('Page.enable');

    const probeRes = await client.send('Runtime.evaluate', {
      expression: `(() => {
        const ua = navigator.userAgent || '';
        const isHub = Boolean(/Antigravity\\//.test(ua) || globalThis.electronNative || globalThis.sshRemote || globalThis.createFileRoute);
        return { isHub, ua, title: document.title || '' };
      })()`,
      returnByValue: true
    });
    const probe = probeRes?.result?.value;
    if (probe && typeof probe === 'object' && probe.isHub === false) {
      try { client.socket.close(); } catch {}
      clients.delete(target.id);
      return;
    }

    await client.send('Runtime.addBinding', { name: '__agpsRequestSuggestion' });
    await injectClient(client);
    onLog(`[prompt-suggestions] Attached window: ${target.title || target.id}`);

    if (engine && isEnabled()) {
      engine.syncState();
    }
  }

  async function poll() {
    if (stopped || polling) return;
    polling = true;
    lastPollAt = Date.now();
    try {
      const port = readDebugPort(activePortFile);
      if (!port) {
        lastPort = null;
        lastError = '未检测到 Antigravity 本地调试端口 (DevToolsActivePort)';
        for (const [id, client] of clients) {
          try { client.socket.close(); } catch {}
          clients.delete(id);
        }
        try { onMissingDebugPort?.(); } catch {}
        return;
      }

      const res = await fetchImpl(`http://127.0.0.1:${port}/json/list`, {
        signal: AbortSignal.timeout(4000)
      });
      if (!res.ok) {
        throw new Error(`CDP /json/list 返回 HTTP ${res.status}`);
      }
      const targets = await res.json();
      if (!Array.isArray(targets)) {
        throw new Error('CDP /json/list 返回格式无效');
      }

      lastPort = port;
      lastError = '';
      try { onDebugPortReady?.(port); } catch {}

      const hubs = targets.filter(
        (t) =>
          isHubTarget(t) ||
          (isLoopbackPageTarget(t) && clients.get(t.id)?.origin === new URL(t.url).origin)
      );

      const enabled = isEnabled();
      for (const target of hubs) {
        let client = clients.get(target.id);
        try {
          if (
            client &&
            (client.origin !== new URL(target.url).origin ||
              client.endpoint !== target.webSocketDebuggerUrl)
          ) {
            try { client.socket.close(); } catch {}
            clients.delete(target.id);
            client = null;
          }
          if (!client) {
            await attach(target);
          } else {
            client.title = String(target.title || client.title || '');
            const check = await client.send('Runtime.evaluate', {
              expression: `(() => {
                const rt = globalThis.__agps_runtime;
                return {
                  ready: Boolean(rt && rt.version === ${JSON.stringify(version)} && rt.healthy),
                  enabled: Boolean(rt && rt.enabled)
                };
              })()`,
              returnByValue: true
            });
            const v = check?.result?.value;
            if (!v?.ready || v.enabled !== enabled) {
              await injectClient(client);
            }
          }
        } catch (err) {
          try { clients.get(target.id)?.socket.close(); } catch {}
          clients.delete(target.id);
          lastError = err?.message || String(err);
        }
      }

      const liveIds = new Set(hubs.map((t) => t.id));
      for (const [id, client] of clients) {
        if (!liveIds.has(id)) {
          try { client.socket.close(); } catch {}
          clients.delete(id);
        }
      }

      if (engine) {
        if (clients.size > 0 && enabled) {
          engine.syncState();
        } else if (!enabled) {
          engine.stop();
        }
      }
    } catch (err) {
      lastError = err?.message || String(err);
      if (clients.size === 0) {
        try { onMissingDebugPort?.(); } catch {}
      }
    } finally {
      polling = false;
    }
  }

  async function syncSettings() {
    if (stopped) return;
    if (engine) {
      if (isEnabled() && clients.size > 0) {
        engine.syncState();
      } else if (!isEnabled()) {
        engine.stop();
      }
    }
    const jobs = [];
    for (const [id, client] of clients) {
      jobs.push(
        injectClient(client).catch(() => {
          try { client.socket.close(); } catch {}
          clients.delete(id);
        })
      );
    }
    await Promise.all(jobs);
  }

  function start() {
    if (stopped || timer) return;
    void poll();
    timer = setInterval(() => {
      void poll();
    }, pollIntervalMs);
    if (typeof timer.unref === 'function') timer.unref();
  }

  async function stop() {
    if (stopped) return;
    stopped = true;
    if (timer) {
      clearInterval(timer);
      timer = null;
    }
    const closeJobs = [];
    for (const client of clients.values()) {
      closeJobs.push(
        (async () => {
          try {
            if (client.scriptId) {
              await client
                .send('Page.removeScriptToEvaluateOnNewDocument', { identifier: client.scriptId })
                .catch(() => {});
            }
            await client
              .send('Runtime.evaluate', {
                expression: 'if (globalThis.__agps_runtime) globalThis.__agps_runtime.dispose();'
              })
              .catch(() => {});
          } finally {
            try { client.socket.close(); } catch {}
          }
        })()
      );
    }
    await Promise.all(closeJobs);
    clients.clear();
  }

  function getStatus() {
    return {
      connected: clients.size > 0,
      windowCount: clients.size,
      windows: Array.from(clients.entries()).map(([id, c]) => ({
        id,
        title: c.title || '',
        origin: c.origin || ''
      })),
      debugPort: lastPort,
      portFile: activePortFile,
      error: clients.size > 0 ? '' : lastError,
      lastPollAt
    };
  }

  return {
    start,
    stop,
    poll,
    syncSettings,
    getStatus
  };
}
