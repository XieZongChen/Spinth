/**
 * 脑图连线数学纯函数（docs/11 §5，从原仓库 helpers.ts/DRAWER.md 忠实移植具名化）。
 *
 * f(x) 三段：
 * 1. x ≤ H(1500)：先经贝塞尔缓动（控制点 [0.17,0.32]/[0.83,0.56]）得 by，
 *    再 fx = (1 - A^dx)·S1，dx = by·H/D
 * 2. H < x ≤ 2H：fx = S1 + S2·min((x-H)/H, 1)
 * 3. x > 2H：fx = S1 + S2 = 0.98
 *
 * t = isLeft ? 2w·fx - 1 : 1 - 2w·fx（w=0.5 → t ∈ [-1,1] 全幅）
 *
 * 2026-09 修复：S2 曾被写成 0.9（既有设计 generateCurveParamsCalculator 的第二参
 * 是 **0.08**）——饱和值变 1.8，导致 t = 1-fx 在 fx>1 后转负：子节点离根中心
 * 垂直距离超过约 1667 世界像素时，连线起点跑到根节点中心的另一侧（线头穿根）。
 */

const H = 1500;
const S1 = 0.9;
/** 线性段斜率（既有设计 helpers.calculateAwesomeParamT 第二参 0.08） */
const S2 = 0.08;
const A = 0.9;
const D = 10;
const CP1: readonly [number, number] = [0.17, 0.32];
const CP2: readonly [number, number] = [0.83, 0.56];
const W = 0.5;

/** 根连线起点缩进 */
export const ROOT_CURVE_START_PADDING = 24;
/** 根连线贝塞尔控制点系数 */
export const ROOT_CP_RATIO = 0.2;

/** 三次贝塞尔求 y(t)（x 单调 → t ≈ x）——端点 (0,0)-(1,1) */
function bezierY(x: number): number {
  // 参数化：直接用三次贝塞尔公式，t = x（贝塞尔 x 单调近似）
  const t = x;
  const mt = 1 - t;
  return 3 * mt * mt * t * CP1[1] + 3 * mt * t * t * CP2[1] + t * t * t;
}

/** f(x)：垂直距离 → [0, 1.8] 缓动值 */
export function mindF(x: number): number {
  if (x <= 0) return 0;
  if (x <= H) {
    const by = bezierY(x / H);
    const dx = (by * H) / D;
    return (1 - Math.pow(A, dx)) * S1;
  }
  if (x <= 2 * H) return S1 + S2 * Math.min((x - H) / H, 1);
  return S1 + S2;
}

/** t 参数 ∈ [-1,1]（fx=0 → t=±1 靠边；fx=1 → t=0 中点） */
export function rootT(verticalDist: number, isLeft: boolean): number {
  const fx = mindF(verticalDist);
  return isLeft ? 2 * W * fx - 1 : 1 - 2 * W * fx;
}

/** startX = middleX + axisWidth·t */
export function rootStartX(rootCenterX: number, rootWidth: number, t: number): number {
  const axisWidth = rootWidth / 2 - ROOT_CURVE_START_PADDING;
  return rootCenterX + axisWidth * t;
}

/** 子节点朝根侧的边中点 */
export function rootEnd(
  childRect: { x: number; y: number; width: number; height: number },
  isLeft: boolean,
): { x: number; y: number } {
  return {
    x: isLeft ? childRect.x + childRect.width : childRect.x,
    y: childRect.y + childRect.height / 2,
  };
}

/** 普通节点折线 4 点（父边中点→垂直段→子边中点；midX 共享 = 鱼骨） */
export function nodePathPoints(
  parentRect: { x: number; y: number; width: number; height: number },
  childRect: { x: number; y: number; width: number; height: number },
): Array<{ x: number; y: number }> {
  const isLeft = childRect.x + childRect.width / 2 < parentRect.x + parentRect.width / 2;
  const startX = isLeft ? parentRect.x : parentRect.x + parentRect.width;
  const startY = parentRect.y + parentRect.height / 2;
  const endX = isLeft ? childRect.x + childRect.width : childRect.x;
  const endY = childRect.y + childRect.height / 2;
  const midX = (startX + endX) / 2;
  return [
    { x: startX, y: startY },
    { x: midX, y: startY },
    { x: midX, y: endY },
    { x: endX, y: endY },
  ];
}

