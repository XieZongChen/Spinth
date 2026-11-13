import { Point } from 'pixi.js';
import { Subject } from 'rxjs';
import { markRender } from '../../common/render';
import { unionRects, type IRect } from '../../common/geometry';
import { DRAG_TRACTION_SCREEN } from '../../common/interaction';
import { quantizeGrid } from '../../common/grid';
import type {
  IDataEngineService,
  IHistoryService,
  IPointerEventInfo,
  IViewportService,
  IVmEngineService,
} from '../../types';
import type { SelectionVm } from '../selection/selectionVm';
import type { RefLineService } from '../refLine/refLineService';
export interface DragState {
  startWorld: Point;
  ids: string[];
  /** 按下时元素是否已在选区（未拖动松手 = 单击已选中 → 激活编辑，docs/05 §3） */
  wasSelected: boolean;
  initial: Map<string, IRect>;
  /** 拖拽起点的选区外接矩形（选区框绝对定位基准） */
  initialUnion: IRect;
  moved: boolean;
  /** 最后一帧吸附修正后的位移：松手落库用它，禁止从指针原始差值重算
   *  （否则吸附只作用于视觉、松手跳回未对齐位置——docs/06 §5 视觉=数据 / docs/14 规则 5） */
  lastDx: number;
  lastDy: number;
}

/** 拖拽操作上下文：状态仍归 SelectorService（dragState 创建/清空/isDragging），
 *  ops 只经显式 ctx 读写服务依赖——无状态操作函数（specs/split-large-files §4.5） */
export interface ISelectorDragContext {
  readonly viewport: IViewportService;
  readonly vmEngine: IVmEngineService;
  readonly engine: IDataEngineService;
  readonly history: IHistoryService;
  readonly selectionVm: SelectionVm;
  readonly dragMove$: Subject<void>;
  getRefLine(): RefLineService;
  onDragCommitted(ids: string[], dx: number, dy: number): void;
  syncSelectionVm(): void;
  /** 网格吸附开关读取（specs/flowchart-closeout §9.2；组合根注入 gridSnap 服务） */
  gridSnapOn(): boolean;
}

/** 拖拽态创建（selector.onPointerDown 命中分支尾段）：
 *  initial（per-id）= getLocalRect（commitDrag/预览的输入语义——数据矩形）；
 *  initialUnion = 世界 AABB union（选区框视觉，θ≠0 外接矩形大于数据矩形）。
 *  无有效选中（union 为空）返回 null（主类不建 dragState）。 */
export function createDragState(
  ctx: ISelectorDragContext,
  ids: string[],
  e: IPointerEventInfo,
  wasSelected: boolean,
): DragState | null {
  const initial = new Map<string, IRect>();
  const worldBounds: IRect[] = [];
  for (const id of ids) {
    const vm = ctx.vmEngine.getVmById(id);
    if (vm) {
      initial.set(id, vm.getLocalRect());
      worldBounds.push(vm.getBounds());
    }
  }
  const initialUnion = unionRects(worldBounds);
  if (!initialUnion) return null;
  return {
    startWorld: e.world.clone(),
    ids,
    wasSelected,
    initial,
    initialUnion,
    moved: false,
    lastDx: 0,
    lastDy: 0,
  };
}

/** 拖拽预览帧（selector.onPointerMove 的 dragState 分支）：阻尼判定 → 参考线
 *  吸附 → per-type 平移预览 + 选区框绝对定位（零 Yjs 写，docs/00 铁律 4）。
 *  最后一帧吸附修正写入 state.lastDx/lastDy（松手落库用）。 */
