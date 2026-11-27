/**
 * 生命线几何单源（specs/sequence-diagram §3.1、§3.3、§3.5）：参与者头框、竖直
 * 轴、命中（头框 ∪ 轴带）、标签区、缩放整形、轴虚线分段、标签截断——全部纯函数，
 * 单测直测。纯模块（无 PIXI）：渲染 Vm / 标签编辑链 / 命中测试共用。
 *
 * 轴锚定（specs/sequence-diagram §3.2）本文件只提供「矩形 → 轴」（lifelineAxis）；
 * 轴上取点、选边、端口在连线层（widgets/line/lineAxisAnchor——生命线与消息共用，
 * 连线层不能反向依赖 sequence）。
 */
import type { IPoint, IRect } from '../../common/geometry';
import { rectsIntersect } from '../../common/geometry';
import { truncateLabelToWidth } from '../../platform/textEngine/labelText';
import { createCanvasMeasurer, type ITextStyleProps } from '../../platform/textEngine/measure';
import type { IAxisAnchor, ResizeDir } from '../../types/base';

/** 头部样式：box = 矩形头框；actor = 小人（批次 4 绘制；几何先定，标签在小人下方） */
export type LifelineHead = 'box' | 'actor';

// —— 常量（§3.1） ——

/** box 头高（世界 px） */
export const LIFELINE_HEAD_HEIGHT = 36;
/** actor 头区高（小人 44 + 标签带） */
export const LIFELINE_ACTOR_HEAD_HEIGHT = 72;
/** 单击创建默认尺寸 */
export const LIFELINE_DEFAULT_WIDTH = 120;
export const LIFELINE_DEFAULT_HEIGHT = 520;
/** 手柄缩放下限（高度下限保证轴长 ≥ 84） */
export const LIFELINE_MIN_WIDTH = 60;
export const LIFELINE_MIN_HEIGHT = 120;
/** 标签字号 / 行高（编辑器与画布同源） */
export const LIFELINE_LABEL_FONT_SIZE = 14;
export const LIFELINE_LABEL_LINE_HEIGHT = 20;
/** 标签左右内边距 */
export const LIFELINE_LABEL_PAD_X = 8;
/** 轴命中半宽：屏幕 px，命中时折算世界值；折算后的世界值上限 */
export const LIFELINE_AXIS_HIT_SCREEN = 6;
export const LIFELINE_AXIS_HIT_MAX = 24;
/** 头框填充 / 描边（描边色即标签色：#333333 对 #ffffff ≈ 12.6:1） */
export const LIFELINE_HEAD_COLOR = '#ffffff';
export const LIFELINE_HEAD_BORDER = '#333333';
/** 轴虚线 [实, 空]（世界 px） */
export const LIFELINE_AXIS_DASH: readonly [number, number] = [6, 6];
/** 宽度低于此值标签不画（头框放不下一个字） */
export const LIFELINE_LABEL_MIN_WIDTH = 24;
/** 标签落库截断上限（字素） */
export const LIFELINE_LABEL_MAX_CHARS = 64;

/** 头区高（数据缺省 / 未知值按 box） */
export function lifelineHeadHeight(head?: LifelineHead): number {
  return head === 'actor' ? LIFELINE_ACTOR_HEAD_HEIGHT : LIFELINE_HEAD_HEIGHT;
}

/** 竖直轴（世界坐标）：x = 水平中心；轴段 = 头区底边到 bbox 底边。高度不足时
 *  top ≥ bottom（无轴，退化不抛错） */
export interface ILifelineAxis {
  x: number;
  top: number;
  bottom: number;
}

export function lifelineAxisOf(rect: IRect, head?: LifelineHead): ILifelineAxis {
  return {
    x: rect.x + rect.width / 2,
    top: rect.y + lifelineHeadHeight(head),
    bottom: rect.y + rect.height,
  };
}

/** 轴锚定几何（§3.2）：轴长 < 1 的退化件返回 null——连线按普通件处理
 *  （锚点回落 bbox）；≥ 1 才是可落线的轴 */
export function lifelineAxis(rect: IRect, head?: LifelineHead): IAxisAnchor | null {
  const axis = lifelineAxisOf(rect, head);
  return axis.bottom - axis.top < 1 ? null : axis;
}

/** 轴虚线的实线段 [y0, y1]（世界坐标，自上而下）：从轴顶按 [实, 空] 点划，末段
 *  不足一个实长照画。无轴返回空数组 */
export function lifelineAxisDashSegments(axis: ILifelineAxis): Array<[number, number]> {
  const [on, off] = LIFELINE_AXIS_DASH;
  const segments: Array<[number, number]> = [];
  for (let y = axis.top; y < axis.bottom; y += on + off) {
    segments.push([y, Math.min(y + on, axis.bottom)]);
  }
  return segments;
}

/** 轴带命中半宽（世界 px）：屏幕 6px 按 vpScale 折算；下限 6（放大时不无限变细，
 *  4x 下仍是屏幕 24px 可抓），上限 24（深缩放不吞掉整条）——FRAME 边框环同款 */
export function lifelineAxisHitHalf(scale: number): number {
  const s = scale > 0 && Number.isFinite(scale) ? scale : 1;
  return Math.min(
    Math.max(LIFELINE_AXIS_HIT_SCREEN / s, LIFELINE_AXIS_HIT_SCREEN),
    LIFELINE_AXIS_HIT_MAX,
  );
}

