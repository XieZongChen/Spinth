import { Disposable } from '../../base/disposable';
import type { IHostGeom, IRect } from '../../common/geometry';
import type { ISelectorService, IVmEngineService, IViewportService } from '../../types';
import { capsuleAnchors, outlineAnchorsOf, type IPt, type JoinDir } from './lineMath';
import {
  dotSnapshots,
  effectiveLinePts,
  JOINS,
  lineAnchorFlags,
  nearestDot,
  resolveLineHover,
} from './lineHoverMath';
import { LineAnchorIndicator } from './lineAnchorIndicator';
import { LineEndpointHandles } from './lineEndpointHandles';
import { LineSegmentHandles } from './lineSegmentHandles';
import { LineGhostPreview } from './lineGhostPreview';
import type { LineVm } from './lineVm';

/**
 * 连线悬停/选中浮层协作者（自 lineService 拆出，2026-10-05 A1 整理批刀 2）：
 * 统一持有四个浮层渲染件（指示器/端点圆/段条/幽灵预览）与全部探针快照，
 * 承载 refreshHandles / followQuickDots / onCursorHover / 显隐复位原语。
 * 会话状态（drawingId/editingId/endpointDrag/segSlide…）归属宿主——经
 * ILineOverlayHost 的窄语义查询读取；quick-add 决策经 host 回调转发
 * （刀 3 后指向 LineQuickAdd 协作者，本类不感知）。
 * 悬停命中与外移点几何单源在 lineHoverMath（纯函数）。
 */

/** 宿主回调：会话状态查询 + quick-add 决策转发（MindNodeEditor 模式窄面） */
export interface ILineOverlayHost {
  /** 任意手势/编辑会话进行中（悬停应让路清场） */
  isSessionBusy(): boolean;
  /** 文字编辑中（手柄保持全收） */
  isEditing(): boolean;
  /** 拉线进行中（refreshHandles 收线） */
  isDrawing(): boolean;
  /** quick-add 决策（hover 预览与点击共用——宿主转发 LineQuickAdd） */
  quickAddPlanFor(
    srcId: string,
    sb: IRect,
    anchor: IPt,
    join: JoinDir,
  ): { kind: 'connect'; route: IPt[] } | { kind: 'create'; rect: IRect; route: IPt[] };
}

export class LineHoverOverlay extends Disposable {
  private readonly indicator: LineAnchorIndicator;
  private readonly endpointHandles: LineEndpointHandles;
  private readonly segmentHandles: LineSegmentHandles;
  private readonly ghostPreview: LineGhostPreview;
  /** 选中目标的几何变化订阅（连线=端点手柄刷新 / 形状=连接点跟随双触发） */
  private targetSub: { unsubscribe(): void } | null = null;
  /** 线手柄 hover 临时光标已设置（复位用 flag——避免每 move 覆盖 pixi cursor） */
  private hoverCursorSet = false;

  private anchorHoverSnapshot: Array<{ x: number; y: number }> | null = null;
  private anchorActiveSnapshot: number | null = null;
  private segmentSnapshot: Array<{ x: number; y: number }> | null = null;
  private segmentActiveSnapshot: number | null = null;
  private endpointActiveSnapshot: number | null = null;
  private hoverTarget: { id: string; geom: IHostGeom } | null = null;

  constructor(
    private readonly viewport: IViewportService,
    private readonly vmEngine: IVmEngineService,
    private readonly selector: ISelectorService,
    private readonly host: ILineOverlayHost,
  ) {
    super();
    this.indicator = new LineAnchorIndicator(viewport.optionLayer);
    this.endpointHandles = new LineEndpointHandles(viewport.optionLayer);
    this.segmentHandles = new LineSegmentHandles(viewport.optionLayer);
    this.ghostPreview = new LineGhostPreview(viewport.optionLayer);
  }

  /** 悬停 window 监听 + 拖拽跟随订阅（宿主 initialize 时调用一次） */
  initialize(): void {
    this.addDisposable(() => this.indicator.destroy());
    this.addDisposable(() => this.endpointHandles.destroy());
    this.addDisposable(() => this.segmentHandles.destroy());
    this.addDisposable(() => this.ghostPreview.destroy());
    // 拖动选中形状时四向连接点跟随（拖拽期 onStateChanged$ 不发射、只改视觉，
    // 须挂 dragMove$ 通道；用户实测「拖动图形时四个触发点不跟随」）
    this.addDisposable(this.selector.dragMove$.subscribe(() => this.followQuickDots()));
    if (typeof window !== 'undefined') {
      window.addEventListener('pointermove', this.onCursorHover, { passive: true });
      this.addDisposable(() => window.removeEventListener('pointermove', this.onCursorHover));
    }
    this.addDisposable(() => this.targetSub?.unsubscribe());
  }

