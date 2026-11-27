import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { devToolsPortFile, manualLaunchCommand, pluginDataDir } from '../lib/paths.mjs';
import { readDebugPort } from '../lib/cdp-host.mjs';
import { resolveAgyCliBinary } from '../lib/engine.mjs';
import { configureLaunchers } from '../lib/launcher.mjs';

export const PLUGIN_DIR_NAME = 'agy-prompt-suggestions';

export const BUNDLE_ENTRIES = Object.freeze([
  'plugin.json',
  'package.json',
  'LICENSE',
  'README.md',
  'assets',
  'lib',
  'sidecars',
  'skills',
  'scripts/relaunch-helper.mjs'
]);

export function resolveInstallTarget({ home = os.homedir(), targetDir = '' } = {}) {
  if (targetDir) return path.resolve(targetDir);
  return path.join(home, '.gemini', 'config', 'plugins', PLUGIN_DIR_NAME);
}

export function installPlugin({
  sourceDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'),
  home = os.homedir(),
  targetDir = '',
  env = process.env,
  platform = process.platform
} = {}) {
  const srcRoot = path.resolve(sourceDir);
  const dstRoot = resolveInstallTarget({ home, targetDir });

  if (srcRoot !== dstRoot) {
    fs.mkdirSync(path.dirname(dstRoot), { recursive: true });
    const stageDir = `${dstRoot}.staging.${process.pid}.${Date.now()}`;
    const backupDir = `${dstRoot}.backup.${process.pid}.${Date.now()}`;
    let movedOld = false;
    try {
      fs.mkdirSync(stageDir, { recursive: true });
      for (const entry of BUNDLE_ENTRIES) {
        const srcPath = path.join(srcRoot, entry);
        if (!fs.existsSync(srcPath)) continue;
        const dstPath = path.join(stageDir, entry);
        fs.mkdirSync(path.dirname(dstPath), { recursive: true });
        fs.cpSync(srcPath, dstPath, { recursive: true });
      }
      if (fs.existsSync(dstRoot)) {
        fs.renameSync(dstRoot, backupDir);
        movedOld = true;
      }
      fs.renameSync(stageDir, dstRoot);
      if (movedOld) {
        fs.rmSync(backupDir, { recursive: true, force: true });
      }
    } catch (err) {
      fs.rmSync(stageDir, { recursive: true, force: true });
      if (movedOld && !fs.existsSync(dstRoot) && fs.existsSync(backupDir)) {
        try {
          fs.renameSync(backupDir, dstRoot);
        } catch {}
      }
      throw err;
    }
  }

  const pkg = JSON.parse(fs.readFileSync(path.join(dstRoot, 'package.json'), 'utf8'));
  const launcher = configureLaunchers({ platform, home, env });
  const portFile = devToolsPortFile({ home, env, platform });
  const debugPort = readDebugPort(portFile);
  const agyBin = resolveAgyCliBinary({ platform, env, homedir: home });

  return {
    version: pkg.version || '1.1.1',
    installedDir: dstRoot,
    dataDir: pluginDataDir({ home, env }),
    debugPort,
    agyBin,
    launcher,
    manualCommand: manualLaunchCommand({ platform })
  };
}

function parseArgs(argv) {
  const out = { home: undefined, targetDir: '', json: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--home' && argv[i + 1]) {
      out.home = argv[++i];
    } else if (arg === '--dir' && argv[i + 1]) {
      out.targetDir = argv[++i];
    } else if (arg === '--json') {
      out.json = true;
    }
  }
  return out;
}

const isMain = process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url;
if (isMain) {
  const [major, minor] = process.versions.node.split('.').map(Number);
  if (major < 22 || (major === 22 && minor < 13)) {
    console.error('需要 Node.js 22.13 或更高版本。');
    process.exit(1);
  }
  const opts = parseArgs(process.argv.slice(2));
  const result = installPlugin(opts);
  if (opts.json) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    console.log(`已安装 Prompt Suggestions v${result.version}`);
    console.log(`插件目录：${result.installedDir}`);
    console.log(`配置目录：${result.dataDir}`);
    if (!result.agyBin) {
      console.log('提示：未检测到 agy CLI，请先安装并登录 agy 后再使用预测功能。');
    }
    if (!result.debugPort) {
      console.log('提示：当前未检测到 Antigravity 本地调试端口 (DevToolsActivePort)。');
      console.log(`如需启用，请使用以下命令启动 Antigravity：\n  ${result.manualCommand}`);
    } else {
      console.log(`已检测到本地调试端口：${result.debugPort}（插件将由 Antigravity 自动加载）`);
    }
  }
}
