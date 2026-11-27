import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { BUNDLE_ENTRIES, installPlugin, resolveInstallTarget } from '../scripts/install.mjs';
import { uninstallPlugin } from '../scripts/uninstall.mjs';

test('installPlugin deploys bundle cleanly, preserves user settings on reinstall, and uninstallPlugin respects --purge', () => {
  const fakeHome = fs.mkdtempSync(path.join(os.tmpdir(), 'agps-install-test-'));
  try {
    const res1 = installPlugin({ home: fakeHome, env: {} });
    const expectedDir = resolveInstallTarget({ home: fakeHome });
    assert.equal(res1.installedDir, expectedDir);
    assert.equal(res1.version, '1.1.1');

    for (const entry of BUNDLE_ENTRIES) {
      assert.ok(fs.existsSync(path.join(expectedDir, entry)), `expected installed entry: ${entry}`);
    }
    assert.equal(fs.existsSync(path.join(expectedDir, '.git')), false);
    assert.equal(fs.existsSync(path.join(expectedDir, 'tests')), false);

    // Create user settings file in plugin_data and reinstall -> must preserve settings
    fs.mkdirSync(res1.dataDir, { recursive: true });
    const settingsPath = path.join(res1.dataDir, 'settings.json');
    fs.writeFileSync(settingsPath, JSON.stringify({ enabled: true, model: 'gemini-4-neon-low' }), 'utf8');

    const res2 = installPlugin({ home: fakeHome, env: {} });
    assert.equal(res2.installedDir, expectedDir);
    assert.equal(JSON.parse(fs.readFileSync(settingsPath, 'utf8')).model, 'gemini-4-neon-low');

    // Uninstall without purge keeps plugin_data
    const u1 = uninstallPlugin({ home: fakeHome, env: {}, purge: false });
    assert.equal(u1.removedPlugin, true);
    assert.equal(u1.removedData, false);
    assert.equal(fs.existsSync(expectedDir), false);
    assert.equal(fs.existsSync(settingsPath), true);

    // Reinstall and uninstall with purge deletes both
    installPlugin({ home: fakeHome, env: {} });
    const u2 = uninstallPlugin({ home: fakeHome, env: {}, purge: true });
    assert.equal(u2.removedPlugin, true);
    assert.equal(u2.removedData, true);
    assert.equal(fs.existsSync(expectedDir), false);
    assert.equal(fs.existsSync(res1.dataDir), false);
  } finally {
    fs.rmSync(fakeHome, { recursive: true, force: true });
  }
});