  // ---------- 探针快照（宿主 debug getter 转发） ----------

  get anchorHoverDebug(): Array<{ x: number; y: number }> | null {
    return this.anchorHoverSnapshot;
  }
  get anchorActiveDebug(): number | null {
    return this.anchorActiveSnapshot;
  }
  get segmentSnapshotDebug(): Array<{ x: number; y: number }> | null {
    return this.segmentSnapshot;
  }
  get segmentActiveDebug(): number | null {
    return this.segmentActiveSnapshot;
  }
  get endpointActiveDebug(): number | null {
    return this.endpointActiveSnapshot;
  }
  get ghostVisible(): boolean {
    return this.ghostPreview.visible;
  }
  get ghostMode(): 'rect' | 'line' | null {
    return this.ghostPreview.mode;
  }
  get ghostBounds(): string {
    return this.ghostBoundsOf();
  }
  private ghostBoundsOf(): string {
    const g = (
      this.ghostPreview as unknown as {
        g?: { bounds: { rectangle: { x: number; y: number; width: number; height: number } } };
      }
    ).g;
    const r = g?.bounds.rectangle;
    return r
      ? `${[r.x, r.y, r.width, r.height].map((v) => v.toFixed(0))} vis=${this.ghostPreview.visible}`
      : 'empty';
  }

  // ---------- 选中态/悬停主流程（原 lineService 组⑥） ----------

  refreshHandles(ids: string[]): void {
    this.targetSub?.unsubscribe();
    this.targetSub = null;
    // 统一先收线手柄（选中目标切换残留的根因修复：非 LINE 分支此前漏 hide，
    // 选中线后点/拖别的元素——线端点圆+段条残留在画布上）
    this.hideHandles();
    // 文字编辑会话：手柄保持全收（编辑器接管交互；打字落库触发的
    // onStateChanged$ 不得把手柄 show 回来——2026-10-02 实测编辑框内
    // 胶囊/端点压字）。恢复由 exitEdit 负责
    if (this.host.isEditing()) return;
    if (ids.length !== 1 || this.host.isDrawing()) {
      this.hideAll();
      return;
    }
    const first = this.vmEngine.getVmById(ids[0]!);
    if (!first) {
      this.hideAll();
      return;
    }
    if (first.type === 'LINE') {
      // 单选连线：端点手柄（拖拽重锚定/解绑）+ 段中点手柄（批次 3 选中态复刻）
      const lvm = first as LineVm;
      const update = (): void => {
        if (this.host.isEditing()) return; // 编辑期 targetSub 重入守卫（同上）
        const pts = effectiveLinePts(lvm.state);
        if (pts.length < 2) return;
        const scale = this.viewport.vpScale$.value || 1;
        this.endpointHandles.show([pts[0]!, pts[pts.length - 1]!], scale);
        // 拐点手柄（G-11）：仅 ELBOWED 且 ≥3 点（两点的直线无内部拐点）
        const corners =
          (lvm.state.lineType ?? 'ELBOWED') === 'ELBOWED' && pts.length >= 3
            ? pts.slice(1, -1)
            : null;
        this.showSegmentHandles(pts, scale, null, lvm, corners);
      };
      update();
      this.targetSub = lvm.onStateChanged$.subscribe(() => update());
      return;
    }
    // PEN 不出连接点/快捷创建（2026-10-08 用户拍板：画笔元素不应有快捷创建；
    // 选中画笔只留选中框，无手柄无四点）
    if (first.type === 'PEN') {
      this.hideAll();
      return;
    }
    // 旋转件不出四点（docs/05 §8 降级项：quick-add/连接点系对旋转件整体禁用；
    // 既有锚定线跟随不受影响——锚定链 θ 感知）
    if (first.getRotation() !== 0) {
      this.hideAll();
      return;
    }
    // 非 LINE 形状（docs/08 §10 批次 2，参考同款）：四向连接点**常显**——
    // 选中态视觉的一部分（非悬停提示）；快照 = 轮廓锚点外移点（与抓取判定同坐标）
    const geom = first.getHostGeom();
    const anchors = outlineAnchorsOf(first, geom);
    this.indicator.show(anchors, geom);
    this.hoverTarget = { id: first.id, geom };
    this.anchorHoverSnapshot = dotSnapshots(
      anchors,
      geom.rotation,
      this.viewport.vpScale$.value || 1,
    );
    this.anchorActiveSnapshot = null;
    this.ghostPreview.hide();
    // 模型几何变化（拖拽落库/键盘微移/undo/远端）→ 四点跟随
    this.targetSub = first.onStateChanged$.subscribe(() => this.followQuickDots());
  }

  /** 四向外移点坐标快照与最近点几何单源在 lineHoverMath（dotSnapshots/nearestDot） */

