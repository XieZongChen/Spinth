import type { IRect } from '../../common/geometry';
import { rotatePointAround } from '../../platform/rectEditor/rotateMath';
import type { IPt, JoinDir } from './lineMathTypes';
import { anchorOf, intersectLine, nearestSegBody, type ISegmentGeom } from './lineGeometry';
import { slicePathExcludingRect } from './linePath';
import { NODE_MARGIN } from './lineRoute';

/** 连线手柄域（docs/08 §10）：主段/胶囊手柄锚点、quick-add 落位槽位、连接点
 *  外移点、段身容差、段滑移。依赖 lineGeometry/linePath/lineRoute 的下层几何。 */

/** 可交互主段的最小屏显长度：走廊短段（如 30px）的胶囊会贴着端点手柄/肘部
 *  挤作一团（2026-09-29 用户实测截图——视觉混乱被感知为「段条缺失/错位」） */
export const MAJOR_SEG_MIN_SCREEN = 60;

/**
 * 可交互主段（渲染/快照两处共用一份过滤）：屏显长度 ≥60px 的段。
 * index = 真实段号（slideSegment 口径——segmentGeoms 跳零长段会漂移序号，
 * 故此处独立遍历）；数组序号 = 手柄渲染与探针的 activeIndex 口径。
 */
export function majorSegments(
  pts: readonly IPt[],
  scale: number,
): Array<{ index: number; geom: ISegmentGeom }> {
  const s = scale || 1;
  const out: Array<{ index: number; geom: ISegmentGeom }> = [];
  for (let i = 0; i + 1 < pts.length; i++) {
    const a = pts[i]!;
    const b = pts[i + 1]!;
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len = Math.hypot(dx, dy);
    if (len < MAJOR_SEG_MIN_SCREEN / s) continue; // 零长/短段一并过滤
    out.push({
      index: i,
      geom: { mid: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }, angle: Math.atan2(dy, dx), len },
    });
  }
  return out;
}

/** 有文字时单侧可见部分的最小屏显弧长（短于胶囊本身无操作空间，不放手柄） */
export const CAPSULE_MIN_PIECE_SCREEN = 24;

/** quick-add 新形状近边与源锚点的间距（2026-10-02 用户拍板：70 偏短加长；
 *  历史 150→70→110——quickAddConnectedShape 与 LineGhostPreview 共用单源） */
export const QUICK_ADD_GAP = 110;

/** 交替落位相邻卡位的净间隙（参考视频实测：260 高卡中心偏移 330 =
 *  卡长 260 + 间隙 70）。独立于 QUICK_ADD_GAP（正对落位间隙 110 是用户
 *  拍板值，错开卡位间隙未被拍板——先贴视频，实测微调项） */
export const BRANCH_STAGGER_GAP = 70;

/** 交替落位单步卡位中心偏移（quick-add 方向已有带连线元素时）= 垂直于
 *  法向的卡边长 + 净间隙——错开**一整个卡位**不重叠（首版 30% 比例偏移
 *  被用户实测报重叠：240 宽卡仅偏 72 仍叠一大半，2026-10-03 修正） */
export function branchStride(perp: number): number {
  return perp + BRANCH_STAGGER_GAP;
}

/**
 * quick-add 交替落位槽位偏移（2026-10-02 参考视频第 3 段）：方向上已有
 * 带连线的元素时，新形状不再正对落位，而是垂直于法向一上一下（垂直方向
 * 一右一左）交替错开成列——n=已有分支数，第 n+1 个成员：n 奇偏「负侧」
 * 1 卡位、n 偶偏「正侧」1、再交替加一（n=1 → -1、2 → +1、3 → -2、4 → +2）。
 * 负侧 = 水平方向的上方（y 减）/ 垂直方向的左方（x 减）；垂直方向起步为
 * 「先右」，由调用方取负翻转。perp = 源卡垂直于法向的边长。n<1 返回 0
 * （方向空闲，正对落位）。
 */
export function branchSlotOffset(n: number, perp: number): number {
  if (n < 1) return 0;
  const slot = Math.ceil(n / 2);
  const sign = n % 2 === 1 ? -1 : 1;
  return sign * slot * branchStride(perp);
}

