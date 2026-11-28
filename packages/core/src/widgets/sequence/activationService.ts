import type {
  CursorMode,
  IDataEngineService,
  IHistoryService,
  IPointerEventInfo,
  ISelectorService,
  IVmEngineService,
  IViewportService,
} from '../../types';
import type { IAxisAnchor } from '../../types/base';
import type { IRect } from '../../common/geometry';
import { DragCreateServiceBase } from '../base/dragCreateServiceBase';
import { genId } from '../../utils/id';
import { hitWidget } from '../line/lineHitTest';
import { isAxisHost } from '../line/lineAxisAnchor';
import type { LineService } from '../line/lineService';
import {
  ACTIVATION_DEFAULT_DROP,
  ACTIVATION_MIN_HEIGHT,
  ACTIVATION_WIDTH,
  activationDropRect,
} from './sequenceOps';

/** 条边让位的重路由端口（LineService 的结构子集；未组装 = 新建后不重路由） */
export type IActivationReroute = Pick<LineService, 'reattach'>;

/**
 * 激活条创建手势（specs/sequence-diagram §7.1，批次 3）：`DragCreateServiceBase`
 * 模板 + 四个钩子——
 * - 按下门禁：必须命中轴宿主且按下高度在轴段内（点头框 / 轴旁空白 / 压在轴上的
 *   普通件都不建）；不调 super，本次手势的 move / up 全部空转。
 * - 落点矩形：x 归中到轴、顶 = 按下高度、高度跟手（钳 ≥ 16，底不出轴底；向上拖
 *   钳到 16）；单击向下 80。按下点距轴底不足 16 不建。不量化网格（恒宽条无意义）。
 * - 创建数据直接带 `lifelineId`（§9.6 陷阱 7：不走创建后写入）。
 * - 落库后、stopCapturing 之前重路由宿主生命线上的消息——条边让位与创建同一步撤销。
 *
 * 本服务**不注册指针处理器**：'sequence' 模式由 SequenceService 唯一注册，事件按
 * 当前图元种类转发到这里（与生命线服务同款）。
 */
export class ActivationService extends DragCreateServiceBase {
  /** 基类的模式键：只用于基类语义占位——注册由 SequenceService 负责 */
  protected readonly scope: CursorMode = 'sequence';
  protected readonly defaultSize = { width: ACTIVATION_WIDTH, height: ACTIVATION_DEFAULT_DROP };
  protected override readonly minDraftSize = {
    width: ACTIVATION_WIDTH,
    height: ACTIVATION_MIN_HEIGHT,
  };
  /** 本次手势按下的轴宿主（门禁通过才有值） */
  private host: { id: string; axis: IAxisAnchor } | null = null;

  constructor(
    viewport: IViewportService,
    engine: IDataEngineService,
    history: IHistoryService,
    selector: ISelectorService,
    private readonly vmEngine: IVmEngineService,
    private readonly line: IActivationReroute | null,
  ) {
    super(viewport, engine, history, selector);
  }

  /** 同 LifelineService：误调会覆盖 SequenceService 的注册（§9.6 陷阱 6） */
  override initialize(): void {
    throw new Error(
      '[ActivationService] 不注册指针处理器：由 SequenceService 转发（specs/sequence-diagram §7.1）',
    );
  }

  protected override onPointerDown(e: IPointerEventInfo): void {
    this.host = null;
    if (!this.viewport.editable$.value) return;
    // 拾取走连线同款 hitWidget：压在轴上的激活条 / 消息线被跳过，取到下层生命线
    const hit = hitWidget(this.vmEngine, this.viewport, e.world);
    const vm = hit ? this.vmEngine.getVmById(hit.id) : null;
    const axis = isAxisHost(vm) ? vm.getAxisAnchor() : null;
    if (!hit || !axis || e.world.y < axis.top || e.world.y > axis.bottom) return;
    this.host = { id: hit.id, axis };
    super.onPointerDown(e);
  }

  protected override onPointerCancel(): void {
    super.onPointerCancel();
    this.host = null;
  }

  protected override clickRect(): IRect | null {
    return this.dropRect(ACTIVATION_DEFAULT_DROP);
  }

  /** 只认纵向下拉量：横向偏移由 x 归中吸收 */
  protected override draftRect(_dx: number, dy: number): IRect | null {
    return this.dropRect(dy);
  }

  private dropRect(drop: number): IRect | null {
    return this.host ? activationDropRect(this.host.axis, this.start!.y, drop) : null;
  }

  protected createWidget(x: number, y: number, width: number, height: number): string {
    const id = genId();
    this.engine.add({
      id,
      type: 'ACTIVATION',
      zOrder: this.engine.genInitialOrder(),
      x,
      y,
      width,
      height,
      lifelineId: this.host!.id,
    });
    return id;
  }

  protected override afterCreate(): void {
    const host = this.host;
    this.host = null;
    const geom = host ? (this.vmEngine.getVmById(host.id)?.getHostGeom() ?? null) : null;
    if (host && geom) this.line?.reattach(host.id, geom);
  }
}