  /**
   * 选中形状的四向连接点跟随（三通道共用）：selector 拖拽（dragMove$）、
   * rectEditor 缩放（resizeMove$，组合根接线）、模型几何变化（onStateChanged$）。
   * 拖拽/缩放期 getBounds() 对预览位置敏感——四点贴着视觉矩形走；
   * 高亮/影子由 onCursorHover 管理（手势期 busy 分支已清，这里只管点位）。
   */
  followQuickDots(): void {
    const sel = this.selector.selected$.value;
    if (sel.length !== 1 || !this.hoverTarget || sel[0] !== this.hoverTarget.id) return;
    const vm = this.vmEngine.getVmById(sel[0]!);
    if (!vm || vm.type === 'LINE') return;
    // 宿主被旋转（手势/命令）→ 四点收起（refreshHandles 同款禁用口径）
    if (vm.getRotation() !== 0) {
      this.hideAll();
      return;
    }
    const geom = vm.getHostGeom();
    const anchors = outlineAnchorsOf(vm, geom);
    this.indicator.show(anchors, geom, this.anchorActiveSnapshot);
    this.hoverTarget = { id: vm.id, geom };
    this.anchorHoverSnapshot = dotSnapshots(
      anchors,
      geom.rotation,
      this.viewport.vpScale$.value || 1,
    );
  }

  /**
   * cursor 模式指针移动（docs/08 §10 批次 2，参考同款状态机）：
   * - 四向连接点由选中态常显（refreshHandles），这里只管「高亮 + 影子」；
   * - 指针靠近某外移点（≤12px）→ 该侧点放大（activeIndex）+ 影子预览
   *   （quick-add 的连线+幽灵形状，源尺寸）；
   * - 离开抓取半径 → 点复原、影子收起（四点仍常显）。
   */
  private readonly onCursorHover = (e: PointerEvent): void => {
    const mode = this.viewport.cursorMode$.value;
    if (mode === 'line') return; // line 工具悬停由 line 模式分支驱动
    if (mode !== 'cursor' || this.host.isSessionBusy()) {
      this.clearQuickAnchor();
      return;
    }
    const sel = this.selector.selected$.value;
    // 单选连线（批次 3 选中态复刻）：端点/段中点 hover 高亮——与快捷创建点
    // 同一套圆点交互语言（距端点/段中点 ≤12/scale 放大 1.25×，离开放大复原）
    if (sel.length === 1) {
      const lvm = this.vmEngine.getVmById(sel[0]!);
      if (lvm?.type === 'LINE') {
        const line = lvm as LineVm;
        const pts = effectiveLinePts(line.state);
        if (pts.length >= 2) {
          const world = this.viewport.clientToWorld(e.clientX, e.clientY);
          const scale = this.viewport.vpScale$.value || 1;
          const hit = resolveLineHover(
            pts,
            line.state.lineType ?? 'ELBOWED',
            line.knockoutRectDebug,
            world,
            scale,
            // 近形禁拖（2026-11）：锚定端相邻段不高亮不出光标（与抓取同源）
            lineAnchorFlags(line.state),
          );
          this.endpointHandles.show([pts[0]!, pts[pts.length - 1]!], scale, hit.endpointActive);
          this.showSegmentHandles(pts, scale, hit.segmentActive, line);
          this.endpointActiveSnapshot = hit.endpointActive;
          // cursor 反馈（判定单源 lineHoverMath）：端点 = grab（拖拽重锚定）、
          // 段身 = 拖动方向（法向）的双向箭头；离开恢复模式默认
          if (hit.hoverCursor) {
            this.hoverCursorSet = true;
            this.viewport.setHoverCursor(hit.hoverCursor);
          } else {
            this.resetHoverCursor();
          }
          return;
        }
      }
    }
    this.resetHoverCursor(); // 非 LINE 路径：线 hover 临时光标若在位则复原（仅一次）
    const target = sel.length === 1 ? this.hoverTarget : null;
    if (!target || sel[0] !== target.id) {
      this.clearQuickAnchor();
      return;
    }
    const world = this.viewport.clientToWorld(e.clientX, e.clientY);
    const scale = this.viewport.vpScale$.value || 1;
    // 轮廓锚点集合（与快照/抓取/落线起点同源）；最近外移点（≤抓取半径
    // 12/scale = hover 命中，与按下抓取 maybeShapeAnchorGrab 同口径）
    const anchors = outlineAnchorsOf(this.vmEngine.getVmById(target.id), target.geom);
    const nearest = nearestDot(anchors, world, scale);
    if (nearest.d <= 12 / scale) {
      const anchor = anchors[JOINS.indexOf(nearest.j)]!;
      const sb = this.vmEngine.getVmById(target.id)?.getBounds() ?? null;
      const sbFull = sb ?? { x: anchor.x, y: anchor.y, width: 120, height: 80 };
      // 预览即结果（quickAddPlan 与点击共用）：只连线 = 灰线连已有形状；
      // 建新形状（正对/交替错开）= 幽灵矩形画实际落位 + routeElbow 折线
      const plan = this.host.quickAddPlanFor(target.id, sbFull, anchor, nearest.j);
      if (plan.kind === 'connect') this.ghostPreview.showRoute(plan.route);
      else this.ghostPreview.showAt(plan.rect, plan.route);
      this.anchorActiveSnapshot = JOINS.indexOf(nearest.j);
    } else {
      this.clearQuickAnchor();
    }
    // 四点常显 + 指针贴近外移点时高亮
    this.indicator.show(anchors, target.geom, this.anchorActiveSnapshot);
    this.anchorHoverSnapshot = dotSnapshots(anchors, target.geom.rotation, scale);
  };

