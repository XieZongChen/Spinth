import type { IActionBarOption } from '../../types';

/** 连线工具选项域：线型/线宽选项表单源（工具坞常驻二级菜单与 ActionBar
 *  popover 共用）；lineService re-export 保持既有消费路径。 */

/** 线型三选项单源（docs/04 §2 工具默认参数节）：工具坞常驻二级菜单与 ActionBar 线型 popover 共用 */
export const LINE_TYPE_OPTIONS: IActionBarOption[] = [
  { id: 'STRAIGHT', label: '直线', icon: 'line-straight' },
  { id: 'ELBOWED', label: '折线', icon: 'line-elbow' },
  { id: 'CURVE', label: '曲线', icon: 'line-curve' },
];

/** 线宽四档（2026-10-14 线宽笔宽批）：1/2/4/8，默认 2——icon 粗细横线示意；
 *  flyout 第二组与 ActionBar popover 共用；超越既有设计两档（2/5） */
export const LINE_WIDTH_STEPS = [1, 2, 4, 8] as const;
export const LINE_WIDTH_OPTIONS: IActionBarOption[] = LINE_WIDTH_STEPS.map((n) => ({
  id: String(n),
  label: `${n} 像素线宽`,
  icon: `line-width-${n}`,
}));
