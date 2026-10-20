/**
 * 选中态视觉语言（全元素统一，2026-09 设计定稿）：
 * - 一个元素任何时刻只有**一层**选中视觉（脑图节点经 getFocusFrame 走同一
 *   SelectionVm，不叠本体描边）；
 * - 框 = 2px 实线（屏幕恒定，/scale 补偿）+ 6px 圆角（spinth 圆角语言：
 *   工具坞 14 / 卡片 6）+ 8% 透明填充（选中区域可读，与常见白板工具一致）；
 * - 色取功能蓝（白板行业肌肉记忆，与缩放手柄一致）——品牌火花紫不侵入
 *   画布操作语义；
 * - 常量唯一色源：SelectionVm / RectEditor 手柄 / 脑图焦点框全部同源消费，
 *   禁止散落裸 hex。
 */
export const SELECTION_COLOR = 0x2878ff;
export const SELECTION_LINE_WIDTH = 2;
export const SELECTION_RADIUS = 6;
export const SELECTION_FILL_ALPHA = 0.08;
/** 缩放手柄：白心 + 选中蓝描边（与框同源） */
export const HANDLE_FILL = 0xffffff;
