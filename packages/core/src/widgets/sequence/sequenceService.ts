import { BehaviorSubject } from 'rxjs';
import { Disposable } from '../../base/disposable';
import type { IRect } from '../../common/geometry';
import type { ILineDrawPolicy } from '../line/lineAxisAnchor';
import type { LineService } from '../line/lineService';
import type {
  IActivationLookup,
  IAxisAnchor,
  IDataEngineService,
  IHistoryService,
  IPointerEventInfo,
  IPointerHandlers,
  ISequenceLookup,
  ISelectorService,
  IViewportService,
  IVmEngineService,
  LifelineData,
} from '../../types';
import { isAxisHost } from '../line/lineAxisAnchor';
import type { FrameService } from '../frame/frameService';
import type { LifelineService } from './lifelineService';
import { ActivationService } from './activationService';
import { lifelineAxis } from './lifelineGeometry';
import { activationBind, ACTIVATION_WIDTH, resolveActivationHost } from './sequenceOps';
import {
  isFragmentKind,
  isSequenceKind,
  SEQUENCE_DEFAULT_KIND,
  SEQUENCE_DRAW_POLICIES,
  SEQUENCE_FRAGMENT_PRESETS,
  type SequenceKind,
} from './sequenceOptions';

/** 连线服务的结构子集：消息借用的拉线管线 + 条边让位的重路由入口 */
export type ISequenceLine = Pick<LineService, 'drawHandlers' | 'drawPolicyProbe' | 'reattach'>;

/** 时序图工具要写的协作者（组合根注入）。缺省 = 无激活条图元 / 无片段：'activation'
 *  转发为 no-op，片段种类转发为 no-op（桩环境 / 未组装时序图的组合） */
export interface ISequenceTools {
  engine: IDataEngineService;
  history: IHistoryService;
  selector: ISelectorService;
  /** 容器工具（片段 = 容器手势 + 创建预设，§6.1）。它的 handlers 与 C 工具共用同一对象 */
  frame?: Pick<FrameService, 'handlers' | 'createPreset'> | null;
}

/**
 * 时序图工具（specs/sequence-diagram §7.1）：一个 CursorMode（'sequence'）对应
 * 多种图元。一个模式只能注册一组处理器——本服务是 'sequence' 的**唯一注册者**，
 * 事件到达时才解析当前图元种类并转发到该图元自己的服务（它们不注册；
 * LifelineService / ActivationService 的 initialize 抛错防误调）：生命线 → 生命线
 * 服务；激活条 → 本服务持有的激活条手势（activationService）；消息 / 分隔线 →
 * 连线拉线管线（lineService.drawHandlers）+ 种类对应的拉线策略；片段 → 容器工具的
 * 手势（frameService.handlers）+ 创建预设。
 *
 * 种类记忆是会话级（不落库不持久化），经 kind$ 汇入工具默认参数表——工具坞
 * 二级菜单读写同一个值（docs/04 §2 工具默认参数节）。
 *
 * 兼任 ISequenceLookup（specs/sequence-diagram §9.4）：VM（生命线锚点让位、轴消息
 * 平移）经构造注入的只读查询——组合根注册的是晚绑定门面（Tokens.SequenceLookup），
 * VM 不持服务引用。
 */
export class SequenceService extends Disposable implements IActivationLookup, ISequenceLookup {
  private kind: SequenceKind = SEQUENCE_DEFAULT_KIND;
  readonly kind$ = new BehaviorSubject<SequenceKind>(SEQUENCE_DEFAULT_KIND);

