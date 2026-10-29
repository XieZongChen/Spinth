import { Container, Point, type Renderer } from 'pixi.js';
import { Viewport } from 'pixi-viewport';
import { BehaviorSubject } from 'rxjs';
import { Disposable } from '../../base/disposable';
import { markRender } from '../../common/render';
import type { IPoint, IRect } from '../../common/geometry';
import { isInteractiveUiTarget } from '../keyboard/shortcuts';
import type { CursorMode, IPointerHandlers, IViewportService } from '../../types';
import { BoardApplication } from './boardApplication';
import { ViewportPointerInput } from './viewportPointerInput';
import { ViewportZoom, MIN_SCALE, MAX_SCALE } from './viewportZoom';

declare module 'pixi.js' {
  interface Container {
    /** widgetLayer 排序键（fractional indexing 字符串，字典序即渲染序） */
    zOrder?: string;
  }
}

/**
 * 视口服务（docs/03 §4-§7）：pixi-viewport 封装、分层、zOrder 物理排序、
 * 全局指针分发（工具状态机）、视口状态流。
 */
export class ViewportService extends Disposable implements IViewportService {
  private boardApp!: BoardApplication;
  private viewport!: Viewport;
  private readonly _widgetLayer = new Container();
  /** 控件层（导出 target 等离线渲染消费——接口暴露，optionLayer 对称） */
  get widgetLayer(): Container {
    return this._widgetLayer;
  }
  readonly optionLayer = new Container();
  private resizeObserver: ResizeObserver | null = null;

  /** 指针输入与相机缩放协作者（initialize 时创建并绑定；监听释放随 Disposable） */
  private pointerInput!: ViewportPointerInput;
  private zoom!: ViewportZoom;

  /** 物理断网判定（组合根注入 NetworkService.editBlocked$；默认直读 navigator） */
  isEditBlocked: () => boolean = () =>
    typeof navigator !== 'undefined' ? !navigator.onLine : false;
  private prevModeBeforeSpace: CursorMode | null = null;

  readonly cursorMode$ = new BehaviorSubject<CursorMode>('cursor');
  readonly vpScale$ = new BehaviorSubject(1);
  readonly vpBounds$ = new BehaviorSubject<IRect>({ x: 0, y: 0, width: 0, height: 0 });
  readonly editable$ = new BehaviorSubject(true);
  /** 指针世界坐标流（awareness 光标采集源，docs/10 §3；80ms 节流） */
  readonly curPos$ = new BehaviorSubject<IPoint | null>(null);

  /** moved 高频合并：微任务内只派发一次 */
  private vpDirty = false;

  get viewportInstance(): Viewport {
    return this.viewport;
  }

  /** DOM 事件挂载目标（右键菜单等）；initialize 时填充 */
  get container(): HTMLElement | null {
    return this.domContainer;
  }
  private domContainer: HTMLElement | null = null;

  /** 渲染器（纹理生成/屏幕矩形消费；initialize 前为 null） */
  get renderer(): Renderer | null {
    return this.boardApp?.app?.renderer ?? null;
  }

  async initialize(container: HTMLElement, opts: { editable: boolean }): Promise<void> {
    this.domContainer = container;
    this.editable$.next(opts.editable);

    this.boardApp = await BoardApplication.create(container);
    const app = this.boardApp.app;

    this.viewport = new Viewport({
      events: app.renderer.events,
      passiveWheel: false,
    });
    this.viewport
      .drag({ clampWheel: false, pressDrag: true })
      .wheel({ smooth: 3, trackpadPinch: true, wheelZoom: false, percent: 0.1 })
      .clampZoom({ minScale: MIN_SCALE, maxScale: MAX_SCALE });

    // cursor 模式下按住拖动 = 框选/移动元素，不启用视口拖拽；hand/space 模式才启用
    this.viewport.plugins.pause('drag');

    // 点阵背景已迁移至 DOM/CSS 层（@spinth/react DotGrid，docs/03 §6）——
    // 曾用 PIXI TilingSprite 实现，受 8.20 批渲染首帧不上屏问题困扰，且网格
    // 本就不是画布内容（不参与 zOrder/导出），DOM 合成层零 WebGL 成本且天然换肤
    app.stage.addChild(this.viewport);
    this.viewport.addChild(this.widgetLayer, this.optionLayer);

    // 指针输入/相机缩放协作者（specs/split-large-files §4.4）：host 经对象
    // 字面量接线——isEditBlocked 闭包读实例字段（组合根覆写仍生效）
    this.pointerInput = new ViewportPointerInput({
      stage: app.stage,
      canvas: app.canvas,
      toWorld: (p) => this.toWorld(p),
      cursorMode$: this.cursorMode$,
      editable$: this.editable$,
      curPos$: this.curPos$,
      isEditBlocked: () => this.isEditBlocked(),
    });
    this.zoom = new ViewportZoom({
      viewport: this.viewport,
      widgetLayer: this.widgetLayer,
      getRendererSize: () => ({
        width: app.renderer.width,
        height: app.renderer.height,
      }),
      onMoved: () => {
        markRender();
        this.scheduleVpSync();
      },
    });
    this.addDisposable(this.pointerInput);
    this.pointerInput.bind();

    this.bindViewportEvents();
    this.bindWheelModifier();
    this.bindSpaceGrab();
    this.observeResize();

    this.syncViewportState(true);
  }

