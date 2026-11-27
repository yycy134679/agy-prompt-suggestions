import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { pluginDataDir } from '../lib/paths.mjs';
import { resolveInstallTarget } from './install.mjs';

export function uninstallPlugin({
  home = os.homedir(),
  targetDir = '',
  env = process.env,
  purge = false
} = {}) {
  const dstRoot = resolveInstallTarget({ home, targetDir });
  const dataDir = pluginDataDir({ home, env });

  const removedPlugin = fs.existsSync(dstRoot);
  if (removedPlugin) {
    fs.rmSync(dstRoot, { recursive: true, force: true });
  }

  let removedData = false;
  if (purge && fs.existsSync(dataDir)) {
    fs.rmSync(dataDir, { recursive: true, force: true });
    removedData = true;
  }

  return {
    installedDir: dstRoot,
    dataDir,
    removedPlugin,
    removedData
  };
}

function parseArgs(argv) {
  const out = { home: undefined, targetDir: '', purge: false, json: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--home' && argv[i + 1]) {
      out.home = argv[++i];
    } else if (arg === '--dir' && argv[i + 1]) {
      out.targetDir = argv[++i];
    } else if (arg === '--purge') {
      out.purge = true;
    } else if (arg === '--json') {
      out.json = true;
    }
  }
  return out;
}

const isMain = process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url;
if (isMain) {
  const opts = parseArgs(process.argv.slice(2));
  const result = uninstallPlugin(opts);
  if (opts.json) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    console.log(
      result.removedPlugin
        ? `已卸载 Prompt Suggestions：${result.installedDir}`
        : `未检测到已安装的插件目录：${result.installedDir}`
    );
    if (opts.purge) {
      console.log(
        result.removedData
          ? `已清除用户配置：${result.dataDir}`
          : `未找到用户配置目录：${result.dataDir}`
      );
    } else {
      console.log(`已保留用户配置：${result.dataDir}（如需一并清除请追加 --purge）`);
    }
  }
}
