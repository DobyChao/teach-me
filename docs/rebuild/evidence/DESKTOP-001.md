# 桌面集成检查

日期：2026-10-17。运行 `npm run build` 后，在获准的沙箱外执行 `node scripts/smoke.mjs`。

真实 Electron 主进程 + sandbox preload + React renderer 共通过 16 项检查：

- localhost start 握手；preload 没有通用 send 方法。
- say 渲染真实 DOM；收起/展开保持输入节点、草稿和选择区。
- prepare 聚焦唯一输入框；IPC submit→wait→ack 闭环；已确认消息不重发。
- Agent ready 显示继续 chip；真实 textarea 输入 + Enter 发送，成功后清空。
- 460 CSS 像素下工具栏不横向溢出。
- 捕获应用自身面板用于视觉检查，520 DIP / 150% 环境下冷灰、粉色、四层结构正常。
- HTML 内联脚本运行，无法访问 Node/preload/父窗口，网络被阻止，TTL 销毁窗口。

HTML 首轮测试失败，定位为外层 CSP 继承导致内层合法脚本也被禁止；修正后同一集成测试通过。

原始结果和面板图位于被忽略的 `.runtime/electron-smoke/`，只含合成教学消息，未加入 Git。测试设置关闭屏幕附件，没有实际采集桌面或麦克风。

## 尚未验证

鼠标非激活输入→截图→聚焦的完整时序；恢复到外部软件；真实 desktopCapturer 返回；画布对其他软件的穿透；真实系统/本地/远端语音；多屏与 DPI 矩阵；HTML CPU/内存硬限制；远程 CI。不得据此将 A04/A07/A09/A11/A12 标为全部通过。

## 2026-10-20 · 长审批主题横向溢出修复

本提交简短进展：在真实Electron中复现长连续URL主题越过审批卡片，520宽时topic scrollWidth为3378、clientWidth为468，详情区出现横向滚动条。只在审批主题段落添加任意位置换行、120 CSS px最大高度和内部滚动，保留完整主题可阅读，同时给审批按钮留空间。

`node scripts/layout-smoke.mjs`使用真实宿主/Renderer/HTTP，准备5条长历史、确认400余字草稿实际存在并保留选区，再申请加入。520与460 CSS px下主题/详情无横向溢出，草稿与输入实例/选区保留；DOM点击拒绝后草稿仍可发送，wait/ack和清稿通过。实际查看两张capturePage截图：520宽卡片、草稿和按钮可见；460通过Electron zoomFactor模拟，主题换行正常，但面板顶部被裁切。该相邻问题是截图审阅发现，原几何断言未覆盖header.top，不能把脚本完成当成整体视觉验收通过。夹具现在显式输出PENDING_T02，不以构建或DOM点击证明原生鼠标可达。460CSS宽也不等于460DIP原生窗口。

T02保持in_progress。下一步：以实际可用视口/屏幕缩放复现顶部裁切，核对宿主DIP尺寸与Renderer测高的单位，不直接加100vh约束造成自动测高收缩反馈；再补短工作区、工具满载和审批组合的完整视觉矩阵。独立审查未发现本次局部CSS修复的阻断回归，但确认上述测试边界。

npm run context、生成差异审阅和npm run check通过（84项测试、类型、构建、格式及边界）。截图/运行文件只留.runtime，之前的失败记录保留。

## 2026-10-20 · 短工作区顶部裁切与草稿占高

22:05用户授权继续至最晚23:30。T14已有45分钟未复现记录且本轮无新退出条件；先处理已有确定复现的T02，未扩展功能方向。

原因与修复：独立Electron夹具仅约束宿主读取的workArea，不修改Windows设置。原生460×480 DIP窗口、zoom=1时header.top=-79，实际Windows截图缺少标题；Renderer固定560 CSS高与宿主容量不一致。增加独立panelHeightLimit，使用定位相同的显示器；保留自然测高而不加100vh反馈。同时修正resize和动效Snapshot的CSS/DIP换算。进一步压到320×224时，长稿曾把details压到0，按容量限制textarea最大高度后，正文保留58px滚动空间，审批可滚到完整按钮，composer完整留在窗口内。见ADR-029。

本轮验证：

