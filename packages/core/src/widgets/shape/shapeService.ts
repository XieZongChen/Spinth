import { BehaviorSubject } from 'rxjs';
import { DragCreateServiceBase } from '../base/dragCreateServiceBase';
import { genId } from '../../utils/id';
import { ShapeTypeSchema, type IActionBarOption, type ShapeType } from '../../types';
import type {
  IDataEngineService,
  IHistoryService,
  ISelectorService,
  IViewportService,
} from '../../types';

/** 单击创建默认尺寸 / 拖拽创建（docs/04 §2 Service 交互层）；三段流在基类 */
const DEFAULT_WIDTH = 120;
const DEFAULT_HEIGHT = 80;
/** 拖拽草稿的最小边（视觉规格） */
const MIN_SIZE = 8;

/** 四型选项单源（docs/04 §2 形状默认型小节）：工具坞常驻二级菜单与 ActionBar
 *  shapeType 切换 popover 共用——icon = @spinth/react Icon 语义名 */
export const SHAPE_TYPE_OPTIONS: IActionBarOption[] = [
  { id: 'rect', label: '矩形', icon: 'shape-rect' },
  { id: 'round-rect', label: '圆角矩形', icon: 'shape-round-rect' },
  { id: 'ellipse', label: '椭圆', icon: 'shape-ellipse' },
  { id: 'diamond', label: '菱形', icon: 'shape-diamond' },
  { id: 'triangle-up', label: '上三角', icon: 'shape-triangle-up' },
  { id: 'triangle-down', label: '下三角', icon: 'shape-triangle-down' },
  { id: 'parallelogram-right', label: '右平行四边形', icon: 'shape-parallelogram-right' },
  { id: 'parallelogram-left', label: '左平行四边形', icon: 'shape-parallelogram-left' },
  { id: 'eng-database', label: '数据库', icon: 'shape-eng-database' },
  { id: 'eng-queue', label: '队列', icon: 'shape-eng-queue' },
  { id: 'eng-file', label: '文件', icon: 'shape-eng-file' },
  { id: 'eng-folder', label: '文件夹', icon: 'shape-eng-folder' },
  { id: 'stadium', label: '起止', icon: 'shape-stadium' },
  { id: 'document', label: '文档', icon: 'shape-document' },
  { id: 'hexagon', label: '六边形', icon: 'shape-hexagon' },
  { id: 'predefined-process', label: '子过程', icon: 'shape-predefined-process' },
  { id: 'trapezoid-up', label: '上梯形', icon: 'shape-trapezoid-up' },
  { id: 'trapezoid-down', label: '下梯形', icon: 'shape-trapezoid-down' },
  { id: 'delay', label: '延迟', icon: 'shape-delay' },
  { id: 'off-page', label: '页连接', icon: 'shape-off-page' },
];

export class ShapeService extends DragCreateServiceBase {
  protected readonly scope = 'shape' as const;
  protected readonly defaultSize = { width: DEFAULT_WIDTH, height: DEFAULT_HEIGHT };
  protected override readonly minDraftSize = { width: MIN_SIZE, height: MIN_SIZE };

  /** 工具默认创建型（会话级工具参数，eraserSize 同族——不落库不持久化）：
   *  工具坞常驻二级菜单写、createWidget 与 ToolGhost 图标读 */
  private defaultType: ShapeType = 'rect';
  readonly defaultShapeType$ = new BehaviorSubject<ShapeType>('rect');

  constructor(
    viewport: IViewportService,
    engine: IDataEngineService,
    history: IHistoryService,
    selector: ISelectorService,
  ) {
    super(viewport, engine, history, selector);
  }

  get defaultShapeType(): ShapeType {
    return this.defaultType;
  }

  /** 二级菜单写通道（zod 校验；非手势无编辑冲突面，不做模式自查） */
  setDefaultShapeType(t: ShapeType): void {
    const parsed = ShapeTypeSchema.parse(t);
    if (parsed === this.defaultType) return;
    this.defaultType = parsed;
    this.defaultShapeType$.next(parsed);
  }

  protected override createWidget(x: number, y: number, width: number, height: number): string {
    const model = this.engine.add({
      id: genId(),
      type: 'SHAPE',
      zOrder: this.engine.genInitialOrder(),
      shapeType: this.defaultType,
      color: '#e8f0fb',
      borderStyle: 'solid',
      // 文字撑高形状（docs/17 §6 autoHeight 隐式默认开；engine.add 不跑 zod
      // parse，须显式传——老文档 undefined 消费侧 ?? true 同语义）
      autoHeight: true,
      // 几何（DataProcessor 拆到 yRect）
      x,
      y,
      width,
      height,
    } as never);
    return model.id;
  }
}
