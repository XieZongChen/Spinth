import type {
  IDataEngineService,
  IHistoryService,
  ISelectorService,
  IViewportService,
  IVmEngineService,
  LineType,
  ShapeType,
} from '../../types';
import { LineHoverOverlay, type ILineOverlayHost } from './lineHoverOverlay';
import { LineDrawSession } from './lineDrawSession';
import { LineQuickAdd } from './lineQuickAdd';
import { createQuickAddHost } from './lineQuickAddHost';
import { LineAnchorFollow } from './lineAnchorFollow';
import { LineEndpointDrag } from './lineEndpointDrag';
import { LineSegTextSlide } from './lineSegTextSlide';
import { hitWidget } from './lineHitTest';

/**
 * 连线服务协作者工厂（specs/sequence-diagram §7.1 前置重构，给 LineService 腾
 * 行数）：悬停浮层、拉线状态机与四个手势/路由协作者的构造，一处装配。
 *
 * **只构造、不登记**。释放顺序 = 登记序（`Disposable.dispose` 正向遍历），由
 * `LineService.initialize()` 按原顺序一次性 `addDisposable`（lineServiceWiring.test
 * 锁顺序：quickAdd → anchorFollow → endpointDragCtl → segTextSlide）。
 *
 * 只在 `initialize()` 里调用：构造函数不碰依赖（`lineDefaultType.test` 断言）。
 */

export interface ILineCollaborators {
  overlay: LineHoverOverlay;
  drawSession: LineDrawSession;
  quickAdd: LineQuickAdd;
  anchorFollow: LineAnchorFollow;
  endpointDragCtl: LineEndpointDrag;
  segTextSlide: LineSegTextSlide;
}

export function createLineCollaborators(deps: {
  viewport: IViewportService;
  engine: IDataEngineService;
  vmEngine: IVmEngineService;
  selector: ISelectorService;
  history: IHistoryService;
  /** 悬停浮层的宿主回调（忙态 / 编辑态 / 拉线态 / quick-add 决策）——全部惰性求值 */
  overlayHost: ILineOverlayHost;
  getDefaultLineType(): LineType;
  getDefaultStrokeWidth(): number;
  getDefaultShapeType(): ShapeType;
  /** 网格吸附开关探针（specs/flowchart-closeout §9.2 自由线端点；缺省关） */
  gridSnapOn(): boolean;
  /** 落定重排（拉线 / quick-add / 端点重锚定同源）：settle 事务内调用 = 一步撤销 */
  onSettled(): void;
}): ILineCollaborators {
  const { viewport, engine, vmEngine, selector, history } = deps;
  const overlay = new LineHoverOverlay(viewport, vmEngine, selector, deps.overlayHost);
  const drawSession = new LineDrawSession(viewport, engine, vmEngine, selector, history, {
    overlay,
    getDefaultLineType: () => deps.getDefaultLineType(),
    getDefaultStrokeWidth: () => deps.getDefaultStrokeWidth(),
    // 网格吸附开关探针（specs/flowchart-closeout §9.2 自由线端点；缺省关）
    gridSnapOn: () => deps.gridSnapOn(),
    // 落定重排（specs/flowchart-closeout §7.3）：同边余线让位 + 本线终路由
    // 单源（避障/spread/探针）；settle 事务内调用 = 一步撤销
    onSettled: () => deps.onSettled(),
  });
  const anchorFollow = new LineAnchorFollow(engine, vmEngine, selector);
  return {
    overlay,
    drawSession,
    // host 组装走 lineQuickAdd 侧工厂（2026-11 审查返工：400 行铁律）；会话
    // 通道/会话默认值/点击落定重排（与拉线 settle 同源，docs/08 §5）显式注入
    quickAdd: new LineQuickAdd(
      viewport,
      engine,
      vmEngine,
      selector,
      history,
      createQuickAddHost({
        session: drawSession,
        hideOverlays: () => overlay.hideAll(),
        getDefaultLineType: () => deps.getDefaultLineType(),
        getDefaultStrokeWidth: () => deps.getDefaultStrokeWidth(),
        getDefaultShapeType: () => deps.getDefaultShapeType(),
        onSettled: () => deps.onSettled(),
      }),
    ),
    anchorFollow,
    endpointDragCtl: new LineEndpointDrag(viewport, engine, vmEngine, history, overlay, {
      hitTest: (world) => hitWidget(vmEngine, viewport, world),
      // 网格吸附开关探针（specs/flowchart-closeout §9.2；组合根注入，缺省关）
      gridSnapOn: () => deps.gridSnapOn(),
      // 端点重锚定落定重排（§7.3/§7.5 五轮：同边自环嵌套档全量重算）
      onSettled: () => deps.onSettled(),
    }),
    segTextSlide: new LineSegTextSlide(viewport, engine, vmEngine, history, overlay),
  };
}
