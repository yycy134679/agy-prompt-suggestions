/**
 * lib/launcher.mjs — Standalone CDP Debug-Port Launcher & Safe Cold-Start Relaunch
 *
 * Enables prompt-suggestions to work out of the box without Agy Powertools:
 * - Windows / Linux: idempotently patches user shortcuts / .desktop entries with --remote-debugging-port=0
 * - macOS / Windows / Linux: supports one-click manual relaunch from Sidecar UI and
 *   optional cold-start auto-relaunch with uptime window, active-WAL protection,
 *   cooldown, circuit breaker, and automatic deferral when Agy Powertools is active.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { pluginDataDir } from './paths.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const RELAUNCH_HELPER_PATH = path.resolve(__dirname, '..', 'scripts', 'relaunch-helper.mjs');

export const LINUX_DESKTOP_MARKER = '# X-AGPS-Managed=1';
const NON_HOST_CMD_RE =
  /--type=|--crashpad|--utility-sub-type=|--import=|sidecar_sdk|--ms-enable-electron-run-as-node/i;

const SCRUB_ENV_KEYS = new Set([
  'ELECTRON_RUN_AS_NODE',
  'NODE_OPTIONS',
  'ANTIGRAVITY_LS_ADDRESS',
  'ANTIGRAVITY_CSRF_TOKEN',
  'ANTIGRAVITY_AGENTAPI_EXE',
  'ANTIGRAVITY_SIDECAR_WEB_PORT',
  'ANTIGRAVITY_SIDECAR_UI_TOKEN'
]);

export function scrubChildEnv(env = process.env) {
  const out = {};
  for (const [k, v] of Object.entries(env || {})) {
    if (v === undefined || SCRUB_ENV_KEYS.has(k) || k.startsWith('ANTIGRAVITY_SIDECAR_')) continue;
    out[k] = v;
  }
  return out;
}

export function parsePosixEtimeSeconds(raw) {
  const s = String(raw || '').trim();
  if (!s) return Infinity;
  let days = 0;
  let rest = s;
  const dashIdx = s.indexOf('-');
  if (dashIdx !== -1) {
    days = parseInt(s.slice(0, dashIdx), 10);
    if (!Number.isFinite(days)) return Infinity;
    rest = s.slice(dashIdx + 1);
  }
  const parts = rest.split(':').map((p) => parseInt(p, 10));
  if (parts.some((n) => !Number.isFinite(n))) return Infinity;
  if (parts.length === 3) return days * 86400 + parts[0] * 3600 + parts[1] * 60 + parts[2];
  if (parts.length === 2) return days * 86400 + parts[0] * 60 + parts[1];
  if (parts.length === 1) return days * 86400 + parts[0];
  return Infinity;
}

export function isRemoteSshEnvironment(env = process.env) {
  return Boolean(env.SSH_CONNECTION || env.SSH_CLIENT || env.SSH_TTY);
}

export function isPowertoolsInstalled({ home = os.homedir(), existsSyncImpl = fs.existsSync } = {}) {
  const manifest = path.join(home, '.gemini', 'config', 'plugins', 'agy-powertools', 'plugin.json');
  const sidecar = path.join(
    home,
    '.gemini',
    'config',
    'plugins',
    'agy-powertools',
    'sidecars',
    'inspector',
    'main.mjs'
  );
  try {
    return existsSyncImpl(manifest) && existsSyncImpl(sidecar);
  } catch {
    return false;
  }
}

export function hasRecentActiveConversationWal({
  home = os.homedir(),
  windowSec = 15,
  procElapsedSec = Infinity,
  nowMs = Date.now()
} = {}) {
  if (Number.isFinite(procElapsedSec) && procElapsedSec < 4) return false;
  const windowMs = windowSec * 1000;
  const procStartMs = Number.isFinite(procElapsedSec) ? nowMs - procElapsedSec * 1000 : 0;
  const dirs = [
    path.join(home, '.gemini', 'antigravity', 'conversations'),
    path.join(home, '.gemini', 'antigravity-insiders', 'conversations')
  ];
  for (const dir of dirs) {
    try {
      if (!fs.existsSync(dir)) continue;
      for (const name of fs.readdirSync(dir)) {
        if (!name.endsWith('.db-wal')) continue;
        const st = fs.statSync(path.join(dir, name), { throwIfNoEntry: false });
        if (!st || st.size <= 4096 || nowMs - st.mtimeMs >= windowMs) continue;
        if (procStartMs > 0 && st.mtimeMs <= procStartMs + 2500) continue;
        return true;
      }
    } catch {}
  }
  return false;
}

export function probeAntigravityHostProcesses({
  platform = process.platform,
  spawnSyncImpl = spawnSync
} = {}) {
  if (platform === 'darwin') {
    const res = spawnSyncImpl('ps', ['-axo', 'pid=,etime=,command='], {
      encoding: 'utf8',
      timeout: 2500
    });
    if (res.status !== 0 || !res.stdout) return [];
    const found = [];
    for (const line of String(res.stdout).split(/\r?\n/)) {
      const m = line.trim().match(/^(\d+)\s+(\S+)\s+(.+)$/);
      if (!m) continue;
      const pid = parseInt(m[1], 10);
      const etimeRaw = m[2];
      const cmd = m[3];
      if (!pid || NON_HOST_CMD_RE.test(cmd) || /Helper(?:\s|\.|\/)/i.test(cmd)) continue;
      const appMatch = cmd.match(
        /^(\S.*?\/Antigravity(?:\s-\sInsiders)?\.app)\/Contents\/MacOS\/(Antigravity(?:\s-\sInsiders)?)(?:\s|$)/
      );
      if (!appMatch) continue;
      found.push({
        pid,
        elapsedSec: parsePosixEtimeSeconds(etimeRaw),
        appPath: appMatch[1],
        exePath: `${appMatch[1]}/Contents/MacOS/${appMatch[2]}`,
        hasCdpFlag: /--remote-debugging-port(?:=|\s|$)/.test(cmd),
        hasUpdatedFlag: /--updated(?:\s|$)/.test(cmd)
      });
    }
    return found;
  }

  if (platform === 'linux') {
    const res = spawnSyncImpl('ps', ['-axo', 'pid=,etime=,command='], {
      encoding: 'utf8',
      timeout: 2500
    });
    if (res.status !== 0 || !res.stdout) return [];
    const found = [];
    for (const line of String(res.stdout).split(/\r?\n/)) {
      const m = line.trim().match(/^(\d+)\s+(\S+)\s+(.+)$/);
      if (!m) continue;
      const pid = parseInt(m[1], 10);
      const etimeRaw = m[2];
      const cmd = m[3];
      if (!pid || NON_HOST_CMD_RE.test(cmd) || /main\.mjs|install\.mjs|relaunch-helper\.mjs/i.test(cmd)) {
        continue;
      }
      const binMatch = cmd.match(/^(\/\S*\/antigravity(?:-insiders)?)(?:\s|$)/i);
      if (!binMatch) continue;
      found.push({
        pid,
        elapsedSec: parsePosixEtimeSeconds(etimeRaw),
        appPath: '',
        exePath: binMatch[1],
        hasCdpFlag: /--remote-debugging-port(?:=|\s|$)/.test(cmd),
        hasUpdatedFlag: /--updated(?:\s|$)/.test(cmd)
      });
    }
    return found;
  }

  if (platform === 'win32') {
    const psCmd = [
      '[Console]::OutputEncoding = [System.Text.Encoding]::UTF8',
      "$ErrorActionPreference = 'SilentlyContinue'",
      '$now = [DateTime]::UtcNow',
      `$procs = @(Get-CimInstance Win32_Process -Filter "Name = 'Antigravity.exe' OR Name = 'Antigravity - Insiders.exe'" | Where-Object { $_.CommandLine -notmatch '--type=|--crashpad|--utility-sub-type=|--import=|sidecar_sdk|--ms-enable-electron-run-as-node' } | ForEach-Object { $age = if ($_.CreationDate) { [Math]::Max(0, [int][Math]::Round(($now - ([DateTime]$_.CreationDate).ToUniversalTime()).TotalSeconds)) } else { 999999 }; @{ pid = [int]$_.ProcessId; exe = [string]$_.ExecutablePath; cmd = [string]$_.CommandLine; elapsedSec = $age } })`,
      '$procs | ConvertTo-Json -Compress -Depth 3'
    ].join('\n');
    const r = spawnSyncImpl(
      'powershell',
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', psCmd],
      { windowsHide: true, encoding: 'utf8', timeout: 5000 }
    );
    if (r.status !== 0 || !r.stdout || !r.stdout.trim()) return [];
    try {
      const parsed = JSON.parse(String(r.stdout).replace(/^\uFEFF/, '').trim());
      const rows = Array.isArray(parsed) ? parsed : parsed ? [parsed] : [];
      return rows
        .map((row) => ({
          pid: Number(row.pid) || 0,
          elapsedSec: Number.isFinite(Number(row.elapsedSec)) ? Number(row.elapsedSec) : Infinity,
          appPath: '',
          exePath: String(row.exe || ''),
          hasCdpFlag: /--remote-debugging-port(?:=|\s|$)/i.test(String(row.cmd || '')),
          hasUpdatedFlag: /--updated(?:\s|$)/i.test(String(row.cmd || ''))
        }))
        .filter((p) => p.pid > 0 && p.exePath);
    } catch {
      return [];
    }
  }

  return [];
}

export function findDefaultAntigravityTarget({
  platform = process.platform,
  home = os.homedir(),
  env = process.env,
  existsSyncImpl = fs.existsSync
} = {}) {
  if (platform === 'darwin') {
    const appPath = [
      '/Applications/Antigravity.app',
      path.join(home, 'Applications', 'Antigravity.app'),
      '/Applications/Antigravity - Insiders.app',
      path.join(home, 'Applications', 'Antigravity - Insiders.app')
    ].find((p) => existsSyncImpl(p));
    if (appPath) {
      const binName = path.basename(appPath, '.app');
      return { appPath, exePath: path.join(appPath, 'Contents', 'MacOS', binName) };
    }
    return null;
  }
  if (platform === 'win32') {
    const localAppData = env.LOCALAPPDATA || path.join(home, 'AppData', 'Local');
    const progFiles = env.ProgramFiles || 'C:\\Program Files';
    const exePath = [
      path.join(localAppData, 'Programs', 'Antigravity', 'Antigravity.exe'),
      path.join(progFiles, 'Antigravity', 'Antigravity.exe'),
      path.join(localAppData, 'Programs', 'Antigravity - Insiders', 'Antigravity - Insiders.exe')
    ].find((p) => existsSyncImpl(p));
    return exePath ? { appPath: '', exePath } : null;
  }
  if (platform === 'linux') {
    const exePath = [
      '/usr/bin/antigravity',
      '/usr/local/bin/antigravity',
      '/opt/Antigravity/antigravity',
      '/usr/share/antigravity/antigravity'
    ].find((p) => existsSyncImpl(p));
    return exePath ? { appPath: '', exePath } : null;
  }
  return null;
}

export function evaluateColdStartDecision({
  proc,
  hasActivePort = false,
  hasActiveWal = false,
  guard = {},
  nowMs = Date.now(),
  powertoolsPresent = false,
  autoRelaunch = true
} = {}) {
  if (!autoRelaunch) {
    return { action: 'skip', reason: 'auto-relaunch-disabled' };
  }
  if (powertoolsPresent) {
    return { action: 'skip', reason: 'delegated-to-powertools' };
  }
  if (!proc || proc.hasCdpFlag || hasActivePort) {
    return { action: 'skip', reason: 'already-ready' };
  }
  const maxWindowSec = proc.hasUpdatedFlag ? 35 : 20;
  if (!Number.isFinite(proc.elapsedSec) || proc.elapsedSec > maxWindowSec) {
    return { action: 'exempt', reason: 'uptime-exceeded', maxWindowSec };
  }
  if (hasActiveWal) {
    return { action: 'exempt', reason: 'active-wal-write' };
  }
  const consecutiveFailures = Number(guard.consecutiveFailures) || 0;
  if (consecutiveFailures >= 2) {
    return { action: 'exempt', reason: 'circuit-breaker-open', consecutiveFailures };
  }
  const handledPids = Array.isArray(guard.handledPids)
    ? guard.handledPids.map((n) => Number(n)).filter(Boolean)
    : [];
  if (handledPids.includes(proc.pid)) {
    return { action: 'exempt', reason: 'pid-already-handled' };
  }
  const lastAt = Number(guard.lastRelaunchAtMs) || 0;
  const lastAttachedAt = Number(guard.lastAttachedAtMs) || 0;
  const prevSucceeded = lastAt > 0 && lastAttachedAt >= lastAt;
  const cooldownMs = prevSucceeded ? 5000 : 120000;
  if (lastAt > 0 && nowMs - lastAt < cooldownMs) {
    return { action: 'exempt', reason: 'cooldown-active', cooldownMs, deltaMs: nowMs - lastAt };
  }
  return {
    action: 'relaunch',
    reason: proc.hasUpdatedFlag ? 'cold-start-post-update' : 'cold-start-unflagged'
  };
}

export function configureLaunchers({
  platform = process.platform,
  home = os.homedir(),
  env = process.env,
  sysDesktopDir = '/usr/share/applications',
  spawnSyncImpl = spawnSync
} = {}) {
  if (platform === 'darwin') {
    return { platform: 'darwin', mode: 'single-icon-cold-start', updated: [] };
  }

  if (platform === 'linux') {
    const userApps = path.join(home, '.local', 'share', 'applications');
    const updated = [];
    for (const name of ['antigravity.desktop', 'antigravity-insiders.desktop']) {
      try {
        const userPath = path.join(userApps, name);
        const sysPath = path.join(sysDesktopDir, name);
        const srcPath = fs.existsSync(userPath) ? userPath : sysPath;
        if (!fs.existsSync(srcPath)) continue;
        const raw = fs.readFileSync(srcPath, 'utf8');
        let changed = false;
        let next = raw.replace(/^(Exec=.*)$/gm, (line) => {
          if (/--remote-debugging-port/.test(line)) return line;
          changed = true;
          return `${line} --remote-debugging-port=0`;
        });
        if (!changed && fs.existsSync(userPath)) continue;
        if (!next.includes(LINUX_DESKTOP_MARKER)) {
          next = `${LINUX_DESKTOP_MARKER}\n${next}`;
        }
        fs.mkdirSync(userApps, { recursive: true });
        fs.writeFileSync(userPath, next, 'utf8');
        updated.push(userPath);
      } catch {}
    }
    return { platform: 'linux', mode: 'desktop-entry', updated };
  }

  if (platform === 'win32') {
    const psPatch = [
      '[Console]::OutputEncoding = [System.Text.Encoding]::UTF8',
      "$ErrorActionPreference = 'SilentlyContinue'",
      '$wsh = New-Object -ComObject WScript.Shell',
      "$rawDirs = if ($env:AGPS_WIN32_LNK_DIRS) { $env:AGPS_WIN32_LNK_DIRS -split ';' } else { @([Environment]::GetFolderPath('Desktop'), [Environment]::GetFolderPath('CommonDesktopDirectory'), (Join-Path $env:APPDATA 'Microsoft\\Windows\\Start Menu\\Programs'), (Join-Path $env:ProgramData 'Microsoft\\Windows\\Start Menu\\Programs'), (Join-Path $env:APPDATA 'Microsoft\\Internet Explorer\\Quick Launch\\User Pinned\\TaskBar')) }",
      '$dirs = @($rawDirs | Where-Object { $_ -and (Test-Path -LiteralPath $_) })',
      '$patched = @()',
      'foreach ($d in $dirs) {',
      "  Get-ChildItem -LiteralPath $d -Filter '*.lnk' -Recurse -ErrorAction SilentlyContinue | ForEach-Object {",
      '    try {',
      '      $sc = $wsh.CreateShortcut($_.FullName)',
      '      $leaf = [IO.Path]::GetFileName([string]$sc.TargetPath)',
      "      if ($leaf -ine 'Antigravity.exe' -and $leaf -ine 'Antigravity - Insiders.exe') { return }",
      '      $argsStr = [string]$sc.Arguments',
      "      if ($argsStr -match '--remote-debugging-port') { return }",
      `      $sc.Arguments = if ($argsStr.Trim()) { "$($argsStr.Trim()) --remote-debugging-port=0" } else { '--remote-debugging-port=0' }`,
      '      $sc.Save()',
      '      $patched += $_.FullName',
      '    } catch {}',
      '  }',
      '}',
      '@{ patched = $patched } | ConvertTo-Json -Compress -Depth 3'
    ].join('\n');
    const r = spawnSyncImpl(
      'powershell',
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', psPatch],
      { windowsHide: true, encoding: 'utf8', timeout: 8000, env }
    );
    try {
      const parsed = JSON.parse(String(r.stdout || '').replace(/^\uFEFF/, '').trim() || '{}');
      const updated = Array.isArray(parsed.patched)
        ? parsed.patched
        : parsed.patched
        ? [parsed.patched]
        : [];
      return { platform: 'win32', mode: 'in-place-lnk', updated };
    } catch {
      return { platform: 'win32', mode: 'in-place-lnk', updated: [] };
    }
  }

  return { platform, mode: 'unsupported', updated: [] };
}

export function removeLaunchers({
  platform = process.platform,
  home = os.homedir()
} = {}) {
  if (platform === 'linux') {
    const removed = [];
    const userApps = path.join(home, '.local', 'share', 'applications');
    for (const name of ['antigravity.desktop', 'antigravity-insiders.desktop']) {
      const p = path.join(userApps, name);
      if (!fs.existsSync(p)) continue;
      try {
        const raw = fs.readFileSync(p, 'utf8');
        if (raw.includes(LINUX_DESKTOP_MARKER)) {
          fs.unlinkSync(p);
          removed.push(p);
        }
      } catch {}
    }
    return removed;
  }
  return [];
}

function readJsonSafe(filePath) {
  try {
    if (!fs.existsSync(filePath)) return {};
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return {};
  }
}

function writeJsonAtomic(filePath, data) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const tmp = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2) + '\n', { encoding: 'utf8', mode: 0o600 });
  fs.renameSync(tmp, filePath);
}

export function createLauncherController({
  dataDir = pluginDataDir(),
  home = os.homedir(),
  platform = process.platform,
  env = process.env,
  helperPath = RELAUNCH_HELPER_PATH,
  probeHostsImpl = probeAntigravityHostProcesses,
  findDefaultTargetImpl = findDefaultAntigravityTarget,
  hasActiveWalImpl = hasRecentActiveConversationWal,
  powertoolsInstalledImpl = isPowertoolsInstalled,
  configureLaunchersImpl = configureLaunchers,
  spawnImpl = spawn
} = {}) {
  const guardFile = path.join(dataDir, 'relaunch-guard.json');
  const jobFile = path.join(dataDir, 'relaunch-job.json');
  let scheduledAtMs = 0;
  let shortcutsPatched = false;

  function recordDebugPortReady() {
    try {
      const prev = readJsonSafe(guardFile);
      writeJsonAtomic(guardFile, {
        ...prev,
        lastAttachedAtMs: Date.now(),
        consecutiveFailures: 0
      });
    } catch {}
  }

  function ensureShortcutsConfiguredOnce() {
    if (shortcutsPatched || isRemoteSshEnvironment(env)) return { updated: [] };
    shortcutsPatched = true;
    try {
      return configureLaunchersImpl({ platform, home, env });
    } catch {
      return { updated: [] };
    }
  }

  function scheduleRelaunch({ proc = null, reason = 'manual', nowMs = Date.now() } = {}) {
    if (isRemoteSshEnvironment(env)) {
      return { scheduled: false, reason: 'ssh-remote' };
    }
    if (scheduledAtMs > 0 && nowMs - scheduledAtMs < 10000) {
      return { scheduled: false, reason: 'already-scheduled' };
    }

    const hostProc = proc || probeHostsImpl({ platform })[0] || null;
    const fallbackTarget = hostProc ? null : findDefaultTargetImpl({ platform, home, env });
    const appPath = hostProc?.appPath || fallbackTarget?.appPath || '';
    const exePath = hostProc?.exePath || fallbackTarget?.exePath || '';
    const pid = hostProc?.pid || 0;

    if (!appPath && !exePath) {
      return { scheduled: false, reason: 'antigravity-not-found' };
    }
    if (!fs.existsSync(helperPath)) {
      return { scheduled: false, reason: 'helper-not-found' };
    }

    const prevGuard = readJsonSafe(guardFile);
    const prevHandled = Array.isArray(prevGuard.handledPids)
      ? prevGuard.handledPids.map((n) => Number(n)).filter(Boolean)
      : [];
    const prevLastAt = Number(prevGuard.lastRelaunchAtMs) || 0;
    const prevAttachedAt = Number(prevGuard.lastAttachedAtMs) || 0;
    const prevFailed = prevLastAt > 0 && prevAttachedAt < prevLastAt;
    const nextFailures =
      reason === 'manual' ? 0 : prevFailed ? (Number(prevGuard.consecutiveFailures) || 0) + 1 : 1;

    try {
      writeJsonAtomic(guardFile, {
        ...prevGuard,
        lastRelaunchAtMs: nowMs,
        lastReason: reason,
        consecutiveFailures: nextFailures,
        handledPids: pid > 0 ? Array.from(new Set([...prevHandled.slice(-15), pid])) : prevHandled
      });
      writeJsonAtomic(jobFile, {
        format: 1,
        requestedAt: nowMs,
        platform,
        pid,
        appPath,
        exePath
      });
    } catch (err) {
      return { scheduled: false, reason: 'write-failed', error: err?.message || String(err) };
    }

    try {
      const child = spawnImpl(process.execPath, [helperPath, jobFile], {
        detached: true,
        stdio: 'ignore',
        windowsHide: true,
        env: scrubChildEnv(env)
      });
      child.unref?.();
      scheduledAtMs = nowMs;
      return { scheduled: true, reason, pid, appPath, exePath };
    } catch (err) {
      return { scheduled: false, reason: 'spawn-failed', error: err?.message || String(err) };
    }
  }

  function attemptColdStartAutoRelaunch({ autoRelaunch = true, nowMs = Date.now() } = {}) {
    if (isRemoteSshEnvironment(env)) {
      return { action: 'skip', reason: 'ssh-remote' };
    }
    const powertoolsPresent = powertoolsInstalledImpl({ home });
    if (powertoolsPresent) {
      return { action: 'skip', reason: 'delegated-to-powertools' };
    }
    const hosts = probeHostsImpl({ platform });
    const proc = hosts.find((p) => !p.hasCdpFlag) || null;
    if (!proc) {
      return { action: 'skip', reason: 'no-unflagged-host' };
    }
    const guard = readJsonSafe(guardFile);
    const hasActiveWal = hasActiveWalImpl({
      home,
      windowSec: 15,
      procElapsedSec: proc.elapsedSec,
      nowMs
    });
    const decision = evaluateColdStartDecision({
      proc,
      hasActivePort: false,
      hasActiveWal,
      guard,
      nowMs,
      powertoolsPresent,
      autoRelaunch
    });
    if (decision.action !== 'relaunch') {
      return decision;
    }
    const res = scheduleRelaunch({ proc, reason: decision.reason, nowMs });
    return { action: res.scheduled ? 'relaunched' : 'failed', ...res };
  }

  return {
    guardFile,
    jobFile,
    recordDebugPortReady,
    ensureShortcutsConfiguredOnce,
    scheduleRelaunch,
    attemptColdStartAutoRelaunch,
    isPowertoolsInstalled: () => powertoolsInstalledImpl({ home })
  };
}
