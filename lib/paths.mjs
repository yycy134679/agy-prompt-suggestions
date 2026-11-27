import { homedir } from 'node:os';
import { join, posix, win32 } from 'node:path';

export function antigravityUserDataDir({
  platform = process.platform,
  env = process.env,
  home = homedir()
} = {}) {
  if (env.ANTIGRAVITY_USER_DATA_DIR) {
    return env.ANTIGRAVITY_USER_DATA_DIR;
  }
  const pathApi = platform === 'win32' ? win32 : posix;
  if (platform === 'win32') {
    return pathApi.join(env.APPDATA || pathApi.join(home, 'AppData', 'Roaming'), 'Antigravity');
  }
  if (platform === 'darwin') {
    return pathApi.join(home, 'Library', 'Application Support', 'Antigravity');
  }
  return pathApi.join(env.XDG_CONFIG_HOME || pathApi.join(home, '.config'), 'Antigravity');
}

export function devToolsPortFile({
  portFile = '',
  platform = process.platform,
  env = process.env,
  home = homedir()
} = {}) {
  if (portFile) return portFile;
  if (env.ANTIGRAVITY_CDP_PORT_FILE) return env.ANTIGRAVITY_CDP_PORT_FILE;
  if (env.AGY_BROWSER_ACTIVE_PORT_FILE) return env.AGY_BROWSER_ACTIVE_PORT_FILE;
  const pathApi = platform === 'win32' ? win32 : posix;
  return pathApi.join(antigravityUserDataDir({ platform, env, home }), 'DevToolsActivePort');
}

export function pluginDataDir({ home = homedir(), env = process.env } = {}) {
  if (env.AGPS_DATA_DIR) return env.AGPS_DATA_DIR;
  return join(home, '.gemini', 'antigravity', 'plugin_data', 'agy-prompt-suggestions');
}

export function manualLaunchCommand({ platform = process.platform } = {}) {
  if (platform === 'darwin') {
    return 'open -a Antigravity --args --remote-debugging-port=0';
  }
  if (platform === 'win32') {
    return 'Antigravity.exe --remote-debugging-port=0';
  }
  return 'antigravity --remote-debugging-port=0';
}