- `node scripts/layout-smoke.mjs`：520×560、460×480、460×320、320×224的真实原生窗口，另列520DIP/460CSS页面zoom及恢复520场景，六组通过。标题top非负、审批滚动后按钮完整、输入/发送不裁切、主题无横向溢出、同一输入实例/长稿/选区保留、wait/ack清稿通过；短容量内mini→compose→conversation均通过且恢复后重新长回。
- Windows原生观察：460×480标题和审批按钮恢复可见；320×224按截图位置用原生鼠标拒绝，再点击发送，真实队列收到完整长稿并ack，界面出现用户消息且清稿。夹具要求trusted审批/发送点击，最终CHECKS_COMPLETE且退出0。很短区域需滚动正文才能完整查看审批，截图不能代表所有内容同时可见。
- 首次人工节奏的审批在30秒后到期，UIA索引失效；后来一次点击未被记录为trusted，未计为原生通过。夹具改为准备就绪后再触发审批，并在捕获阶段记录点击，仍保留应用30秒审批期限；最终原生闭环重新通过。没有放宽应用超时或验收断言。
- `node scripts/panel-modes.mjs`七组通过，含输入保护、减少动态效果、同HWND、收尾及连续拖动回归。独立审查确认容量使用与定位相同显示器，并指出页面zoom的mini仍有DIP/CSS固定尺寸风险；本轮不将对话zoom通过当作全部缩放三档通过。

边界：本机单屏，短workArea为宿主测试输入、窗口和鼠标为实际Windows；不称作真实多屏或修改系统DPI验收。审批由scrollIntoView定位后做原生点击，尚未单独验证原生滚轮/触控滚动。320×224仅是本场景已验尺寸，不是所有状态的最低支持规格。更短容量、错误/语音/工具满载组合及page zoom mini仍pending。原始日志和合成截图只在.runtime。

本提交简短进展：修复已复现的短工作区标题裁切及长稿挤空审批区，完成六场景与原生拒绝/发送闭环；生成context、审阅差异并运行check后本地提交。T02保留in_progress，继续剩余矩阵。

## 2026-10-20 · 原生滚动条到达审批按钮

补齐上一轮scrollIntoView掩盖的验证缺口，没有修改产品代码或30秒审批期限。夹具新增可选`TMA_LAYOUT_SCROLL`模式：审批从details.scrollTop=0开始，不调用scrollIntoView；等待真实可见位置变化后再断言按钮完整，仍要求可信的审批/发送点击、原草稿/选区保留及wait/ack。

最终Windows单屏实测：`TMA_LAYOUT_CASE=tiny`、`TMA_LAYOUT_REVIEW=tiny`、`TMA_LAYOUT_SCROLL=scrollbar`运行`node scripts/layout-smoke.mjs`。320×224窗口内用Computer Use拖动实际滚动条，再原生点击拒绝和发送；按钮top=64.5、bottom=97.5，完整位于49–107的正文视口内；header.top=1，composer为111–213，长稿与2–6选区保持。真实HTTP wait收到完整长稿、ack并清稿，CHECKS_COMPLETE、退出0、endpoint删除。合成页面图保存在忽略目录`.runtime/layout/1792508869913/approval-tiny.png`，Windows截图也现场确认了按钮可见和发送后清稿。

失败与边界保留：纯wheel模式三次未完成闭环，第一次未绑定截图坐标时指针落在标题，后两次虽然推动正文但未在审批期限内到达并点击按钮（日志`.runtime/layout-native-wheel*.log`）。转用滚动条后，首次拖过头而到期；第二次按钮已完整显示，但最终点击未捕获trusted事件，仍失败；最后按已观察位置一次拖动后完整通过。不能将前几次失败算通过，也不能由滚动条通过宣称纯滚轮/触控已验收。后续若补wheel，先核对实际wheel delta、滚动位置与每步耗时，不再盲目重复。

独立只读审查未发现默认六场景回归或既有断言放宽；确认scrollbar分支本身只证明滚动结果，原生来源必须由本轮Sky拖动记录支持，不能单靠PASS日志推断。wheel分支额外要求可信wheel，但本轮未完成，保持pending。

本提交简短进展：增加真实滚动验证入口并补齐滚动条审批/发送证据；不扩大320×224为所有状态最低支持规格，T02完整矩阵与纯滚轮仍pending。最终工程检查结果见本轮接续记录。
