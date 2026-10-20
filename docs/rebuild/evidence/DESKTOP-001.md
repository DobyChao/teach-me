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