  // ---------- 分层与 zOrder ----------

  addWidget(displayObject: Container, zOrder: string): void {
    displayObject.zOrder = zOrder;
    this._widgetLayer.addChild(displayObject);
    this.sortWidgetLayer();
    markRender();
  }

  removeWidget(...displayObjects: Container[]): void {
    for (const d of displayObjects) {
      this._widgetLayer.removeChild(d);
      d.destroy({ children: true });
    }
    markRender();
  }

  setZOrder(displayObject: Container, zOrder: string): void {
    if (displayObject.zOrder === zOrder) return;
    displayObject.zOrder = zOrder;
    this.sortWidgetLayer();
    markRender();
  }

  /** 物理排序 children：字典序即层级序（替代既有设计 @pixi/layers 的方案，docs/03 §2） */
  private sortWidgetLayer(): void {
    this._widgetLayer.children.sort((a, b) => ((a.zOrder ?? '') < (b.zOrder ?? '') ? -1 : 1));
  }

  // ---------- 视口状态 ----------

  private bindViewportEvents(): void {
    const onMoved = (): void => {
      // 任何视口变化都要触发渲染（含动画/decelerate 过程）
      markRender();
      this.scheduleVpSync();
    };
    this.viewport.on('moved', onMoved);
    this.addDisposable(() => this.viewport.off('moved', onMoved));
  }

  private scheduleVpSync(): void {
    if (this.vpDirty) return;
    this.vpDirty = true;
    queueMicrotask(() => {
      this.vpDirty = false;
      this.syncViewportState();
    });
  }

  private syncViewportState(initial = false): void {
    if (!this.viewport) return;
    const scale = this.viewport.scale.x;
    const bounds = this.getPageBounds();
    const changed =
      initial || this.vpScale$.value !== scale || !rectsClose(this.vpBounds$.value, bounds);
    if (changed) {
      this.vpScale$.next(scale);
      this.vpBounds$.next(bounds);
    }
  }

  getPageBounds(): IRect {
    const v = this.viewport;
    return { x: v.left, y: v.top, width: v.right - v.left, height: v.bottom - v.top };
  }

  getClientSize(): { width: number; height: number } {
    return {
      width: this.domContainer?.clientWidth ?? 0,
      height: this.domContainer?.clientHeight ?? 0,
    };
  }

  /** 程序化平移（屏幕像素）：正 dx/dy 視口右/下移，内容视觉左/上移（docs/11 §7 焦点跟随） */
  panBy(dx: number, dy: number): void {
    if (!dx && !dy) return;
    this.viewport.x += dx;
    this.viewport.y += dy;
    markRender();
    this.syncViewportState();
  }

  toWorld(screen: { x: number; y: number }): Point {
    return this.viewport.toWorld(screen.x, screen.y);
  }

  toScreen(world: { x: number; y: number }): Point {
    return this.viewport.toScreen(world.x, world.y);
  }

  /** 浏览器 client 坐标 → 世界坐标（window 级拖拽监听用） */
  clientToWorld(clientX: number, clientY: number): Point {
    const rect = this.boardApp.app.canvas.getBoundingClientRect();
    return this.viewport.toWorld(clientX - rect.left, clientY - rect.top);
  }

  /** 世界坐标 → 页面 client 坐标（挂 body 的 fixed 浮层用；clientToWorld 的逆） */
  worldToClient(world: { x: number; y: number }): Point {
    const p = this.viewport.toScreen(world.x, world.y);
    const rect = this.boardApp.app.canvas.getBoundingClientRect();
    return new Point(p.x + rect.left, p.y + rect.top);
  }

  // ---------- 指针分发（工具状态机枢纽；输入管线本体在 ViewportPointerInput） ----------

  registerGlobalEventListener(mode: CursorMode, handlers: IPointerHandlers): void {
    this.pointerInput.register(mode, handlers);
  }

  /** 对指定模式派发手势取消（Batch 1 · 1.10）：切工具/Esc 收口入口——
   *  换模式前对**旧模式** handlers 发 cancel（换完再发会路由到新模式） */
  dispatchGestureCancel(mode: CursorMode): void {
    this.pointerInput.dispatchCancel(mode);
  }

  // ---------- wheel / 抓手 / 光标 ----------

