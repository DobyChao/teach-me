# Teach me, Agent

[English](README.md) | 简体中文

用户留在当前软件中操作，Agent 用短句和屏幕上的指引一步步教学。

Teach me, Agent 与具体 Agent 无关，通过本地 CLI 连接你已有的 Agent 和桌面教学面板。Agent 需要能执行本地命令、查看图片并可靠接收App消息。是否使用当前环境支持的hook或事件通道，由Agent自行判断，合适时接通并验证消息能回到当前对话；否则使用工程自带的`tma wait`兜底。

[让 Agent 安装](#让-agent-帮你安装) · [手动安装](#安装本机-agent-入口)

## 让 Agent 帮你安装

在 Agent 中打开本仓库，把下面这句话发给它：

```text
请读取本仓库的 INSTALL.md，按指引为当前 Agent 环境安装 Teach me, Agent 和 skill，并检查安装结果。
```

[Agent 安装指南](INSTALL.md)包含环境准备、技能目录识别、安装和验证，由 Agent 完成这些步骤。下面保留手动安装方式。

## 安装本机 Agent 入口

### 1. 安装 App 和 CLI

需要 Windows 和 Node.js 24。在仓库目录运行：

```powershell
npm ci
npm run build
npm link --offline
tma --version
```

这会注册 `tma`，并保留 `teach-me-agent` 兼容别名。CLI 链接到此 checkout，移动仓库后需重新注册。独立安装包尚未交付，仍属 T08。

### 2. 安装 skill

手动安装时，找到**你的 Agent 认可的技能父目录**并替换下面的路径占位符。安装 skill 只需这一条命令：

```powershell
tma skill install --skills-dir "<your-agent-skills-directory>"
```

成功后，这条命令本身就会返回安装位置和状态。

<details>
<summary>可选：查看安装位置和状态</summary>

下面两条只做检查，不执行安装：

```powershell
tma skill path --skills-dir "<your-agent-skills-directory>"
tma skill status --skills-dir "<your-agent-skills-directory>"
```

安装后的结构是：

```text
<your-agent-skills-directory>/
  teach-me/
    SKILL.md
```

状态命令应返回 `"status": "installed"`。这表示文件安装成功；技能发现与调用仍遵循你的 Agent 宿主自身的加载规则。

</details>

**手动安装：**把整个 [skills/teach-me](skills/teach-me) 文件夹复制到该技能父目录。如果 Agent 不支持加载 skill，可以让它直接读取 [SKILL.md](skills/teach-me/SKILL.md) 作为指引，再通过 `tma protocol` 查看命令协议；CLI 连接本身不依赖原生 skill 加载器。

通过 CLI 安装的版本，仓库更新后用**同一个目录**重新运行安装命令。安装器只更新自己安装且未经修改的文件，遇到外来技能或本地修改会停止，不静默覆盖。手动安装的版本请自行更新副本，并保留本地修改。

### 3. 让 Agent 连接

重新加载技能或开启新的 Agent 会话，按宿主的技能调用方式使用。例如：

> 使用 teach-me skill 连接本机 Teach me, Agent 应用，教我使用画图。

Agent 也可以直接通过 CLI 连接：

```powershell
tma start --client my-lesson --topic '学习使用画图'
```

每个 Agent 使用不同的 `--client` 或 `TEACH_ME_CLIENT`。教学期间，视觉指引需要新画面时由Agent主动capture，用`say`/`show`给出步骤，自主选择接收方式，没有已验证的原生通路时用wait兜底；用户自己操作软件。命令见`tma help`，完整[Agent协议](docs/AGENT-PROTOCOL.md)也可通过`tma protocol`查看。

### 可选：Codex 预设

当前内置的技能位置预设是 Codex。使用 Codex 时，可用下面命令代替第 2 步：

```powershell
tma skill install --agent codex
```

需要检查时，可选运行 `tma skill status --agent codex`。

目标目录是 `CODEX_HOME/skills/teach-me`，未设置时为 `~/.codex/skills/teach-me`；新 Codex 对话可使用 `$teach-me`。现有 `npm run setup` 快捷方式会构建 App、注册 CLI 并安装这个 Codex 预设。其他宿主使用上面的显式目录流程，其技能发现尚未在本工程验收。

## 使用应用

UI 不包含浏览器模拟后端，必须由 Electron 加载；`npm run dev` 只用于前端开发，不能代替真实桌面运行。

面板有小/中/大三档：默认120×48 DIP双入口胶囊，点击写字或输入快捷键打开360宽输入框，收到回复/审批或点击展开显示520宽完整对话。输入中收到回复只标记新消息；草稿、录音、审批和画板编辑期间不自动收小。横线可手动收成胶囊，输入与草稿保持同一份；拖动左侧把手/状态栏可移动，重启记住位置。完整规则见 [三档面板决议](docs/rebuild/PANEL-MODES.md)。

用户画板复用 [Excalidraw](https://github.com/excalidraw/excalidraw)（MIT，见 [第三方声明](THIRD-PARTY-NOTICES.md)）。在面板点击“画板”打开编辑工具，无需先连接 Agent。右上角“完成画板”恢复点击穿透；再次打开可继续编辑。首次连接 Agent 会保留已画内容，勾选“附画板”随消息发送透明图片。用户清除与 Agent 清除独立；画板内容仅在本次应用运行内存中保留。

未连接时点写字可查看并复制连接说明。上翻阅读旧步骤时，新回复只显示跳至最新的提示；回到底部后继续跟随。实际试用记录与下一步优化建议见 [T18](docs/rebuild/evidence/T18.md)。开发时可用 `node scripts/dogfood.mjs` 启动隔离体验实例，用 `--verify` 回归入口、阅读和长草稿布局；先运行构建，测试数据不进 Git。

设置入口打开独立窗口，可拖动、调整大小；保存/取消固定在底部，关闭后教学草稿继续保留。三档和内容高度重新测量均连续过渡，系统减少动态效果时直接切换；详情与验证范围见 [T20](docs/rebuild/evidence/T20.md)。

后续体验修正在[T21](docs/rebuild/evidence/T21.md)：过渡使用页面合成层，设置去除系统标题栏，新增浅色/深色/跟随系统；当前设置窗口预览，保存后所有窗口与画板工具栏应用。主题token与后续桌宠规划见[外观契约](docs/rebuild/APPEARANCE.md)。

## 项目规划

- [项目即记忆：新 Agent 从这里开始](MEMORY.md)
- [自动生成的当前上下文](docs/rebuild/CONTEXT.md)
- [计划入口](docs/rebuild/README.md)
- [产品规格](docs/rebuild/PRODUCT.md)
- [架构](docs/rebuild/ARCHITECTURE.md)
- [任务状态](docs/rebuild/tasks.json)
- [接续记录与限制](docs/rebuild/PROGRESS.md)
- [验收标准](docs/rebuild/ACCEPTANCE.md)
- [原始设计决议](docs/DESIGN-NOTES.md)

## 开发

本分支从空白开始重建。旧工作在 `codex/companion-rebuild` 的 `54623c6`。

Windows + Node.js 24。

开始工作先运行 `npm run context:check`；每轮将新决议、任务、验证证据与接续要点写回项目，再用 `npm run context` 刷新摘要。`npm run check` 与 CI 会拒绝过期上下文，详见 [项目记忆](MEMORY.md)。

```powershell
npm ci
npm run check
npm run app
```

## 状态与排查

若终端找不到 `tma`，用 `npm prefix -g` 核对全局命令目录是否在 PATH 中，并重新打开终端；没有注册时可在仓库内使用 `node bin/teach-me.mjs`。安装文件不会自动启动教学或修改 Agent 的其他配置。

当前实现与未验证能力详见接续记录。本分支尚未完成全部 v1 功能。

若 `npm run app` 自行结束，终端会输出 Electron 的退出码、Windows 状态码和运行时长。诊断保存在 `%APPDATA%/teach-me-agent-v2/runtime.log`（设置 `TEACH_ME_AGENT_HOME` 时位于该目录）；不包含对话正文或 token。重复启动会提示已有实例，避免将第二个进程正常退出误认为原窗口退出。远控里有任务栏图标但没有浮窗时，同时检查设置中的远控可见开关。
