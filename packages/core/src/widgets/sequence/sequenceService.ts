import { BehaviorSubject } from 'rxjs';
import { Disposable } from '../../base/disposable';
import type { IRect } from '../../common/geometry';
import type { ILineDrawPolicy } from '../line/lineAxisAnchor';
import type { LineService } from '../line/lineService';
import type {
  IAxisAnchor,
  IDataEngineService,
  IHistoryService,
  IPointerEventInfo,
  IPointerHandlers,
  ISequenceLookup,
  ISelectorService,
  IViewportService,
  IVmEngineService,
} from '../../types';
import type { LifelineService } from './lifelineService';
import { ActivationService } from './activationService';
import {
  isSequenceKind,
  SEQUENCE_DEFAULT_KIND,
  SEQUENCE_DRAW_POLICIES,
  type SequenceKind,
} from './sequenceOptions';

/** 连线服务的结构子集：消息借用的拉线管线 + 条边让位的重路由入口 */
export type ISequenceLine = Pick<LineService, 'drawHandlers' | 'drawPolicyProbe' | 'reattach'>;

/** 激活条手势要写的协作者（组合根注入）。缺省 = 无激活条图元：'activation' 种类
 *  转发为 no-op（桩环境 / 未组装时序图的组合） */
export interface ISequenceTools {
  engine: IDataEngineService;
  history: IHistoryService;
  selector: ISelectorService;
}

/**
 * 时序图工具（specs/sequence-diagram §7.1）：一个 CursorMode（'sequence'）对应
 * 多种图元。一个模式只能注册一组处理器——本服务是 'sequence' 的**唯一注册者**，
 * 事件到达时才解析当前图元种类并转发到该图元自己的服务（它们不注册；
 * LifelineService / ActivationService 的 initialize 抛错防误调）：生命线 → 生命线
 * 服务；激活条 → 本服务持有的激活条手势（activationService）；消息 → 连线拉线
 * 管线（lineService.drawHandlers）+ 种类对应的拉线策略；片段随后续批次追加。
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

  private readonly line: ISequenceLine | null = null;
  /** 激活条创建手势（tools 注入时才有；随本服务释放） */
  private readonly activation: ActivationService | null = null;

  constructor(
    private readonly viewport: IViewportService,
    private readonly vmEngine: IVmEngineService,
    private readonly lifeline: LifelineService,
    line: ISequenceLine | null = null,
    tools: ISequenceTools | null = null,
  ) {
    super();
    this.line = line;
    // 策略探针读「当前种类 + 当前模式」：通用连线工具（'line' 模式）与消息共用同一组
    // drawHandlers，只在时序图工具激活时才给策略，不得被劫持
    if (line) line.drawPolicyProbe = () => this.drawPolicy();
    this.activation = tools
      ? new ActivationService(viewport, tools.engine, tools.history, tools.selector, vmEngine, line)
      : null;
    if (this.activation) this.addDisposable(this.activation);
  }

  private drawPolicy(): ILineDrawPolicy | undefined {
    return this.viewport.cursorMode$.value === 'sequence'
      ? SEQUENCE_DRAW_POLICIES[this.kind]
      : undefined;
  }

  /** 种类 → 处理器：生命线走生命线服务，激活条走本服务持有的手势，消息走连线管线 */
  private targetOf(kind: SequenceKind): IPointerHandlers {
    if (kind === 'lifeline') return this.lifeline.handlers;
    if (kind === 'activation') return this.activation?.handlers ?? {};
    return this.line?.drawHandlers ?? {};
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
    onPointerDown: (e: IPointerEventInfo) => this.targetOf(this.kind).onPointerDown?.(e),
    onPointerMove: (e: IPointerEventInfo) => this.targetOf(this.kind).onPointerMove?.(e),
    onPointerUp: (e: IPointerEventInfo) => this.targetOf(this.kind).onPointerUp?.(e),
    onPointerUpOutside: (e: IPointerEventInfo) => this.targetOf(this.kind).onPointerUpOutside?.(e),
    onPointerCancel: (e: IPointerEventInfo) => this.targetOf(this.kind).onPointerCancel?.(e),
    onRightClick: (e: IPointerEventInfo) => this.targetOf(this.kind).onRightClick?.(e),
  };

  initialize(): void {
    this.viewport.registerGlobalEventListener('sequence', this.handlers);
  }
}
