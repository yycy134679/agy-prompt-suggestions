<div align="center">
  <img src="assets/logo.svg" width="72" height="72" alt="Prompt Suggestions Logo" />
  <h1>Antigravity Prompt Suggestions</h1>
  <p><strong>Antigravity 2.0 独立「输入框下一句预测」原生插件（Ghost Text + Tab 补全）</strong></p>
  <p>v1.0.0 | MIT License | Antigravity 2.33+ | Node.js &gt;= 22.13 | macOS / Windows / Linux</p>
</div>

---

将 [antigravity-codex-theme](https://github.com/nkjDSLcvanv/antigravity-codex-theme) 中的「输入框下一句预测」功能独立抽离为纯功能 **Antigravity 原生插件**，不修改任何主题、字体、汉化或统计栏，可与 [Agy Powertools](https://github.com/WhiteBr1ck/agy-powertools) 等插件零冲突共存。

## 功能特性

- **Ghost Text 预测**：每轮回复结束后，在空输入框中以浅色提示文本呈现最可能的下一句追问或指令。
- **快捷补全**：按 `Tab`、`→` 或点击 `Tab` 徽章一键填入；输入任意字符或按 `Esc` 隐藏。
- **多窗格上下文隔离**：主对话、分屏多对话、旁路提问（Side Question）与子智能体窗格各自维护独立指纹，互不串台。
- **零外部 API Key**：通过常驻 `agy --input-format stream-json --output-format stream-json` 进程复用当前 Antigravity 账号能力，支持 Prompt Cache 加速且不污染侧边栏会话列表。
- **原生 Sidecar 生命周期**：启用插件自动运行，禁用或卸载插件自动移除注入样式/DOM 并优雅终止后台 `agy` 进程，无需额外 `LaunchAgent` / 计划任务。
- **独立侧边控制面板**：内置 Antigravity 辅助面板「下一句预测」，支持一键开关、通过 `agy models` 动态切换预测模型与思考强度（默认 `Gemini 4 Hydrogen (Low)`）、查看运行状态与清空缓存。
- **独立命名空间与深浅色自适应**：所有 DOM、样式类、全局变量与 CDP 绑定均使用 `agps` 前缀，不依赖任何第三方主题即可自动适配浅色与深色模式。

## 前置要求

1. **Node.js >= 22.13.0**（安装脚本会自动优先检测本机 `node`，缺失时回退至 Antigravity 内置的 `agy-node`）。
2. 本地已安装并登录 **`agy` CLI**（`~/.local/bin/agy` 或 `PATH` 可见）。
3. Antigravity 开启本地调试端口（`DevToolsActivePort`）：
   - 若你已安装并启用 `agy-powertools`，本地调试端口通常已自动开启，**直接安装本插件即可立即生效**。
   - 若未开启调试端口，可用以下命令启动 Antigravity：
     - **macOS**：`open -a Antigravity --args --remote-debugging-port=0`
     - **Linux**：`antigravity --remote-debugging-port=0`
     - **Windows**：`Antigravity.exe --remote-debugging-port=0`

## 安装与卸载

### 方式一：命令行安装

```sh
# macOS / Linux / WSL2
git clone https://github.com/yycy134679/prompt-suggestions.git
cd prompt-suggestions
sh ./install.sh
```

```powershell
# Windows (PowerShell)
git clone https://github.com/yycy134679/prompt-suggestions.git
cd prompt-suggestions
powershell -NoProfile -ExecutionPolicy Bypass -File .\install.ps1
```

安装脚本会将运行时文件原子替换部署至 `~/.gemini/config/plugins/prompt-suggestions/`，不会覆盖你的个人配置文件，也无需修改 Antigravity 安装包。

### 方式二：发给 Agent 一键安装

将以下提示词发给 Antigravity 或其他本地 Coding Agent：

> 请帮我安装 Antigravity 插件 https://github.com/yycy134679/prompt-suggestions ：克隆仓库后先阅读 README.md，运行 `sh ./install.sh`（Windows 运行 `powershell -NoProfile -ExecutionPolicy Bypass -File .\install.ps1`）将插件安装到 `~/.gemini/config/plugins/prompt-suggestions/`，并运行 `npm run check && npm test` 确认校验通过。

### 卸载

```sh
# macOS / Linux / WSL2（默认保留个人配置，追加 --purge 一并清除）
sh ./uninstall.sh

# Windows (PowerShell)
powershell -NoProfile -ExecutionPolicy Bypass -File .\uninstall.ps1
```

## 配置说明

推荐直接在 Antigravity 右侧辅助面板 **「下一句预测」** 中可视化操作，或直接编辑 `~/.gemini/antigravity/plugin_data/prompt-suggestions/settings.json`（Sidecar 会在 3 秒内自动热生效）：

```json
{
  "enabled": true,
  "model": "gemini-4-hydrogen-low"
}
```

| 字段 | 默认值 | 说明 |
| :--- | :--- | :--- |
| `enabled` | `true` | 是否开启预测；设为 `false` 后立即移除 Ghost Text 并停止后台 `agy` 进程 |
| `model` | `"gemini-4-hydrogen-low"` | 预测使用的模型 ID（可运行 `agy models` 查看全部可用 ID） |

## 项目结构

```text
prompt-suggestions/
├── plugin.json                    # Antigravity 插件清单
├── assets/logo.svg                # 插件图标
├── install.sh / uninstall.sh      # macOS / Linux / WSL2 安装与卸载入口
├── install.ps1 / uninstall.ps1    # Windows PowerShell 安装与卸载入口
├── scripts/
│   ├── install.mjs                # 原子部署安装器
│   └── uninstall.mjs              # 卸载器（支持 --purge）
├── sidecars/suggester/
│   ├── sidecar.json               # Antigravity 原生 Sidecar 与辅助面板声明
│   └── main.mjs                   # Sidecar 主入口与优雅退出清理
├── lib/
│   ├── engine.mjs                 # 常驻 agy stream-json 预测引擎
│   ├── runtime.js                 # 浏览器端 Ghost Text 与 Lexical 补全运行时
│   ├── cdp-host.mjs               # CDP 目标发现、绑定桥接与保活管理
│   ├── web-ui.mjs                 # 侧边辅助控制面板
│   ├── settings.mjs               # 配置持久化与变更订阅
│   └── paths.mjs                  # 跨平台 DevToolsActivePort 与数据目录解析
├── skills/prompt-suggestions/
│   └── SKILL.md                   # 供对话中排查与切换模型的内置技能
└── tests/
    ├── prompt-suggestions.test.mjs
    └── install.test.mjs
```

## 本地开发与测试

```sh
npm run check          # 全量语法校验
npm test               # 运行 node:test 单元测试
npm run install:local  # 将本地修改部署到 ~/.gemini/config/plugins/prompt-suggestions
```

## 致谢与协议

核心预测引擎与 Lexical 补全逻辑抽取并改编自 [nkjDSLcvanv/antigravity-codex-theme](https://github.com/nkjDSLcvanv/antigravity-codex-theme)（MIT 协议，原作者 [@isdou](https://github.com/isdou) PR #1）；跨平台 `agy-node` 启动器检测思路参考了 [WhiteBr1ck/agy-powertools](https://github.com/WhiteBr1ck/agy-powertools)（MIT 协议）。

本项目基于 [MIT License](LICENSE) 开源。
