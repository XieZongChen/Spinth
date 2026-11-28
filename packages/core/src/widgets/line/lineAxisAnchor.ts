import type { IHostGeom, IPoint, JoinDir } from '../../common/geometry';
import type { IAxisAnchor } from '../../types/base';
import type { LineData } from '../../types';
import { nearestJoin } from './lineGeometry';
import { LINE_END_GAP } from './linePath';

/**
 * 轴上几何与落点（specs/sequence-diagram §3.2 / §4.2）：连线层的纯函数，生命线
 * 与消息共用。连线层不能反向依赖 sequence，所以轴上几何不放 lifelineGeometry
 * （那里只留「矩形 → 轴」的 lifelineAxis）。
 */

/** 轴上高度 ↔ 点：t ∈ [0,1] 沿轴段插值 */
export function axisAnchorPoint(axis: IAxisAnchor, t: number): IPoint {
  return { x: axis.x, y: axis.top + (axis.bottom - axis.top) * t };
}

/** 指针在轴的哪一侧：p.x ≥ 轴取 right（轴上按下按右侧） */
export function axisJoinFor(axis: IAxisAnchor, p: IPoint): JoinDir {
  return p.x >= axis.x ? 'right' : 'left';
}

/** 端口取 4 位小数：端点拖拽今天写两位小数，两位在 520 高的轴上量化到 5px、
 *  在 1000 高的轴上量化到 10px——「加长保高度」重写端口时消息会可见地跳。
 *  普通件维持两位不变（lineGeometry.r2） */
export function r4(n: number): number {
  // + 0 归一化 -0（Math.round(-1e-10) = -0）：钳到轴顶的端口不落负零
  return Math.round(n * 10000) / 10000 + 0;
}

/** 高度 → 轴上比例（钳到 [0,1]，4 位小数）；退化轴（长 ≤ 0）不产生 NaN */
export function axisPortFor(axis: IAxisAnchor, y: number): number {
  const len = axis.bottom - axis.top;
  return len > 0 ? r4(Math.min(1, Math.max(0, (y - axis.top) / len))) : 0;
}

/** 出线侧的横向符号：right = +1、left = −1、top / bottom = 0 */
function joinSign(join: JoinDir): number {
  return join === 'right' ? 1 : join === 'left' ? -1 : 0;
}

/** 轴锚点：y = 轴上高度；x = 轴 + sign(join) × (barHalf − LINE_END_GAP)。
 *  连线两端视觉各收缩一个留隙（linePath.insetEnds）——锚点向内让出一个留隙后，
 *  线身与箭头恰好停在条边或轴上；不让位则箭头悬在轴外 5px，或被激活条盖住半个
 *  箭头。barHalf = 绑定在本生命线上、且纵向覆盖该高度的激活条的半宽（无则 0） */
export function axisAnchorWithInset(
  axis: IAxisAnchor,
  join: JoinDir,
  t: number,
  barHalf: number,
): IPoint {
  const p = axisAnchorPoint(axis, t);
  return { x: p.x + joinSign(join) * (barHalf - LINE_END_GAP), y: p.y };
}

/** 拉线悬停轴宿主时的反馈点（§4.8）：轴上、指针高度（钳到轴段内）的单点——
 *  消息起点是按下高度，四向连接点无从表达。非轴宿主 / 无轴 / 未给指针位置返回 null */
export function axisHoverPoint(
  vm: { getAxisAnchor?: IAxisHostVm['getAxisAnchor'] } | null | undefined,
  geom: IHostGeom,
  world: IPoint | undefined,
): IPoint | null {
  const axis = isAxisHost(vm) ? vm.getAxisAnchor(geom) : null;
  if (!axis || !world) return null;
  // 反馈点取指针原始高度（不经端口取整）：指示器贴着指针走，不随 r4 量化微跳
  return { x: axis.x, y: Math.min(axis.bottom, Math.max(axis.top, world.y)) };
}

/** 轴宿主的最小形状：实现了 getAxisAnchor 探针（specs/sequence-diagram §4.1） */
export interface IAxisHostVm {
  getAxisAnchor(geom?: IHostGeom): IAxisAnchor | null;
}

