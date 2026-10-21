# 悬浮面板动效契约与参考

2026-10-19。用户要求定位收尾偶闪、移动放大，并参考公开最佳实践。ADR-018修正T21，历史结果保留；验证见[T22](evidence/T22.md)。

## 官方实践及采用方式

| 来源 | 采用的原则 | 本工程对应 |
| --- | --- | --- |
| [web.dev高性能动画](https://web.dev/articles/animations-guide) | 优先transform/opacity，避免每帧布局；用工具观察真实帧和重绘，谨慎使用will-change | 背景形变与正文分层；不逐帧resize原生窗口，不加全局will-change |
| [Motion布局动画](https://motion.dev/docs/react-layout-animations) | 以目标布局做FLIP；scale可能拉伸文字/圆角；窗口resize期间抑制无意义布局动画 | 正文保持目标宽度、不整体缩放；拖动只平移，测高与形变分开；终点背景矩阵为identity |
| [Electron窗口几何](https://www.electronjs.org/docs/latest/api/base-window) | setBounds同时调整尺寸位置；setPosition语义为平移，程序移动不产生will-move | 本机125%实际setPosition累积增高，用固定逻辑尺寸setBounds平移；不只依赖will-move识别程序拖动 |

纯网页布局库可以协调DOM，但原生透明窗口的包围范围、DPI取整和IPC先后仍由宿主管理。本轮沿用WAAPI，把这些边界明确分开；没有为修复时序额外引入动画框架。参考资料指导结构，工程故障必须靠本机复现验证，不能由文档推定已修复。

## 几何所有权

1. **目标布局**：正文用目标档位宽度布局，Renderer报告自然高度；报告携带panelLayoutVersion。
2. **视觉形变**：背景以固定目标宽高为基准，从旧视觉矩形FLIP到identity，右下锚定。原生包围范围收紧时，仍存活的结束帧不会再次按新视口缩放；完成后取消效果不改变终点视觉。
3. **原生范围**：宿主只分配包围范围与收尾，不逐帧更新窗口尺寸。500ms兜底、transition id、减少动态效果沿用ADR-017。
4. **拖动**：开始先置moving标记、提升布局版本，再结束未完成形变；记录固定逻辑宽高，所有move/end沿用它们，防原生取整回读累积。只移动位置，不把拖动做成布局弹簧动画。
5. **测高**：模式变更、拖动开始/结束均递增版本。宿主拒绝拖动中全部测高和过期版本/档位；松手后重新观察当前布局，合法的新内容变化才可改高度。不能把旧报告缓存为下次释放时的新目标。
6. **容量与单位**（ADR-029）：宿主以定位所用显示器的workArea计算独立高度上限，Snapshot的panelHeightLimit为CSS像素。原生几何/内部PanelMotion保留DIP，resize回报乘页面zoom，Snapshot中的transition几何除页面zoom后供Renderer使用。容量不是当前视口高度，不引入100vh反馈。

## 验收方法

除动画中段，还要覆盖结束帧、原生先收紧/Renderer延迟清理、减少动态效果、改目标/取消、连续拖动、拖动时与之后迟到的测高。测宽高和动画状态必须发生在动作后立即及连续帧中，不能只等全部settle后再看终点。

Windows实际鼠标观察与故障注入分开记录。高刷新率、跨屏DPI、远控逐帧仍须独立矩阵；一组约60Hz采样不保证所有设备丝滑。clipPath的实际合成/重绘成本由Chromium版本与环境决定，不能因使用WAAPI就宣称全部无需重绘。
