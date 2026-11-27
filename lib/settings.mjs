import fs from 'node:fs';
import path from 'node:path';
import { pluginDataDir } from './paths.mjs';

export const DEFAULT_MODEL = 'gemini-4-hydrogen-low';

export const DEFAULT_SETTINGS = Object.freeze({
  enabled: true,
  model: DEFAULT_MODEL,
  autoRelaunch: true
});

export function sanitizeModelId(raw) {
  const s = String(raw || '').trim();
  if (!s || s.startsWith('-') || !/^[a-zA-Z0-9._:/-]+$/.test(s)) {
    return DEFAULT_MODEL;
  }
  return s;
}

export function normalizeSettings(raw) {
  const src = raw && typeof raw === 'object' ? raw : {};
  return {
    enabled: src.enabled !== false,
    model: sanitizeModelId(src.model),
    autoRelaunch: src.autoRelaunch !== false
  };
}

export function createSettingsStore({ dataDir = pluginDataDir() } = {}) {
  const filePath = path.join(dataDir, 'settings.json');
  const listeners = new Set();
  let cached = null;
  let lastMtimeMs = -1;

  function readFromDisk() {
    try {
      const st = fs.statSync(filePath);
      if (cached && st.mtimeMs === lastMtimeMs) {
        return cached;
      }
      const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'));
      cached = normalizeSettings(parsed);
      lastMtimeMs = st.mtimeMs;
      return cached;
    } catch {
      if (!cached) {
        cached = { ...DEFAULT_SETTINGS };
      }
      return cached;
    }
  }

  function writeToDisk(next) {
    fs.mkdirSync(dataDir, { recursive: true });
    const tmpPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
    fs.writeFileSync(tmpPath, JSON.stringify(next, null, 2) + '\n', { encoding: 'utf8', mode: 0o600 });
    fs.renameSync(tmpPath, filePath);
    try {
      lastMtimeMs = fs.statSync(filePath).mtimeMs;
    } catch {
      lastMtimeMs = Date.now();
    }
  }

  function get() {
    return { ...readFromDisk() };
  }

  function set(patch = {}) {
    const prev = readFromDisk();
    const next = normalizeSettings({
      ...prev,
      ...(patch && typeof patch === 'object' ? patch : {})
    });
    const changed =
      prev.enabled !== next.enabled ||
      prev.model !== next.model ||
      prev.autoRelaunch !== next.autoRelaunch;
    cached = next;
    writeToDisk(next);
    if (changed) {
      for (const fn of listeners) {
        try {
          fn({ ...next }, { ...prev });
        } catch {}
      }
    }
    return { ...next };
  }

  function subscribe(fn) {
    if (typeof fn !== 'function') return () => {};
    listeners.add(fn);
    return () => listeners.delete(fn);
  }

  return {
    filePath,
    get,
    set,
    subscribe
  };
}