/**
 * 胶囊手柄锚点（渲染/抓取/hover/探针的单一事实源，2026-10-02 参考规格）：
 * - 无文字（knockout = null）：majorSegments 逐主段中点（现状）；
 * - 有文字：文字把连线分成两部分，**每侧一个手柄**放在该侧可见部分的
 *   弧长中点（贴文字两侧——取代原段中点，避免与文字锚点重叠）。index =
 *   中点所在的**真实段号**（slideSegment 口径，拖任一侧手柄即滑移所在段）；
 *   屏显弧长 < 24px 的侧不放（线太短胶囊无处安放）。
 */
export function capsuleAnchors(
  pts: readonly IPt[],
  scale: number,
  knockout: IRect | null,
): Array<{ index: number; geom: ISegmentGeom }> {
  if (!knockout) return majorSegments(pts, scale);
  const s = scale || 1;
  const out: Array<{ index: number; geom: ISegmentGeom }> = [];
  const pieces = slicePathExcludingRect([...pts], knockout);
  for (const piece of pieces) {
    // piece 弧长中点
    let total = 0;
    for (let i = 1; i < piece.length; i++) {
      total += Math.hypot(piece[i]!.x - piece[i - 1]!.x, piece[i]!.y - piece[i - 1]!.y);
    }
    if (total < CAPSULE_MIN_PIECE_SCREEN / s) continue;
    let half = total / 2;
    let mid = piece[piece.length - 1]!;
    for (let i = 1; i < piece.length && half > 0; i++) {
      const a = piece[i - 1]!;
      const b = piece[i]!;
      const len = Math.hypot(b.x - a.x, b.y - a.y);
      if (half <= len) {
        mid = { x: a.x + ((b.x - a.x) * half) / len, y: a.y + ((b.y - a.y) * half) / len };
        break;
      }
      half -= len;
    }
    // 中点回定位到真实段号 + 沿所在段方向旋转（胶囊口径与主段一致）
    const hit = nearestSegBody(pts, mid, 1e-3);
    if (!hit) continue;
    const a = pts[hit.index]!;
    const b = pts[hit.index + 1]!;
    out.push({
      index: hit.index,
      geom: { mid, angle: Math.atan2(b.y - a.y, b.x - a.x), len: Math.hypot(b.x - a.x, b.y - a.y) },
    });
  }
  // 文字矩形未实际切到路径（切分为空）→ 回退无字口径
  return out.length > 0 ? out : majorSegments(pts, scale);
}

/** 连接点外移点中心：edge 锚点 + 法向偏移（选中态外移 24px——与指示器绘制
 *  同源，避开边中点缩放手柄；A1 整理批抽纯函数，overlay 与抓取判定共用。
 *  常量单源：lineAnchorIndicator 从此处 re-export） */
export const ANCHOR_DOT_OFFSET = 24;
const DOT_JOIN_NORMALS: Record<JoinDir, IPt> = {
  top: { x: 0, y: -1 },
  right: { x: 1, y: 0 },
  bottom: { x: 0, y: 1 },
  left: { x: -1, y: 0 },
};

/** scale = 屏幕像素→世界单位换算（Batch 1 · 1.8③：外移量屏幕恒定——
 *  rectEditor 旋转柄同款口径；缺省 1 兼容既有单测的世界口径） */
export function dotOffsetCenter(bounds: IRect, j: JoinDir, rotation = 0, scale = 1): IPt {
  const off = ANCHOR_DOT_OFFSET / scale;
  const a = anchorOf(bounds, j, rotation);
  const n = DOT_JOIN_NORMALS[j];
  if (rotation === 0) return { x: a.x + n.x * off, y: a.y + n.y * off };
  const rn = rotatePointAround(n, { x: 0, y: 0 }, rotation);
  return { x: a.x + rn.x * off, y: a.y + rn.y * off };
}

/** 段身抓取容差（屏幕像素）：参考演示视频对齐——线身任意点按住即拖
 *  （与 polylineHit 命中同 8px 口径；A1 整理批收单源，overlay/滑移共用） */
export const SEGMENT_BODY_TOLERANCE = 8;

// ---------------------------------------------------------------------------
// 段滑移（docs/08 §10 批次 3 waypoint，用户拍板参考图二 U 形）
// ---------------------------------------------------------------------------

/** 唯一段拆分的锚点侧连接段长度（世界像素）：被拖段与锚点之间留出的 stub
 *  ——参考演示视频量级 30-50px，与 NODE_MARGIN 同源 */
