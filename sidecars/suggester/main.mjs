import { readFileSync, realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createSettingsStore } from '../../lib/settings.mjs';
import { createPromptSuggestionEngine } from '../../lib/engine.mjs';
import { createCdpHost } from '../../lib/cdp-host.mjs';
import { createLauncherController } from '../../lib/launcher.mjs';
import { startSidecarWebUi } from '../../lib/web-ui.mjs';

const isDirectRun = (() => {
  if (!process.argv[1]) return false;
  const norm = (p) => {
    let resolved = p;
    try {
      resolved = realpathSync(p);
    } catch {}
    return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
  };
  return norm(fileURLToPath(import.meta.url)) === norm(process.argv[1]);
})();

export async function startSidecar() {
  const pkg = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8'));
  const version = pkg.version || '1.1.0';
  const settings = createSettingsStore();
  const launcher = createLauncherController();
  const engine = createPromptSuggestionEngine({
    getConfig: () => settings.get()
  });

  let everConnectedDebugPort = false;
  let missingPortPolls = 0;

  const cdpHost = createCdpHost({
    version,
    getSettings: () => settings.get(),
    engine,
    onLog: (msg) => console.log(msg),
    onDebugPortReady: () => {
      everConnectedDebugPort = true;
      missingPortPolls = 0;
      launcher.recordDebugPortReady();
    },
    onMissingDebugPort: () => {
      if (everConnectedDebugPort) return;
      missingPortPolls += 1;
      launcher.ensureShortcutsConfiguredOnce();
      const cur = settings.get();
      if (cur.enabled && cur.autoRelaunch && missingPortPolls >= 2) {
        launcher.attemptColdStartAutoRelaunch({ autoRelaunch: cur.autoRelaunch });
      }
    }
  });

  const unsubscribe = settings.subscribe(() => {
    void cdpHost.syncSettings();
  });

  cdpHost.start();

  const closeWebUi = await startSidecarWebUi({
    version,
    getStatus: () => ({
      settings: settings.get(),
      cdp: cdpHost.getStatus(),
      engine: engine.getStatus(),
      launcher: {
        platform: process.platform,
        powertoolsInstalled: launcher.isPowertoolsInstalled()
      }
    }),
    onListModels: ({ force }) => engine.listModels({ force }),
    onSetSettings: (patch) => settings.set(patch),
    onClearCache: () => {
      engine.clearCache();
    },
    onRelaunch: () => launcher.scheduleRelaunch({ reason: 'manual' })
  }).catch(() => async () => {});

  let shuttingDown = false;
  async function shutdown() {
    if (shuttingDown) return;
    shuttingDown = true;
    unsubscribe();
    await cdpHost.stop();
    engine.stop({ terminateAll: true });
    await closeWebUi();
  }

  return {
    version,
    settings,
    launcher,
    engine,
    cdpHost,
    shutdown
  };
}

if (isDirectRun) {
  const runtime = await startSidecar();
  for (const sig of ['SIGINT', 'SIGTERM']) {
    process.on(sig, async () => {
      await runtime.shutdown();
      process.exit(0);
    });
  }
}
