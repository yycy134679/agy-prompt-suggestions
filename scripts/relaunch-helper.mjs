#!/usr/bin/env node
/**
 * scripts/relaunch-helper.mjs — Detached helper that gracefully restarts Antigravity
 * with --remote-debugging-port=0 after the parent Sidecar process exits.
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

const JOB_TTL_MS = 60_000;
const ALLOWED_TARGET_RE = /antigravity/i;

export function validateRelaunchJob(job, { nowMs = Date.now(), existsSyncImpl = fs.existsSync } = {}) {
  if (!job || typeof job !== 'object' || Array.isArray(job)) {
    return { valid: false, reason: 'invalid-job' };
  }
  if (job.format !== 1) {
    return { valid: false, reason: 'invalid-format' };
  }
  if (!Number.isFinite(job.requestedAt) || Math.abs(nowMs - job.requestedAt) > JOB_TTL_MS) {
    return { valid: false, reason: 'expired-job' };
  }
  const appPath = typeof job.appPath === 'string' ? job.appPath.trim() : '';
  const exePath = typeof job.exePath === 'string' ? job.exePath.trim() : '';
  if (!appPath && !exePath) {
    return { valid: false, reason: 'missing-target' };
  }
  const target = job.platform === 'darwin' && appPath ? appPath : exePath || appPath;
  if (/[\x00-\x1f\x7f]/.test(target) || !ALLOWED_TARGET_RE.test(path.basename(target))) {
    return { valid: false, reason: 'disallowed-target' };
  }
  if (!existsSyncImpl(target)) {
    return { valid: false, reason: 'target-not-found' };
  }
  return { valid: true, target, appPath, exePath, pid: Number(job.pid) || 0, platform: job.platform };
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isPidAlive(pid) {
  if (!pid || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return Boolean(err && err.code === 'EPERM');
  }
}

async function runRelaunchJob(jobPath) {
  let job;
  try {
    job = JSON.parse(fs.readFileSync(jobPath, 'utf8'));
  } catch {
    return;
  } finally {
    try {
      fs.unlinkSync(jobPath);
    } catch {}
  }

  const check = validateRelaunchJob(job);
  if (!check.valid) return;

  // Give the Sidecar HTTP server a brief moment to send its JSON reply before closing Antigravity
  await sleep(300);

  if (check.pid > 0 && isPidAlive(check.pid)) {
    if (check.platform === 'win32') {
      const stopPs = [
        `$gp = Get-Process -Id ${check.pid} -ErrorAction SilentlyContinue`,
        `if ($gp) { [void]$gp.CloseMainWindow(); if (-not $gp.WaitForExit(3500)) { Stop-Process -Id ${check.pid} -Force -ErrorAction SilentlyContinue } }`
      ].join('; ');
      spawnSync(
        'powershell',
        ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', stopPs],
        { windowsHide: true, stdio: 'ignore', timeout: 6000 }
      );
    } else {
      try {
        process.kill(check.pid, 'SIGTERM');
      } catch {}
      for (let i = 0; i < 60 && isPidAlive(check.pid); i++) {
        await sleep(100);
      }
    }
  }

  await sleep(400);

  if (check.platform === 'darwin' && check.appPath) {
    spawnSync('/usr/bin/open', ['-a', check.appPath, '--args', '--remote-debugging-port=0'], {
      stdio: 'ignore',
      timeout: 8000
    });
    return;
  }

  if (check.exePath) {
    const child = spawn(check.exePath, ['--remote-debugging-port=0'], {
      detached: true,
      stdio: 'ignore',
      windowsHide: false
    });
    child.unref();
  }
}

const isMain = process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url;
if (isMain) {
  const jobPath = process.argv[2];
  if (jobPath) {
    await runRelaunchJob(jobPath);
  }
}