export const SEG_SLIDE_STUB = 30;

/**
 * 段滑移：把段 i 沿自身法向平移 offset。
 * - 中段：新段两端 = 与相邻段直线的交点（拐点跟随，正交段必相交），
 *   平行退化取平移后端点；
 * - 唯一段（两点线，2026-09-30 视频实锤）：两端保持 + **拆五点**——锚点各伸
 *   stub 连接段、被拖段平移 offset，全程正交（参考拖水平直连线的「几」形）；
 * - 首/末段（2026-09-30 用户实测拍板两档）：**长段（≥ NODE_MARGIN=30，与
 *   自动路由走廊阈值同源）拆几字形保正交接入**——锚点端沿原方向伸 stub、
 *   垂直连接到被拖段、被拖段另一端与邻段求交（锚点始终正交进入元素，不斜）；
 *   短段（< 30，走廊短段不够拆）退化为斜连（锚点保持 + 拐点平移求交）。
 *   offset=0 时拆点共线，由调用方 mergeCollinear 清回原形（幂等）。
 */
export function slideSegment(pts: readonly IPt[], i: number, offset: number): IPt[] {
  const a = pts[i]!;
  const b = pts[i + 1]!;
  const len = Math.hypot(b.x - a.x, b.y - a.y) || 1;
  const nx = -(b.y - a.y) / len;
  const ny = (b.x - a.x) / len;
  const dirX = (b.x - a.x) / len;
  const dirY = (b.y - a.y) / len;
  const a2 = { x: a.x + nx * offset, y: a.y + ny * offset };
  const b2 = { x: b.x + nx * offset, y: b.y + ny * offset };
  const hasPrev = i > 0;
  const hasNext = i + 2 < pts.length;
  if (!hasPrev && !hasNext) {
    // 唯一段拆五点：两端各伸 stub + 被拖段平移（全程正交）
    const stub = Math.min(SEG_SLIDE_STUB, len / 3);
    const a1 = { x: a.x + dirX * stub, y: a.y + dirY * stub };
    const b1 = { x: b.x - dirX * stub, y: b.y - dirY * stub };
    return [
      a,
      a1,
      { x: a1.x + nx * offset, y: a1.y + ny * offset },
      { x: b1.x + nx * offset, y: b1.y + ny * offset },
      b1,
      b,
    ];
  }
  if (hasPrev && hasNext) {
    // 中段：两端求交（拐点跟随）
    const out = pts.map((p) => ({ ...p }));
    out[i] = intersectLine(pts[i - 1]!, pts[i]!, a2, b2) ?? a2;
    out[i + 1] = intersectLine(a2, b2, pts[i + 1]!, pts[i + 2]!) ?? b2;
    return out;
  }
  // 首/末段：长段拆几字形（正交接入），短段斜连
  if (len >= NODE_MARGIN) {
    const stub = Math.min(SEG_SLIDE_STUB, len / 3);
    if (!hasPrev) {
      // 首段拆：[a, a+stub, +off（垂直连接）, 与后段求交] + 后续原样
      const s = { x: a.x + dirX * stub, y: a.y + dirY * stub };
      const c1 = { x: s.x + nx * offset, y: s.y + ny * offset };
      const join = intersectLine(a2, b2, pts[i + 1]!, pts[i + 2]!) ?? b2;
      return [a, s, c1, join, ...pts.slice(i + 2)];
    }
    // 末段拆：前段原样 + [与前段求交, +off（垂直连接）, b−stub, b]
    const s = { x: b.x - dirX * stub, y: b.y - dirY * stub };
    const c1 = { x: s.x + nx * offset, y: s.y + ny * offset };
    const join = intersectLine(pts[i - 1]!, pts[i]!, a2, b2) ?? a2;
    return [...pts.slice(0, i), join, c1, s, b];
  }
  const out = pts.map((p) => ({ ...p }));
  if (!hasPrev) {
    // 首段短段：锚点端保持，拐点端平移 + 与后段求交（斜连）
    out[i] = a;
    out[i + 1] = intersectLine(a2, b2, pts[i + 1]!, pts[i + 2]!) ?? b2;
  } else {
    // 末段短段：镜像
    out[i] = intersectLine(pts[i - 1]!, pts[i]!, a2, b2) ?? a2;
    out[i + 1] = pts[i + 1]!;
  }
  return out;
}
