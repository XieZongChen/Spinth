import type { IPt, JoinDir } from './lineMathTypes';
import type { LineType, ShapeType } from '../../types';

/**
 * quick-add 宿主契约与组装（自 lineQuickAdd/lineService 拆出，2026-11 审查
 * 返工批——400 行铁律；host 窄面与工厂就近同文件）：
 * - ILineQuickAddHost：LineQuickAdd 经宿主读拉线会话状态/节流通道/会话默认值
 *   （①绘制管线归属宿主——MindNode 模式同款）；
 * - createQuickAddHost：lineService 侧组装（会话通道/浮层收场/会话默认值/
 *   落定重排全部显式依赖注入）。
 */

/** 宿主回调：拉线会话状态与节流通道（①绘制管线归属宿主） */
export interface ILineQuickAddHost {
  /** 开始拉线会话（写 drawingId/startAnchor） */
  beginSession(id: string, anchor: { nodeId: string; join: JoinDir; point: IPt }): void;
  /** 结束会话：flush 节流尾帧 + 清 drawingId（顺序敏感——先 flush 再清） */
  endSession(): void;
  /** 节流落库通道（与 line 工具管线共用 pendingMove/moveTimer） */
  throttledMove(world: { x: number; y: number }): void;
  /** 连线落定（未拖出删除 / 否则保留选中） */
  settle(id: string): void;
  /** 会话期浮层收场 */
  hideOverlays(): void;
  /** 读起点锚（quickAddConnectedShape 用） */
  getStartAnchor(): { nodeId: string; join: JoinDir; point: IPt } | null;
  /** 会话默认线型/线宽（与 line 工具拉线同源——双创建链统一，docs/04 §2） */
  getDefaultLineType(): LineType;
  getDefaultStrokeWidth(): number;
  /** quick-add 落新形状的默认型（组合根注入 ShapeService 会话态） */
  getDefaultShapeType(): ShapeType;
  /** 点击落定重排（与拉线 settle 同源，docs/08 §5 重排触发清单）：建线/连线
   *  落定后全量重排，同边槽位即时物化——否则两条同边 quick-add 线都停在
   *  t=0.5，删除目标形状时才第一次物化 0.4/0.6 分配，幸存线跳槽重路由扭结 */
  onSettled(): void;
}

/** quick-add 宿主组装：session = lineService 的 LineDrawSession
 *  （beginFromQuickAdd/queueMove/settle 与 startAnchor 读取）。 */
export function createQuickAddHost(deps: {
  session: {
    beginFromQuickAdd(id: string, anchor: { nodeId: string; join: JoinDir; point: IPt }): void;
    endSession(): void;
    queueMove(world: { x: number; y: number }): void;
    settle(id: string): void;
    /** LineDrawSession 真实口径（字段可空——quick-add 起点必非空，读取处守卫） */
    startAnchor: { nodeId: string | null; join: JoinDir | null; point: IPt } | null;
  };
  hideOverlays(): void;
  getDefaultLineType(): LineType;
  getDefaultStrokeWidth(): number;
  getDefaultShapeType(): ShapeType;
  onSettled(): void;
}): ILineQuickAddHost {
  return {
    beginSession: (id, anchor) => deps.session.beginFromQuickAdd(id, anchor),
    endSession: () => deps.session.endSession(),
    throttledMove: (world) => deps.session.queueMove(world),
    settle: (id) => deps.session.settle(id),
    hideOverlays: () => deps.hideOverlays(),
    getStartAnchor: () =>
      deps.session.startAnchor as { nodeId: string; join: JoinDir; point: IPt } | null,
    getDefaultLineType: () => deps.getDefaultLineType(),
    getDefaultStrokeWidth: () => deps.getDefaultStrokeWidth(),
    getDefaultShapeType: () => deps.getDefaultShapeType(),
    onSettled: () => deps.onSettled(),
  };
}
