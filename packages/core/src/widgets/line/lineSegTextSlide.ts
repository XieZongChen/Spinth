import { Disposable } from '../../base/disposable';
import type {
  IDataEngineService,
  IHistoryService,
  IVmEngineService,
  IViewportService,
} from '../../types';
import {
  capsuleAnchors,
  effectivePath,
  mergeCollinear,
  nearestSegBody,
  ratioAtPoint,
  r2,
  SEGMENT_BODY_TOLERANCE,
  slideSegment,
} from './lineMath';
import type { LineVm } from './lineVm';
import type { LineHoverOverlay } from './lineHoverOverlay';
import type { Point } from 'pixi.js';

/**
 * 线上文字/段滑移协作者（自 lineService 拆出，2026-10-05 A1 整理批刀 6）：
 * - 文字滑移（批次 3，docs/08 §6）：按住文字沿路径拖动 → textRatio 视觉
 *   跟随（vm.previewTextRatio 零模型写），松手落库一次；
 * - 段滑移（批次 3 waypoint，docs/08 §10）：按住段身沿法向平移该段，
 *   松手单事务落库 points + pinned。
 * 两者均经 handleGestureDown 分发（grab 公开）；pointercancel 走 Up 同款
 * 收尾（moved<4 均无副作用，对打断安全，外部审查 S1）。
 */

export class LineSegTextSlide extends Disposable {
  /** 文字滑移会话 */
  private textDrag: {
    id: string;
    downClient: { x: number; y: number };
    downWorld: { x: number; y: number };
    lastRatio: number | null;
  } | null = null;
  /** 段滑移会话 */
  private segSlide: {
    id: string;
    segIndex: number;
    downClient: { x: number; y: number };
    downWorld: { x: number; y: number };
    /** 按下时的模型点快照（slideSegment 纯函数基准，无增量累积） */
    origPts: Array<{ x: number; y: number }>;
    /** 最近一帧法向位移（松手落库用） */
    lastOffset: number;
  } | null = null;

  constructor(
    private readonly viewport: IViewportService,
    private readonly engine: IDataEngineService,
    private readonly vmEngine: IVmEngineService,
    private readonly history: IHistoryService,
    private readonly overlay: LineHoverOverlay,
  ) {
    super();
  }

  /** 段滑移会话进行中（宿主手势守卫/悬停抑制读） */
  get segSlideActive(): boolean {
    return this.segSlide !== null;
  }

  /**
   * 文字滑移抓取（handleGestureDown 分发）：按住线上文字 → 沿路径拖动改
   * textRatio；位移 < 4px = 点击无语义（2026-09-30 拍板：双击连线才进编辑）。
   */
  maybeTextSlideGrab(id: string, world: { x: number; y: number }): boolean {
    const vm = this.vmEngine.getVmById(id) as LineVm | undefined;
    if (!vm || !vm.hitTestText(world as Point)) return false;
    this.textDrag = {
      id,
      downClient: this.viewport.worldToClient(world),
      downWorld: { x: world.x, y: world.y },
      lastRatio: null,
    };
    window.addEventListener('pointermove', this.textDragMove);
    window.addEventListener('pointerup', this.textDragUp, { once: true });
    // pointercancel → Up 同款收尾（moved<4 本就无操作，对打断安全，外部审查 S1）
    window.addEventListener('pointercancel', this.textDragUp);
    return true;
  }

  private readonly textDragMove = (e: PointerEvent): void => {
    const d = this.textDrag;
    if (!d) return;
    const vm = this.vmEngine.getVmById(d.id) as LineVm | undefined;
    if (!vm) return;
    const world = this.viewport.clientToWorld(e.clientX, e.clientY);
    const pts = effectivePath(
      vm.state.points.map((p) => ({ x: p[0], y: p[1] })),
      vm.state.lineType ?? 'ELBOWED',
    );
    // 钳制 [0.05, 0.95]：文字不骑在端点上压箭头（schema 仍放行 0~1，
    // 这是交互层视觉规格——docs/08 §6 批次 3）
    const ratio = Math.min(0.95, Math.max(0.05, ratioAtPoint(pts, world)));
    d.lastRatio = ratio;
    vm.previewTextRatio(ratio);
  };

  private readonly textDragUp = (e: PointerEvent): void => {
    window.removeEventListener('pointermove', this.textDragMove);
    window.removeEventListener('pointerup', this.textDragUp); // once 监听显式移除（cancel 路径防泄漏）
    window.removeEventListener('pointercancel', this.textDragUp);
    const d = this.textDrag;
    this.textDrag = null;
    if (!d) return;
    const vm = this.vmEngine.getVmById(d.id) as LineVm | undefined;
    const model = this.engine.getModelById(d.id);
    if (!vm || !model) return;
    const moved = Math.hypot(e.clientX - d.downClient.x, e.clientY - d.downClient.y) >= 4;
    if (!moved) return; // 单击无语义（2026-09-30 拍板：双击连线才进文字编辑）
    if (d.lastRatio === null) return;
    model.update({ textRatio: d.lastRatio } as never);
    this.history.stopCapturing();
  };

