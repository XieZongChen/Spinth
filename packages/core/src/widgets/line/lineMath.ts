/**
 * 连线路由纯逻辑（docs/08）：锚点计算 + 直线路径 + ELBOWED 正交路由（候选走廊法）
 * + 线上文字定位/镂空切分 + 虚线切分 + 命中检测。全部无状态纯函数。
 *
 * 实现按域拆分（specs/split-large-files §4.1）：本文件是显式 barrel，只
 * re-export 原公开名，包外消费者的 import 路径不变；子模块互相 import 具体
 * 文件、不得 import 本 barrel：
 * - lineMathTypes：IPt / JoinDir
 * - lineGeometry：锚点/命中/裁剪/长度/段几何（最底层）
 * - lineRoute：走廊/绕行/贴边/拐点整理/pinKeepMiddle
 * - linePath：视图语义路径/端点收缩/曲线/ratio 定位/镂空与虚线切分
 * - lineHandles：主段/胶囊/落位槽位/外移点/段滑移
 */

export type { IPt, JoinDir } from './lineMathTypes';

// 旋转数学单源在 rectEditor/rotateMath（docs/05 §8）；此处 re-export 供锚定链消费
export { rotatePointAround, inverseRotatePoint } from '../../platform/rectEditor/rotateMath';

export {
  anchorOf,
  nearestJoin,
  segmentDirection,
  sqDistToSegment,
  polylineHit,
  quantizeJoin,
  segmentIntersectsRect,
  pathLength,
  segmentGeoms,
  r2,
  nodeAnchorPoint,
  nearestSegBody,
  intersectLine,
} from './lineGeometry';
export type { ISegmentGeom } from './lineGeometry';

export {
  NODE_MARGIN,
  ELBOW_RADIUS,
  collectRouteObstacles,
  routeSelfLoop,
  mergeCollinear,
  absorbTinyJogs,
  routeElbow,
  pinKeepMiddle,
} from './lineRoute';
export type { IRouteElbowOptions } from './lineRoute';

export {
  effectivePath,
  LINE_END_GAP,
  insetEnds,
  curveControlPoints,
  flattenCurve,
  pointAtRatio,
  ratioAtPoint,
  slicePathExcludingRect,
  slicePathByDash,
} from './linePath';

export {
  MAJOR_SEG_MIN_SCREEN,
  moveCorner,
  majorSegments,
  CAPSULE_MIN_PIECE_SCREEN,
  QUICK_ADD_GAP,
  BRANCH_STAGGER_GAP,
  branchStride,
  branchSlotOffset,
  capsuleAnchors,
  ANCHOR_DOT_OFFSET,
  dotOffsetCenter,
  SEGMENT_BODY_TOLERANCE,
  SEG_SLIDE_STUB,
  slideSegment,
} from './lineHandles';