  private readonly line: ISequenceLine | null = null;
  /** 激活条创建手势（tools 注入时才有；随本服务释放） */
  private readonly activation: ActivationService | null = null;
  /** 绑定写入面（tools 注入时才有；缺省 = 三个级联钩子 no-op） */
  private readonly engine: IDataEngineService | null = null;
  /** 容器工具（tools 注入时才有）：片段转发它的手势、逐事件刷新它的创建预设 */
  private readonly frame: ISequenceTools['frame'] = null;

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
    this.engine = tools?.engine ?? null;
    this.frame = tools?.frame ?? null;
  }

  private drawPolicy(): ILineDrawPolicy | undefined {
    return this.viewport.cursorMode$.value === 'sequence'
      ? SEQUENCE_DRAW_POLICIES[this.kind]
      : undefined;
  }

  /** 种类 → 处理器：生命线走生命线服务，激活条走本服务持有的手势，消息 / 分隔线走
   *  连线管线，片段走容器工具 */
  private targetOf(kind: SequenceKind): IPointerHandlers {
    if (isFragmentKind(kind)) {
      // 片段 = 容器工具的手势 + 预设（§6.1）。预设逐事件刷新：frame.handlers 与容器
      // 工具（C）共用同一对象，不清会串到 C 工具上——其余种类在这里清，离开本工具
      // 由 initialize 的模式订阅清
      if (this.frame) this.frame.createPreset = SEQUENCE_FRAGMENT_PRESETS[kind] ?? null;
      return this.frame?.handlers ?? {};
    }
    if (this.frame) this.frame.createPreset = null;
    if (kind === 'lifeline') return this.lifeline.handlers;
    if (kind === 'activation') return this.activation?.handlers ?? {};
    return this.line?.drawHandlers ?? {};
  }

  /** 轴宿主的轴（视觉感知）；非轴宿主 / vm 缺失返回 null */
  axisOf(id: string): IAxisAnchor | null {
    return this.vmEngine.getVmById(id)?.getAxisAnchor?.() ?? null;
  }

  /** 绑定在某条生命线上的激活条的世界矩形（预览敏感）。绑定经条 VM 的宿主探针读
   *  模型（不是微任务合批的 state）；每次新数组 */
  barsOf(lifelineId: string): IRect[] {
    const out: IRect[] = [];
    for (const vm of this.vmEngine.getAllVms()) {
      if (vm.anchorFollowHosts?.()?.[0] !== lifelineId) continue;
      out.push(vm.getBounds());
    }
    return out;
  }

  // ---- IActivationLookup（specs/sequence-diagram §5.3）：激活条随生命线的级联钩子 ----

  /** 生命线 → 并入其绑定的激活条（zOrder 升序）。非激活条的入参由合成方原样保留 */
  expandActivations(ids: string[]): string[] {
    const wanted = new Set(ids);
    const bars: Array<{ id: string; z: string }> = [];
    for (const vm of this.vmEngine.getAllVms()) {
      const host = vm.anchorFollowHosts?.()?.[0];
      if (host === undefined || !wanted.has(host)) continue;
      bars.push({ id: vm.id, z: this.engine?.getModelById(vm.id)?.toJSON().zOrder ?? '' });
    }
    return bars.sort((a, b) => (a.z < b.z ? -1 : a.z > b.z ? 1 : 0)).map((b) => b.id);
  }

  /** 落点绑定判定并落库（§5.1）——只在事务内调用（S7）。只看选区里的激活条；条与
   *  宿主的几何全走 rectOf / 模型（陷阱 13）：绑定写 update({ lifelineId })，归中
   *  另走 updateRect({ x })——update 会丢弃几何键 */
  reconcileActivations(ids: string[], rectOf: (id: string) => IRect): void {
    const engine = this.engine;
    if (!engine) return;
    let hosts: ReadonlyArray<{ id: string; axis: IAxisAnchor }> | null = null;
    for (const id of ids) {
      const vm = this.vmEngine.getVmById(id);
      if (!vm?.anchorFollowHosts) continue; // 只有激活条参与
      const model = engine.getModelById(id);
      if (!model) continue;
      hosts ??= this.axisHosts(rectOf);
      const rect = rectOf(id);
      const hostId = resolveActivationHost(rect, hosts);
      const bind = activationBind(
        rect,
        hosts.find((h) => h.id === hostId),
        vm.anchorFollowHosts()[0],
      );
      if (!bind) continue;
      if ('lifelineId' in bind) model.update({ lifelineId: bind.lifelineId } as never);
      if (bind.x !== undefined) model.updateRect({ x: bind.x });
    }
  }

  /** 粘贴收尾（§5.4）——只在事务内调用：无绑定的副本落在轴上即绑定并归中，随后
   *  重路由宿主（条边让位并进粘贴这一步撤销）。宿主 vm 可能还没渲染，几何用模型矩形 */
  adoptActivationsByLanding(ids: string[]): void {
    const engine = this.engine;
    if (!engine) return;
    const modelRectOf = (id: string): IRect => {
      const d = engine.getModelById(id)?.toJSON() as Partial<IRect> | undefined;
      return { x: d?.x ?? 0, y: d?.y ?? 0, width: d?.width ?? 0, height: d?.height ?? 0 };
    };
    const fresh = ids.filter((id) => {
      const vm = this.vmEngine.getVmById(id);
      return !!vm?.anchorFollowHosts && vm.anchorFollowHosts().length === 0;
    });
    if (fresh.length === 0) return;
    const hosts = this.axisHosts(modelRectOf);
    for (const id of fresh) {
      const model = engine.getModelById(id);
      if (!model) continue;
      const rect = modelRectOf(id);
      const hit = hosts.find((h) => h.id === resolveActivationHost(rect, hosts));
      if (!hit) continue;
      model.update({ lifelineId: hit.id } as never);
      model.updateRect({ x: hit.axis.x - ACTIVATION_WIDTH / 2 });
      this.line?.reattach(hit.id, { rect: modelRectOf(hit.id), rotation: 0 });
    }
  }

  /** 轴宿主清单（zOrder 降序 = 多条命中取最上）。轴由 rectOf + 模型 head 算术推导：
   *  事务内不读 vm——生命线与它的条同选同拖时，vm 几何还是拖拽前的旧值 */
  private axisHosts(rectOf: (id: string) => IRect): Array<{ id: string; axis: IAxisAnchor }> {
    const out: Array<{ id: string; z: string; axis: IAxisAnchor }> = [];
    for (const vm of this.vmEngine.getAllVms()) {
      if (!isAxisHost(vm)) continue;
      const data = this.engine?.getModelById(vm.id)?.toJSON() as Partial<LifelineData> | undefined;
      const axis = data ? lifelineAxis(rectOf(vm.id), data.head) : null;
      if (axis) out.push({ id: vm.id, z: data?.zOrder ?? '', axis });
    }
    return out.sort((a, b) => (a.z < b.z ? 1 : a.z > b.z ? -1 : 0));
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
    // 离开时序图工具即清片段预设：切到容器工具（C）后不会再有时序图事件来清，
    // 留着会让 C 工具建出无填充的片段（两者共用同一组 handlers）
    const modeSub = this.viewport.cursorMode$.subscribe((mode) => {
      if (mode !== 'sequence' && this.frame) this.frame.createPreset = null;
    });
    this.addDisposable(() => modeSub.unsubscribe());
  }
}
