/**
 * 形状几何常量单源（specs/flowchart-closeout §7.2 常量单源）：绘制路径
 * （shapePath）与内接/撑高（shapeGeometry）、轮廓折线（shapeOutline）三方共同
 * 消费——锚点与绘制若各持一份参数会产生「锚点贴不齐轮廓」的漂移，此前
 * shapePath 与 shapeGeometry 已是两份手抄（32 轮审查遗留），本文件收口。
 */

/** 平行四边形斜边比例（顶/底边平移量 = w × ratio） */
export const PARALLELOGRAM_SKEW_RATIO = 0.18;

/** 圆柱/滚筒端头半轴（弧深口径）与全高（= 2×半轴，内接矩形与撑高公式消费） */
export const CYLINDER_SEMI_AXIS = 27;
export const CYLINDER_HEAD_FULL = CYLINDER_SEMI_AXIS * 2;

/** 缺角页折角（固定上限 + 小形状钳制比例） */
export const FILE_FOLD_MAX = 50;
export const FILE_FOLD_CLAMP = 0.3;

/** 文件夹标签页高度上限与钳制比例 */
export const FOLDER_TAB_MAX = 40;
export const FOLDER_TAB_CLAMP = 0.25;

/** 页连接下尖深度（比例 + 上限；撑高公式同源） */
export const OFFPAGE_TIP_RATIO = 0.35;
export const OFFPAGE_TIP_MAX = 35;

/** 梯形两腰内斜（比例 + 上限） */
export const TRAPEZOID_WAIST_RATIO = 0.2;
export const TRAPEZOID_WAIST_MAX = 40;

/** 六边形左右尖斜宽比例 */
export const HEXAGON_SLANT_RATIO = 0.25;

/** 文档底边 S 波波深（上限 + 小形状钳制比例） */
export const DOCUMENT_WAVE_MAX = 18;
export const DOCUMENT_WAVE_CLAMP = 0.15;

/** 子过程双竖线内缩（上限 + 比例） */
export const PREDEFINED_BAND_MAX = 12;
export const PREDEFINED_BAND_RATIO = 0.1;

/** round-rect 圆角（比例封顶 + 绝对上限） */
export const CORNER_RADIUS_RATIO = 0.2;
export const CORNER_RADIUS_MAX = 32;

// —— 派生钳制（绘制与内接两处共用的「小形状钳制」语义） ——

/** 圆柱端头半轴（按高钳制） */
export const cylinderSemiAxis = (h: number): number => Math.min(CYLINDER_SEMI_AXIS, h * 0.15);
/** 滚筒端头半轴（按宽钳制） */
export const queueSemiAxis = (w: number): number => Math.min(CYLINDER_SEMI_AXIS, w * 0.15);
/** 缺角页折角深 */
export const fileFold = (w: number): number => Math.min(FILE_FOLD_MAX, w * FILE_FOLD_CLAMP);
/** 文件夹标签页高 */
export const folderTab = (h: number): number => Math.min(FOLDER_TAB_MAX, h * FOLDER_TAB_CLAMP);
/** 页连接下尖深 */
export const offPageTip = (h: number): number => Math.min(h * OFFPAGE_TIP_RATIO, OFFPAGE_TIP_MAX);
/** 梯形腰斜宽 */
export const trapezoidWaist = (w: number): number =>
  Math.min(w * TRAPEZOID_WAIST_RATIO, TRAPEZOID_WAIST_MAX);
/** 六边形斜宽 */
export const hexagonSlant = (w: number, h: number): number =>
  Math.min(w * HEXAGON_SLANT_RATIO, h / 2);
/** 文档波深 */
export const documentWave = (h: number): number =>
  Math.min(DOCUMENT_WAVE_MAX, h * DOCUMENT_WAVE_CLAMP);
/** 子过程竖线带内缩 */
export const predefinedBand = (w: number): number =>
  Math.min(PREDEFINED_BAND_MAX, w * PREDEFINED_BAND_RATIO);
