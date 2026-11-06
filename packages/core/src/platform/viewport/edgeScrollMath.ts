/**
 * 边缘自动滚屏纯数学（specs/edge-auto-scroll §3，docs/05 §4.5）：
 * 热区判定、连续线性速度斜坡、方向符号、帧间隔钳制。全部为无状态纯函数——
 * 单测直接钉死符号与速度曲线（§2.3-①：panBy 正值 = 内容右/下移 = 露出左侧/
 * 上方世界，因此露出右侧世界要传负速度）。
 */

/** 热区宽度（屏幕 px，与缩放无关——4x 放大手感一致） */
export const EDGE_SCROLL_ZONE_PX = 120;

/** 边缘处最大速度（屏幕 px/s）——线性斜坡上限（保留旧快档值做封顶） */
export const EDGE_SCROLL_MAX_PX_PER_S = 1080;

/** 帧间隔钳制上限（ms）：后台标签页 rAF 暂停，回前台首帧真实间隔可达数秒，
 *  不钳制会一次瞬移（specs §12-R5） */
export const EDGE_SCROLL_DT_CLAMP_MS = 50;

export interface IEdgeScrollVelocity {
  x: number;
  y: number;
}

/** 距边距离 → 速度（px/s）。连续线性：热区外沿 0、边缘最大；d ≤ 0（指针越出
 *  边界）钳到最大。d=100px 处恰为旧慢档 180，从分档手感过渡无突兀。 */
function rampSpeed(distance: number, zone: number): number {
  const depth = 1 - Math.max(0, distance) / zone; // 越界时 > 1
  return EDGE_SCROLL_MAX_PX_PER_S * Math.min(1, Math.max(0, depth));
}

/**
 * 单轴速度：正 = 内容向正方向移（panBy 正值，露出负侧世界）；负 = 露出正侧世界；
 * 0 = 不在热区。position 用画布局部屏幕坐标，extent 为该轴可视尺寸。
 */
export function edgeScrollAxisVelocity(
  position: number,
  extent: number,
  zone: number = EDGE_SCROLL_ZONE_PX,
): number {
  if (!(extent > 0)) return 0; // 容器未布局（0×0）一律不滚（E6）
  const left = position; // 越出左侧为负 → 钳到最大
  const right = extent - position;
  if (left <= right && left < zone) return rampSpeed(left, zone); // 露出左侧 = 内容右移
  if (right < left && right < zone) return -rampSpeed(right, zone); // 露出右侧 = 内容左移
  return 0;
}

/** 指针屏幕坐标 + 视口尺寸 → 两轴速度（px/s）。两轴独立，四角斜向各自到最大 */
export function resolveEdgeScroll(
  screen: { x: number; y: number },
  size: { width: number; height: number },
  zone: number = EDGE_SCROLL_ZONE_PX,
): IEdgeScrollVelocity {
  return {
    x: edgeScrollAxisVelocity(screen.x, size.width, zone),
    y: edgeScrollAxisVelocity(screen.y, size.height, zone),
  };
}

/** 帧间隔钳制到 [0, EDGE_SCROLL_DT_CLAMP_MS]；负值（时钟回退）归 0 */
export function clampFrameDt(dtMs: number): number {
  return Math.min(Math.max(dtMs, 0), EDGE_SCROLL_DT_CLAMP_MS);
}