  /**
   * 段滑移抓取（批次 3 waypoint，docs/08 §10）：
   * - capsuleOnly：距 majorSegments **段中点** ≤12/scale（胶囊手柄显式区域——
   *   handleGestureDown 里优先于文字 bbox，点手柄=拖段不进文字编辑）；
   * - 否则：距段身 ≤8/scale（参考视频对齐——线身任意点按住即拖）。
   * 沿法向拖动平移该段；首末段两档（长段拆几字形保正交/短段斜连——
   * slideSegment）；STRAIGHT/CURVE 无段语义不滑。
   */
  maybeSegmentSlideGrab(id: string, world: { x: number; y: number }, capsuleOnly = false): boolean {
    const vm = this.vmEngine.getVmById(id) as LineVm | undefined;
    if (!vm || (vm.state.lineType ?? 'ELBOWED') !== 'ELBOWED') return false;
    const pts = effectivePath(
      vm.state.points.map((p) => ({ x: p[0], y: p[1] })),
      vm.state.lineType ?? 'ELBOWED',
    );
    const scale = this.viewport.vpScale$.value || 1;
    let segIndex = -1;
    if (capsuleOnly) {
      const grab = 12 / scale;
      let bestD = Infinity;
      // 抓取判定与胶囊所见同源（capsuleAnchors：有字 = 文字两侧双胶囊锚点）
      capsuleAnchors(pts, scale, vm.knockoutRectDebug).forEach(({ index, geom }) => {
        const d = Math.hypot(geom.mid.x - world.x, geom.mid.y - world.y);
        if (d <= grab && d < bestD) {
          bestD = d;
          segIndex = index; // 真实段号（slideSegment 口径）
        }
      });
    } else {
      const seg = nearestSegBody(pts, world, SEGMENT_BODY_TOLERANCE / scale);
      segIndex = seg?.index ?? -1;
    }
    if (segIndex < 0) return false;
    this.segSlide = {
      id,
      segIndex, // 真实段号（slideSegment 口径）
      downClient: this.viewport.worldToClient(world),
      downWorld: { x: world.x, y: world.y },
      origPts: pts.map((p) => ({ ...p })),
      lastOffset: 0,
    };
    this.overlay.hideSegmentHandles(); // 拖拽中段条由预览路由接管（每帧跟随新段）
    window.addEventListener('pointermove', this.segSlideMove);
    window.addEventListener('pointerup', this.segSlideUp, { once: true });
    // pointercancel → Up 同款收尾（moved<4 仅恢复段条，对打断安全，外部审查 S1）
    window.addEventListener('pointercancel', this.segSlideUp);
    return true;
  }

  private readonly segSlideMove = (e: PointerEvent): void => {
    const d = this.segSlide;
    if (!d) return;
    const vm = this.vmEngine.getVmById(d.id) as LineVm | undefined;
    if (!vm) return;
    const world = this.viewport.clientToWorld(e.clientX, e.clientY);
    // 平移量 = 指针位移在被拖段法向上的投影（对按下基准绝对计算——不增量累积）
    const a = d.origPts[d.segIndex]!;
    const b = d.origPts[d.segIndex + 1]!;
    const len = Math.hypot(b.x - a.x, b.y - a.y) || 1;
    const nx = -(b.y - a.y) / len;
    const ny = (b.x - a.x) / len;
    const offset = (world.x - d.downWorld.x) * nx + (world.y - d.downWorld.y) * ny;
    d.lastOffset = offset;
    const next = slideSegment(d.origPts, d.segIndex, offset);
    vm.previewRoute(next); // 视觉预览零模型写（docs/00 铁律 4）——drawLine 已更新 knockout
    this.overlay.showSegmentHandles(next, this.viewport.vpScale$.value || 1, null, vm); // 胶囊跟随预览（有字=两侧跟随）
  };

  private readonly segSlideUp = (e: PointerEvent): void => {
    window.removeEventListener('pointermove', this.segSlideMove);
    window.removeEventListener('pointerup', this.segSlideUp); // once 监听显式移除（cancel 路径防泄漏）
    window.removeEventListener('pointercancel', this.segSlideUp);
    const d = this.segSlide;
    this.segSlide = null;
    if (!d) return;
    const vm = this.vmEngine.getVmById(d.id) as LineVm | undefined;
    const model = this.engine.getModelById(d.id);
    if (!vm || !model) return;
    const moved = Math.hypot(e.clientX - d.downClient.x, e.clientY - d.downClient.y) >= 4;
    if (!moved) {
      // 点击无语义，但恢复段条——grab 时已 hide（2026-09-30 用户实测：单击
      // 线身后段条消失且不再出现，须重新选中才恢复——落库路径由 targetSub
      // 几何订阅重显，仅此路径漏）；端点手柄未被 hide 无需恢复
      const cur = effectivePath(
        vm.state.points.map((p) => ({ x: p[0], y: p[1] })),
        vm.state.lineType ?? 'ELBOWED',
      );
      if (cur.length >= 2)
        this.overlay.showSegmentHandles(cur, this.viewport.vpScale$.value || 1, null, vm);
      return;
    }
    // 单事务落库 points + pinned（一次撤销）；mergeCollinear 清滑移可能产生的
    // 重复/共线冗余点（段被滑到与相邻段平齐时交点会与端点重合——零长段积累）
    const next = mergeCollinear(slideSegment(d.origPts, d.segIndex, d.lastOffset)).map(
      (p) => [r2(p.x), r2(p.y)] as [number, number],
    );
    model.update({ points: next, pinned: true } as never);
    this.history.stopCapturing();
  };
}
