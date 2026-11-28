import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { EventEmitter } from 'node:events';
import { createSettingsStore, DEFAULT_MODEL, sanitizeModelId } from '../lib/settings.mjs';
import {
  buildPromptSuggestionPrompt,
  cleanPromptSuggestionText,
  createPromptSuggestionEngine,
  deriveEffortFromModelId,
  parseAgyModelsOutput
} from '../lib/engine.mjs';
import {
  buildRuntimeSource,
  createCdpHost,
  isHubTarget,
  isLoopbackPageTarget
} from '../lib/cdp-host.mjs';

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

function createMockChild(bin, args) {
  const child = new EventEmitter();
  child.bin = bin;
  child.args = args;
  child.exitCode = null;
  child.signalCode = null;
  child.killed = false;
  child.signals = [];
  child.written = [];
  child.stdin = {
    ended: false,
    destroyed: false,
    write(chunk) {
      child.written.push(String(chunk));
      return true;
    },
    end() {
      this.ended = true;
    },
    destroy() {
      this.destroyed = true;
    }
  };
  child.stdout = new EventEmitter();
  child.stdout.destroyed = false;
  child.stdout.destroy = function () {
    this.destroyed = true;
  };
  child.stderr = new EventEmitter();
  child.stderr.destroyed = false;
  child.stderr.resume = function () {};
  child.stderr.destroy = function () {
    this.destroyed = true;
  };
  child.kill = (sig = 'SIGTERM') => {
    child.killed = true;
    child.signals.push(sig);
    return true;
  };
  child.emitStdout = (obj) => {
    const line = typeof obj === 'string' ? obj : JSON.stringify(obj) + '\n';
    child.stdout.emit('data', Buffer.from(line, 'utf8'));
  };
  child.finishExit = (code = 0, signal = null) => {
    child.exitCode = code;
    child.signalCode = signal;
    child.emit('exit', code, signal);
    child.emit('close', code, signal);
  };
  return child;
}

