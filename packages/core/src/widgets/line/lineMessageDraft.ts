import { genId } from '../../utils/id';
import type { IDataEngineService, IVmEngineService, LineType } from '../../types';
import type { IAxisAnchor } from '../../types/base';
import type { IHostGeom, IPoint } from '../../common/geometry';
import { routeSelfLoop, type JoinDir } from './lineMath';
import { nodeAnchorPoint } from './lineGeometry';
import {
  axisAnchorWithInset,
  axisPortFor,
  normalizeMessageJoins,
  type ILineDrawPolicy,
} from './lineAxisAnchor';
import { selfLoopSpanOf } from './lineSelfLoopSpan';
import { rotatedRectBounds } from '../../platform/rectEditor/rotateMath';

/**
 * 消息拉线路径（specs/sequence-diagram §4.4 / §4.6，批次 2）：有拉线策略时，
 * LineDrawSession 的终点求解、草稿路由、落定都走这里——通用拉线状态机不认识
 * 「轴」「自消息」。无策略时零参与（既有连线路径逐字节不变）。
 */

/** 消息草稿的事务 origin：Y.UndoManager 只跟踪 origin 为 null 的事务——草稿的创建 /
 *  逐帧移动 / 取消删除都不入撤销栈。落定才以跟踪事务建终线 */
export const LINE_DRAFT_ORIGIN = 'sequence-draft';
/** 自消息的最小纵向间距（§4.6）：routeSelfLoop 对 <8 的重合锚点会撑成 80 的环 */
const SELF_MESSAGE_MIN_GAP = 8;

/** 起点锚定（按下时定格）；port = 起点端口（轴宿主才有） */
export interface IStartAnchor {
  nodeId: string | null;
  join: JoinDir | null;
  point: IPoint;
  port?: number;
}

/** 消息落定读写的草稿字段（终线 = 草稿全量字段 + 重写项） */
export interface IMessageDraft {
  points: Array<[number, number]>;
  startNodeId: string | null;
  endNodeId: string | null;
  startJoin: JoinDir | null;
  lineType: LineType;
}

/** 落定收尾（宿主 LineDrawSession 的回调面） */
export interface IMessageSettleSink {
  onSettled(): void;
  stopCapturing(): void;
  select(id: string): void;
}

export class LineMessageDraft {
  constructor(
    private readonly engine: IDataEngineService,
    private readonly vmEngine: IVmEngineService,
    private readonly sink: IMessageSettleSink,
  ) {}

  /** 落在轴宿主上的终点（§4.4 第 2 步）：跨轴消息钳到起点高度、自消息取指针高度
   *  （钳到轴段内）；join 取朝向起点的一侧（箭头让位方向随 join），端口 = 轴上比例。
   *  点位经宿主锚点单源（vm.getAnchorPoint：终点高度上有激活条时让到条边，与落定
   *  后的重路由同一口径）；vm 缺失回落轴上点 */
  endAnchor(
    axis: IAxisAnchor,
    start: IStartAnchor,
    hitId: string,
    geom: IHostGeom,
    world: IPoint,
    policy: ILineDrawPolicy,
  ): IPoint {
    const self = hitId === start.nodeId;
    const y =
      policy.horizontal && !self
        ? Math.min(axis.bottom, Math.max(axis.top, start.point.y))
        : world.y;
    const endJoin = self ? start.join! : normalizeMessageJoins(start.point, { x: axis.x, y })[1];
    const port = axisPortFor(axis, y);
    return (
      nodeAnchorPoint(this.vmEngine, hitId, geom, endJoin, port) ??
      axisAnchorWithInset(axis, endJoin, port, 0)
    );
  }

  /** 草稿路由：跨轴 = 两点直线预览（horizontal）；同轴 = 自消息环（§4.6；纵向间距
   *  < 8 收成重合两点——不画环，同值写入被数据层跳过）。返回 null = 走通用路由 */
  route(
    policy: ILineDrawPolicy,
    start: IStartAnchor,
    drawingId: string,
    hitId: string,
    node: IHostGeom,
    end: IPoint,
  ): IPoint[] | null {
    if (hitId !== start.nodeId) return policy.horizontal ? [start.point, end] : null;
    if (!policy.selfMessage) return null;
    if (Math.abs(end.y - start.point.y) < SELF_MESSAGE_MIN_GAP) return [start.point, start.point];
    return routeSelfLoop({
      start: start.point,
      startJoin: start.join!,
      end,
      endJoin: start.join!,
      node: rotatedRectBounds(node.rect, node.rotation),
      // 同边多自环嵌套档（§7.5）：预览与落库同源——live 传当帧锚定
      spanScale: selfLoopSpanOf(this.engine, this.vmEngine, drawingId, {
        startNodeId: hitId,
        startJoin: start.join!,
        endNodeId: hitId,
        endJoin: start.join!,
      }),
    });
  }

  /**
   * 落定（§4.4 第 3 步）：终点在另一条轴上 → 跨轴消息（改 STRAIGHT、join 按
   *  方向归一、两点直线）；在同一条轴上且纵向间距 ≥ 8 → 自消息（保留 ELBOWED 自环，
   *  两端 join = 按下侧）；其余取消——时序图没有悬空消息。
   *  落定 = 非跟踪删草稿 + 跟踪事务建终线（一步撤销 = 建出这条消息；撤销不让草稿
   *  复活）；取消 = 非跟踪删除，撤销栈零变化。
   */
  settle(policy: ILineDrawPolicy, draftId: string, draft: IMessageDraft): void {
    const cancel = (): void => {
      this.engine.transact(() => this.engine.removeByIds([draftId]), LINE_DRAFT_ORIGIN);
    };
    const axisOf = (id: string | null): IAxisAnchor | null =>
      id ? (this.vmEngine.getVmById(id)?.getAxisAnchor?.() ?? null) : null;
    const startAxis = axisOf(draft.startNodeId);
    const endAxis = axisOf(draft.endNodeId);
    // 自消息是 4 点环：间距 / 终点端口都按**末点**量（第二点已是第一个拐点）
    const a = draft.points[0];
    const b = draft.points[draft.points.length - 1];
    if (!a || !b || !startAxis || !endAxis) return cancel();
    const self = draft.startNodeId === draft.endNodeId;
    if (self && !(policy.selfMessage && Math.abs(b[1] - a[1]) >= SELF_MESSAGE_MIN_GAP)) {
      return cancel();
    }
    // join 归一：axisJoinFor 取的是指针侧——不归一的话从轴右侧按下、向左画的消息，
    // 箭头会让向远侧。自消息两端同侧 = 按下侧
    const [startJoin, endJoin] = self
      ? [draft.startJoin, draft.startJoin]
      : normalizeMessageJoins({ x: a[0], y: a[1] }, { x: b[0], y: b[1] });
    const finalId = genId();
    this.engine.transact(() => this.engine.removeByIds([draftId]), LINE_DRAFT_ORIGIN);
    this.engine.add({
      ...draft,
      id: finalId,
      startJoin,
      endJoin,
      startPort: axisPortFor(startAxis, a[1]),
      endPort: axisPortFor(endAxis, b[1]),
      // 跨轴消息 = 两点直线；自消息保留草稿的 ELBOWED 自环路由
      lineType: self ? draft.lineType : 'STRAIGHT',
      points: self ? draft.points : [a, b],
    } as never);
    this.sink.onSettled();
    this.sink.stopCapturing();
    this.sink.select(finalId);
  }
}
