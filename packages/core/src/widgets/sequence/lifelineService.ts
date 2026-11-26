import { DragCreateServiceBase } from '../base/dragCreateServiceBase';
import { genId } from '../../utils/id';
import type {
  IDataEngineService,
  IEditingService,
  IHistoryService,
  ISelectorService,
  IVmEngineService,
  IViewportService,
} from '../../types';
import type { IPoint } from '../../common/geometry';
import {
  LIFELINE_DEFAULT_HEIGHT,
  LIFELINE_DEFAULT_WIDTH,
  LIFELINE_MIN_HEIGHT,
  LIFELINE_MIN_WIDTH,
} from './lifelineGeometry';
import { LifelineLabelEditor } from './lifelineLabelEditor';

/**
 * 生命线工具（specs/sequence-diagram §6，批次 1）：DragCreateServiceBase 模板——
 * 单击默认 120×520 按下点居中、工具保持可连击；拖拽跟手草稿（下限 60×120）、
 * 松手选中回选择工具；网格吸附经 bindGridSnap 接线（起止角量化）。
 *
 * 本服务**不注册指针处理器**：'sequence' 模式的处理器由 SequenceService 唯一注册，
 * 事件按当前图元种类转发到这里（一个 CursorMode 只能有一组处理器）。创建一次
 * 事务写 { type:'LIFELINE', label:'', ...rect }；标签编辑走 LifelineLabelEditor。
 */
export class LifelineService extends DragCreateServiceBase {
  /** 基类的模式键：只用于基类语义占位——注册由 SequenceService 负责 */
  protected readonly scope = 'sequence' as const;
  protected readonly defaultSize = {
    width: LIFELINE_DEFAULT_WIDTH,
    height: LIFELINE_DEFAULT_HEIGHT,
  };
  protected override readonly minDraftSize = {
    width: LIFELINE_MIN_WIDTH,
    height: LIFELINE_MIN_HEIGHT,
  };

  /** 标签编辑协作者（§3.7，FRAME 标题编辑器同款） */
  private readonly labelEditor: LifelineLabelEditor;

  /** 基类构造是 protected（模板基类不直接实例化）——子类显式公开（SymbolService 同款） */
  constructor(
    viewport: IViewportService,
    engine: IDataEngineService,
    vmEngine: IVmEngineService,
    selector: ISelectorService,
    history: IHistoryService,
    editingService: IEditingService | null,
  ) {
    super(viewport, engine, history, selector);
    this.labelEditor = new LifelineLabelEditor(viewport, engine, vmEngine, history, editingService);
    this.addDisposable(this.labelEditor);
  }

  /** 误调会覆盖 SequenceService 在 'sequence' 上的注册（整个工具失灵且无报错）——
   *  直接抛错，不让它静默发生 */
  override initialize(): void {
    throw new Error(
      '[LifelineService] 不自行注册指针处理器——由 SequenceService 转发（specs/sequence-diagram §7.1）',
    );
  }

  /** 进入标签编辑（单击已选中生命线的激活通道入口；world 给出时须落在头框内） */
  enterLabelEdit(id: string, world?: IPoint): boolean {
    return this.labelEditor.enterLabelEdit(id, world);
  }

  /** 正在编辑标签的生命线 id（无会话 = null） */
  get editingLabelId(): string | null {
    return this.labelEditor.editingWidgetId;
  }

  override createWidget(x: number, y: number, width: number, height: number): string {
    const id = genId();
    this.engine.add({
      id,
      type: 'LIFELINE',
      zOrder: this.engine.genInitialOrder(),
      label: '',
      x,
      y,
      width,
      height,
    } as never);
    return id;
  }
}