  /** 外移点中心单源在 lineHoverMath.dotCenter（overlay 调用处传 scale） */

  private clearQuickAnchor(): void {
    this.ghostPreview.hide();
    this.anchorActiveSnapshot = null;
    this.resetHoverCursor();
  }

  /** 线手柄 hover 临时光标复位（仅本类设置过才恢复——不覆盖 pixi 对
   *  可交互对象设置的 cursor，如缩放手柄 ns-resize） */
  private resetHoverCursor(): void {
    if (!this.hoverCursorSet) return;
    this.hoverCursorSet = false;
    this.viewport.setHoverCursor(null);
  }

  // ---------- 显隐复位原语（手势组/编辑会话共用） ----------

  /** 全部浮层收场（选中消失/拉线期/quick-add 手势收尾） */
  hideAll(): void {
    this.indicator.hide();
    this.ghostPreview.hide();
    this.segmentHandles.hide();
    this.endpointHandles.hide(); // 收线场景两类手柄对称（此前漏收端点圆）
    this.segmentSnapshot = null;
    this.segmentActiveSnapshot = null;
    this.endpointActiveSnapshot = null;
    this.hoverTarget = null;
    this.anchorHoverSnapshot = null;
    this.anchorActiveSnapshot = null;
  }

  /** 线手柄 + 快照全收（进入编辑 / 进入端点/段拖拽手势——编辑期与手势期
   *  手柄语义相同：路由将变，旧手柄失效） */
  hideHandles(): void {
    this.endpointHandles.hide();
    this.segmentHandles.hide();
    this.segmentSnapshot = null;
    this.segmentActiveSnapshot = null;
    this.endpointActiveSnapshot = null;
  }

  /** 段手柄显示 + 探针快照（锚点 = capsuleAnchors 单一事实源：无字主段
   *  中点 / 有字文字两侧各一，vm 提供 knockout 单源（最近一次 drawLine）；
   *  anchored 同源于 vm.state——锚定端相邻段不出胶囊，2026-11 近形禁拖） */
  showSegmentHandles(
    pts: IPt[],
    scale: number,
    activeIndex: number | null = null,
    vm?: LineVm,
    corners?: readonly IPt[] | null,
  ): void {
    const knockout = vm ? vm.knockoutRectDebug : null;
    const anchored = vm ? lineAnchorFlags(vm.state) : undefined;
    this.segmentHandles.show(pts, scale, activeIndex, knockout, corners ?? null, anchored);
    this.segmentSnapshot = capsuleAnchors(pts, scale, knockout, anchored).map(({ geom }) => ({
      x: geom.mid.x,
      y: geom.mid.y,
    }));
    this.segmentActiveSnapshot = activeIndex;
  }

  hideSegmentHandles(): void {
    this.segmentHandles.hide();
  }

  /** 端点手柄显示（拖拽重锚定中跟随预览路由） */
  showEndpointHandles(pts: [IPt, IPt], scale: number, activeIndex?: number | null): void {
    this.endpointHandles.show(pts, scale, activeIndex ?? null);
  }

  hideEndpointHandles(): void {
    this.endpointHandles.hide();
  }

  /** 绘制/端点拖拽的吸附反馈：指示器紧贴轮廓锚点（outside:false）+ 锚点快照。
   *  vmId 缺失（极端时序）回退 bbox 锚点——快照语义不变（E2E 探针消费）。 */
  showDrawFeedback(vmId: string | null, geom: IHostGeom, activeIndex: number | null): void {
    const anchors = outlineAnchorsOf(vmId ? this.vmEngine.getVmById(vmId) : null, geom);
    this.indicator.show(anchors, geom, activeIndex, { outside: false });
    this.anchorHoverSnapshot = anchors.map((p) => ({ x: p.x, y: p.y }));
    this.anchorActiveSnapshot = activeIndex;
  }

  hideDrawFeedback(): void {
    this.indicator.hide();
    this.anchorHoverSnapshot = null;
    this.anchorActiveSnapshot = null;
  }
}
