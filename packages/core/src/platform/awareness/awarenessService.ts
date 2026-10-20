import { BehaviorSubject } from 'rxjs';
import type { Awareness } from 'y-protocols/awareness';
import { Disposable } from '../../base/disposable';
import type { CursorMode, ISelectorService, IViewportService } from '../../types';

/**
 * 协同在线状态（docs/10 §3）：
 * - 本地：curPos$/cursorMode$/selected$ 聚合 → awareness.setLocalState 合并写
 *   （光标位置 80ms 节流——viewport curPos$ 已节流，这里直接透传）。
 * - 远端：awareness 'change' 事件 → peers$（Map<clientId, state>，整体替换引用）。
 * - 瞬态通道铁律：不落盘、不进 undo、断线即焚；禁止传业务数据。
 */

/** peer 色板（docs/10 §3，脱敏替代） */
export const PEER_COLORS = [
  '#f5484d',
  '#f2a93b',
  '#eebd37',
  '#59c11f',
  '#1fc38e',
  '#17b2e2',
  '#3e69fe',
  '#7a5af8',
  '#c25ef0',
  '#e6499c',
] as const;

export interface IAwarenessState {
  userId: string;
  userName: string;
  userColor: string;
  cursorMode: CursorMode;
  cursorPos: { x: number; y: number } | null;
  selectedWidgetIds: string[];
  /** 脑图节点级选中（4.9，docs/11 §0 修订）：所属图 id 由 selectedWidgetIds
   *  承载，此字段为选中节点 id（null = 整图选中/无节点选中） */
  mindNodeId: string | null;
}

export class AwarenessService extends Disposable {
  /** 远端 peer 状态（clientId → state；整体替换引用，渲染层浅比较） */
  readonly peers$ = new BehaviorSubject<Map<number, IAwarenessState>>(new Map());
  readonly localState: IAwarenessState;

  private readonly awareness: Awareness;
  /** 光标位置上报节流（viewport curPos$ 已 80ms 节流，此处免二次节流） */
  private destroyed = false;

  constructor(
    awareness: Awareness,
    private viewport: Pick<IViewportService, 'curPos$' | 'cursorMode$' | 'vpScale$'>,
    selector: Pick<ISelectorService, 'selected$'>,
    userName: string,
  ) {
    super();
    this.awareness = awareness;
    // 选色：随机起点取「未被占用」的第一个（规避多端同时上线竞态，docs/10 §3）
    const occupied = new Set(
      [...awareness.getStates().values()].map((s) => (s as { userColor?: string }).userColor),
    );
    const start = Math.floor(Math.random() * PEER_COLORS.length);
    let color = PEER_COLORS[start]!;
    for (let i = 0; i < PEER_COLORS.length; i++) {
      const c = PEER_COLORS[(start + i) % PEER_COLORS.length]!;
      if (!occupied.has(c)) {
        color = c;
        break;
      }
    }
    this.localState = {
      userId: `u-${Math.random().toString(36).slice(2, 8)}`,
      userName,
      userColor: color,
      cursorMode: 'cursor',
      cursorPos: null,
      selectedWidgetIds: [],
      mindNodeId: null,
    };

    this.awareness.setLocalState({ ...this.localState });
    this.awareness.on('change', this.onChange);

    // 种子快照：构造可能晚于连接建立（BoardSDK 初始化的 PIXI await 期间，
    // 本地 server 的 awareness 快照已到达并触发过 'change'）——只等事件会
    // 漏掉全部已在线 peer，「后加入端初始 peers 为空」（docs/10 §8 已知遗留，
    // 2026-09 定位：根因在客户端订阅时序而非 server 下发）。过滤自身与
    // 无 userId 的状态（与服务端快照过滤同口径）
    const seeded = new Map<number, IAwarenessState>();
    for (const [id, st] of this.awareness.getStates()) {
      if (id === this.awareness.clientID) continue;
      const state = st as IAwarenessState | null;
      if (state && state.userId) seeded.set(id, { ...state });
    }
    this.peers$.next(seeded);
    // 种子快照：组合根在 engine.initialize（ws 连接发起）+ PIXI 异步初始化之后
    // 才构造本服务——server 的初始快照常在订阅挂上前到达（change 已错过）。
    // 全量遍历 getStates() 填充（曾误用空 diff 调 onChange 等于没种，实测揪出）。
    this.seedFromStates();

    this.addDisposable(
      this.viewport.curPos$.subscribe((p) => {
        this.localState.cursorPos = p ? { ...p } : null;
        this.publish();
      }),
      this.viewport.cursorMode$.subscribe((m) => {
        this.localState.cursorMode = m;
        this.publish();
      }),
      selector.selected$.subscribe((ids) => {
        this.localState.selectedWidgetIds = [...ids];
        this.publish();
      }),
      () => {
        this.awareness.off('change', this.onChange);
        this.awareness.setLocalState(null); // 离线即焚
      },
    );
  }

  /** 从 awareness.states 全量填充 peers$（过滤自身与无 userId 的状态） */
  private seedFromStates(): void {
    const next = new Map<number, IAwarenessState>();
    for (const [id, raw] of this.awareness.getStates()) {
      const st = raw as IAwarenessState | null;
      if (id === this.awareness.clientID || !st?.userId) continue;
      next.set(id, { ...st });
    }
    if (next.size > 0) this.peers$.next(next);
  }

  /** 脑图节点级选中上报（4.9；组合根订阅 focusChanged$ 驱动） */
  setMindNodeId(id: string | null): void {
    this.localState.mindNodeId = id;
    this.publish();
  }

  private publish(): void {
    if (this.destroyed) return;
    this.awareness.setLocalState({ ...this.localState });
  }

  private onChange = (
    changed: { added: number[]; updated: number[]; removed: number[] },
    _origin: unknown,
  ): void => {
    const next = new Map(this.peers$.value);
    for (const id of changed.removed) next.delete(id);
    for (const id of [...changed.added, ...changed.updated]) {
      if (id === this.awareness.clientID) continue; // 本地不进 peers
      const state = this.awareness.getStates().get(id) as IAwarenessState | undefined;
      if (state && state.userId) next.set(id, { ...state });
      else next.delete(id);
    }
    this.peers$.next(next);
  };

  override dispose(): void {
    this.destroyed = true;
    super.dispose();
  }
}

export type { Awareness };
