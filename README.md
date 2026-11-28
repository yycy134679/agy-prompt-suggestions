<div align="center">
  <img src="assets/logo.svg" width="72" height="72" alt="Prompt Suggestions Logo" />
  <h1>Agy Prompt Suggestions</h1>
  <p><strong>Antigravity 2.0 独立「输入框下一句预测」原生插件（Ghost Text + Tab 补全）</strong></p>
  <p>v1.2.0 | MIT License | Antigravity 2.33+ | Node.js &gt;= 22.13 | macOS / Windows / Linux</p>
</div>

---

将 [antigravity-codex-theme](https://github.com/nkjDSLcvanv/antigravity-codex-theme) 中的「输入框下一句预测」功能独立抽离为纯功能 **Antigravity 原生插件**，不修改任何主题、字体、汉化或统计栏，可与 [Agy Powertools](https://github.com/WhiteBr1ck/agy-powertools) 等插件零冲突共存。

## 功能特性

- **Ghost Text 预测与智能触发（省额度）**：当前对话新回复结束后自动在空输入框给出下一步建议；**翻看侧栏历史空闲对话时不主动发请求**，仅在你主动点击或聚焦空输入框时按需触发，避免翻历史白烧额度。
- **行内柔和等待提示**：预测耗时超过 `160ms` 时在输入框内呈现柔和呼吸提示（遵循系统「减弱动态效果」），结果到达即无缝切换为 Ghost Text + `Tab` 徽章；按 `Esc` 或直接打字立即取消。
- **快捷补全**：按 `Tab`、`→` 或点击 `Tab` 徽章一键填入；输入任意字符后删回空输入框可立刻从内存恢复本轮建议，按 `Esc` 彻底隐藏。
- **多窗格上下文隔离**：主对话、**分屏多对话、旁路提问（Side Question）与子智能体窗格**各自维护独立指纹，互不串台。
- **零外部 API Key**：通过常驻 `agy --input-format stream-json --output-format stream-json` 进程复用当前 Antigravity 账号能力，支持 Prompt Cache 加速且不污染侧边栏会话列表。
- **原生 Sidecar 生命周期与侧边控制面板**：启用插件自动运行，禁用或卸载自动移除注入样式/DOM 并优雅终止后台 `agy` 进程；右侧辅助面板「下一句预测」支持一键开关、通过 `agy models` 动态切换预测模型与思考强度（默认 `Gemini 4 Hydrogen (Low)`）、查看运行状态与清空缓存。
- **独立命名空间与深浅色自适应**：所有 DOM、样式类、全局变量与 CDP 绑定均使用 `agps` 前缀，不依赖任何第三方主题即可自动适配浅色与深色模式。
- **独立开启本地调试端口（不依赖其他插件）**：
  - **macOS**：直接双击原版 Antigravity 图标即可（无需第二个 `.app` 图标），冷启动无调试端口时自动带 `--remote-debugging-port=0` 重启一次，内置 20s 冷启动时间窗、活跃会话 WAL 保护、120s 冷却与连续 2 次失败熔断；右侧面板也提供「立即带调试端口重启」按钮与自动重启开关。
  - **Windows / Linux**：安装时自动为 Antigravity 快捷方式（`.lnk`）或桌面入口（`~/.local/share/applications/antigravity.desktop`）补充 `--remote-debugging-port=0`。
  - **与 Agy Powertools 和平共存**：检测到已安装 `agy-powertools` 时自动避让冷启动重启，避免双重重启冲突。

## 与 Agy Powertools 内置「输入框意图预测」的区别

[Agy Powertools](https://github.com/WhiteBr1ck/agy-powertools)（`v2.17.0+`）已内置实验性「输入框意图预测（Beta）」，两者解决的是同一类场景，但**底层路线与适用人群不同**：

| 对比项 | `agy-prompt-suggestions`（本插件） | Agy Powertools 内置「输入框意图预测」 |
| :--- | :--- | :--- |
| **模型与额度来源** | **零外部 API Key**，直接复用本机 `agy` CLI 的 Antigravity 账号模型与额度，装完即用 | 需自配外部自定义供应商（OpenAI / Anthropic / Gemini API Key 或本地端点），不消耗 Antigravity 额度 |
| **覆盖窗格** | 主对话 + **分屏多对话 + 旁路提问（Side Question）+ 子智能体窗格** | 主输入框 |
| **插件定位** | 单一职责纯功能插件，不改动主题、字体、汉化或统计栏，未装 Powertools 也可独立运行 | 集成在 Powertools 套件内，与免 TUN 代理、多语言设置统一管理 |

> **共存提醒**：如果你同时安装了两款插件，请**不要同时开启**两者的预测开关（Powertools 内置版默认关闭），二选一启用即可避免空输入框覆盖层与 `Tab` 快捷键冲突。

## 前置要求

1. **Node.js >= 22.13.0**（安装脚本会自动优先检测本机 `node`，缺失时回退至 Antigravity 内置的 `agy-node`）。
2. 本地已安装并登录 **`agy` CLI**（`~/.local/bin/agy` 或 `PATH` 可见）。
3. Antigravity `2.33.0+`：插件已内置调试端口启动支持；若当前窗口是在安装前无调试端口启动的，点击右侧「下一句预测」面板中的 **「立即带调试端口重启」** 或重启一次 Antigravity 即可生效。

## 安装与卸载

### 方式一：命令行安装

```sh
# macOS / Linux / WSL2
git clone https://github.com/yycy134679/agy-prompt-suggestions.git
cd agy-prompt-suggestions
sh ./install.sh
```

```powershell
# Windows (PowerShell)
git clone https://github.com/yycy134679/agy-prompt-suggestions.git
cd agy-prompt-suggestions
powershell -NoProfile -ExecutionPolicy Bypass -File .\install.ps1
```

安装脚本会将运行时文件原子替换部署至 `~/.gemini/config/plugins/agy-prompt-suggestions/`，不会覆盖你的个人配置文件，也无需修改 Antigravity 安装包。

### 方式二：发给 Agent 一键安装

将以下提示词发给 Antigravity 或其他本地 Coding Agent：

> 请帮我安装 Antigravity 插件 https://github.com/yycy134679/agy-prompt-suggestions ：克隆仓库后先阅读 README.md，运行 `sh ./install.sh`（Windows 运行 `powershell -NoProfile -ExecutionPolicy Bypass -File .\install.ps1`）将插件安装到 `~/.gemini/config/plugins/agy-prompt-suggestions/`，并运行 `npm run check && npm test` 确认校验通过。

### 卸载

```sh
# macOS / Linux / WSL2（默认保留个人配置，追加 --purge 一并清除）
sh ./uninstall.sh

# Windows (PowerShell)
powershell -NoProfile -ExecutionPolicy Bypass -File .\uninstall.ps1
```

## 配置说明

推荐直接在 Antigravity 右侧辅助面板 **「下一句预测」** 中可视化操作，或直接编辑 `~/.gemini/antigravity/plugin_data/agy-prompt-suggestions/settings.json`（Sidecar 会在 3 秒内自动热生效）：

```json
{
  "enabled": true,
  "model": "gemini-4-hydrogen-low",
  "autoRelaunch": true
}
```

| 字段 | 默认值 | 说明 |
| :--- | :--- | :--- |
| `enabled` | `true` | 是否开启预测；设为 `false` 后立即移除 Ghost Text 并停止后台 `agy` 进程 |
| `model` | `"gemini-4-hydrogen-low"` | 预测使用的模型 ID（可运行 `agy models` 查看全部可用 ID） |
| `autoRelaunch` | `true` | 冷启动无调试端口时是否自动带 `--remote-debugging-port=0` 重启一次（已装 `agy-powertools` 时自动避让） |

## 项目结构

```text
agy-prompt-suggestions/
├── plugin.json                    # Antigravity 插件清单
├── assets/logo.svg                # 插件图标
├── install.sh / uninstall.sh      # macOS / Linux / WSL2 安装与卸载入口
├── install.ps1 / uninstall.ps1    # Windows PowerShell 安装与卸载入口
├── scripts/
│   ├── install.mjs                # 原子部署安装器
│   ├── uninstall.mjs              # 卸载器（支持 --purge）
│   └── relaunch-helper.mjs        # 独立 detached 调试端口重启辅助进程
├── sidecars/suggester/
│   ├── sidecar.json               # Antigravity 原生 Sidecar 与辅助面板声明
│   └── main.mjs                   # Sidecar 主入口与优雅退出清理
├── lib/
│   ├── engine.mjs                 # 常驻 agy stream-json 预测引擎
│   ├── runtime.js                 # 浏览器端 Ghost Text 与 Lexical 补全运行时
│   ├── cdp-host.mjs               # CDP 目标发现、绑定桥接与保活管理
│   ├── launcher.mjs               # 跨平台调试端口启动与冷启动防循环控制
│   ├── web-ui.mjs                 # 侧边辅助控制面板
│   ├── settings.mjs               # 配置持久化与变更订阅
│   └── paths.mjs                  # 跨平台 DevToolsActivePort 与数据目录解析
├── skills/agy-prompt-suggestions/
│   └── SKILL.md                   # 供对话中排查与切换模型的内置技能
└── tests/
    ├── prompt-suggestions.test.mjs
    ├── launcher.test.mjs
    └── install.test.mjs
```

## 本地开发与测试

```sh
npm run check          # 全量语法校验
npm test               # 运行 node:test 单元测试
npm run install:local  # 将本地修改部署到 ~/.gemini/config/plugins/agy-prompt-suggestions
```

## 致谢与协议

- 核心预测引擎与 Lexical 补全逻辑抽取并改编自 [nkjDSLcvanv/antigravity-codex-theme](https://github.com/nkjDSLcvanv/antigravity-codex-theme)（MIT 协议，原作者 [@isdou](https://github.com/isdou) PR #1）。
- 跨平台 `agy-node` 启动器检测思路参考了 [WhiteBr1ck/agy-powertools](https://github.com/WhiteBr1ck/agy-powertools)（MIT 协议）。
- 社区交流与友情链接：[LINUX DO](https://linux.do/) - 新的理想型社区。

本项目基于 [MIT License](LICENSE) 开源。
