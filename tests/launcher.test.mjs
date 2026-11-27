import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  LINUX_DESKTOP_MARKER,
  configureLaunchers,
  createLauncherController,
  evaluateColdStartDecision,
  parsePosixEtimeSeconds,
  removeLaunchers,
  scrubChildEnv
} from '../lib/launcher.mjs';
import { validateRelaunchJob } from '../scripts/relaunch-helper.mjs';

test('parsePosixEtimeSeconds and scrubChildEnv handle standard formats and strip sidecar env vars', () => {
  assert.equal(parsePosixEtimeSeconds('00:12'), 12);
  assert.equal(parsePosixEtimeSeconds('02:05'), 125);
  assert.equal(parsePosixEtimeSeconds('01:02:03'), 3723);
  assert.equal(parsePosixEtimeSeconds('2-00:00:10'), 172810);

  const scrubbed = scrubChildEnv({
    PATH: '/usr/bin',
    ELECTRON_RUN_AS_NODE: '1',
    NODE_OPTIONS: '--inspect',
    ANTIGRAVITY_SIDECAR_WEB_PORT: '12345',
    ANTIGRAVITY_CSRF_TOKEN: 'secret',
    HOME: '/tmp'
  });
  assert.equal(scrubbed.PATH, '/usr/bin');
  assert.equal(scrubbed.HOME, '/tmp');
  assert.equal('ELECTRON_RUN_AS_NODE' in scrubbed, false);
  assert.equal('NODE_OPTIONS' in scrubbed, false);
  assert.equal('ANTIGRAVITY_SIDECAR_WEB_PORT' in scrubbed, false);
  assert.equal('ANTIGRAVITY_CSRF_TOKEN' in scrubbed, false);
});

test('evaluateColdStartDecision enforces uptime window, active WAL, cooldown, circuit breaker, and Powertools deferral', () => {
  const coldProc = { pid: 1001, elapsedSec: 6, hasCdpFlag: false, hasUpdatedFlag: false };
  assert.equal(
    evaluateColdStartDecision({ proc: coldProc, nowMs: 100000 }).action,
    'relaunch'
  );
  assert.equal(
    evaluateColdStartDecision({ proc: coldProc, powertoolsPresent: true }).reason,
    'delegated-to-powertools'
  );
  assert.equal(
    evaluateColdStartDecision({ proc: coldProc, autoRelaunch: false }).reason,
    'auto-relaunch-disabled'
  );
  assert.equal(
    evaluateColdStartDecision({ proc: { ...coldProc, elapsedSec: 45 } }).reason,
    'uptime-exceeded'
  );
  assert.equal(
    evaluateColdStartDecision({ proc: coldProc, hasActiveWal: true }).reason,
    'active-wal-write'
  );
  assert.equal(
    evaluateColdStartDecision({ proc: coldProc, guard: { consecutiveFailures: 2 } }).reason,
    'circuit-breaker-open'
  );
  assert.equal(
    evaluateColdStartDecision({ proc: coldProc, guard: { handledPids: [1001] } }).reason,
    'pid-already-handled'
  );
  assert.equal(
    evaluateColdStartDecision({
      proc: coldProc,
      guard: { lastRelaunchAtMs: 90000, lastAttachedAtMs: 0 },
      nowMs: 100000
    }).reason,
    'cooldown-active'
  );
});

test('configureLaunchers and removeLaunchers manage Linux .desktop entries cleanly and idempotently', () => {
  const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'agps-linux-home-'));
  const tmpSys = fs.mkdtempSync(path.join(os.tmpdir(), 'agps-linux-sys-'));
  try {
    fs.writeFileSync(
      path.join(tmpSys, 'antigravity.desktop'),
      '[Desktop Entry]\nName=Antigravity\nExec=/usr/bin/antigravity %F\n',
      'utf8'
    );

    const r1 = configureLaunchers({ platform: 'linux', home: tmpHome, sysDesktopDir: tmpSys });
    assert.equal(r1.updated.length, 1);
    const written = fs.readFileSync(r1.updated[0], 'utf8');
    assert.ok(written.includes(LINUX_DESKTOP_MARKER));
    assert.ok(written.includes('Exec=/usr/bin/antigravity %F --remote-debugging-port=0'));

    // Second run is idempotent
    const r2 = configureLaunchers({ platform: 'linux', home: tmpHome, sysDesktopDir: tmpSys });
    assert.equal(r2.updated.length, 0);

    // Uninstall cleans up only managed entries
    const removed = removeLaunchers({ platform: 'linux', home: tmpHome });
    assert.equal(removed.length, 1);
    assert.equal(fs.existsSync(r1.updated[0]), false);
  } finally {
    fs.rmSync(tmpHome, { recursive: true, force: true });
    fs.rmSync(tmpSys, { recursive: true, force: true });
  }
});

test('createLauncherController schedules detached relaunch helper, tracks failures, and resets on debug port ready', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agps-launcher-'));
  const helperPath = path.join(tmpDir, 'relaunch-helper.mjs');
  fs.writeFileSync(helperPath, '// mock helper\n', 'utf8');

  const spawns = [];
  const ctrl = createLauncherController({
    dataDir: tmpDir,
    home: tmpDir,
    platform: 'darwin',
    env: {},
    helperPath,
    powertoolsInstalledImpl: () => false,
    hasActiveWalImpl: () => false,
    probeHostsImpl: () => [
      {
        pid: 4321,
        elapsedSec: 5,
        appPath: '/Applications/Antigravity.app',
        exePath: '/Applications/Antigravity.app/Contents/MacOS/Antigravity',
        hasCdpFlag: false,
        hasUpdatedFlag: false
      }
    ],
    spawnImpl: (bin, args, opts) => {
      spawns.push({ bin, args, opts });
      return { unref() {} };
    }
  });

  try {
    const res = ctrl.attemptColdStartAutoRelaunch({ autoRelaunch: true, nowMs: 500000 });
    assert.equal(res.action, 'relaunched');
    assert.equal(res.scheduled, true);
    assert.equal(spawns.length, 1);
    assert.equal(spawns[0].opts.detached, true);
    assert.ok(fs.existsSync(ctrl.jobFile));

    const job = JSON.parse(fs.readFileSync(ctrl.jobFile, 'utf8'));
    assert.equal(
      validateRelaunchJob(job, { nowMs: 500500, existsSyncImpl: () => true }).valid,
      true
    );
    assert.equal(
      validateRelaunchJob(job, { nowMs: 600000, existsSyncImpl: () => true }).reason,
      'expired-job'
    );
    assert.equal(
      validateRelaunchJob({ ...job, appPath: '/Applications/Evil.app', exePath: '/bin/sh' }, { nowMs: 500500, existsSyncImpl: () => true }).reason,
      'disallowed-target'
    );

    // After debug port connects, consecutiveFailures resets to 0
    ctrl.recordDebugPortReady();
    const guard = JSON.parse(fs.readFileSync(ctrl.guardFile, 'utf8'));
    assert.equal(guard.consecutiveFailures, 0);
    assert.ok(guard.lastAttachedAtMs > 0);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});
