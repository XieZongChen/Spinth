import { BehaviorSubject } from 'rxjs';
import { Disposable } from '../../base/disposable';
import type { IRect } from '../../common/geometry';
import type {
  IAxisAnchor,
  IPointerEventInfo,
  IPointerHandlers,
  ISequenceLookup,
  IViewportService,
  IVmEngineService,
} from '../../types';
import type { LifelineService } from './lifelineService';
import { isSequenceKind, SEQUENCE_DEFAULT_KIND, type SequenceKind } from './sequenceOptions';

/**
 * 时序图工具（specs/sequence-diagram §7.1）：一个 CursorMode（'sequence'）对应
 * 多种图元。一个模式只能注册一组处理器——本服务是 'sequence' 的**唯一注册者**，
 * 事件到达时才解析当前图元种类并转发到该图元自己的服务（它们不注册；
 * LifelineService.initialize 抛错防误调）。批次 1 只有生命线；批次 2 起追加消息、
 * 批次 4 追加片段的转发分支。
 *
 * 种类记忆是会话级（不落库不持久化），经 kind$ 汇入工具默认参数表——工具坞
 * 二级菜单读写同一个值（docs/04 §2 工具默认参数节）。
 *
 * 兼任 ISequenceLookup（specs/sequence-diagram §9.4）：VM（生命线锚点让位、轴消息
 * 平移）经构造注入的只读查询——组合根注册的是晚绑定门面（Tokens.SequenceLookup），
 * VM 不持服务引用。
 */
export class SequenceService extends Disposable implements ISequenceLookup {
  private kind: SequenceKind = SEQUENCE_DEFAULT_KIND;
  readonly kind$ = new BehaviorSubject<SequenceKind>(SEQUENCE_DEFAULT_KIND);

  constructor(
    private readonly viewport: IViewportService,
    private readonly vmEngine: IVmEngineService,
    private readonly lifeline: LifelineService,
  ) {
    super();
  }

  /** 轴宿主的轴（视觉感知）；非轴宿主 / vm 缺失返回 null */
  axisOf(id: string): IAxisAnchor | null {
    return this.vmEngine.getVmById(id)?.getAxisAnchor?.() ?? null;
  }

  /** 绑定在某条生命线上的激活条：激活条属后续批次，当前恒空（每次新数组） */
  barsOf(_lifelineId: string): IRect[] {
    return [];
  }

  get currentKind(): SequenceKind {
    return this.kind;
  }

  /** 工具坞二级菜单写入口：档位外取值 / 同值忽略（不污染会话、不触发无谓广播） */
  setKind(kind: string): void {
    if (!isSequenceKind(kind) || kind === this.kind) return;
    this.kind = kind;
    this.kind$.next(kind);
  }

  /** 'sequence' 模式的指针处理器：逐成员转发，事件到达时才解析目标种类。
   *  转发目标缺某个成员时是 no-op（不抛错） */
  readonly handlers: IPointerHandlers = {
    onPointerDown: (e: IPointerEventInfo) => this.lifeline.handlers.onPointerDown?.(e),
    onPointerMove: (e: IPointerEventInfo) => this.lifeline.handlers.onPointerMove?.(e),
    onPointerUp: (e: IPointerEventInfo) => this.lifeline.handlers.onPointerUp?.(e),
    onPointerUpOutside: (e: IPointerEventInfo) => this.lifeline.handlers.onPointerUpOutside?.(e),
    onPointerCancel: (e: IPointerEventInfo) => this.lifeline.handlers.onPointerCancel?.(e),
    onRightClick: (e: IPointerEventInfo) => this.lifeline.handlers.onRightClick?.(e),
  };

  initialize(): void {
    this.viewport.registerGlobalEventListener('sequence', this.handlers);
  }
}
