---
name: agy-prompt-suggestions
description: 管理 Antigravity「输入框下一句预测（Agy Prompt Suggestions）」独立插件：查看运行与 CDP 挂载状态、切换预测模型与思考强度、暂停或恢复预测、排查 agy CLI 或 DevToolsActivePort 问题。当用户提到下一句预测、Ghost Text 补全、切换预测模型或排查该插件故障时使用。
---

# Agy Prompt Suggestions 插件管理

本插件通过 Antigravity 原生 Sidecar（`sidecars/suggester/main.mjs`）连接本地 CDP 调试端口（`DevToolsActivePort`），在主对话、分屏、旁路提问与子智能体输入框中渲染 Ghost Text 下一句预测，并复用本地常驻 `agy` 进程生成建议。

## 关键路径

- 插件目录：`~/.gemini/config/plugins/agy-prompt-suggestions/`
- 用户设置：`~/.gemini/antigravity/plugin_data/agy-prompt-suggestions/settings.json`
  ```json
  {
    "enabled": true,
    "model": "gemini-4-hydrogen-low",
    "autoRelaunch": true
  }
  ```
- 调试端口文件：
  - macOS：`~/Library/Application Support/Antigravity/DevToolsActivePort`
  - Linux：`${XDG_CONFIG_HOME:-~/.config}/Antigravity/DevToolsActivePort`
  - Windows：`%APPDATA%\Antigravity\DevToolsActivePort`

## 常用操作

### 1. 检查运行与前置环境状态

一次性检查 Node 版本、`agy` CLI、`DevToolsActivePort`、设置文件以及 Sidecar 进程：

```bash
node --version; which agy || ls -la "$HOME/.local/bin/agy"; cat "$HOME/Library/Application Support/Antigravity/DevToolsActivePort" 2>/dev/null || echo "NO_CDP_PORT"; cat "$HOME/.gemini/antigravity/plugin_data/agy-prompt-suggestions/settings.json" 2>/dev/null || echo "DEFAULT_SETTINGS"
```

### 2. 查看可选模型并切换预测模型

1. 运行 `agy models` 查看当前账号可用的模型 ID（例如 `gemini-4-hydrogen-low`、`gemini-4-neon-medium`）。
2. 更新 `~/.gemini/antigravity/plugin_data/agy-prompt-suggestions/settings.json` 中的 `"model"` 字段。Sidecar 会在 3 秒内自动检测文件变更并平滑重启后台 `agy` 进程（也可在右侧「下一句预测」Sidecar 面板直接点选）。

### 3. 暂停或恢复预测

将 `~/.gemini/antigravity/plugin_data/agy-prompt-suggestions/settings.json` 中的 `"enabled"` 设为 `false`（暂停并立刻停止后台 `agy` 进程与 DOM 覆盖层）或 `true`（恢复）。若要彻底停用或卸载整个插件，请在自定义页面操作 `[Agy Prompt Suggestions](customization://agy-prompt-suggestions)`。

### 4. 故障排查

- **未出现 Ghost Text**：确认 `DevToolsActivePort` 存在且端口可访问 `http://127.0.0.1:<port>/json/list`；若未开启调试端口，提示用户使用 `open -a Antigravity --args --remote-debugging-port=0`（macOS）重启客户端，或启用已托管调试端口的插件。
- **后台预测无响应**：确认 `agy models` 可正常返回且当前账号已登录。
- **运行自检测试**：在插件目录运行 `npm run check && npm test`。