export const NODE_LINE_ARC_RADIUS = 8;

/** 普通节点连线：聚合线长度（既有设计 NODE_LINE_AGGREGATED，兄弟共享垂直段） */
export const NODE_LINE_AGGREGATED = 24;

/** 连线画笔指令（VM 层逐条落到 PIXI Graphics，纯逻辑可单测） */
export type IConnectorCmd =
  | { op: 'moveTo'; x: number; y: number }
  | { op: 'lineTo'; x: number; y: number }
  | { op: 'arc'; cx: number; cy: number; r: number; start: number; end: number; ccw: boolean }
  | { op: 'cubicTo'; c1x: number; c1y: number; c2x: number; c2y: number; x: number; y: number };

const PI_90 = Math.PI / 2;
const PI_270 = (Math.PI * 3) / 2;

/**
 * 普通节点鱼骨连线路径（既有设计 drawer.drawNodeLine 的 8 象限分情况，含**真圆弧**）：
 * 从父节点朝子节点一侧的边中点出发 → 聚合线（±24）→ 垂直段 → R8 圆弧 → 子节点边中点。
 * 首尾段水平差 1px 以内直接画直线（既有设计 `YDValue = Math.trunc(endY - startY)` 同判据）。
 */
export function nodeConnectorPath(
  parentRect: { x: number; y: number; width: number; height: number },
  childRect: { x: number; y: number; width: number; height: number },
  radius = NODE_LINE_ARC_RADIUS,
): IConnectorCmd[] {
  const isLeft = childRect.x + childRect.width / 2 < parentRect.x + parentRect.width / 2;
  const startX = isLeft ? parentRect.x : parentRect.x + parentRect.width;
  const startY = parentRect.y + parentRect.height / 2;
  const endX = isLeft ? childRect.x + childRect.width : childRect.x;
  const endY = childRect.y + childRect.height / 2;
  const yDelta = Math.trunc(endY - startY);

  const moveTo = (x: number, y: number): IConnectorCmd => ({ op: 'moveTo', x, y });
  const lineTo = (x: number, y: number): IConnectorCmd => ({ op: 'lineTo', x, y });
  if (yDelta === 0) return [moveTo(startX, startY), lineTo(endX, endY)];

  const aggregatedX = isLeft ? startX - NODE_LINE_AGGREGATED : startX + NODE_LINE_AGGREGATED;

  // 小台阶（0 < |Δy| < 2R）：圆弧放不下，改用一段平滑 S 曲线直连。
  // 既有设计此处是 TODO（源码注释：「如果遇到 1px < endY - startY < 弧半径 的情况，
  // 需要考虑使用贝塞尔曲线」）——不处理会画出钩状折角：子节点块相对父中心本就
  // 有 ~2px 偏移（末尾外边距口径），每个单子节点都会撞上这个区间。
  if (Math.abs(endY - startY) < radius * 2) {
    return [
      moveTo(startX, startY),
      {
        op: 'cubicTo',
        c1x: aggregatedX,
        c1y: startY,
        c2x: aggregatedX,
        c2y: endY,
        x: endX,
        y: endY,
      },
    ];
  }
  const down = yDelta > 0;
  const cy = down ? endY - radius : endY + radius;
  const arcCx = isLeft ? aggregatedX - radius : aggregatedX + radius;

  const arc: IConnectorCmd = isLeft
    ? down
      ? { op: 'arc', cx: arcCx, cy, r: radius, start: 0, end: PI_90, ccw: false }
      : { op: 'arc', cx: arcCx, cy, r: radius, start: 0, end: PI_270, ccw: true }
    : down
      ? { op: 'arc', cx: arcCx, cy, r: radius, start: Math.PI, end: PI_90, ccw: true }
      : { op: 'arc', cx: arcCx, cy, r: radius, start: Math.PI, end: PI_270, ccw: false };

  return [
    moveTo(startX, startY),
    lineTo(aggregatedX, startY),
    lineTo(aggregatedX, cy),
    arc,
    lineTo(endX, endY),
  ];
}
