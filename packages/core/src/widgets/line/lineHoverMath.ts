import type { IHostGeom } from '../../common/geometry';
import {
  capsuleAnchors,
  dotOffsetCenter,
  nearestSegBody,
  SEGMENT_BODY_TOLERANCE,
  type IPt,
  type JoinDir,
} from './lineMath';

/** 连线悬停几何域（docs/08 §10 批次 2/3）：外移点坐标/快照、最近外移点、
 *  连线端点/段身 hover 判定与光标方向。纯函数，只依赖 points/lineType/
 *  knockout/world/scale——副作用（手柄显隐、setHoverCursor）归 LineHoverOverlay。 */

export const JOINS: readonly JoinDir[] = ['top', 'right', 'bottom', 'left'];

/** 四向外移点坐标快照（快照供 E2E 探针 + hover 命中判定共用） */
export function dotSnapshots(geom: IHostGeom, scale: number): Array<{ x: number; y: number }> {
  return JOINS.map((j) => {
    const c = dotCenter(geom, j, scale);
    return { x: c.x, y: c.y };
  });
}

/** 连接点外移点中心（edge 锚点 + 法向 24px——与指示器绘制同源，避开边中点缩放手柄） */
export function dotCenter(geom: IHostGeom, j: JoinDir, scale: number): IPt {
  // 1.8③：外移量屏幕恒定（与抓取圆心同源）
  return dotOffsetCenter(geom.rect, j, geom.rotation, scale);
}

/** 最近外移点（四向距离排序取最近——hover 命中与按下抓取同口径） */
export function nearestDot(geom: IHostGeom, world: IPt, scale: number): { j: JoinDir; d: number } {
  return JOINS.map((j) => ({ j, c: dotCenter(geom, j, scale) }))
    .map(({ j, c }) => ({ j, d: Math.hypot(c.x - world.x, c.y - world.y) }))
    .sort((p, q) => p.d - q.d)[0]!;
}

/** 连线 hover 判定结果：端点命中（0=起点/1=终点）、胶囊索引、段号、光标方向 */
export interface ILineHoverHit {
  endpointActive: number | null;
  segmentActive: number | null;
  hoverSegIndex: number;
  hoverCursor: string | null;
}

/**
 * 连线端点/段身 hover 判定（纯几何）：
 * - 距端点 ≤12/scale → 该端点放大（拖拽重锚定光标 grab）；
 * - 否则 ELBOWED 线身任意点 ≤8/scale（SEGMENT_BODY_TOLERANCE）→ 段身命中，
 *   胶囊高亮与所见同源（有字 = 文字两侧双胶囊，无字 = 主段；短段无手柄 →
 *   capsuleAnchors 找不到对应索引则不亮）；CURVE/STRAIGHT 无段语义不参与；
 * - 光标 = 段身拖动方向（法向）的双向箭头——水平段上下拖 ↕ ns-resize /
 *   垂直段左右拖 ↔ ew-resize（与矩形缩放手柄同惯例：光标指拖向，
 *   2026-09-30 用户实测定向）；端点 = grab。
 */
export function resolveLineHover(
  pts: IPt[],
  lineType: 'STRAIGHT' | 'ELBOWED' | 'CURVE',
  knockout: { x: number; y: number; width: number; height: number } | null,
  world: IPt,
  scale: number,
): ILineHoverHit {
  const grab = 12 / scale;
  const dS = Math.hypot(world.x - pts[0]!.x, world.y - pts[0]!.y);
  const dE = Math.hypot(world.x - pts[pts.length - 1]!.x, world.y - pts[pts.length - 1]!.y);
  const endpointActive = dS <= grab ? 0 : dE <= grab ? 1 : null;
  // 段身 hover（2026-09-30 参考视频对齐）：距段线身 ≤8/scale 即命中
  // （线身任意点可拖），胶囊高亮仍限主段（短段无手柄）
  let segmentActive: number | null = null;
  let hoverSegIndex = -1;
  if (endpointActive === null && lineType === 'ELBOWED') {
    const seg = nearestSegBody(pts, world, SEGMENT_BODY_TOLERANCE / scale);
    if (seg) {
      hoverSegIndex = seg.index;
      // 胶囊高亮与所见同源（有字 = 文字两侧双胶囊，无字 = 主段）
      const k = capsuleAnchors(pts, scale, knockout).findIndex(({ index }) => index === seg.index);
      segmentActive = k >= 0 ? k : null;
    }
  }
  // cursor 反馈：端点 = grab（拖拽重锚定）、段身 = 拖动方向（法向）的双向箭头；
  // 离开恢复模式默认
  let hoverCursor: string | null = null;
  if (endpointActive !== null) {
    hoverCursor = 'grab';
  } else if (hoverSegIndex >= 0) {
    const a = pts[hoverSegIndex]!;
    const b = pts[hoverSegIndex + 1]!;
    hoverCursor = Math.abs(b.x - a.x) >= Math.abs(b.y - a.y) ? 'ns-resize' : 'ew-resize';
  }
  return { endpointActive, segmentActive, hoverSegIndex, hoverCursor };
}
