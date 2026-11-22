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
import { FRAME_DEFAULT_COLOR, FRAME_DEFAULT_SIZE, FRAME_MIN_SIZE } from './frameGeometry';

/**
 * 容器工具与归属服务（specs/container-frame §4.1/§6.4）：DragCreateServiceBase
 * 模板——单击默认尺寸按下点居中、拖拽跟手草稿、松手选中回 cursor；网格吸附
 * 经 bindGridSnap。归属判定/级联展开/标题编辑在后续批次接入（vmEngine/
 * editingService 构造注入即为此预留——显式依赖铁律，不用时保持可空消费）。
 */
export class FrameService extends DragCreateServiceBase {
  protected readonly scope = 'frame' as const;
  protected readonly defaultSize = FRAME_DEFAULT_SIZE;
  protected override readonly minDraftSize = FRAME_MIN_SIZE;

  /** 基类构造是 protected（模板基类不直接实例化）——子类显式公开（SymbolService 同款） */
  constructor(
    viewport: IViewportService,
    engine: IDataEngineService,
    /** 归属判定的几何/类型读取（后续批次 reconcileParents/childIds 用） */
    private readonly vmEngine: IVmEngineService,
    selector: ISelectorService,
    history: IHistoryService,
    /** 标题 plain 编辑会话（§4.10，后续批次 enterTitleEdit 用） */
    private readonly editingService: IEditingService | null,
  ) {
    super(viewport, engine, history, selector);
  }

  override createWidget(x: number, y: number, width: number, height: number): string {
    const id = genId();
    // 创建不收养既有元素（§0.2 拍板）：归属只来自「落入」或显式菜单——
    // 只写容器自身，样式缺省走 schema（title ''/borderStyle solid）
    this.engine.add({
      id,
      type: 'FRAME',
      zOrder: this.engine.genInitialOrder(),
      color: FRAME_DEFAULT_COLOR,
      x,
      y,
      width,
      height,
    } as never);
    return id;
  }
}
