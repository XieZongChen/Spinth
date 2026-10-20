# components/ — DOM UI 组件（规格见 docs/12-ui-layer.md）

全部已实现。样式不自包含——宿主 app 必须提供语义令牌/工具类映射/动效类/字体/
Tailwind 源扫描五项契约（docs/12 §5「react 包的宿主契约」）。

- `Board.tsx`：画板容器——#stage-container 挂载 + SDK 生命周期（useEffect +
  AbortController 的 StrictMode 双挂载防御）+ 主题态注入（theme prop →
  sdk.setTheme，docs/17 C2）+ `window.__spinth` 调试句柄（DEV）
- `Toolbar.tsx`：底部中央工具坞（同类工具 布局）——纯点击切工具 + 常驻二级菜单（工具激活即显示变体面板，形状四型首例，2026-10-11）
- `ToolFlyout.tsx`：工具坞常驻二级菜单面板（可见性 = 工具激活的纯派生状态；横向图标排 + 音色点亮选中 + Tooltip）
- `ActionBar.tsx`：选中浮动操作栏——schema v2 驱动多级化（PopoverControl 承载
  popover 项 + Tooltip 中文文案）；**纯算术定位**（选区屏幕矩形 + 固定偏移 +
  视口钳制 + 下方翻转，不引入 floating-ui——决策记录 docs/12 §5）；**禁止在
  浮层定位上再叠 TOPBAR_HEIGHT**（canvas 局部坐标已含，双计偏移实测揪出）
- `PopoverControl.tsx`：ActionBar 的 popover 项体（一级「当前值图标/色点/数字
  文本 + ▾」、二级面板、x 跟随触发钮视口钳制）
- `Tooltip.tsx`：通用悬停提示（400ms 延迟、focus 可达、disabled 抑制）
- `ContextMenu.tsx`：右键菜单（图标 + 快捷键 chip、边缘翻转）
- `ZoomControl.tsx`：缩放胶囊（右下角）
- `OfflineBar.tsx`：离线提示条
- `MindAddButtons.tsx`：脑图节点 +/- 按钮（纯算术定位）
- `ToolGhost.tsx`：工具幽灵（可创建工具的指针跟随示意；自监听 pointermove +
  ref 直写 transform——高频流纪律，docs/12 §5）
- `Icon.tsx`：图标统一封装（语义名注册表：lucide-react + svgIcon 内联自绘；
  项目内禁止直接 import 图标库）
- `DotGrid.tsx`：画布点阵（CSS radial-gradient；命令式重定位不进 React 渲染）
