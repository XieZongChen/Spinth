import { Container, Point, Rectangle, type Renderer } from 'pixi.js';
import { Viewport } from 'pixi-viewport';
import { BehaviorSubject } from 'rxjs';
import { Disposable } from '../../base/disposable';
import { markRender } from '../../common/render';
import type { IPoint, IRect } from '../../common/geometry';
import { isInteractiveUiTarget } from '../keyboard/shortcuts';
import type {
  CursorMode,
  IPointerEventInfo,
  IPointerHandlers,
  IViewportService,
} from '../../types';
import { BoardApplication } from './boardApplication';

declare module 'pixi.js' {
  interface Container {
    /** widgetLayer 排序键（fractional indexing 字符串，字典序即渲染序） */
    zOrder?: string;
  }
}

const MIN_SCALE = 0.05;
/** awareness 光标位置上报节流（docs/10 §3：80ms） */
const AWARENESS_POS_THROTTLE_MS = 80;
const MAX_SCALE = 4;
const ZOOM_STEP = 1.2;

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

  private handlers = new Map<CursorMode, IPointerHandlers>();

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

    this.bindViewportEvents();
    this.bindStagePointerEvents();
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

  // ---------- 指针分发（工具状态机枢纽） ----------

  registerGlobalEventListener(mode: CursorMode, handlers: IPointerHandlers): void {
    this.handlers.set(mode, handlers);
  }

  private bindStagePointerEvents(): void {
    const stage = this.boardApp.app.stage;
    stage.eventMode = 'static';
    stage.hitArea = new Rectangle(0, 0, 1e6, 1e6);

    let lastPosAt = 0;
    /** 活跃指针（Batch 1 · 1.9④）：down 起至 up/cancel 止——期间异 pointerId 的
     *  down/move 不派发（第二指不再新建孤儿笔/草稿跳变/覆写 dragState） */
    let activePointerId: number | null = null;
    const dispatch = (
      kind: 'down' | 'move' | 'up' | 'upoutside' | 'right' | 'cancel',
      e: {
        global: Point;
        shiftKey: boolean;
        metaKey: boolean;
        ctrlKey: boolean;
        altKey: boolean;
        pointerId?: number;
      },
    ): void => {
      // pointerId 过滤：down 抢占记录（首个生效），异 id 的 down/move 丢弃；
      // up/cancel 归还（任意终止都释放）
      if (kind === 'down') {
        if (
          activePointerId !== null &&
          e.pointerId !== undefined &&
          e.pointerId !== activePointerId
        )
          return;
        activePointerId = e.pointerId ?? null;
      } else if (kind === 'move') {
        if (
          activePointerId !== null &&
          e.pointerId !== undefined &&
          e.pointerId !== activePointerId
        )
          return;
      } else if (kind === 'up' || kind === 'upoutside' || kind === 'cancel') {
        if (
          e.pointerId !== undefined &&
          activePointerId !== null &&
          e.pointerId !== activePointerId &&
          kind !== 'cancel'
        )
          return;
        activePointerId = null;
      }
      // 编辑守卫（docs/10 §4）：只读或物理断网不分发交互（ws 断连不拦——离线可编辑）。
      // up/upoutside 必须放行：拖拽中途断网若吞掉 up，交互状态机（如拉线中）会永久挂起。
      // 断网判定注入（组合根接 NetworkService.editBlocked$——两态单源，
      // 曾直接读 navigator.onLine 与 keyboard 闸门形成双源，外部审查揪出）
      if (
        kind !== 'up' &&
        kind !== 'upoutside' &&
        kind !== 'cancel' &&
        (!this.editable$.value || this.isEditBlocked())
      ) {
        return;
      }
      // awareness 光标采集：move 事件顺带更新（80ms 节流，docs/10 §3）
      if (kind === 'move') {
        const now = performance.now();
        if (now - lastPosAt >= AWARENESS_POS_THROTTLE_MS) {
          lastPosAt = now;
          const world = this.toWorld(e.global);
          this.curPos$.next({ x: world.x, y: world.y });
        }
      }
      const handlers = this.handlers.get(this.cursorMode$.value);
      if (!handlers) return;
      // 只读下 up/upoutside 也吞（上面"up 必须放行"仅对 editBlocked 断网分支
      // 成立）——依赖 BoardCommands.updateEditable(false) 降级时先对手势发
      // dispatchGestureCancel 收口，交互状态机不会悬挂在等 up 的半路
      if (!this.editable$.value && kind !== 'cancel') return;
      const info: IPointerEventInfo = {
        world: this.toWorld(e.global),
        screen: e.global.clone(),
        shiftKey: e.shiftKey,
        metaKey: e.metaKey,
        ctrlKey: e.ctrlKey,
        altKey: e.altKey,
        raw: { x: e.global.x, y: e.global.y },
      };
      switch (kind) {
        case 'down':
          handlers.onPointerDown?.(info);
          break;
        case 'move':
          handlers.onPointerMove?.(info);
          break;
        case 'up':
          handlers.onPointerUp?.(info);
          break;
        case 'upoutside':
          handlers.onPointerUpOutside?.(info);
          break;
        case 'cancel':
          handlers.onPointerCancel?.(info);
          break;
        case 'right':
          handlers.onRightClick?.(info);
          break;
      }
    };

    const disposers: Array<() => void> = [];
    for (const [event, kind] of [
      ['pointerdown', 'down'],
      ['pointermove', 'move'],
      ['pointerup', 'up'],
      ['pointerupoutside', 'upoutside'],
      ['rightdown', 'right'],
    ] as const) {
      const handler = (e: {
        global: Point;
        shiftKey: boolean;
        metaKey: boolean;
        ctrlKey: boolean;
        altKey: boolean;
      }): void => dispatch(kind, e);
      stage.on(event, handler);
      disposers.push(() => stage.off(event, handler));
    }

    // 原生 pointercancel（Batch 1 · 1.9①）：pixi EventSystem 不转发 cancel——
    // 触控/笔被打断（来电、浏览器手势接管）时 stage 会话收不到任何终止事件。
    // 直挂 canvas，派发进统一 cancel 通道
    const canvasEl = this.boardApp.app.canvas; // 启动即有（boardApplication appendChild 同源）
    const onNativeCancel = (e: PointerEvent): void => {
      dispatch('cancel', {
        global: new Point(e.offsetX, e.offsetY),
        shiftKey: e.shiftKey,
        metaKey: e.metaKey,
        ctrlKey: e.ctrlKey,
        altKey: e.altKey,
        pointerId: e.pointerId,
      });
      activePointerId = null;
    };
    canvasEl.addEventListener('pointercancel', onNativeCancel);
    disposers.push(() => canvasEl.removeEventListener('pointercancel', onNativeCancel));

    // window blur watchdog（1.9③）：切窗/失焦时对当前模式派发 cancel——
    // stage 管线会话冻结在预览态、window 管线（rectEditor 等）复焦后无按键续拖
    const onBlur = (): void => {
      dispatch('cancel', {
        global: new Point(-1e5, -1e5), // 无有效指针位——cancel 语义不依赖坐标
        shiftKey: false,
        metaKey: false,
        ctrlKey: false,
        altKey: false,
      });
      activePointerId = null;
    };
    window.addEventListener('blur', onBlur);
    disposers.push(() => window.removeEventListener('blur', onBlur));
    for (const d of disposers) this.addDisposable(d);
  }

  /** 对指定模式派发手势取消（Batch 1 · 1.10）：切工具/Esc 收口入口——
   *  换模式前对**旧模式** handlers 发 cancel（换完再发会路由到新模式） */
  dispatchGestureCancel(mode: CursorMode): void {
    const handlers = this.handlers.get(mode);
    if (!handlers?.onPointerCancel) return;
    handlers.onPointerCancel({
      world: { x: -1e5, y: -1e5, clone: () => ({ x: -1e5, y: -1e5 }) } as unknown as Point,
      screen: new Point(-1e5, -1e5),
      shiftKey: false,
      metaKey: false,
      ctrlKey: false,
      altKey: false,
      raw: { x: -1e5, y: -1e5 },
    });
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

  // ---------- 缩放 ----------

  setPageScale(scale: number, focus?: { x: number; y: number }, immediate = false): void {
    const clamped = Math.min(MAX_SCALE, Math.max(MIN_SCALE, scale));
    // P0-7（2026-10-17 外部审查）三处数学修正：
    // ① focus 缺省直用 viewport.center——pixi-viewport v6 的 center 本就是世界
    //    坐标（屏幕中心的 toWorld 值），再过一次 toWorld 是二次换算（纯缩放
    //    轨道上恰好幂等掩盖了漂移，平移后 focus 即错位）；
    // ② 比例项 old/new：保持 focus 世界点停在同一屏幕位置的正确目标是
    //    P = f + (c_w − f)·(s/s′)——原写成 new/old；
    // ③ immediate 分支改 moveCenter：animate({ position }) 的 position 是
    //    moveCenter 的世界中心目标（AnimatePlugin 源码语义），而
    //    viewport.position 是平移量——同数异义，cmd+0 曾半屏级跳动。
    // 不能省略 position：pixi-viewport AnimatePlugin 在 keepCenter=true 时不 emit
    // 'moved'，vpScale$/vpBounds$ 将永远滞后（setPageScale(1) 后 HUD 显示与 LOD
    // 联动全部失真，2026-09 浏览器实测揪出）。
    const f = focus ?? this.viewport.center;
    const ratio = this.viewport.scale.x / clamped;
    const target = new Point(
      f.x + (this.viewport.center.x - f.x) * ratio,
      f.y + (this.viewport.center.y - f.y) * ratio,
    );
    if (immediate) {
      // 立即精确路径（zoom100 专用）：AnimatePlugin 是收敛式插值（每帧
      // scale += (target-scale)*ease），慢环境帧少时停在离目标 1.6%~2.9% 的
      // 残差（CI 两次红实证）——「回 100%」语义要求精确归位。手动设置不
      // emit 'moved'，须自触发 vp 同步 + markRender（onMoved 同款）。
      // 须先取消在飞 Animate：animate() 重入自带替换（add 先 destroy 同名），
      // 本路径绕过了它——残留 Animate 每帧仍按其目标继续插值，把刚设的
      // scale 拉走（CI 实证：cmd+= 动画在飞时 cmd+0，最终停在 1.18）。
      this.viewport.plugins.remove('animate');
      this.viewport.scale.set(clamped);
      this.viewport.moveCenter(target);
      markRender();
      this.scheduleVpSync();
      return;
    }
    this.viewport.animate({
      time: 200,
      scale: clamped,
      position: target,
    });
  }

  zoomIn(): void {
    this.setPageScale(this.viewport.scale.x * ZOOM_STEP);
  }

  zoomOut(): void {
    this.setPageScale(this.viewport.scale.x / ZOOM_STEP);
  }

  zoomToFit(padding = 100): void {
    if (this._widgetLayer.children.length === 0) {
      this.setPageScale(1);
      return;
    }
    const b = this._widgetLayer.getLocalBounds();
    const w = this.boardApp.app.renderer.width;
    const h = this.boardApp.app.renderer.height;
    const scale = Math.min(Math.max((w - padding * 2) / b.width, (h - padding * 2) / b.height), 1);
    this.viewport.animate({
      time: 200,
      scale,
      position: new Point(b.x + b.width / 2, b.y + b.height / 2),
    });
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