/** 是否轴宿主 = 有 getAxisAnchor 探针（服务层不按 type 分支，docs/14 规则 6） */
export function isAxisHost(vm: { getAxisAnchor?: unknown } | null | undefined): vm is IAxisHostVm {
  return typeof vm?.getAxisAnchor === 'function';
}

/**
 * 拉线落点：轴宿主按指针所在侧选边、端口 = 轴上比例（r4）；其他宿主 = nearestJoin
 * + 无端口——与轴锚定之前逐字节一致。geom 透传给探针（急刻重路由以落库后的
 * 权威几何为准）。调用方只在 port !== undefined 时才写 startPort / endPort 键
 * （写 undefined 会在 Yjs 里留下键）。
 */
export function resolveAnchorPick(
  vm: { getAxisAnchor?: IAxisHostVm['getAxisAnchor'] } | null | undefined,
  geom: IHostGeom,
  p: IPoint,
): { join: JoinDir; port: number | undefined } {
  const axis = isAxisHost(vm) ? vm.getAxisAnchor(geom) : null;
  if (!axis) return { join: nearestJoin(geom.rect, p, geom.rotation), port: undefined };
  return { join: axisJoinFor(axis, p), port: axisPortFor(axis, p.y) };
}

/**
 * 拉线策略（specs/sequence-diagram §4.3）：有策略才走消息路径，缺省 undefined =
 * 既有连线路径。时序图工具按图元种类选用预设（SequenceService 注入）。
 */
export interface ILineDrawPolicy {
  /** 建线样式预设（字段优先于会话默认）：线型 / 箭头 / 虚线 / 线上文字侧别 */
  style: Partial<Pick<LineData, 'lineType' | 'startArrow' | 'endArrow' | 'dashed' | 'textSide'>>;
  /** 终点高度锁定为起点高度（钳到目标轴范围） */
  horizontal: boolean;
  /** 两端必须落在轴宿主上：起点不是 → 不建线；终点不是 → 松手取消草稿 */
  requireAxisTargets: boolean;
  /** 忽略控件命中，两端都落自由点（分隔线） */
  freeEnds: boolean;
  /** 同一宿主松手 = 自消息：纵向间距 ≥ 8 落 ELBOWED 自环，否则取消 */
  selfMessage: boolean;
}

const MESSAGE_POLICY_BASE = {
  horizontal: true,
  requireAxisTargets: true,
  freeEnds: false,
  selfMessage: true,
} as const;

/** 同步消息：草稿按 ELBOWED 建（自消息需要自环路由），跨轴落定时改 STRAIGHT；实心
 *  箭头；标签在线上方（消息的线上文字不骑线镂空，§4.9） */
export const MESSAGE_SYNC_POLICY: ILineDrawPolicy = {
  style: {
    lineType: 'ELBOWED',
    startArrow: 'none',
    endArrow: 'solid',
    dashed: false,
    textSide: 'above',
  },
  ...MESSAGE_POLICY_BASE,
};
/** 异步消息：开放箭头 */
export const MESSAGE_ASYNC_POLICY: ILineDrawPolicy = {
  ...MESSAGE_SYNC_POLICY,
  style: { ...MESSAGE_SYNC_POLICY.style, endArrow: 'arrow' },
};
/** 返回消息：开放箭头 + 虚线 */
export const MESSAGE_RETURN_POLICY: ILineDrawPolicy = {
  ...MESSAGE_ASYNC_POLICY,
  style: { ...MESSAGE_ASYNC_POLICY.style, dashed: true },
};

/** join 归一（specs/sequence-diagram §4.4）：跨轴消息起点 = 去向侧、终点 = 来向侧。
 *  箭头让位方向由 join 决定，而 axisJoinFor 取的是指针侧——不归一的话从轴右侧
 *  按下、向左画的消息，箭头会让向远侧 */
export function normalizeMessageJoins(start: IPoint, end: IPoint): [JoinDir, JoinDir] {
  return end.x >= start.x ? ['right', 'left'] : ['left', 'right'];
}
