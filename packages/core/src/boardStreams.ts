/**
 * BoardSDK 输出流区（specs/api-surface §3.4）：17 条输出流 + 组装前兜底的
 * 唯一持有者。getter 体自 app.ts 逐字迁入——兜底实例的惰性创建、返回同一
 * 实例、组装后返回真实流，语义与迁移前逐字一致。
 *
 * 构造器只存 host 引用、禁止读 host 字段：app.ts 类字段初始化顺序 = 声明
 * 顺序（useDefineForClassFields），outputs 字段初始化时宿主服务字段尚为 null。
 * 对 app.ts 只允许 import type（值依赖由 app.ts → 本模块单向注入）。
 */
import { BehaviorSubject, Subject } from 'rxjs';
import type { IRect } from './common/geometry';
import type { CursorMode, ShapeType } from './types';
import type { IContextMenuState } from './platform/contextMenu/contextMenuService';
import type { IStorageStatus } from './types/storage';
import { INITIAL_STORAGE_STATUS } from './types/storage';
import type { IBoardStreamHost } from './boardHost';

export class BoardOutputs {
  constructor(private readonly host: IBoardStreamHost) {}

  /** 组装前输出流兜底（批 B：bridge 订阅早于 composeBoard 完成——null 服务
   *  读 getter 曾整树崩（ghostSuppressed/editBlocked 实锤族）；各流返回与
   *  真实初值同源的 BehaviorSubject，组装完成后真值流接管（订阅方拿到的是
   *  fallback 实例的消费者在组装完成前已存在的极早期 bridge 订阅——react
   *  connectBoard 在 onReady 后才挂，实际无消费者，兜底仅防初始化窗口崩溃） */
  private fallbacks = {
    cursorMode: null as BehaviorSubject<CursorMode> | null,
    shapeType: null as BehaviorSubject<ShapeType> | null,
    vpScale: null as BehaviorSubject<number> | null,
    vpBounds: null as BehaviorSubject<IRect> | null,
    editable: null as BehaviorSubject<boolean> | null,
    docState: null as BehaviorSubject<'idle'> | null,
    wsState: null as BehaviorSubject<'off'> | null,
    persistState: null as BehaviorSubject<'saved'> | null,
    storageStatus: null as BehaviorSubject<IStorageStatus> | null,
    selected: null as BehaviorSubject<string[]> | null,
    canUndo: null as BehaviorSubject<boolean> | null,
    canRedo: null as BehaviorSubject<boolean> | null,
  };

  get cursorMode$(): BehaviorSubject<CursorMode> {
    return (
      this.host.viewport?.cursorMode$ ??
      (this.fallbacks.cursorMode ??= new BehaviorSubject<CursorMode>('cursor'))
    );
  }

  /** 形状工具默认创建型（会话级，docs/04 §2 形状默认型小节；工具坞二级菜单消费） */
  get defaultShapeType$(): BehaviorSubject<ShapeType> {
    return (
      this.host.shapeService?.defaultShapeType$ ??
      (this.fallbacks.shapeType ??= new BehaviorSubject<ShapeType>('rect'))
    );
  }

  get vpScale$(): BehaviorSubject<number> {
    return (
      this.host.viewport?.vpScale$ ?? (this.fallbacks.vpScale ??= new BehaviorSubject<number>(1))
    );
  }

  get vpBounds$(): BehaviorSubject<IRect> {
    return (
      this.host.viewport?.vpBounds$ ??
      (this.fallbacks.vpBounds ??= new BehaviorSubject<IRect>({ x: 0, y: 0, width: 0, height: 0 }))
    );
  }

  get editable$(): BehaviorSubject<boolean> {
    return (
      this.host.viewport?.editable$ ??
      (this.fallbacks.editable ??= new BehaviorSubject<boolean>(true))
    );
  }

  get docState$() {
    return (
      this.host.engine?.docState$ ??
      (this.fallbacks.docState ??= new BehaviorSubject<'idle'>('idle'))
    );
  }

  /** ws 连接态（docs/10 §2；本地模式恒 'off'） */
  get wsState$() {
    return (
      this.host.engine?.wsState$ ?? (this.fallbacks.wsState ??= new BehaviorSubject<'off'>('off'))
    );
  }

