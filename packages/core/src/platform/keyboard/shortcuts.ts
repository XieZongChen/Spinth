import type { CursorMode } from '../../types';

/**
 * 声明式快捷键注册表（docs/09 §2）：定义与实现分离；setShortcuts 支持程序化
 * 全量重绑（无用户改键 UI——docs/09 §2 口径）。
 * keys 语法为 hotkeys-js 格式；description 面向未来的快捷键面板。
 */
export interface IShortcutDef {
  id: string;
  keys: string;
  description: string;
  /** 只读模式可用 */
  allowInReadonly?: boolean;
}

/** 快捷键实现依赖（由组合根注入；避免本模块依赖具体服务实现） */
export interface IShortcutHandlers {
  setCursorMode(mode: CursorMode): void;
  zoomIn(): void;
  zoomOut(): void;
  zoomTo100(): void;
  zoomToFit(): void;
  undo(): void;
  redo(): void;
  removeSelected(): void;
  clearSelection(): void;
  bringForward(): void;
  sendBackward(): void;
  bringToFront(): void;
  sendToBack(): void;
  /** 方向键微移；shift = 10px */
  nudge(dx: number, dy: number, shift: boolean): void;
  /** 橡皮大小调整（方括号；仅 eraser 模式生效，服务内自查） */
  eraserSize(delta: number): void;
  /** 脑图 Tab 建子节点；返回 false = 无脑图焦点未消费（键盘层放行原生 Tab，
   *  specs/a11y-closeout §5.9 键盘陷阱修复——body 焦点下 Tab 原先被吞死） */
  mindAddChild(): boolean;
  /** 脑图 Enter 建同级节点；返回 false 语义同上 */
  mindAddSibling(): boolean;
  /** 脑图方向键焦点导航；返回 true = 已被脑图消费（跳过 1px 微移） */
  mindNavigate(key: string): boolean;
  /** 编组（docs/18 §3.1）：≥2 全可组才建 */
  groupSelection(): void;
  /** 解组（docs/18 §3.2）：涉及组整组解 */
  ungroupSelection(): void;
}

export const DEFAULT_SHORTCUTS: IShortcutDef[] = [
  // 工具
  { id: 'tool.cursor', keys: 'v', description: '选择工具' },
  { id: 'tool.hand', keys: 'h', description: '抓手工具' },
  { id: 'tool.shape', keys: 'r', description: '矩形工具' },
  { id: 'tool.text', keys: 't', description: '文本工具' },
  { id: 'tool.line', keys: 'l', description: '连线工具' },
  { id: 'tool.pen', keys: 'p', description: '画笔工具' },
  { id: 'tool.eraser', keys: 'e', description: '橡皮工具' },
  { id: 'tool.eraser.widen', keys: ']', description: '橡皮增大' },
  { id: 'tool.eraser.narrow', keys: '[', description: '橡皮减小' },
  { id: 'tool.sticky', keys: 's', description: '便签工具' },
  { id: 'tool.mind', keys: 'm', description: '脑图工具' },
  // 视图
  { id: 'view.zoomIn', keys: 'cmd+=', description: '放大', allowInReadonly: true },
  {
    id: 'view.zoomIn2',
    keys: 'ctrl+=',
    description: '放大（Ctrl，Linux/Windows）',
    allowInReadonly: true,
  },
  { id: 'view.zoomOut', keys: 'cmd+-', description: '缩小', allowInReadonly: true },
  {
    id: 'view.zoomOut2',
    keys: 'ctrl+-',
    description: '缩小（Ctrl，Linux/Windows）',
    allowInReadonly: true,
  },
  { id: 'view.zoom100', keys: 'cmd+0', description: '缩放 100%', allowInReadonly: true },
  {
    id: 'view.zoom1002',
    keys: 'ctrl+0',
    description: '缩放 100%（Ctrl，Linux/Windows）',
    allowInReadonly: true,
  },
  { id: 'view.zoomFit', keys: 'f', description: '适应屏幕', allowInReadonly: true },
  // 历史（cmd 系双注册 ctrl——hotkeys-js 的 cmd = metaKey 专指，无 mod 平台
  // 自适应键名（3.13.15 映射表核实），单注册 cmd 在 Linux/Windows 真实用户
  // 按平台标准 Ctrl+Z 不触发；第十九轮审查发现，zoomIn2 双注册先例铺开）
  { id: 'edit.undo', keys: 'cmd+z', description: '撤销' },
  { id: 'edit.undo2', keys: 'ctrl+z', description: '撤销（Ctrl，Linux/Windows）' },
  { id: 'edit.redo', keys: 'cmd+shift+z', description: '重做' },
  { id: 'edit.redo2', keys: 'ctrl+shift+z', description: '重做（Ctrl，Linux/Windows）' },
  // 编辑
  { id: 'edit.delete', keys: 'delete,backspace', description: '删除选中' },
  { id: 'edit.escape', keys: 'esc', description: '退出/取消' },
  // 层级（同上双注册；macOS Chrome 会拦截 cmd+]/[ 为历史导航——E2E 走 SDK 命令）
  { id: 'layer.forward', keys: 'cmd+]', description: '上移一层' },
  { id: 'layer.forward2', keys: 'ctrl+]', description: '上移一层（Ctrl，Linux/Windows）' },
  { id: 'layer.backward', keys: 'cmd+[', description: '下移一层' },
  { id: 'layer.backward2', keys: 'ctrl+[', description: '下移一层（Ctrl，Linux/Windows）' },
  { id: 'layer.front', keys: 'cmd+alt+]', description: '置顶' },
  { id: 'layer.front2', keys: 'ctrl+alt+]', description: '置顶（Ctrl，Linux/Windows）' },
  { id: 'layer.back', keys: 'cmd+alt+[', description: '置底' },
  { id: 'layer.back2', keys: 'ctrl+alt+[', description: '置底（Ctrl，Linux/Windows）' },
  // 编组（docs/18 §3，双注册同上；浏览器 cmd+g = 查找下一个——bind 内
  // preventDefault 拦截默认行为，参考同款）
  { id: 'edit.group', keys: 'cmd+g', description: '编组' },
  { id: 'edit.group2', keys: 'ctrl+g', description: '编组（Ctrl，Linux/Windows）' },
  { id: 'edit.ungroup', keys: 'cmd+shift+g', description: '解组' },
  { id: 'edit.ungroup2', keys: 'ctrl+shift+g', description: '解组（Ctrl，Linux/Windows）' },
  // 脑图节点（docs/11 §8，选中 MIND_MAP 时生效）
  { id: 'mind.addChild', keys: 'tab', description: '建子节点' },
  { id: 'mind.addSibling', keys: 'enter', description: '建同级节点' },
  // 微移（八向组合由 hotkeys-js 逗号分隔逐个绑定）
  // 脑图焦点存在时方向键先走 mind.navigate（键盘层在 handler 内分流，docs/11 §7）
  { id: 'move.up', keys: 'up', description: '上移 1px' },
  { id: 'move.down', keys: 'down', description: '下移 1px' },
  { id: 'move.left', keys: 'left', description: '左移 1px' },
  { id: 'move.right', keys: 'right', description: '右移 1px' },
];