export function applyDragMove(
  ctx: ISelectorDragContext,
  state: DragState,
  e: IPointerEventInfo,
): void {
  const d = state;
  let dx = e.world.x - d.startWorld.x;
  let dy = e.world.y - d.startWorld.y;
  if (!d.moved) {
    if (Math.hypot(dx, dy) < DRAG_TRACTION_SCREEN / (ctx.viewport.vpScale$.value || 1)) return;
    d.moved = true;
  }
  // 参考线吸附（docs/06 §5）：作用于选区外接矩形的期望位移
  const snapped = ctx.getRefLine().snapForDrag(d.initialUnion, dx, dy);
  dx = snapped.dx;
  dy = snapped.dy;
  // 网格吸附（specs/flowchart-closeout §9.2）：优先级「参考线先、网格后」——
  // 命中轴（对齐线或等间距）不量化（可见反馈优先）；量化基准 = 选区外接矩形
  // 左上角（多元素对齐才整齐），修正量写回 lastDx/lastDy（松手落库同源，不会
  // 「松手跳一格」）。等间距命中时 matchedV/H 为空，凭 spacingV/H 让位网格
  if (ctx.gridSnapOn()) {
    if (snapped.matchedV.length === 0 && !snapped.spacingV) {
      dx = quantizeGrid(d.initialUnion.x + dx) - d.initialUnion.x;
    }
    if (snapped.matchedH.length === 0 && !snapped.spacingH) {
      dy = quantizeGrid(d.initialUnion.y + dy) - d.initialUnion.y;
    }
  }
  d.lastDx = dx;
  d.lastDy = dy;
  // 视觉反馈：per-type 平移预览（rect 型 root=init+delta；points 世界坐标型
  // root=delta、几何在 points 上）——选区框统一用初始包络 + 全量 delta 绝对定位
  // （禁止对框做增量累加——多次 pointermove 下会复合漂移，框以倍速飞离形状）
  for (const id of d.ids) {
    const vm = ctx.vmEngine.getVmById(id);
    const init = d.initial.get(id);
    if (vm && init) {
      vm.applyDragPreview(init, dx, dy);
    }
  }
  ctx.selectionVm.moveTo({
    x: d.initialUnion.x + dx,
    y: d.initialUnion.y + dy,
    width: d.initialUnion.width,
    height: d.initialUnion.height,
  });
  ctx.dragMove$.next();
  markRender();
}

/** 拖拽落库（selector.onPointerUp 的 moved 分支）：松手统一落库——一个事务 =
 *  一次撤销（docs/05 §4.3）；per-type 语义（rect 型写 x/y，points 型平移
 *  points）封装在 vm.commitDrag。落库用最后一帧吸附修正后的位移（lastDx/lastDy），
 *  不从指针重算——重算会丢弃吸附，出现「拖拽中对齐、松手跳偏」。
 *  锚定线急切重路由钩子夹在 transact 之后与 stopCapturing 之前（并入同一撤销项）。 */
export function commitDrag(ctx: ISelectorDragContext, state: DragState): void {
  const d = state;
  if (!d.moved) return;
  const dx = d.lastDx;
  const dy = d.lastDy;
  ctx.engine.transact(() => {
    for (const id of d.ids) {
      const init = d.initial.get(id);
      const vm = ctx.vmEngine.getVmById(id);
      if (init && vm) {
        vm.commitDrag(init, dx, dy);
      }
    }
  });
  // 锚定线急切重路由钩子（组合根注入，docs/05 §4.3/§7）：必须夹在 transact
  // 之后（Yjs 观察者相 state 已同步刷新；root 仍携带末帧预览位移 = 提交后
  // 位置，getBounds 直接可用）与 stopCapturing 之前（并入同一撤销项）——
  // 若留给 onStateChanged$ 微任务相（渲染后才广播）会裂成第二个 undo 项
  ctx.onDragCommitted(d.ids, dx, dy);
  ctx.history.stopCapturing();
}

/** 拖拽取消回弹（selector.onPointerCancel 的 dragState 分支）：预览回弹——
 *  root 只改了视觉 position，按 initial 零位移复位（下一帧渲染依数据重画，
 *  此处显式复位防「冻结在预览位直到下次点击」）；吸附参考线收起。 */
export function cancelDrag(ctx: ISelectorDragContext, state: DragState): void {
  for (const id of state.ids) {
    const vm = ctx.vmEngine.getVmById(id);
    const init = state.initial.get(id);
    if (vm && init) vm.applyDragPreview(init, 0, 0);
  }
  ctx.getRefLine().hideMatches();
}
