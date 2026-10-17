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