  /** 物理断网（阻断编辑；ws 断连仅提示不阻断——docs/10 §4）。组装前兜底
   *  false（批 B：bridge 订阅早于 boardCompletion 完成） */
  get editBlocked$() {
    if (this.host.network) return this.host.network.editBlocked$;
    this.editBlockedFallback ??= new BehaviorSubject<boolean>(false);
    return this.editBlockedFallback;
  }
  private editBlockedFallback: BehaviorSubject<boolean> | null = null;

  /** 本地落盘态（Batch 1 · 1.15）：failed=写失败退避中（配额满等），
   *  UI 顶栏「已同步」不得再与 wsState 混同 */
  get persistState$() {
    return (
      this.host.engine?.persistState$ ??
      (this.fallbacks.persistState ??= new BehaviorSubject<'saved'>('saved'))
    );
  }

  /** 浏览器持久化授权 + 站点配额（docs/02 §6.1——与 persistState$ 不混同） */
  get storageStatus$() {
    return (
      this.host.storageStatus?.status$ ??
      (this.fallbacks.storageStatus ??= new BehaviorSubject<IStorageStatus>(INITIAL_STORAGE_STATUS))
    );
  }

  get selected$() {
    return (
      this.host.selector?.selected$ ??
      (this.fallbacks.selected ??= new BehaviorSubject<string[]>([]))
    );
  }

  get canUndo$() {
    return (
      this.host.history?.canUndo$ ??
      (this.fallbacks.canUndo ??= new BehaviorSubject<boolean>(false))
    );
  }

  get canRedo$() {
    return (
      this.host.history?.canRedo$ ??
      (this.fallbacks.canRedo ??= new BehaviorSubject<boolean>(false))
    );
  }

  /** 网格吸附开关（specs/flowchart-closeout §9.2）：视图偏好流（不写文档）。
   *  组装前兜底 false */
  get gridSnap$(): BehaviorSubject<boolean> {
    if (this.host.gridSnap) return this.host.gridSnap.gridSnap$;
    this.gridSnapFallback ??= new BehaviorSubject<boolean>(false);
    return this.gridSnapFallback;
  }
  private gridSnapFallback: BehaviorSubject<boolean> | null = null;

  get contextMenuOptions$(): BehaviorSubject<IContextMenuState> {
    // 组装前兜底（批 B 输出流族最后一员）：静止菜单
    if (this.host.contextMenu) return this.host.contextMenu.options$;
    this.ctxMenuFallback ??= new BehaviorSubject<IContextMenuState>({
      show: false,
      x: 0,
      y: 0,
      onWidget: false,
      canPaste: false,
    });
    return this.ctxMenuFallback;
  }

  /** 拖拽进行中通知（ActionBar 隐藏跟随） */
  get dragMove$(): Subject<void> {
    if (this.host.selector) return this.host.selector.dragMove$;
    this.dragMoveFallback ??= new Subject<void>();
    return this.dragMoveFallback;
  }

  /** mind 幽灵抑制（指针悬停已有脑图）——ToolGhost 消费（2026-09-22 幽灵 DOM 化）。
   *  批 B 三分后组装在 boardComposition、bridge 订阅可能早于组装完成——
   *  BehaviorSubject(false) 兜底（mindService 就绪后返回真值流） */
  get mindGhostSuppressed$(): import('rxjs').BehaviorSubject<boolean> {
    if (this.host.mindService) return this.host.mindService.ghostSuppressed$;
    this.mindGhostFallback ??= new BehaviorSubject<boolean>(false);
    return this.mindGhostFallback;
  }
  private mindGhostFallback: BehaviorSubject<boolean> | null = null;

  /** 脑图焦点节点变化（导航/建删/点击落点——AddButtons 重算触发器之一）。
   *  组装前兜底 dead Subject（批 B 同 mindGhostSuppressed） */
  get mindFocusChanged$(): Subject<void> {
    if (this.host.mindService) return this.host.mindService.focusChanged$;
    this.mindFocusFallback ??= new Subject<void>();
    return this.mindFocusFallback;
  }
  private mindFocusFallback: Subject<void> | null = null;
  private ctxMenuFallback: BehaviorSubject<IContextMenuState> | null = null;
  private dragMoveFallback: Subject<void> | null = null;
}
