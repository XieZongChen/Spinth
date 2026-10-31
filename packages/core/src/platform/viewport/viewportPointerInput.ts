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

/** 已投递 move 的重放快照（specs/edge-auto-scroll D3）：只存屏幕坐标与修饰键，
 *  世界坐标重放时按当前视口现算——跨帧缓存世界坐标正是补偿要消灭的形态 */
interface IMoveSnapshot {
  x: number;
  y: number;
  shiftKey: boolean;
  metaKey: boolean;
  ctrlKey: boolean;
  altKey: boolean;
  pointerId?: number;
}

type IDispatchKind = 'down' | 'move' | 'up' | 'upoutside' | 'right' | 'cancel';

interface IDispatchEvent {
  global: Point;
  shiftKey: boolean;
  metaKey: boolean;
  ctrlKey: boolean;
  altKey: boolean;
  pointerId?: number;
}

/**
 * 视口指针输入（docs/03 §4，工具状态机枢纽的输入侧）：stage 五事件绑定、
 * 活跃指针过滤（Batch 1 · 1.9④）、主键过滤（批次 B W1）、原生 pointercancel
 * 与 window blur 取消通道（1.9①/③）、awareness 光标节流采集、模式 handlers
 * 查表分发、已投递 move 快照与重放（specs/edge-auto-scroll D3）。
 * 监听释放经 addDisposable（bind 内登记）。
 */
export class ViewportPointerInput extends Disposable {
  private handlers = new Map<CursorMode, IPointerHandlers>();
  /** 活跃指针（Batch 1 · 1.9④）：down 起至 up/cancel 止——期间异 pointerId 的
   *  down/move 不派发（第二指不再新建孤儿笔/草稿跳变/覆写 dragState） */
  private activePointerId: number | null = null;
  private lastPosAt = 0;
  /** 最近一次**已投递**的 move（被闸门拦下的不记录——重放必须走同一闸门语义） */
  private lastMove: IMoveSnapshot | null = null;

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

  /** 以最后一次已投递的 move 快照重放一次 move（specs/edge-auto-scroll §3.4）：
   *  世界坐标按当前视口现算，走完整 dispatch 闸门。返回 false = 管线拒发
   *  （只读/断网/当前模式无 handler）——调用方据此回滚本帧平移 */
  replayLastMove(): boolean {
    const m = this.lastMove;
    if (!m) return false;
    return this.dispatch('move', {
      global: new Point(m.x, m.y),
      shiftKey: m.shiftKey,
      metaKey: m.metaKey,
      ctrlKey: m.ctrlKey,
      altKey: m.altKey,
      pointerId: m.pointerId,
    });
  }

  /** 统一分发闸门：返回是否投递到当前模式 handlers（false = 被任一闸门拦下） */
  private dispatch(kind: IDispatchKind, e: IDispatchEvent): boolean {
    // pointerId 过滤：down 抢占记录（首个生效），异 id 的 down/move 丢弃；
    // up/cancel 归还（任意终止都释放）
    if (kind === 'down') {
      if (
        this.activePointerId !== null &&
        e.pointerId !== undefined &&
        e.pointerId !== this.activePointerId
      )
        return false;
      this.activePointerId = e.pointerId ?? null;
    } else if (kind === 'move') {
      if (
        this.activePointerId !== null &&
        e.pointerId !== undefined &&
        e.pointerId !== this.activePointerId
      )
        return false;
    } else if (kind === 'up' || kind === 'upoutside' || kind === 'cancel') {
      if (
        e.pointerId !== undefined &&
        this.activePointerId !== null &&
        e.pointerId !== this.activePointerId &&
        kind !== 'cancel'
      )
        return false;
      this.activePointerId = null;
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
      return false;
    }
    // awareness 光标采集：move 事件顺带更新（80ms 节流，docs/10 §3）
    if (kind === 'move') {
      const now = performance.now();
      if (now - this.lastPosAt >= AWARENESS_POS_THROTTLE_MS) {
        this.lastPosAt = now;
        const world = this.host.toWorld(e.global);
        this.host.curPos$.next({ x: world.x, y: world.y });
      }
    }
    const handlers = this.handlers.get(this.host.cursorMode$.value);
    if (!handlers) return false;
    // 只读下 up/upoutside 也吞（上面"up 必须放行"仅对 editBlocked 断网分支
    // 成立）——依赖 BoardCommands.updateEditable(false) 降级时先对手势发
    // dispatchGestureCancel 收口，交互状态机不会悬挂在等 up 的半路
    if (!this.host.editable$.value && kind !== 'cancel') return false;
    const info: IPointerEventInfo = {
      world: this.host.toWorld(e.global),
      screen: e.global.clone(),
      shiftKey: e.shiftKey,
      metaKey: e.metaKey,
      ctrlKey: e.ctrlKey,
      altKey: e.altKey,
      raw: { x: e.global.x, y: e.global.y },
    };
    // 快照在全部闸门通过后写入（specs §5.3：被拦下的 move 不得成为重放源）
    if (kind === 'move') {
      this.lastMove = {
        x: e.global.x,
        y: e.global.y,
        shiftKey: e.shiftKey,
        metaKey: e.metaKey,
        ctrlKey: e.ctrlKey,
        altKey: e.altKey,
        pointerId: e.pointerId,
      };
    }
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
    return true;
  }

  /** stage/canvas/window 监听绑定（viewport.initialize 内调用一次；dispose 释放） */
  bind(): void {
    const stage = this.host.stage;
    stage.eventMode = 'static';
    stage.hitArea = new Rectangle(0, 0, 1e6, 1e6);

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
        this.dispatch(kind, e);
      };
      stage.on(event, handler);
      disposers.push(() => stage.off(event, handler));
    }

    // 原生 pointercancel（Batch 1 · 1.9①）：pixi EventSystem 不转发 cancel——
    // 触控/笔被打断（来电、浏览器手势接管）时 stage 会话收不到任何终止事件。
    // 直挂 canvas，派发进统一 cancel 通道
    const canvasEl = this.host.canvas; // 启动即有（boardApplication appendChild 同源）
    const onNativeCancel = (e: PointerEvent): void => {
      this.dispatch('cancel', {
        global: new Point(e.offsetX, e.offsetY),
        shiftKey: e.shiftKey,
        metaKey: e.metaKey,
        ctrlKey: e.ctrlKey,
        altKey: e.altKey,
        pointerId: e.pointerId,
      });
      this.activePointerId = null;
    };
    canvasEl.addEventListener('pointercancel', onNativeCancel);
    disposers.push(() => canvasEl.removeEventListener('pointercancel', onNativeCancel));

    // window blur watchdog（1.9③）：切窗/失焦时对当前模式派发 cancel——
    // stage 管线会话冻结在预览态、window 管线（rectEditor 等）复焦后无按键续拖
    const onBlur = (): void => {
      this.dispatch('cancel', {
        global: new Point(-1e5, -1e5), // 无有效指针位——cancel 语义不依赖坐标
        shiftKey: false,
        metaKey: false,
        ctrlKey: false,
        altKey: false,
      });
      this.activePointerId = null;
    };
    window.addEventListener('blur', onBlur);
    disposers.push(() => window.removeEventListener('blur', onBlur));
    for (const d of disposers) this.addDisposable(d);
  }
}