  /** Cmd/Ctrl+滚轮 = 缩放，裸滚轮 = 平移（参考手感）；trackpadPinch 已由 ctrl+wheel 覆盖 */
  private bindWheelModifier(): void {
    const onWheel = (e: WheelEvent): void => {
      const wheelPlugin = this.viewport.plugins.get('wheel') as {
        setWheelZoom(v: boolean): void;
      } | null;
      wheelPlugin?.setWheelZoom(e.metaKey || e.ctrlKey);
    };
    this.container?.addEventListener('wheel', onWheel, { capture: true, passive: false });
    this.addDisposable(() =>
      this.container?.removeEventListener('wheel', onWheel, { capture: true }),
    );
  }

  /** 空格按住临时抓手（Phase 1 要求的手感项） */
  private bindSpaceGrab(): void {
    const isTypingTarget = (t: EventTarget | null): boolean => {
      const el = t as HTMLElement | null;
      return !!el && (el.isContentEditable || ['INPUT', 'TEXTAREA'].includes(el.tagName));
    };
    const onKeyDown = (e: KeyboardEvent): void => {
      if (e.code !== 'Space' || e.repeat || isTypingTarget(e.target)) return;
      // 键盘可达性（2026-10-17 外部审查 4.1）：聚焦按钮/链接时 Space 是原生
      // 激活——放行，不切抓手
      if (isInteractiveUiTarget(e.target)) return;
      e.preventDefault();
      if (this.prevModeBeforeSpace) return;
      this.prevModeBeforeSpace = this.cursorMode$.value;
      this.setCursorMode('hand');
    };
    const onKeyUp = (e: KeyboardEvent): void => {
      if (e.code !== 'Space') return;
      if (!this.prevModeBeforeSpace) return;
      this.setCursorMode(this.prevModeBeforeSpace);
      this.prevModeBeforeSpace = null;
    };
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    this.addDisposable(() => window.removeEventListener('keydown', onKeyDown));
    this.addDisposable(() => window.removeEventListener('keyup', onKeyUp));
  }

  private static CURSOR_STYLES: Partial<Record<CursorMode, string>> = {
    cursor: 'default',
    hand: 'grab',
    shape: 'crosshair',
    text: 'text',
    line: 'crosshair',
    pen: 'crosshair',
    eraser: 'cell',
  };

  setCursorMode(mode: CursorMode): void {
    if (this.cursorMode$.value === mode) return;
    // 切工具收口（Batch 1 · 1.10）：换模式前对旧模式发手势取消——拖拽预览
    // 回弹、框选蓝框隐藏、绘制草稿 settle，不随模式断流悬空
    this.dispatchGestureCancel(this.cursorMode$.value);
    this.cursorMode$.next(mode);
    // hand 模式启用视口拖拽，其余暂停（元素交互优先）
    if (mode === 'hand') {
      this.viewport.plugins.resume('drag');
    } else {
      this.viewport.plugins.pause('drag');
    }
    const canvas = this.boardApp?.app?.canvas;
    if (canvas) {
      canvas.style.cursor = ViewportService.CURSOR_STYLES[mode] ?? 'default';
    }
  }

  /** 悬停态临时光标（连线手柄等 eventMode:none 对象，pixi 不接管 cursor）：
   *  null = 恢复当前模式默认。模式切换会覆盖临时光标（语义正确）。 */
  setHoverCursor(cursor: string | null): void {
    const canvas = this.boardApp?.app?.canvas;
    if (!canvas) return;
    canvas.style.cursor =
      cursor ?? ViewportService.CURSOR_STYLES[this.cursorMode$.value] ?? 'default';
  }

  // ---------- 缩放（相机数学本体在 ViewportZoom 协作者） ----------

  setPageScale(scale: number, focus?: { x: number; y: number }, immediate = false): void {
    this.zoom.setPageScale(scale, focus, immediate);
  }

  zoomIn(): void {
    this.zoom.zoomIn();
  }

  zoomOut(): void {
    this.zoom.zoomOut();
  }

  zoomToFit(padding = 100): void {
    this.zoom.zoomToFit(padding);
  }

  // ---------- resize / destroy ----------

  private observeResize(): void {
    if (!this.container) return;
    this.resizeObserver = new ResizeObserver(() => {
      if (!this.container) return;
      const w = this.container.clientWidth;
      const h = this.container.clientHeight;
      this.boardApp.resize(w, h);
      this.viewport.resize(w, h);
      this.syncViewportState();
      markRender();
    });
    this.resizeObserver.observe(this.container);
  }

  override dispose(): void {
    this.resizeObserver?.disconnect();
    this.resizeObserver = null;
    this.boardApp?.dispose();
    super.dispose();
  }
}

function rectsClose(a: IRect, b: IRect, eps = 1e-3): boolean {
  return (
    Math.abs(a.x - b.x) < eps &&
    Math.abs(a.y - b.y) < eps &&
    Math.abs(a.width - b.width) < eps &&
    Math.abs(a.height - b.height) < eps
  );
}