/** 头框（世界坐标）：整条宽 × 头区高；高度不足头区高时就是整个 bbox */
export function lifelineHeadRect(rect: IRect, head?: LifelineHead): IRect {
  return {
    x: rect.x,
    y: rect.y,
    width: rect.width,
    height: Math.min(lifelineHeadHeight(head), Math.max(rect.height, 0)),
  };
}

/** 点命中（§3.3）：头框 ∪ 轴带（|p.x − 轴 x| ≤ half ∧ 轴段内） */
export function lifelineHitTest(
  p: IPoint,
  rect: IRect,
  head: LifelineHead | undefined,
  half: number,
): boolean {
  const headRect = lifelineHeadRect(rect, head);
  if (
    p.x >= headRect.x &&
    p.x <= headRect.x + headRect.width &&
    p.y >= headRect.y &&
    p.y <= headRect.y + headRect.height
  ) {
    return true;
  }
  const axis = lifelineAxisOf(rect, head);
  return Math.abs(p.x - axis.x) <= half && p.y >= axis.top && p.y <= axis.bottom;
}

/** 框选命中（§3.3）：r 与头框相交 ∨ r 与轴带（宽 2 × half）相交。不用整 bbox——
 *  bbox 有 120 宽，框选擦过轴旁空白不该选中 */
export function lifelineHitTestRect(
  r: IRect,
  rect: IRect,
  head: LifelineHead | undefined,
  half: number,
): boolean {
  if (rectsIntersect(r, lifelineHeadRect(rect, head))) return true;
  const axis = lifelineAxisOf(rect, head);
  if (axis.bottom <= axis.top) return false; // 无轴
  return rectsIntersect(r, {
    x: axis.x - half,
    y: axis.top,
    width: half * 2,
    height: axis.bottom - axis.top,
  });
}

/** 标签文字区（局部系：控件矩形左上角为原点）：头框内缩左右 PAD_X，占头区高的
 *  下部一条；actor 头的标签在小人下方 */
export function lifelineLabelRect(width: number, head?: LifelineHead): IRect {
  const bandTop = head === 'actor' ? LIFELINE_ACTOR_HEAD_HEIGHT - LIFELINE_HEAD_HEIGHT : 0;
  return {
    x: LIFELINE_LABEL_PAD_X,
    y: bandTop,
    width: Math.max(width - LIFELINE_LABEL_PAD_X * 2, 0),
    height: LIFELINE_HEAD_HEIGHT,
  };
}

/** 缩放整形（§3.5）：被拖边跟手——宽度 = 2 × |被拖边到轴的距离|（e 手柄读 next
 *  的右边、w 手柄读左边；轴 x = 起点水平中心，不因缩放移动——绑定的激活条因此不
 *  需要跟随），钳到 LIFELINE_MIN_WIDTH；高度只认被拖的横边（n 锚底边、s 锚顶边），
 *  钳到 LIFELINE_MIN_HEIGHT。
 *
 *  next 是吸附 / 量化**之后**的目标矩形（rectEditor 经 planResize 传入）：整形保持
 *  被拖边的位置——命中线画在哪、边就落在哪；对边镜像过去。不能拿 next.width 当宽：
 *  它是相对固定的对边量的（e 手柄 = 指针到起点左边），轴对称后手柄只以半速跟手；
 *  网格量化还会把 next.x 重置成起点左边。 */
export function constrainLifelineResize(start: IRect, next: IRect, dir: ResizeDir): IRect {
  const bottom = start.y + start.height;
  const topMoved = dir.includes('n');
  const height = topMoved
    ? Math.max(bottom - next.y, LIFELINE_MIN_HEIGHT)
    : dir.includes('s')
      ? Math.max(next.y + next.height - start.y, LIFELINE_MIN_HEIGHT)
      : start.height;
  const y = topMoved ? bottom - height : start.y;
  if (!dir.includes('e') && !dir.includes('w')) {
    return { x: start.x, y, width: start.width, height };
  }
  const axisX = start.x + start.width / 2;
  const edge = dir.includes('e') ? next.x + next.width : next.x;
  const width = Math.max(2 * Math.abs(edge - axisX), LIFELINE_MIN_WIDTH);
  return { x: axisX - width / 2, y, width, height };
}

/** 标签渲染截断：可用宽内逐字素 + 省略号（数据恒存完整标签，加宽即恢复）；
 *  宽度不足 LIFELINE_LABEL_MIN_WIDTH 时为空 */
export function truncateLifelineLabel(label: string, width: number, head?: LifelineHead): string {
  if (width < LIFELINE_LABEL_MIN_WIDTH) return '';
  const style: ITextStyleProps = {
    fontFamily: 'sans-serif',
    fontSize: LIFELINE_LABEL_FONT_SIZE,
    lineHeight: LIFELINE_LABEL_LINE_HEIGHT / LIFELINE_LABEL_FONT_SIZE,
    color: LIFELINE_HEAD_BORDER,
  };
  return truncateLabelToWidth(
    label,
    lifelineLabelRect(width, head).width,
    style,
    createCanvasMeasurer(),
  );
}