/** 断网/只读白名单之外的行为由 handler 内部守卫；这里只做输入态过滤 */
export function isEditableTarget(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el) return false;
  return (
    el.isContentEditable === true ||
    el.tagName === 'INPUT' ||
    el.tagName === 'TEXTAREA' ||
    el.tagName === 'SELECT'
  );
}

/** 键盘可达性守卫（2026-10-17 外部审查 4.1）：目标是可交互 UI 控件（按钮/
 *  链接/浮层面板等）时，Enter/Space/Tab/方向键是原生行为（激活按钮/焦点
 *  遍历）——快捷键层不得 preventDefault 吞掉，否则键盘用户无法选工具、
 *  无法操作浮动栏。无原生语义的键（字母/组合键）不受影响照常分发 */
export function isInteractiveUiTarget(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el || typeof el.closest !== 'function') return false;
  return !!el.closest('button, a, input, textarea, select, [contenteditable], [data-spinth-ui]');
}

/** 上述 UI 目标上必须放行的原生语义键（小写比较） */
export const NATIVE_UI_KEYS = new Set([
  'enter',
  ' ',
  'space',
  'tab',
  'arrowup',
  'arrowdown',
  'arrowleft',
  'arrowright',
]);

/** hotkeys.filter 的纯函数输入（specs/a11y-closeout §5.5）——抽出来可单测 */
export interface IShortcutGateInput {
  /** capture 相输入态快照（见 KeyboardService.editableAtCapture 注释） */
  editableAtCapture: boolean;
  /** UI 模态浮层（右键菜单 / 宿主面板）开着：全静默（D3——菜单内容基于打开
   *  瞬间的选中集，撤销/删除会让它指向已失效对象；菜单内操作走菜单项） */
  uiModalOpen: boolean;
  target: EventTarget | null;
  key: string;
}

/**
 * 快捷键总闸门（顺序即优先级）：输入态 → false；UI 模态浮层开着 → false；
 * 单独修饰键 → true（不干扰组合键判定）；其余 → true（只读白名单由
 * bindAll 的 handler 守卫兜底，docs/09 §2）。抽纯函数的唯一动机：
 * 闸门规则真值表可单测（specs/a11y-closeout §5.8）。
 */
export function shortcutGateAllows(input: IShortcutGateInput): boolean {
  if (input.editableAtCapture) return false;
  if (isEditableTarget(input.target)) return false;
  if (input.uiModalOpen) return false;
  if (['control', 'meta', 'alt', 'shift'].includes(input.key)) return true;
  return true;
}
