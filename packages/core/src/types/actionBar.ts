// ---------------------------------------------------------------------------
// ActionBar schema v2（docs/12 §4/§5：选中浮动操作栏，schema 驱动动态渲染；
// 2026-10-03 参考视频对齐——多级化：bar 一级只放「当前值图标 + ▾」单按钮，
// 选项收进二级面板；文字提示收进 tooltip。segmented/color kind 退役）
// ----------------------------------------------------------------------------

export type ActionBarItemKind = 'toggle' | 'popover' | 'action';

export interface IActionBarOption {
  id: string;
  /** 中文名（面板选项 tooltip / aria 兜底文案） */
  label: string;
  /** Icon 语义名（图标选项；色块选项用 swatch；文本选项用 text——三选一） */
  icon?: string;
  /** 色块选项的 hex 渲染色 */
  swatch?: string;
  /** 文本选项的显示字（字号档位等数字型值，docs/17 §4 排版打磨批 B） */
  text?: string;
}

export interface IActionBarItem {
  /** 语义键：popover/toggle = updateSelectedStyle 的 patch 键；action = 动作 id（commands 层分发，docs/05 §7） */
  id: string;
  kind: ActionBarItemKind;
  /** 控件中文文案（一级按钮 tooltip + aria-label） */
  label: string;
  /** toggle/action：图标语义名 */
  icon?: string;
  /** popover：当前值（option id，触发钮显示其图标/色点）；toggle：boolean */
  value?: string | boolean;
  /** popover 选项（图标型 / 色块型） */
  options?: IActionBarOption[];
  /** action：不可用时的禁用态（分布键 <3 选中，参考同款） */
  disabled?: boolean;
}

export interface IActionBarSchema {
  /** 单选时的控件类型；多选为 '*'（仅通用动作） */
  type: string;
  items: IActionBarItem[];
}

/** 脑图焦点节点 +/- 按钮定位源（docs/12 §4；bounds = canvas 局部坐标，同 ActionBar 语义） */
export interface IMindAddButtonsState {
  bounds: { x: number; y: number; width: number; height: number };
  /** 根节点：左右均显示建子按钮、无同级/删除 */
  isRoot: boolean;
  /** 焦点节点侧向（沿父链继承；isRoot 时恒 right） */
  direction: 'left' | 'right';
  /** 左/右建子按钮的 x 基准边（canvas 局部坐标）：焦点节点边缘与同侧子树
   *  最远端取外——按钮不再压住子节点（2026-09 样式审查实测） */
  slotLeft: number;
  slotRight: number;
}
