import { Container, Point, Rectangle } from 'pixi.js';
import { BehaviorSubject } from 'rxjs';
import { Disposable } from '../../base/disposable';
import type { IPoint } from '../../common/geometry';
import type { CursorMode, IPointerEventInfo, IPointerHandlers } from '../../types';

/** awareness 光标位置上报节流（docs/10 §3：80ms） */
const AWARENESS_POS_THROTTLE_MS = 80;

/** 指针输入宿主：ViewportService 实现——stage/canvas 于 initialize 后就绪
 *  （getter 动态读），指针域不反向持有服务实例 */
export interface IViewportPointerHost {
  readonly stage: Container;
  readonly canvas: HTMLCanvasElement;
  toWorld(p: { x: number; y: number }): Point;
  readonly cursorMode$: BehaviorSubject<CursorMode>;
  readonly editable$: BehaviorSubject<boolean>;
  readonly curPos$: BehaviorSubject<IPoint | null>;
  isEditBlocked(): boolean;
}

/**
 * 视口指针输入（docs/03 §4，工具状态机枢纽的输入侧）：stage 五事件绑定、
 * 活跃指针过滤（Batch 1 · 1.9④）、主键过滤（批次 B W1）、原生 pointercancel
 * 与 window blur 取消通道（1.9①/③）、awareness 光标节流采集、模式 handlers
 * 查表分发。监听释放经 addDisposable（bind 内登记）。
 */
export class ViewportPointerInput extends Disposable {
  private handlers = new Map<CursorMode, IPointerHandlers>();

  constructor(private readonly host: IViewportPointerHost) {
    super();
  }

  register(mode: CursorMode, handlers: IPointerHandlers): void {
    this.handlers.set(mode, handlers);
  }

  /** 对指定模式派发手势取消（Batch 1 · 1.10）：切工具/Esc 收口入口——
   *  换模式前对**旧模式** handlers 发 cancel（换完再发会路由到新模式） */
  dispatchCancel(mode: CursorMode): void {
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

  /** stage/canvas/window 监听绑定（viewport.initialize 内调用一次；dispose 释放） */
  bind(): void {
    const stage = this.host.stage;
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
        (!this.host.editable$.value || this.host.isEditBlocked())
      ) {
        return;
      }
      // awareness 光标采集：move 事件顺带更新（80ms 节流，docs/10 §3）
      if (kind === 'move') {
        const now = performance.now();
        if (now - lastPosAt >= AWARENESS_POS_THROTTLE_MS) {
          lastPosAt = now;
          const world = this.host.toWorld(e.global);
          this.host.curPos$.next({ x: world.x, y: world.y });
        }
      }
      const handlers = this.handlers.get(this.host.cursorMode$.value);
      if (!handlers) return;
      // 只读下 up/upoutside 也吞（上面"up 必须放行"仅对 editBlocked 断网分支
      // 成立）——依赖 BoardCommands.updateEditable(false) 降级时先对手势发
      // dispatchGestureCancel 收口，交互状态机不会悬挂在等 up 的半路
      if (!this.host.editable$.value && kind !== 'cancel') return;
      const info: IPointerEventInfo = {
        world: this.host.toWorld(e.global),
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
        button?: number;
      }): void => {
        // 主键过滤（specs/a11y-closeout §5.3 派生修复，批次 B W1）：右键的
        // down/up 不进模式 handlers——此前右键点已选中件会走「单击激活」路径
        // 异步开出内联编辑器，其挂载焦点抢走右键菜单的首项聚焦；右键语境 =
        // contextmenu 菜单（rightdown 通道与 DOM contextmenu 均不受影响）。
        // `button != null` 防卫：pixi 事件对象可能缺省 button（touch/pen 归一
        // 路径），undefined !== 0 会把合法指针误挡（复审 P2 实锤）
        if (
          (kind === 'down' || kind === 'up' || kind === 'upoutside') &&
          e.button != null &&
          e.button !== 0
        )
          return;
        dispatch(kind, e);
      };
      stage.on(event, handler);
      disposers.push(() => stage.off(event, handler));
    }

    // 原生 pointercancel（Batch 1 · 1.9①）：pixi EventSystem 不转发 cancel——
    // 触控/笔被打断（来电、浏览器手势接管）时 stage 会话收不到任何终止事件。
    // 直挂 canvas，派发进统一 cancel 通道
    const canvasEl = this.host.canvas; // 启动即有（boardApplication appendChild 同源）
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
}
