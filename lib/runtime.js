/**
 * lib/runtime.js — Standalone Browser Runtime for Prompt Suggestions
 *
 * Extracted and isolated from antigravity-codex-theme (MIT, @isdou PR #1).
 * Injects Ghost Text + Tab/ArrowRight accept into Antigravity Lexical composers
 * with per-pane isolation (main, split-screen, Side Question, Subagent) and
 * automatic Light/Dark mode styling.
 */
(function (boot) {
  if (typeof window === 'undefined' || window.top !== window) return;
  if (!boot || typeof boot !== 'object') return;

  const VERSION = String(boot.version || '1.2.0');
  const ENABLED = boot.enabled !== false;
  const STYLE_ID = 'agps-prompt-suggestions-style';
  const OVERLAY_CLASS = 'agps-ghost-overlay';
  const HAS_SUGGESTION_ATTR = 'data-agps-has-suggestion';
  const LOADING_ATTR = 'data-agps-loading';
  const THEME_ATTR = 'data-agps-theme';
  const LOADING_DELAY_MS = 160;
  const LOADING_ROTATE_MS = 2200;
  const NAV_FOCUS_GUARD_MS = 350;
  const LOADING_HINTS = ['正在构思下一句…', '结合上下文预测中…', '正在生成续写建议…'];

  const CSS_TEXT = [
    '[' + HAS_SUGGESTION_ATTR + '="true"] > p.pointer-events-none,',
    '[' + HAS_SUGGESTION_ATTR + '="true"] [data-lexical-editor="true"] ~ p.pointer-events-none {',
    '  opacity: 0 !important;',
    '}',
    '.' + OVERLAY_CLASS + ' {',
    '  position: absolute;',
    '  inset: 0;',
    '  display: flex;',
    '  align-items: flex-start;',
    '  gap: 8px;',
    '  pointer-events: none;',
    '  z-index: 2;',
    '  overflow: hidden;',
    '  user-select: none;',
    '  -webkit-user-select: none;',
    '  opacity: 1;',
    '  transition: opacity 120ms ease;',
    '}',
    '.' + OVERLAY_CLASS + '[hidden] {',
    '  display: none !important;',
    '}',
    '#antigravity\\.agentSidePanelInputBox .agps-ghost-text,',
    '.agps-ghost-text {',
    '  color: rgba(140, 140, 148, 0.68) !important;',
    '  font-family: var(--font-sans, -apple-system, BlinkMacSystemFont, sans-serif) !important;',
    '  font-weight: 400 !important;',
    '  font-size: inherit !important;',
    '  line-height: inherit !important;',
    '  letter-spacing: normal !important;',
    '  white-space: nowrap;',
    '  overflow: hidden;',
    '  text-overflow: ellipsis;',
    '  min-width: 0;',
    '  flex: 0 1 auto;',
    '}',
    '#antigravity\\.agentSidePanelInputBox .agps-ghost-kbd,',
    '.agps-ghost-kbd {',
    '  pointer-events: auto;',
    '  cursor: pointer;',
    '  flex: 0 0 auto;',
    '  display: inline-flex;',
    '  align-items: center;',
    '  justify-content: center;',
    '  height: 18px;',
    '  padding: 0 5px;',
    '  margin-top: 2px;',
    '  border-radius: 5px;',
    '  font-family: var(--font-mono, ui-monospace, SFMono-Regular, monospace) !important;',
    '  font-size: 10.5px !important;',
    '  font-weight: 400 !important;',
    '  line-height: 1 !important;',
    '  letter-spacing: 0.01em !important;',
    '  color: rgba(130, 130, 138, 0.78) !important;',
    '  background: rgba(0, 0, 0, 0.035) !important;',
    '  border: 1px solid rgba(0, 0, 0, 0.08) !important;',
    '  transition: background-color 120ms ease, color 120ms ease, border-color 120ms ease;',
    '}',
    '#antigravity\\.agentSidePanelInputBox .agps-ghost-kbd:hover,',
    '.agps-ghost-kbd:hover {',
    '  color: #171717 !important;',
    '  background: rgba(0, 0, 0, 0.07) !important;',
    '  border-color: rgba(0, 0, 0, 0.15) !important;',
    '}',
    'html[' + THEME_ATTR + '="dark"] #antigravity\\.agentSidePanelInputBox .agps-ghost-text,',
    'html[' + THEME_ATTR + '="dark"] .agps-ghost-text,',
    'body.dark .agps-ghost-text {',
    '  color: rgba(175, 175, 185, 0.46) !important;',
    '}',
    'html[' + THEME_ATTR + '="dark"] #antigravity\\.agentSidePanelInputBox .agps-ghost-kbd,',
    'html[' + THEME_ATTR + '="dark"] .agps-ghost-kbd,',
    'body.dark .agps-ghost-kbd {',
    '  color: rgba(185, 185, 195, 0.65) !important;',
    '  background: rgba(255, 255, 255, 0.06) !important;',
    '  border-color: rgba(255, 255, 255, 0.12) !important;',
    '}',
    'html[' + THEME_ATTR + '="dark"] #antigravity\\.agentSidePanelInputBox .agps-ghost-kbd:hover,',
    'html[' + THEME_ATTR + '="dark"] .agps-ghost-kbd:hover,',
    'body.dark .agps-ghost-kbd:hover {',
    '  color: #FFFFFF !important;',
    '  background: rgba(255, 255, 255, 0.13) !important;',
    '  border-color: rgba(255, 255, 255, 0.22) !important;',
    '}',
    '@keyframes agps-breathe {',
    '  0%, 100% { opacity: 0.42; }',
    '  50% { opacity: 0.85; }',
    '}',
    '.' + OVERLAY_CLASS + '[' + LOADING_ATTR + '="true"] .agps-ghost-text {',
    '  font-style: italic;',
    '  animation: agps-breathe 1.8s ease-in-out infinite;',
    '}',
    '.' + OVERLAY_CLASS + '[' + LOADING_ATTR + '="true"] .agps-ghost-kbd {',
    '  display: none !important;',
    '}',
    '@media (prefers-reduced-motion: reduce) {',
    '  .' + OVERLAY_CLASS + '[' + LOADING_ATTR + '="true"] .agps-ghost-text {',
    '    animation: none !important;',
    '  }',
    '}'
  ].join('\n');

  function removeAllOverlaysAndStyles() {
    try {
      const styleEl = document.getElementById(STYLE_ID);
      if (styleEl) styleEl.remove();
    } catch {}
    try {
      document.querySelectorAll('.' + OVERLAY_CLASS).forEach((el) => {
        if (el.parentElement) el.parentElement.removeAttribute(HAS_SUGGESTION_ATTR);
        el.remove();
      });
      document.querySelectorAll('[' + HAS_SUGGESTION_ATTR + ']').forEach((el) => {
        el.removeAttribute(HAS_SUGGESTION_ATTR);
      });
      if (document.documentElement) {
        document.documentElement.removeAttribute(THEME_ATTR);
      }
    } catch {}
    try {
      delete window.__agps_on_suggestion;
    } catch {
      window.__agps_on_suggestion = null;
    }
  }

  if (window.__agps_runtime && typeof window.__agps_runtime.dispose === 'function') {
    try {
      window.__agps_runtime.dispose();
    } catch {}
  }

  if (!ENABLED) {
    removeAllOverlaysAndStyles();
    window.__agps_runtime = {
      version: VERSION,
      enabled: false,
      healthy: true,
      dispose: removeAllOverlaysAndStyles,
      getStatus: () => ({ version: VERSION, enabled: false, healthy: true, panes: 0 })
    };
    return;
  }

  const CANCEL_BTN_SELECTOR =
    '[data-testid="input-cancel-button"], [data-tooltip-id="input-send-button-cancel-tooltip"], [aria-label^="Cancel ("], [aria-label^="取消生成"]';
  const SIDE_CONTAINER_SELECTOR = '[data-testid="side-question-tab-content"]';
  const SIDE_COMPOSER_SELECTOR = '[data-testid="side-question-tab-composer"]';
  const SUBAGENT_CONTAINER_SELECTOR = '[data-media-drop-scope="subpane"]';
  const SUBAGENT_COMPOSER_SELECTOR = '[data-testid="subagent-tab-composer"]';
  const SUBAGENT_CONV_SELECTOR = '[data-testid="subagent-tab-conversation"]';
  const CONV_VIEW_SELECTOR = '[data-testid="conversation-view"]';
  const USER_MSG_SELECTOR = '[data-testid="user-message-content"], .agy-user-bubble';
  const MAX_DISMISSED_CACHE = 64;
  const INFLIGHT_TIMEOUT_MS = 35000;
  const RETRY_BACKOFF_MS = 2500;
  const CASCADE_PLACEHOLDER_RE =
    /^(?:conversation|new|draft|empty|none|null|undefined|unknown|placeholder|default|pending)$/i;
  const CASCADE_UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const CASCADE_ID_RE = /^[0-9a-zA-Z_-]{8,128}$/;

  let disposed = false;
  let dclHandler = null;
  let themeObserver = null;
  let themeMediaQuery = null;
  let themeMediaHandler = null;
  let domObserver = null;
  let reqSeq = 0;
  let isComposing = false;
  let isAccepting = false;
  let scanTimer = null;
  let lastNavigationAtMs = 0;
  const paneStates = new Map();
  const dismissedFingerprints = new Set();
  const createdOverlays = new Set();
  const pendingRafs = new Set();

  function detectDarkTheme() {
    try {
      const root = document.documentElement;
      const body = document.body;
      if (root) {
        const agMode = root.getAttribute('data-ag-theme-mode');
        if (agMode === 'dark') return true;
        if (agMode === 'light') return false;
        const dataTheme = String(root.getAttribute('data-theme') || '').toLowerCase();
        if (dataTheme === 'dark') return true;
        if (dataTheme === 'light') return false;
        if (root.classList && root.classList.contains('dark')) return true;
      }
      if (body) {
        if (
          body.classList &&
          (body.classList.contains('dark') ||
            body.classList.contains('theme-dark') ||
            body.classList.contains('dark-theme'))
        ) {
          return true;
        }
        if (
          body.classList &&
          (body.classList.contains('light') ||
            body.classList.contains('theme-light') ||
            body.classList.contains('light-theme'))
        ) {
          return false;
        }
        const agyTheme = String(body.getAttribute('data-agy-theme') || '').toLowerCase();
        if (agyTheme.includes('dark')) return true;
        if (agyTheme.includes('light')) return false;
      }
      try {
        const stored = Storage.prototype.getItem.call(localStorage, 'theme-mode');
        if (stored === 'dark') return true;
        if (stored === 'light') return false;
      } catch {}
      if (root && root.style && root.style.colorScheme === 'dark') return true;
      if (typeof window.matchMedia === 'function') {
        return Boolean(window.matchMedia('(prefers-color-scheme: dark)').matches);
      }
    } catch {}
    return false;
  }

  function syncThemeAttr() {
    if (disposed || !document.documentElement) return;
    const mode = detectDarkTheme() ? 'dark' : 'light';
    if (document.documentElement.getAttribute(THEME_ATTR) !== mode) {
      document.documentElement.setAttribute(THEME_ATTR, mode);
    }
  }

  function ensureStyleInjected() {
    const head = document.head || document.getElementsByTagName('head')[0] || document.documentElement;
    if (!head) return;
    let styleEl = document.getElementById(STYLE_ID);
    if (!styleEl) {
      styleEl = document.createElement('style');
      styleEl.id = STYLE_ID;
      head.appendChild(styleEl);
    }
    if (styleEl.textContent !== CSS_TEXT) {
      styleEl.textContent = CSS_TEXT;
    }
  }

  function isValidCascadeId(raw) {
    const s = String(raw || '').trim();
    if (!s || CASCADE_PLACEHOLDER_RE.test(s)) return false;
    return CASCADE_UUID_RE.test(s) || CASCADE_ID_RE.test(s);
  }

  function markDismissed(fp) {
    if (!fp) return;
    dismissedFingerprints.delete(fp);
    dismissedFingerprints.add(fp);
    if (dismissedFingerprints.size > MAX_DISMISSED_CACHE) {
      const oldest = dismissedFingerprints.values().next().value;
      dismissedFingerprints.delete(oldest);
    }
  }

  function createPaneState(scopeKey) {
    return {
      scopeKey: scopeKey || '',
      initializedScope: false,
      seenFingerprint: '',
      eligibleFingerprint: '',
      currentSuggestion: '',
      currentFingerprint: '',
      inflightFingerprint: '',
      inflightReqId: '',
      inflightTimer: null,
      loadingVisible: false,
      loadingHintIndex: 0,
      loadingDelayTimer: null,
      loadingRotateTimer: null,
      retryFingerprint: '',
      retryAfterMs: 0,
      retryCount: 0,
      retryTimer: null,
      wasGenerating: false
    };
  }

  function getOrCreatePaneState(pane) {
    let state = paneStates.get(pane.editor);
    if (!state) {
      state = createPaneState(pane.scopeKey);
      paneStates.set(pane.editor, state);
    }
    return state;
  }

  function clearLoadingTimers(state) {
    if (!state) return;
    if (state.loadingDelayTimer) {
      clearTimeout(state.loadingDelayTimer);
      state.loadingDelayTimer = null;
    }
    if (state.loadingRotateTimer) {
      clearInterval(state.loadingRotateTimer);
      state.loadingRotateTimer = null;
    }
    state.loadingVisible = false;
    state.loadingHintIndex = 0;
  }

  function clearInflightState(state) {
    if (!state) return;
    clearLoadingTimers(state);
    if (state.inflightTimer) {
      clearTimeout(state.inflightTimer);
      state.inflightTimer = null;
    }
    state.inflightReqId = '';
    state.inflightFingerprint = '';
  }

  function clearRetryState(state) {
    if (!state) return;
    if (state.retryTimer) {
      clearTimeout(state.retryTimer);
      state.retryTimer = null;
    }
    state.retryFingerprint = '';
    state.retryAfterMs = 0;
    state.retryCount = 0;
  }

  function scheduleRetryAfterBackoff(state, fp, delayMs = RETRY_BACKOFF_MS) {
    if (!state || !fp || disposed) return;
    const nextCount = state.retryFingerprint === fp ? state.retryCount + 1 : 1;
    if (state.retryTimer) {
      clearTimeout(state.retryTimer);
      state.retryTimer = null;
    }
    state.retryFingerprint = fp;
    state.retryCount = nextCount;
    state.retryAfterMs = Date.now() + delayMs;
    if (nextCount <= 1) {
      state.retryTimer = setTimeout(() => {
        state.retryTimer = null;
        if (state.retryFingerprint === fp) {
          state.retryAfterMs = 0;
        }
        if (!disposed) tick();
      }, delayMs);
    }
  }

  function clearPaneState(state, { clearInflight = true } = {}) {
    if (!state) return;
    state.currentSuggestion = '';
    state.currentFingerprint = '';
    clearRetryState(state);
    if (clearInflight) {
      clearInflightState(state);
    }
  }

  function prunePaneStates(panes) {
    const activeEditors = new Set();
    for (let i = 0; i < panes.length; i++) {
      activeEditors.add(panes[i].editor);
    }
    for (const editor of Array.from(paneStates.keys())) {
      if (!activeEditors.has(editor)) {
        const st = paneStates.get(editor);
        clearInflightState(st);
        clearRetryState(st);
        paneStates.delete(editor);
      }
    }
  }

  function hasVisibleOverlay() {
    for (const ov of createdOverlays) {
      if (ov && !ov.hidden) return true;
    }
    return false;
  }

  function paneHasRenderableSuggestion(state) {
    return Boolean(
      state &&
        state.currentSuggestion &&
        state.currentFingerprint &&
        !dismissedFingerprints.has(state.currentFingerprint)
    );
  }

  function paneNeedsFastReconcile(state) {
    return Boolean(state && (state.inflightReqId || paneHasRenderableSuggestion(state)));
  }

  function hasAnyRenderableSuggestion() {
    if (hasVisibleOverlay()) return true;
    for (const state of paneStates.values()) {
      if (paneHasRenderableSuggestion(state)) return true;
    }
    return false;
  }

  function needsFastReconcile() {
    if (hasVisibleOverlay()) return true;
    for (const state of paneStates.values()) {
      if (paneNeedsFastReconcile(state)) return true;
    }
    return false;
  }

  function isElementHidden(el) {
    if (!el) return false;
    try {
      if (el.closest && el.closest('[hidden]')) return true;
      if (typeof getComputedStyle === 'function') {
        const cs = getComputedStyle(el);
        if (cs && (cs.display === 'none' || cs.visibility === 'hidden')) return true;
      }
    } catch {}
    return false;
  }

  function isVisibleNode(el) {
    if (!el || isElementHidden(el)) return false;
    try {
      const rect = el.getBoundingClientRect();
      return rect.height > 0;
    } catch {
      return false;
    }
  }

  function getNodeText(el) {
    if (!el) return '';
    const raw = el.innerText !== undefined && el.innerText !== null ? el.innerText : el.textContent || '';
    return String(raw).trim();
  }

  function hashText(str) {
    let h = 2166136261;
    for (let i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return (h >>> 0).toString(36);
  }

  function hasVisibleHomeGreeting() {
    try {
      const homeEl = document.querySelector('[data-testid="home-greeting"], [data-testid="home-splash-content"]');
      return Boolean(homeEl && !isElementHidden(homeEl));
    } catch {
      return false;
    }
  }

  function extractNodeFiberCascadeId(node, boundaryEl) {
    try {
      if (!node) return '';
      const fk = Object.keys(node).find(
        (k) => k.startsWith('__reactFiber$') || k.startsWith('__reactInternalInstance$')
      );
      let cur = fk ? node[fk] : null;
      for (let i = 0; i < 40 && cur; i++, cur = cur.return) {
        if (
          boundaryEl &&
          cur.stateNode &&
          cur.stateNode.nodeType === 1 &&
          cur.stateNode !== boundaryEl &&
          (!boundaryEl.contains || !boundaryEl.contains(cur.stateNode))
        ) {
          break;
        }
        const props = cur.memoizedProps;
        if (!props) continue;
        const val = props.value;
        const asp =
          val &&
          ((val.cascadeContext && val.cascadeContext.state && val.cascadeContext.state.agentStateProvider) ||
            val.agentStateProvider);
        if (asp && typeof asp.getState === 'function') {
          const st = asp.getState();
          const cid = st && st.conversationId ? String(st.conversationId).trim() : '';
          if (isValidCascadeId(cid)) return cid;
        }
        const directCid = props.cascadeId || props.conversationId;
        if (typeof directCid === 'string' && isValidCascadeId(directCid)) {
          return directCid.trim();
        }
      }
    } catch {}
    return '';
  }

  function extractRouteCascadeId() {
    try {
      const pathStr = String((window.location && window.location.pathname) || '');
      const mRoute = pathStr.match(/\/c\/([^/?#]+)/i);
      if (mRoute && mRoute[1]) {
        const routeCid = mRoute[1].trim();
        if (isValidCascadeId(routeCid)) return routeCid;
      }
      const mainViews = Array.from(document.querySelectorAll(CONV_VIEW_SELECTOR)).filter(
        (el) => !isElementHidden(el)
      );
      if (mainViews.length === 1) {
        const viewCid = String(
          mainViews[0].getAttribute('data-cascade-id') ||
            mainViews[0].getAttribute('data-quotable-pane-cascade-id') ||
            ''
        ).trim();
        if (isValidCascadeId(viewCid)) return viewCid;
      }
      if (!hasVisibleHomeGreeting()) {
        const selRow = document.querySelector('[data-testid="conversation-row-sidebar"][data-selected="true"]');
        const selCid = selRow ? String(selRow.getAttribute('data-cascade-id') || '').trim() : '';
        if (isValidCascadeId(selCid)) return selCid;
      }
    } catch {}
    return '';
  }

  function extractMainPaneCascadeId(editor, convView, cidHolder, allowGlobalFallback) {
    try {
      if (convView) {
        const attrCid = String(
          convView.getAttribute('data-cascade-id') ||
            convView.getAttribute('data-quotable-pane-cascade-id') ||
            ''
        ).trim();
        if (isValidCascadeId(attrCid)) return attrCid;
      }
      if (cidHolder) {
        const holderCid = String(
          cidHolder.getAttribute('data-cascade-id') ||
            cidHolder.getAttribute('data-quotable-pane-cascade-id') ||
            ''
        ).trim();
        if (isValidCascadeId(holderCid)) return holderCid;
      }
      const nearCid =
        editor && editor.closest ? editor.closest('[data-cascade-id], [data-quotable-pane-cascade-id]') : null;
      if (
        nearCid &&
        (!nearCid.closest ||
          (!nearCid.closest(SIDE_CONTAINER_SELECTOR) &&
            !nearCid.closest(SUBAGENT_COMPOSER_SELECTOR) &&
            !nearCid.closest(SUBAGENT_CONV_SELECTOR) &&
            !nearCid.closest(SUBAGENT_CONTAINER_SELECTOR)))
      ) {
        const nearVal = String(
          nearCid.getAttribute('data-cascade-id') ||
            nearCid.getAttribute('data-quotable-pane-cascade-id') ||
            ''
        ).trim();
        if (isValidCascadeId(nearVal)) return nearVal;
      }
      const inputBox =
        editor && editor.closest ? editor.closest('[id="antigravity.agentSidePanelInputBox"]') : null;
      const fiberCid =
        extractNodeFiberCascadeId(editor, null) ||
        extractNodeFiberCascadeId(inputBox, null) ||
        extractNodeFiberCascadeId(convView, null);
      if (isValidCascadeId(fiberCid)) return fiberCid;
    } catch {}
    return allowGlobalFallback ? extractRouteCascadeId() : '';
  }

  function extractSidePaneCascadeId(sideContent, editor) {
    try {
      const convEl = sideContent ? sideContent.querySelector('[data-testid="side-question-tab-conversation"]') : null;
      if (sideContent) {
        const attrCid = convEl ? String(convEl.getAttribute('data-cascade-id') || '').trim() : '';
        if (isValidCascadeId(attrCid)) return attrCid;
        const selfCid = String(sideContent.getAttribute('data-cascade-id') || '').trim();
        if (isValidCascadeId(selfCid)) return selfCid;
      }
      const holder =
        editor && editor.closest ? editor.closest('[data-cascade-id], [data-quotable-pane-cascade-id]') : null;
      if (holder && (!sideContent || sideContent.contains(holder))) {
        const holderCid = String(
          holder.getAttribute('data-cascade-id') ||
            holder.getAttribute('data-quotable-pane-cascade-id') ||
            ''
        ).trim();
        if (isValidCascadeId(holderCid)) return holderCid;
      }
      if (!sideContent || !sideContent.querySelector('[data-testid="side-question-tab-empty"]')) {
        const fiberCid =
          extractNodeFiberCascadeId(convEl, sideContent) ||
          extractNodeFiberCascadeId(editor, sideContent) ||
          extractNodeFiberCascadeId(sideContent, sideContent);
        if (isValidCascadeId(fiberCid)) return fiberCid;
      }
    } catch {}
    return '';
  }

  function extractSubagentPaneCascadeId(subpane, editor) {
    try {
      const convEl = subpane ? subpane.querySelector(SUBAGENT_CONV_SELECTOR) : null;
      if (subpane) {
        const attrCid = convEl ? String(convEl.getAttribute('data-cascade-id') || '').trim() : '';
        if (isValidCascadeId(attrCid)) return attrCid;
        const selfCid = String(subpane.getAttribute('data-cascade-id') || '').trim();
        if (isValidCascadeId(selfCid)) return selfCid;
      }
      const holder =
        editor && editor.closest ? editor.closest('[data-cascade-id], [data-quotable-pane-cascade-id]') : null;
      if (holder && (!subpane || subpane.contains(holder))) {
        const holderCid = String(
          holder.getAttribute('data-cascade-id') ||
            holder.getAttribute('data-quotable-pane-cascade-id') ||
            ''
        ).trim();
        if (isValidCascadeId(holderCid)) return holderCid;
      }
      const fiberCid =
        extractNodeFiberCascadeId(convEl, subpane) ||
        extractNodeFiberCascadeId(editor, subpane) ||
        extractNodeFiberCascadeId(subpane, subpane);
      if (isValidCascadeId(fiberCid)) return fiberCid;
    } catch {}
    return '';
  }

  function buildPaneScopeKey(kind, cascadeId, fallbackIndex) {
    if (cascadeId) {
      return kind + '|cid:' + cascadeId;
    }
    const pathStr = String((window.location && window.location.pathname) || '');
    const searchStr = String((window.location && window.location.search) || '');
    const titleStr = String(document.title || '');
    return kind + '|idx:' + fallbackIndex + '|' + pathStr + '|' + searchStr + '|' + titleStr;
  }

  function discoverPanes() {
    const rawEditors = Array.from(document.querySelectorAll('[data-lexical-editor="true"]')).filter((ed) => {
      if (isElementHidden(ed)) return false;
      try {
        const rect = ed.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0;
      } catch {
        return false;
      }
    });

    const mainEntries = [];
    const sideEntries = [];
    const subagentEntries = [];

    for (let i = 0; i < rawEditors.length; i++) {
      const editor = rawEditors[i];
      const sideContent = editor.closest ? editor.closest(SIDE_CONTAINER_SELECTOR) : null;
      const sideComposer = editor.closest ? editor.closest(SIDE_COMPOSER_SELECTOR) : null;
      const subagentComposer =
        !sideContent && !sideComposer && editor.closest ? editor.closest(SUBAGENT_COMPOSER_SELECTOR) : null;
      if (sideContent || sideComposer) {
        const container = sideContent || (sideComposer ? sideComposer.parentElement : null);
        if (container && isElementHidden(container)) continue;
        sideEntries.push({ editor, sideContent, container });
      } else if (subagentComposer) {
        const subpane =
          (subagentComposer.closest ? subagentComposer.closest(SUBAGENT_CONTAINER_SELECTOR) : null) ||
          subagentComposer.parentElement ||
          null;
        if (subpane && isElementHidden(subpane)) continue;
        subagentEntries.push({ editor, subpane, container: subpane });
      } else {
        const convView = editor.closest ? editor.closest(CONV_VIEW_SELECTOR) : null;
        const cidHolder =
          !convView && editor.closest
            ? editor.closest('[data-cascade-id], [data-quotable-pane-cascade-id]')
            : null;
        const safeCidHolder =
          cidHolder &&
          (!cidHolder.closest ||
            (!cidHolder.closest(SIDE_CONTAINER_SELECTOR) &&
              !cidHolder.closest(SUBAGENT_COMPOSER_SELECTOR) &&
              !cidHolder.closest(SUBAGENT_CONV_SELECTOR) &&
              !cidHolder.closest(SUBAGENT_CONTAINER_SELECTOR)))
            ? cidHolder
            : null;
        const container = convView || safeCidHolder || null;
        if (container && isElementHidden(container)) continue;
        mainEntries.push({ editor, convView, cidHolder: safeCidHolder, container });
      }
    }

    const allowRouteFallback = mainEntries.length === 1;
    const panes = [];

    for (let i = 0; i < mainEntries.length; i++) {
      const entry = mainEntries[i];
      const container = entry.container || (mainEntries.length === 1 ? document : null);
      const cascadeId = extractMainPaneCascadeId(
        entry.editor,
        entry.convView,
        entry.cidHolder,
        allowRouteFallback
      );
      const scopeKey = buildPaneScopeKey('main', cascadeId, i);
      panes.push({
        kind: 'main',
        editor: entry.editor,
        container,
        cascadeId,
        scopeKey,
        conversationId: cascadeId || 'main:' + hashText(scopeKey),
        generating: undefined,
        turn: undefined
      });
    }

    for (let i = 0; i < sideEntries.length; i++) {
      const entry = sideEntries[i];
      const cascadeId = extractSidePaneCascadeId(entry.sideContent, entry.editor);
      const scopeKey = buildPaneScopeKey('side', cascadeId, i);
      panes.push({
        kind: 'side',
        editor: entry.editor,
        container: entry.container,
        cascadeId,
        scopeKey,
        conversationId: cascadeId || 'side:' + hashText(scopeKey),
        generating: undefined,
        turn: undefined
      });
    }

    for (let i = 0; i < subagentEntries.length; i++) {
      const entry = subagentEntries[i];
      const cascadeId = extractSubagentPaneCascadeId(entry.subpane, entry.editor);
      const scopeKey = buildPaneScopeKey('subagent', cascadeId, i);
      panes.push({
        kind: 'subagent',
        editor: entry.editor,
        container: entry.container,
        cascadeId,
        scopeKey,
        conversationId: cascadeId || 'subagent:' + hashText(scopeKey),
        generating: undefined,
        turn: undefined
      });
    }

    return panes;
  }

  function belongsToPane(el, pane) {
    if (!el || !pane || !pane.container) return false;
    if (pane.kind === 'side') {
      if (el.closest && el.closest(SUBAGENT_COMPOSER_SELECTOR + ', ' + SUBAGENT_CONV_SELECTOR)) {
        return false;
      }
      const closestSide = el.closest ? el.closest(SIDE_CONTAINER_SELECTOR) : null;
      if (closestSide && pane.container !== document && closestSide !== pane.container) {
        return false;
      }
      return true;
    }
    if (pane.kind === 'subagent') {
      if (el.closest && el.closest(SIDE_CONTAINER_SELECTOR + ', ' + SIDE_COMPOSER_SELECTOR)) {
        return false;
      }
      const closestSub = el.closest ? el.closest(SUBAGENT_CONTAINER_SELECTOR) : null;
      if (closestSub && pane.container !== document && closestSub !== pane.container) {
        return false;
      }
      if (pane.container !== document && pane.container.contains && !pane.container.contains(el)) {
        return false;
      }
      return true;
    }
    if (
      el.closest &&
      el.closest(
        SIDE_CONTAINER_SELECTOR +
          ', ' +
          SIDE_COMPOSER_SELECTOR +
          ', ' +
          SUBAGENT_COMPOSER_SELECTOR +
          ', ' +
          SUBAGENT_CONV_SELECTOR +
          ', ' +
          SUBAGENT_CONTAINER_SELECTOR
      )
    ) {
      return false;
    }
    if (pane.container !== document) {
      const containerTestId = pane.container.getAttribute ? pane.container.getAttribute('data-testid') : '';
      if (containerTestId === 'conversation-view' && el.closest) {
        const closestConv = el.closest(CONV_VIEW_SELECTOR);
        if (closestConv && closestConv !== pane.container) return false;
      }
    }
    return true;
  }

  function isPaneGenerating(pane) {
    if (!pane || !pane.container || !pane.container.querySelectorAll) return false;
    const buttons = pane.container.querySelectorAll(CANCEL_BTN_SELECTOR);
    for (let i = 0; i < buttons.length; i++) {
      const btn = buttons[i];
      if (belongsToPane(btn, pane) && !isElementHidden(btn)) return true;
    }
    return false;
  }

  function hasOpenPopupMenu() {
    const menus = document.querySelectorAll('[role="listbox"], [role="menu"], .agy-fastpick');
    for (const m of menus) {
      try {
        const rect = m.getBoundingClientRect();
        if (rect.width > 0 && rect.height > 0) return true;
      } catch {}
    }
    return false;
  }

  function isEditorEmpty(editor) {
    if (!editor) return false;
    const raw =
      editor.innerText !== undefined && editor.innerText !== null ? editor.innerText : editor.textContent || '';
    const text = String(raw)
      .replace(/[\u200B-\u200D\uFEFF\n\r]/g, '')
      .trim();
    return text.length === 0;
  }

  function extractLatestTurn(pane) {
    if (!pane || !pane.container || !pane.container.querySelectorAll) return null;

    const rawAssistantNodes = pane.container.querySelectorAll('[data-markdown-root]');
    let lastAssistantEl = null;
    let lastAssistant = '';
    for (let i = rawAssistantNodes.length - 1; i >= 0; i--) {
      const el = rawAssistantNodes[i];
      if (!belongsToPane(el, pane)) continue;
      if (el.closest && el.closest(USER_MSG_SELECTOR + ', [data-lexical-editor="true"]')) {
        continue;
      }
      if (!isVisibleNode(el)) continue;
      const text = getNodeText(el);
      if (text.length > 0) {
        lastAssistantEl = el;
        lastAssistant = text;
        break;
      }
    }
    if (!lastAssistantEl || !lastAssistant) return null;

    const rawUserNodes = pane.container.querySelectorAll(USER_MSG_SELECTOR);
    let lastUserEl = null;
    for (let i = rawUserNodes.length - 1; i >= 0; i--) {
      const el = rawUserNodes[i];
      if (!belongsToPane(el, pane)) continue;
      if (!isVisibleNode(el)) continue;
      lastUserEl = el;
      break;
    }

    const FOLLOWING_BIT = (typeof Node !== 'undefined' && Node.DOCUMENT_POSITION_FOLLOWING) || 4;
    if (
      lastUserEl &&
      typeof lastAssistantEl.compareDocumentPosition === 'function' &&
      (lastAssistantEl.compareDocumentPosition(lastUserEl) & FOLLOWING_BIT)
    ) {
      return null;
    }

    const lastUser = lastUserEl ? getNodeText(lastUserEl) : '';
    const fingerprint =
      hashText(pane.scopeKey) + '_' + hashText(lastUser.slice(-200) + '||' + lastAssistant.slice(-300));
    return {
      fingerprint,
      conversationId: pane.conversationId,
      scopeKey: pane.scopeKey,
      lastUser: lastUser.slice(-600),
      lastAssistant: lastAssistant.slice(-1400)
    };
  }

  function evaluatePane(pane) {
    pane.generating = isPaneGenerating(pane);
    pane.turn = pane.generating ? null : extractLatestTurn(pane);
    return pane;
  }

  function reconcilePaneState(pane, state) {
    const scopeChanged = Boolean(state.scopeKey && pane.scopeKey && state.scopeKey !== pane.scopeKey);
    state.scopeKey = pane.scopeKey;

    if (scopeChanged) {
      state.initializedScope = false;
      state.seenFingerprint = '';
      state.eligibleFingerprint = '';
      state.wasGenerating = false;
      clearPaneState(state, { clearInflight: true });
    }

    if (pane.generating) {
      state.initializedScope = true;
      state.wasGenerating = true;
      state.eligibleFingerprint = '';
      clearPaneState(state, { clearInflight: true });
      return;
    }

    const justFinishedGenerating = state.wasGenerating;
    state.wasGenerating = false;
    const turn = pane.turn;
    if (!turn) {
      state.initializedScope = true;
      state.seenFingerprint = '';
      state.eligibleFingerprint = '';
      clearPaneState(state, { clearInflight: true });
      return;
    }

    if (justFinishedGenerating) {
      state.initializedScope = true;
      state.seenFingerprint = turn.fingerprint;
      state.eligibleFingerprint = turn.fingerprint;
    } else if (!state.initializedScope) {
      // Historical idle conversation: wait for explicit editor click/focus before requesting
      state.initializedScope = true;
      state.seenFingerprint = turn.fingerprint;
    } else if (state.seenFingerprint !== turn.fingerprint) {
      // Brand-new assistant turn arrived while staying in the same conversation scope
      state.seenFingerprint = turn.fingerprint;
      state.eligibleFingerprint = turn.fingerprint;
    }

    if (state.currentFingerprint && state.currentFingerprint !== turn.fingerprint) {
      clearPaneState(state, { clearInflight: false });
    }
    if (state.inflightFingerprint && state.inflightFingerprint !== turn.fingerprint) {
      clearInflightState(state);
    }
    if (state.retryFingerprint && state.retryFingerprint !== turn.fingerprint) {
      clearRetryState(state);
    }
  }

  function requestSuggestion(pane, state, turn) {
    if (!pane || !state || !turn || !turn.fingerprint) return;
    if (
      turn.fingerprint === state.currentFingerprint ||
      dismissedFingerprints.has(turn.fingerprint) ||
      turn.fingerprint === state.inflightFingerprint ||
      (state.retryFingerprint === turn.fingerprint && state.retryAfterMs > Date.now())
    ) {
      return;
    }
    if (typeof window.__agpsRequestSuggestion !== 'function') return;

    clearInflightState(state);
    reqSeq += 1;
    const reqId = 'agps-' + Date.now() + '-' + reqSeq;
    state.inflightReqId = reqId;
    state.inflightFingerprint = turn.fingerprint;
    state.inflightTimer = setTimeout(() => {
      state.inflightTimer = null;
      if (state.inflightReqId !== reqId) return;
      clearInflightState(state);
      syncOverlays();
    }, INFLIGHT_TIMEOUT_MS);

    state.loadingDelayTimer = setTimeout(() => {
      state.loadingDelayTimer = null;
      if (disposed || state.inflightReqId !== reqId) return;
      state.loadingVisible = true;
      state.loadingHintIndex = 0;
      syncOverlays();
      state.loadingRotateTimer = setInterval(() => {
        if (disposed || state.inflightReqId !== reqId || !state.loadingVisible) {
          clearLoadingTimers(state);
          return;
        }
        state.loadingHintIndex = (state.loadingHintIndex + 1) % LOADING_HINTS.length;
        syncOverlays();
      }, LOADING_ROTATE_MS);
    }, LOADING_DELAY_MS);

    try {
      window.__agpsRequestSuggestion(
        JSON.stringify({
          reqId,
          fingerprint: turn.fingerprint,
          conversationId: turn.conversationId,
          lastUser: turn.lastUser,
          lastAssistant: turn.lastAssistant
        })
      );
    } catch {
      if (state.inflightReqId === reqId) {
        clearInflightState(state);
      }
    }
  }

  function insertTextIntoLexical(editor, text, onDone) {
    if (!editor || !text || isAccepting) return false;
    isAccepting = true;
    try {
      editor.focus();
    } catch {}

    try {
      const sel = window.getSelection();
      if (sel) {
        const range = document.createRange();
        const target = editor.querySelector('p') || editor;
        range.selectNodeContents(target);
        range.collapse(false);
        sel.removeAllRanges();
        sel.addRange(range);
      }
    } catch {}

    try {
      editor.dispatchEvent(
        new InputEvent('beforeinput', {
          inputType: 'insertText',
          data: text,
          bubbles: true,
          cancelable: true
        })
      );
    } catch {}

    const rafFn =
      typeof requestAnimationFrame === 'function' ? requestAnimationFrame : (cb) => setTimeout(cb, 0);
    let rafId = null;
    rafId = rafFn(() => {
      pendingRafs.delete(rafId);
      if (disposed) {
        isAccepting = false;
        return;
      }
      if (isEditorEmpty(editor)) {
        try {
          const dt = new DataTransfer();
          dt.setData('text/plain', text);
          editor.dispatchEvent(
            new ClipboardEvent('paste', {
              clipboardData: dt,
              bubbles: true,
              cancelable: true
            })
          );
        } catch {}
      }
      isAccepting = false;
      if (typeof onDone === 'function') onDone(!isEditorEmpty(editor));
    });
    pendingRafs.add(rafId);
    return true;
  }

  function syncOverlays(existingPanes) {
    if (disposed) return;
    const panes = Array.isArray(existingPanes) ? existingPanes : discoverPanes();
    prunePaneStates(panes);
    const activeOverlays = new Set();

    for (let i = 0; i < panes.length; i++) {
      const pane = panes[i];
      const editor = pane.editor;
      const host = editor.parentElement;
      if (!host) continue;

      const state = paneStates.get(editor);
      let overlay = host.querySelector('.' + OVERLAY_CLASS);
      let activeText = '';
      let isLoadingOverlay = false;

      if (state && !isComposing && isEditorEmpty(editor)) {
        if (
          state.currentSuggestion &&
          state.currentFingerprint &&
          !dismissedFingerprints.has(state.currentFingerprint)
        ) {
          if (pane.turn === undefined || pane.generating === undefined) {
            evaluatePane(pane);
          }
          const scopeMatches = !state.scopeKey || state.scopeKey === pane.scopeKey;
          const fpMatches = Boolean(pane.turn && pane.turn.fingerprint === state.currentFingerprint);
          if (!pane.generating && scopeMatches && fpMatches) {
            activeText = state.currentSuggestion;
          } else {
            reconcilePaneState(pane, state);
          }
        } else if (
          state.loadingVisible &&
          state.inflightReqId &&
          state.inflightFingerprint &&
          !dismissedFingerprints.has(state.inflightFingerprint)
        ) {
          if (pane.turn === undefined || pane.generating === undefined) {
            evaluatePane(pane);
          }
          const scopeMatches = !state.scopeKey || state.scopeKey === pane.scopeKey;
          const fpMatches = Boolean(pane.turn && pane.turn.fingerprint === state.inflightFingerprint);
          if (!pane.generating && scopeMatches && fpMatches) {
            activeText = LOADING_HINTS[state.loadingHintIndex % LOADING_HINTS.length];
            isLoadingOverlay = true;
          } else {
            reconcilePaneState(pane, state);
          }
        }
      }

      if (!activeText) {
        if (overlay) {
          overlay.hidden = true;
          overlay.removeAttribute(LOADING_ATTR);
        }
        host.removeAttribute(HAS_SUGGESTION_ATTR);
        continue;
      }

      if (!overlay) {
        try {
          if (typeof getComputedStyle === 'function' && getComputedStyle(host).position === 'static') {
            host.style.position = 'relative';
          }
        } catch {}
        overlay = document.createElement('div');
        overlay.className = OVERLAY_CLASS;
        overlay.setAttribute('translate', 'no');
        overlay.setAttribute('data-no-translate', 'true');

        const textEl = document.createElement('div');
        textEl.className = 'agps-ghost-text';

        const kbd = document.createElement('kbd');
        kbd.className = 'agps-ghost-kbd';
        kbd.textContent = 'Tab';
        kbd.title = '按 Tab 或 → 填入预测输入';
        kbd.addEventListener('mousedown', (ev) => {
          ev.preventDefault();
          ev.stopPropagation();
          const liveEditor = host.querySelector('[data-lexical-editor="true"]') || editor;
          acceptSuggestion(liveEditor);
        });

        overlay.appendChild(textEl);
        overlay.appendChild(kbd);
        host.appendChild(overlay);
        createdOverlays.add(overlay);
      }

      try {
        if (typeof getComputedStyle === 'function') {
          const cs = getComputedStyle(editor);
          if (cs) {
            overlay.style.paddingTop = cs.paddingTop;
            overlay.style.paddingLeft = cs.paddingLeft;
            overlay.style.paddingRight = cs.paddingRight;
            overlay.style.fontSize = cs.fontSize;
            overlay.style.lineHeight = cs.lineHeight;
          }
        }
      } catch {}

      const textEl = overlay.querySelector('.agps-ghost-text');
      if (textEl && textEl.textContent !== activeText) {
        textEl.textContent = activeText;
      }

      if (isLoadingOverlay) {
        overlay.setAttribute(LOADING_ATTR, 'true');
      } else {
        overlay.removeAttribute(LOADING_ATTR);
      }

      overlay.hidden = false;
      host.setAttribute(HAS_SUGGESTION_ATTR, 'true');
      activeOverlays.add(overlay);
    }

    for (const ov of Array.from(createdOverlays)) {
      if (!activeOverlays.has(ov)) {
        ov.hidden = true;
        if (ov.parentElement) ov.parentElement.removeAttribute(HAS_SUGGESTION_ATTR);
        if (!ov.isConnected) createdOverlays.delete(ov);
      }
    }
  }

  function acceptSuggestion(editor) {
    if (disposed || !editor || isAccepting || !isEditorEmpty(editor)) return false;
    const panes = discoverPanes();
    prunePaneStates(panes);
    const pane = panes.find((p) => p.editor === editor);
    if (!pane) return false;
    const state = paneStates.get(editor);
    if (!state || !state.currentSuggestion || !state.currentFingerprint) return false;
    if (dismissedFingerprints.has(state.currentFingerprint)) return false;

    evaluatePane(pane);
    if (
      pane.generating ||
      !pane.turn ||
      pane.turn.fingerprint !== state.currentFingerprint ||
      (state.scopeKey && state.scopeKey !== pane.scopeKey)
    ) {
      reconcilePaneState(pane, state);
      syncOverlays(panes);
      return false;
    }

    const text = state.currentSuggestion;
    markDismissed(state.currentFingerprint);
    state.currentSuggestion = '';
    syncOverlays(panes);
    return insertTextIntoLexical(editor, text, () => {
      syncOverlays();
    });
  }

  function reconcileAllPanesFast() {
    if (disposed) return;
    const panes = discoverPanes();
    prunePaneStates(panes);
    for (let i = 0; i < panes.length; i++) {
      const pane = panes[i];
      const state = paneStates.get(pane.editor);
      if (!paneNeedsFastReconcile(state)) continue;
      if (state.scopeKey && pane.scopeKey && state.scopeKey !== pane.scopeKey) {
        state.scopeKey = pane.scopeKey;
        clearPaneState(state, { clearInflight: true });
        continue;
      }
      evaluatePane(pane);
      reconcilePaneState(pane, state);
    }
    syncOverlays(panes);
  }

  function tick() {
    if (disposed) return;
    ensureStyleInjected();
    syncThemeAttr();
    const panes = discoverPanes();
    prunePaneStates(panes);

    for (let i = 0; i < panes.length; i++) {
      const pane = panes[i];
      const state = getOrCreatePaneState(pane);
      evaluatePane(pane);
      reconcilePaneState(pane, state);
      if (pane.generating || !pane.turn) continue;
      if (
        state.eligibleFingerprint === pane.turn.fingerprint &&
        pane.turn.fingerprint !== state.currentFingerprint &&
        !dismissedFingerprints.has(pane.turn.fingerprint)
      ) {
        requestSuggestion(pane, state, pane.turn);
      }
    }

    syncOverlays(panes);
  }

  function activatePaneOnEditorInteraction(editor) {
    if (disposed || !editor || !isEditorEmpty(editor)) return;
    const panes = discoverPanes();
    prunePaneStates(panes);
    const pane = panes.find((p) => p.editor === editor);
    if (!pane) return;
    const state = getOrCreatePaneState(pane);
    evaluatePane(pane);
    reconcilePaneState(pane, state);
    if (pane.generating || !pane.turn) {
      syncOverlays(panes);
      return;
    }
    state.eligibleFingerprint = pane.turn.fingerprint;
    if (
      pane.turn.fingerprint !== state.currentFingerprint &&
      !dismissedFingerprints.has(pane.turn.fingerprint)
    ) {
      requestSuggestion(pane, state, pane.turn);
    }
    syncOverlays(panes);
  }

  function scheduleTick(delayMs = 260) {
    if (disposed) return;
    if (scanTimer) clearTimeout(scanTimer);
    scanTimer = setTimeout(() => {
      scanTimer = null;
      tick();
    }, delayMs);
  }

  function onKeyDown(e) {
    if (disposed || e.isComposing || isComposing) return;

    const activeEl = document.activeElement;
    const editor =
      (activeEl && activeEl.closest && activeEl.closest('[data-lexical-editor="true"]')) || null;
    if (!editor || !isEditorEmpty(editor)) return;

    const panes = discoverPanes();
    prunePaneStates(panes);
    const pane = panes.find((p) => p.editor === editor);
    if (!pane) return;
    const state = paneStates.get(editor);
    if (!state) return;

    if (e.key === 'Escape') {
      const activeFp = state.currentFingerprint || state.inflightFingerprint;
      if (activeFp) {
        markDismissed(activeFp);
        state.currentSuggestion = '';
        clearInflightState(state);
        syncOverlays(panes);
      }
      return;
    }

    if (
      !state.currentSuggestion ||
      !state.currentFingerprint ||
      dismissedFingerprints.has(state.currentFingerprint)
    ) {
      return;
    }

    evaluatePane(pane);
    if (
      pane.generating ||
      !pane.turn ||
      pane.turn.fingerprint !== state.currentFingerprint ||
      (state.scopeKey && state.scopeKey !== pane.scopeKey)
    ) {
      reconcilePaneState(pane, state);
      syncOverlays(panes);
      return;
    }

    if (
      (e.key === 'Tab' || e.key === 'ArrowRight') &&
      !e.shiftKey &&
      !e.ctrlKey &&
      !e.metaKey &&
      !e.altKey
    ) {
      if (hasOpenPopupMenu()) return;
      e.preventDefault();
      e.stopPropagation();
      acceptSuggestion(editor);
      return;
    }
  }

  function onCompositionStart() {
    isComposing = true;
    syncOverlays();
  }

  function onCompositionEnd() {
    isComposing = false;
    scheduleTick(60);
  }

  function onInput() {
    if (disposed || (!hasAnyRenderableSuggestion() && !needsFastReconcile())) return;
    syncOverlays();
  }

  function onNavigationChange() {
    if (disposed) return;
    lastNavigationAtMs = Date.now();
    if (needsFastReconcile()) {
      reconcileAllPanesFast();
    }
    scheduleTick(80);
  }

  function onFocusIn(e) {
    if (disposed) return;
    if (needsFastReconcile()) {
      reconcileAllPanesFast();
    }
    const target = (e && e.target) || document.activeElement;
    const editor =
      (target && target.closest && target.closest('[data-lexical-editor="true"]')) || null;
    if (editor && Date.now() - lastNavigationAtMs >= NAV_FOCUS_GUARD_MS) {
      activatePaneOnEditorInteraction(editor);
      return;
    }
    scheduleTick(120);
  }

  function onPointerDown(e) {
    if (disposed || !e || !e.target) return;
    const editor =
      (e.target.closest && e.target.closest('[data-lexical-editor="true"]')) || null;
    if (editor) {
      activatePaneOnEditorInteraction(editor);
    }
  }

  function isOwnOverlayMutation(records) {
    if (!Array.isArray(records) || records.length === 0) return false;
    for (let i = 0; i < records.length; i++) {
      const r = records[i];
      if (!r) return false;
      const target = r.target;
      if (target && target.closest && target.closest('.' + OVERLAY_CLASS)) continue;
      if (r.type === 'attributes') return false;
      const nodes = [];
      if (r.addedNodes) {
        for (let j = 0; j < r.addedNodes.length; j++) nodes.push(r.addedNodes[j]);
      }
      if (r.removedNodes) {
        for (let j = 0; j < r.removedNodes.length; j++) nodes.push(r.removedNodes[j]);
      }
      if (nodes.length === 0) return false;
      const allOverlay = nodes.every(
        (n) => n && n.nodeType === 1 && n.classList && n.classList.contains(OVERLAY_CLASS)
      );
      if (!allOverlay) return false;
    }
    return true;
  }

  function isEditorOnlyMutation(records) {
    if (!Array.isArray(records) || records.length === 0) return false;
    for (let i = 0; i < records.length; i++) {
      const r = records[i];
      if (!r || r.type === 'attributes') return false;
      const target = r.target;
      const targetEl = target && target.nodeType === 1 ? target : target && target.parentElement;
      if (!targetEl || !targetEl.closest || !targetEl.closest('[data-lexical-editor="true"]')) {
        return false;
      }
    }
    return true;
  }

  window.__agps_on_suggestion = (reqId, payload) => {
    if (disposed || !reqId) return;
    const panes = discoverPanes();
    prunePaneStates(panes);

    let matchedPane = null;
    let matchedState = null;
    for (let i = 0; i < panes.length; i++) {
      const st = paneStates.get(panes[i].editor);
      if (st && st.inflightReqId === reqId) {
        matchedPane = panes[i];
        matchedState = st;
        break;
      }
    }
    if (!matchedPane || !matchedState) return;

    const expectedFp = matchedState.inflightFingerprint;
    clearInflightState(matchedState);

    evaluatePane(matchedPane);
    if (
      matchedPane.generating ||
      !matchedPane.turn ||
      !expectedFp ||
      matchedPane.turn.fingerprint !== expectedFp ||
      (matchedState.scopeKey && matchedState.scopeKey !== matchedPane.scopeKey)
    ) {
      reconcilePaneState(matchedPane, matchedState);
      syncOverlays(panes);
      return;
    }

    matchedState.scopeKey = matchedPane.scopeKey;
    if (!payload || !payload.ok || payload.completed === false) {
      matchedState.currentFingerprint = '';
      matchedState.currentSuggestion = '';
      scheduleRetryAfterBackoff(matchedState, expectedFp);
      syncOverlays(panes);
      return;
    }

    clearRetryState(matchedState);
    matchedState.currentFingerprint = expectedFp;
    matchedState.currentSuggestion = payload.suggestion ? String(payload.suggestion).trim() : '';
    syncOverlays(panes);
  };

  function hookHistoryOnce() {
    if (window.__agps_route_hooked || typeof history === 'undefined' || !history) return;
    window.__agps_route_hooked = true;
    const origPush = typeof history.pushState === 'function' ? history.pushState : null;
    const origReplace = typeof history.replaceState === 'function' ? history.replaceState : null;
    const notifyRoute = () => {
      try {
        if (typeof window.dispatchEvent === 'function') {
          const ev = typeof Event === 'function' ? new Event('agps-route-change') : { type: 'agps-route-change' };
          window.dispatchEvent(ev);
        }
      } catch {}
    };
    if (origPush) {
      history.pushState = function () {
        const res = origPush.apply(this, arguments);
        notifyRoute();
        return res;
      };
    }
    if (origReplace) {
      history.replaceState = function () {
        const res = origReplace.apply(this, arguments);
        notifyRoute();
        return res;
      };
    }
  }

  function mount() {
    if (disposed || !document.body) return;
    ensureStyleInjected();
    syncThemeAttr();
    hookHistoryOnce();

    if (typeof MutationObserver !== 'undefined') {
      domObserver = new MutationObserver((records) => {
        if (disposed || isOwnOverlayMutation(records)) return;
        if (!isEditorOnlyMutation(records) && needsFastReconcile()) {
          reconcileAllPanesFast();
        }
        scheduleTick(280);
      });
      domObserver.observe(document.body, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ['data-cascade-id', 'data-quotable-pane-cascade-id', 'hidden']
      });

      themeObserver = new MutationObserver(() => {
        syncThemeAttr();
      });
      themeObserver.observe(document.body, {
        attributes: true,
        attributeFilter: ['class', 'data-agy-theme']
      });
      if (document.documentElement) {
        themeObserver.observe(document.documentElement, {
          attributes: true,
          attributeFilter: ['class', 'data-theme', 'data-ag-theme-mode', 'style']
        });
      }
    }

    if (typeof window.matchMedia === 'function') {
      try {
        themeMediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
        themeMediaHandler = () => syncThemeAttr();
        if (typeof themeMediaQuery.addEventListener === 'function') {
          themeMediaQuery.addEventListener('change', themeMediaHandler);
        }
      } catch {}
    }

    document.addEventListener('keydown', onKeyDown, true);
    document.addEventListener('compositionstart', onCompositionStart, true);
    document.addEventListener('compositionend', onCompositionEnd, true);
    document.addEventListener('input', onInput, true);
    document.addEventListener('focusin', onFocusIn, true);
    document.addEventListener('mousedown', onPointerDown, true);
    if (typeof window.addEventListener === 'function') {
      window.addEventListener('agps-route-change', onNavigationChange);
      window.addEventListener('popstate', onNavigationChange);
      window.addEventListener('hashchange', onNavigationChange);
    }

    scheduleTick(400);
  }

  function dispose() {
    if (disposed) return;
    disposed = true;
    if (dclHandler) {
      try {
        window.removeEventListener('DOMContentLoaded', dclHandler);
      } catch {}
      dclHandler = null;
    }
    if (scanTimer) {
      clearTimeout(scanTimer);
      scanTimer = null;
    }
    for (const rafId of pendingRafs) {
      try {
        if (typeof cancelAnimationFrame === 'function') cancelAnimationFrame(rafId);
        else clearTimeout(rafId);
      } catch {}
    }
    pendingRafs.clear();
    isAccepting = false;
    if (domObserver) {
      try { domObserver.disconnect(); } catch {}
      domObserver = null;
    }
    if (themeObserver) {
      try { themeObserver.disconnect(); } catch {}
      themeObserver = null;
    }
    if (themeMediaQuery && themeMediaHandler && typeof themeMediaQuery.removeEventListener === 'function') {
      try { themeMediaQuery.removeEventListener('change', themeMediaHandler); } catch {}
      themeMediaQuery = null;
      themeMediaHandler = null;
    }
    document.removeEventListener('keydown', onKeyDown, true);
    document.removeEventListener('compositionstart', onCompositionStart, true);
    document.removeEventListener('compositionend', onCompositionEnd, true);
    document.removeEventListener('input', onInput, true);
    document.removeEventListener('focusin', onFocusIn, true);
    document.removeEventListener('mousedown', onPointerDown, true);
    if (typeof window.removeEventListener === 'function') {
      window.removeEventListener('agps-route-change', onNavigationChange);
      window.removeEventListener('popstate', onNavigationChange);
      window.removeEventListener('hashchange', onNavigationChange);
    }
    for (const st of paneStates.values()) {
      clearInflightState(st);
      clearRetryState(st);
    }
    paneStates.clear();
    dismissedFingerprints.clear();
    for (const ov of createdOverlays) {
      if (ov.parentElement) ov.parentElement.removeAttribute(HAS_SUGGESTION_ATTR);
      ov.remove();
    }
    createdOverlays.clear();
    removeAllOverlaysAndStyles();
  }

  window.__agps_runtime = {
    version: VERSION,
    enabled: true,
    healthy: true,
    dispose,
    getStatus: () => ({
      version: VERSION,
      enabled: true,
      healthy: !disposed,
      panes: paneStates.size,
      visibleOverlays: Array.from(createdOverlays).filter((ov) => ov && !ov.hidden).length
    })
  };

  if (!document.body) {
    dclHandler = () => {
      dclHandler = null;
      mount();
    };
    window.addEventListener('DOMContentLoaded', dclHandler, { once: true });
  } else {
    mount();
  }
})(__AGPS_BOOT_PAYLOAD__);