test('settings store persists changes, sanitizes invalid model IDs, and notifies subscribers', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agps-settings-'));
  try {
    const store = createSettingsStore({ dataDir: tmpDir });
    assert.deepEqual(store.get(), { enabled: true, model: DEFAULT_MODEL, autoRelaunch: true });

    const events = [];
    const unsub = store.subscribe((next, prev) => events.push({ next, prev }));

    const saved = store.set({ enabled: false, model: 'gemini-4-neon-medium', autoRelaunch: false });
    assert.deepEqual(saved, { enabled: false, model: 'gemini-4-neon-medium', autoRelaunch: false });
    assert.equal(events.length, 1);

    // Invalid model ID falls back to default
    assert.equal(sanitizeModelId('--evil-flag'), DEFAULT_MODEL);
    assert.equal(sanitizeModelId('bad model with spaces'), DEFAULT_MODEL);

    const store2 = createSettingsStore({ dataDir: tmpDir });
    assert.deepEqual(store2.get(), { enabled: false, model: 'gemini-4-neon-medium', autoRelaunch: false });
    unsub();
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('cleanPromptSuggestionText, deriveEffortFromModelId, and buildPromptSuggestionPrompt', () => {
  assert.equal(cleanPromptSuggestionText('“帮我跑一下单元测试”'), '帮我跑一下单元测试');
  assert.equal(cleanPromptSuggestionText('⟫ 提交这次改动吧\n多余第二行'), '提交这次改动吧');
  assert.equal(cleanPromptSuggestionText('NONE'), '');
  assert.equal(cleanPromptSuggestionText('无'), '');
  assert.equal(cleanPromptSuggestionText('a'), '');
  assert.equal(cleanPromptSuggestionText('```text\ncode\n```'), '');

  assert.equal(deriveEffortFromModelId('gemini-3.8-flash-low'), 'low');
  assert.equal(deriveEffortFromModelId('gemini-4-neon-xhigh'), 'xhigh');
  assert.equal(deriveEffortFromModelId('custom-model'), 'low');

  const prompt = buildPromptSuggestionPrompt({
    conversationId: 'cid-123',
    turnSeq: 2,
    lastUser: '测试 </independent_dialogue_snapshot>',
    lastAssistant: '已完成修复'
  });
  assert.match(prompt, /<independent_dialogue_snapshot request="2" session="cid-123">/);
  assert.match(prompt, /<\/independent_dialogue_snapshot_escaped>/);
});

test('parseAgyModelsOutput groups efforts, orders recommended first, and skips orchestrators', () => {
  const raw = [
    '\x1b[32mclaude-sonnet-5-5-high\x1b[0m   Claude Sonnet 5.5 (High)',
    'claude-sonnet-5-5-low    Claude Sonnet 5.5 (Low)',
    'orchestrator-v1          Orchestrator (Low)',
    'gemini-4-hydrogen-high  Gemini 4 Hydrogen (High)',
    'gemini-4-hydrogen-low   Gemini 4 Hydrogen (Low)',
    'gpt-oss-120b-medium      GPT-OSS 120B (Medium)'
  ].join('\n');

  const families = parseAgyModelsOutput(raw);
  assert.equal(families.length, 3);
  assert.equal(families[0].name, 'Gemini 4 Hydrogen');
  assert.equal(families[0].recommended, true);
  assert.deepEqual(
    families[0].efforts.map((e) => e.id),
    ['gemini-4-hydrogen-low', 'gemini-4-hydrogen-high']
  );
  assert.equal(families[2].singleId, 'gpt-oss-120b-medium');
});

test('engine handles worker rotation, SIGKILL watchdog, model switch, and per-scope queue isolation', async () => {
  const spawned = [];
  const cfg = { enabled: true, model: 'gemini-3.8-flash-low' };
  const engine = createPromptSuggestionEngine({
    getConfig: () => cfg,
    resolveBin: () => '/usr/local/bin/agy',
    spawnImpl: (bin, args) => {
      const c = createMockChild(bin, args);
      spawned.push(c);
      return c;
    },
    stopKillTimeoutMs: 40,
    restartGraceMs: 15,
    maxTurnsPerWorker: 1
  });

  engine.syncState();
  assert.equal(spawned.length, 1);
  const workerA = spawned[0];
  workerA.emitStdout({ event: 'init' });
  workerA.emitStdout({ event: 'result', result: { response: 'OK' } });
  assert.equal(engine.getStatus().warmed, true);

  // Two split-screen scopes queued simultaneously should NOT evict each other
  const p1 = engine.suggestWithMeta({
    fingerprint: 'fp-pane-1',
    conversationId: 'conv-1',
    scopeId: 'conv-1',
    lastUser: '修 bug',
    lastAssistant: '修好了'
  });
  const p2 = engine.suggestWithMeta({
    fingerprint: 'fp-pane-2',
    conversationId: 'conv-2',
    scopeId: 'conv-2',
    lastUser: '写文档',
    lastAssistant: '写完了'
  });

  workerA.emitStdout({ event: 'result', result: { response: '运行全部测试' } });
  const r1 = await p1;
  assert.deepEqual(r1, { completed: true, suggestion: '运行全部测试' });

  // Cache hit works and clearCache removes it
  const cached = await engine.suggestWithMeta({
    fingerprint: 'fp-pane-1',
    conversationId: 'conv-1',
    lastAssistant: '修好了'
  });
  assert.equal(cached.suggestion, '运行全部测试');
  engine.clearCache();
  assert.equal(engine.getStatus().cacheSize, 0);

  // Worker A rotated because maxTurnsPerWorker=1; test SIGKILL escalation
  assert.deepEqual(workerA.signals, ['SIGTERM']);
  await wait(60);
  assert.deepEqual(workerA.signals, ['SIGTERM', 'SIGKILL']);
  workerA.finishExit(null, 'SIGKILL');

  // Worker B spawns and drains p2
  await wait(40);
  assert.equal(spawned.length, 2);
  const workerB = spawned[1];
  workerB.emitStdout({ event: 'init' });
  workerB.emitStdout({ event: 'result', result: { response: 'OK' } });
  workerB.emitStdout({ event: 'result', result: { response: '提交文档更新' } });
  const r2 = await p2;
  assert.deepEqual(r2, { completed: true, suggestion: '提交文档更新' });

  engine.stop({ terminateAll: true });
  workerB.finishExit(0, 'SIGTERM');
});

test('cdp-host target filters, binding bridge, settings sync, and clean stop', async () => {
  assert.equal(
    isLoopbackPageTarget({ type: 'page', url: 'https://127.0.0.1:4444/c/abc' }),
    true
  );
  assert.equal(
    isLoopbackPageTarget({ type: 'iframe', url: 'https://127.0.0.1:4444/c/abc' }),
    false
  );
  assert.equal(
    isHubTarget({ type: 'page', title: 'Antigravity', url: 'https://127.0.0.1:4444/' }),
    true
  );
  assert.equal(
    isHubTarget({ type: 'page', title: 'Random Site', url: 'https://example.com/' }),
    false
  );

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agps-cdp-'));
  const portFile = path.join(tmpDir, 'DevToolsActivePort');
  fs.writeFileSync(portFile, '43210\n/devtools/browser/test\n', 'utf8');

  const sent = [];
  let eventHandler = null;
  let closed = false;
  const mockClient = {
    socket: {
      readyState: WebSocket.OPEN,
      addEventListener() {},
      close() {
        closed = true;
        this.readyState = WebSocket.CLOSED;
      }
    },
    onEvent(fn) {
      eventHandler = fn;
    },
    async send(method, params) {
      sent.push({ method, params });
      if (method === 'Page.addScriptToEvaluateOnNewDocument') {
        return { identifier: 'doc-script-1' };
      }
      if (method === 'Runtime.evaluate' && String(params.expression).includes('isHub')) {
        return { result: { value: { isHub: true, ua: 'Antigravity/2.35.2' } } };
      }
      return { result: { value: { ready: true, enabled: true } } };
    }
  };

  let enabled = true;
  const engineCalls = [];
  const mockEngine = {
    syncState() {
      engineCalls.push('sync');
    },
    stop() {
      engineCalls.push('stop');
    },
    async suggestWithMeta(arg) {
      engineCalls.push(['suggest', arg.fingerprint]);
      return { completed: true, suggestion: '继续跑一下单测' };
    }
  };

  const host = createCdpHost({
    version: '1.0.0',
    getSettings: () => ({ enabled, model: DEFAULT_MODEL }),
    engine: mockEngine,
    portFile,
    connectImpl: async () => mockClient,
    fetchImpl: async () => ({
      ok: true,
      async json() {
        return [
          {
            id: 'target-1',
            type: 'page',
            title: 'Antigravity',
            url: 'https://127.0.0.1:8443/c/conv-1',
            webSocketDebuggerUrl: 'ws://127.0.0.1:43210/devtools/page/1'
          }
        ];
      }
    })
  });

  try {
    await host.poll();
    assert.equal(host.getStatus().connected, true);
    assert.equal(host.getStatus().windowCount, 1);
    assert.ok(sent.some((s) => s.method === 'Runtime.addBinding' && s.params.name === '__agpsRequestSuggestion'));

    // Second poll (keepalive check on already-attached client) must NOT throw or drop the connection
    const sentBeforeSecondPoll = sent.length;
    await host.poll();
    assert.equal(closed, false, 'keepalive poll must keep existing client connected');
    assert.equal(host.getStatus().connected, true);
    assert.equal(host.getStatus().windowCount, 1);
    assert.equal(host.getStatus().error, '');
    assert.ok(
      sent.slice(sentBeforeSecondPoll).some((s) => s.method === 'Runtime.evaluate' && String(s.params.expression).includes('"1.0.0"')),
      'keepalive poll should verify runtime version string'
    );

    // Simulate browser calling __agpsRequestSuggestion binding
    eventHandler({
      method: 'Runtime.bindingCalled',
      params: {
        name: '__agpsRequestSuggestion',
        executionContextId: 7,
        payload: JSON.stringify({
          reqId: 'req-1',
          fingerprint: 'fp-1',
          conversationId: 'conv-1',
          lastUser: '修好了吗',
          lastAssistant: '已经修好了'
        })
      }
    });
    await wait(20);
    const replyEval = sent.find(
      (s) => s.method === 'Runtime.evaluate' && String(s.params.expression).includes('__agps_on_suggestion("req-1"')
    );
    assert.ok(replyEval, 'host should reply to window.__agps_on_suggestion');
    assert.match(replyEval.params.expression, /继续跑一下单测/);

    // Toggle off
    enabled = false;
    await host.syncSettings();
    assert.ok(engineCalls.includes('stop'));

    // Graceful stop cleans up script and disposes runtime
    await host.stop();
    assert.equal(closed, true);
    assert.ok(sent.some((s) => s.method === 'Page.removeScriptToEvaluateOnNewDocument'));
    assert.ok(
      sent.some(
        (s) => s.method === 'Runtime.evaluate' && String(s.params.expression).includes('__agps_runtime.dispose()')
      )
    );
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('runtime.js mounts ghost overlay, accepts on Tab, respects dark mode, and cleans up on dispose', async () => {
  // Minimal DOM mock for verifying runtime lifecycle & Tab acceptance
  const listeners = new Map();
  const addListener = (target, type, fn) => {
    const key = `${target}:${type}`;
    if (!listeners.has(key)) listeners.set(key, new Set());
    listeners.get(key).add(fn);
  };
  const removeListener = (target, type, fn) => {
    listeners.get(`${target}:${type}`)?.delete(fn);
  };

  function makeEl(tag, attrs = {}, text = '') {
    const el = {
      tagName: tag.toUpperCase(),
      nodeType: 1,
      id: attrs.id || '',
      className: attrs.class || '',
      attrs: { ...attrs },
      style: {},
      hidden: false,
      textContent: text,
      innerText: text,
      children: [],
      parentElement: null,
      parentNode: null,
      isConnected: true,
      dispatched: [],
      classList: {
        contains(cls) {
          return String(el.className || '').split(/\s+/).includes(cls);
        }
      },
      getAttribute(k) {
        return k in el.attrs ? el.attrs[k] : null;
      },
      setAttribute(k, v) {
        el.attrs[k] = String(v);
        if (k === 'id') el.id = String(v);
        if (k === 'class') el.className = String(v);
      },
      removeAttribute(k) {
        delete el.attrs[k];
      },
      appendChild(child) {
        child.parentElement = el;
        child.parentNode = el;
        el.children.push(child);
        return child;
      },
      remove() {
        el.isConnected = false;
        if (el.parentElement) {
          el.parentElement.children = el.parentElement.children.filter((c) => c !== el);
          el.parentElement = null;
          el.parentNode = null;
        }
      },
      contains(other) {
        let cur = other;
        while (cur) {
          if (cur === el) return true;
          cur = cur.parentElement;
        }
        return false;
      },
      closest(sel) {
        let cur = el;
        while (cur) {
          if (matches(cur, sel)) return cur;
          cur = cur.parentElement;
        }
        return null;
      },
      querySelector(sel) {
        return this.querySelectorAll(sel)[0] || null;
      },
      querySelectorAll(sel) {
        const out = [];
        const walk = (node) => {
          for (const c of node.children || []) {
            if (matches(c, sel)) out.push(c);
            walk(c);
          }
        };
        walk(el);
        return out;
      },
      getBoundingClientRect() {
        return { width: 400, height: 24 };
      },
      compareDocumentPosition() {
        return 2; // PRECEDING (user msg is before assistant msg)
      },
      focus() {},
      addEventListener() {},
      removeEventListener() {},
      dispatchEvent(ev) {
        el.dispatched.push(ev);
        if (ev.type === 'beforeinput' && ev.data) {
          el.innerText = ev.data;
          el.textContent = ev.data;
        }
        return true;
      }
    };
    return el;
  }

  function matches(el, selector) {
    if (!el || !selector) return false;
    return selector.split(',').some((part) => {
      const s = part.trim();
      if (!s) return false;
      if (s.startsWith('.')) return el.classList.contains(s.slice(1));
      if (s.startsWith('#')) return el.id === s.slice(1);
      const attrEq = s.match(/^\[([^=\]]+)="([^"]+)"\]$/);
      if (attrEq) return el.getAttribute(attrEq[1]) === attrEq[2];
      const attrExists = s.match(/^\[([^=\]]+)\]$/);
      if (attrExists) return el.getAttribute(attrExists[1]) !== null;
      return el.tagName.toLowerCase() === s.toLowerCase();
    });
  }

  const htmlEl = makeEl('html');
  const headEl = makeEl('head');
  const bodyEl = makeEl('body', { class: 'dark' });
  htmlEl.appendChild(headEl);
  htmlEl.appendChild(bodyEl);

  const convView = makeEl('div', { 'data-testid': 'conversation-view', 'data-cascade-id': '11111111-2222-3333-4444-555555555555' });
  const userMsg = makeEl('div', { 'data-testid': 'user-message-content' }, '帮我检查一下报错');
  const assistantMsg = makeEl('div', { 'data-markdown-root': 'true' }, '已修复该报错并更新了代码。');
  const host = makeEl('div');
  const editor = makeEl('div', { 'data-lexical-editor': 'true' }, '');
  host.appendChild(editor);
  convView.appendChild(userMsg);
  convView.appendChild(assistantMsg);
  convView.appendChild(host);
  bodyEl.appendChild(convView);

  const requests = [];
  const doc = {
    documentElement: htmlEl,
    head: headEl,
    body: bodyEl,
    title: 'Antigravity',
    activeElement: editor,
    createElement: (tag) => makeEl(tag),
    getElementById: (id) => htmlEl.querySelector('#' + id),
    getElementsByTagName: (tag) => htmlEl.querySelectorAll(tag),
    querySelector: (sel) => htmlEl.querySelector(sel),
    querySelectorAll: (sel) => htmlEl.querySelectorAll(sel),
    addEventListener: (type, fn) => addListener('doc', type, fn),
    removeEventListener: (type, fn) => removeListener('doc', type, fn),
    createRange: () => ({ selectNodeContents() {}, collapse() {} })
  };

  class FakeInputEvent {
    constructor(type, init = {}) {
      this.type = type;
      Object.assign(this, init);
    }
  }

  const sandbox = {
    document: doc,
    Node: { DOCUMENT_POSITION_FOLLOWING: 4 },
    InputEvent: FakeInputEvent,
    Event: FakeInputEvent,
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval,
    requestAnimationFrame: (cb) => setTimeout(cb, 0),
    cancelAnimationFrame: clearTimeout,
    getComputedStyle: () => ({
      display: 'block',
      visibility: 'visible',
      position: 'static',
      paddingTop: '4px',
      paddingLeft: '8px',
      paddingRight: '8px',
      fontSize: '14px',
      lineHeight: '20px'
    }),
    location: { pathname: '/c/11111111-2222-3333-4444-555555555555', search: '' },
    getSelection: () => ({ removeAllRanges() {}, addRange() {} }),
    addEventListener: (type, fn) => addListener('win', type, fn),
    removeEventListener: (type, fn) => removeListener('win', type, fn),
    dispatchEvent() {},
    __agpsRequestSuggestion(payloadStr) {
      requests.push(JSON.parse(payloadStr));
    }
  };
  sandbox.window = sandbox;
  sandbox.top = sandbox;
  sandbox.globalThis = sandbox;

  const source = buildRuntimeSource({ version: '1.2.0', enabled: true });
  vm.runInNewContext(source, sandbox);

  // Wait for initial tick (400ms): historical idle conversation must NOT auto-request before user focuses editor
  await wait(460);

  assert.equal(htmlEl.getAttribute('data-agps-theme'), 'dark');
  assert.ok(doc.getElementById('agps-prompt-suggestions-style'), 'style tag should be injected');
  assert.equal(requests.length, 0, 'idle historical conversation should not auto-request before editor focus');

  // Focusing the empty editor triggers on-demand prediction
  for (const fn of listeners.get('doc:focusin') || []) {
    fn({ target: editor });
  }
  assert.equal(requests.length, 1, 'focusing empty editor should trigger suggestion request');
  assert.equal(requests[0].conversationId, '11111111-2222-3333-4444-555555555555');

  // After 160ms in-flight delay, inline loading hint should appear with data-agps-loading="true"
  await wait(200);
  const loadingOverlay = host.querySelector('.agps-ghost-overlay');
  assert.ok(loadingOverlay && !loadingOverlay.hidden, 'loading overlay should appear after 160ms');
  assert.equal(loadingOverlay.getAttribute('data-agps-loading'), 'true');
  assert.equal(loadingOverlay.querySelector('.agps-ghost-text').textContent, '正在构思下一句…');

  // Deliver suggestion -> loading attr clears and ghost suggestion renders
  sandbox.__agps_on_suggestion(requests[0].reqId, {
    ok: true,
    completed: true,
    suggestion: '帮我跑一下回归测试'
  });

  const overlay = host.querySelector('.agps-ghost-overlay');
  assert.ok(overlay && !overlay.hidden, 'ghost overlay should be visible');
  assert.equal(overlay.getAttribute('data-agps-loading'), null);
  assert.equal(overlay.querySelector('.agps-ghost-text').textContent, '帮我跑一下回归测试');
  assert.equal(host.getAttribute('data-agps-has-suggestion'), 'true');

  // Press Tab to accept
  let prevented = false;
  for (const fn of listeners.get('doc:keydown') || []) {
    fn({
      key: 'Tab',
      isComposing: false,
      shiftKey: false,
      ctrlKey: false,
      metaKey: false,
      altKey: false,
      preventDefault() {
        prevented = true;
      },
      stopPropagation() {}
    });
  }
  await wait(20);
  assert.equal(prevented, true);
  assert.equal(editor.innerText, '帮我跑一下回归测试');
  assert.equal(overlay.hidden, true);

  // Simulate brand-new assistant turn completing in the same conversation (without refocusing)
  editor.innerText = '';
  editor.textContent = '';
  const assistantMsg2 = makeEl('div', { 'data-markdown-root': 'true' }, '回归测试全部通过，没有异常。');
  convView.appendChild(assistantMsg2);
  // Trigger tick via compositionend (60ms) -> new turn on same scope should auto-trigger!
  for (const fn of listeners.get('doc:compositionend') || []) {
    fn({});
  }
  await wait(100);
  assert.equal(requests.length, 2, 'newly completed turn in same conversation should auto-trigger');

  // Wait for loading hint, then press Escape to cancel/dismiss it
  await wait(200);
  assert.equal(overlay.getAttribute('data-agps-loading'), 'true');
  for (const fn of listeners.get('doc:keydown') || []) {
    fn({
      key: 'Escape',
      isComposing: false,
      shiftKey: false,
      ctrlKey: false,
      metaKey: false,
      altKey: false,
      preventDefault() {},
      stopPropagation() {}
    });
  }
  assert.equal(overlay.hidden, true);
  assert.equal(overlay.getAttribute('data-agps-loading'), null);

  // Dispose removes styles, attributes, overlays, and callback
  sandbox.__agps_runtime.dispose();
  assert.equal(doc.getElementById('agps-prompt-suggestions-style'), null);
  assert.equal(htmlEl.getAttribute('data-agps-theme'), null);
  assert.equal(host.querySelector('.agps-ghost-overlay'), null);
  assert.equal(sandbox.__agps_on_suggestion, undefined);
});
