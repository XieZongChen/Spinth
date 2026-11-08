import { BehaviorSubject } from 'rxjs';
import { DragCreateServiceBase } from '../base/dragCreateServiceBase';
import { STICKY_COLOR_PALETTE, STICKY_DEFAULT_COLOR } from './stickyVm';
import { genId } from '../../utils/id';
import type {
  IDataEngineService,
  IHistoryService,
  ISelectorService,
  IViewportService,
} from '../../types';

const DEFAULT_SIZE = 180;
/** 两轴都拖出 ≥24 才视为拖拽创建（低于此为单击）；创建后回缩到阈值下冻结 */
const STICKY_DRAG_MIN = 24;

/** 便签交互层：sticky 工具单击按默认尺寸落件（以按下点为中心、工具保持可连击）；
 *  拖拽画图（两轴各 ≥24 屏幕 px）完成后选中新件并回选择工具 */
export class StickyService extends DragCreateServiceBase {
  protected readonly scope = 'sticky' as const;
  protected readonly defaultSize = { width: DEFAULT_SIZE, height: DEFAULT_SIZE };

  /** 工具默认底色（会话级，docs/04 §2——初始 = STICKY_DEFAULT_COLOR #fff3b0） */
  private defaultColor = STICKY_DEFAULT_COLOR;
  readonly defaultColor$ = new BehaviorSubject<string>(this.defaultColor);

  get defaultStickyColor(): string {
    return this.defaultColor;
  }

  /** 工具坞二级菜单写通道（限四色板内取值；非手势无编辑冲突面） */
  setDefaultStickyColor(hex: string): void {
    if (!(STICKY_COLOR_PALETTE as readonly string[]).includes(hex)) return;
    if (hex === this.defaultColor) return;
    this.defaultColor = hex;
    this.defaultColor$.next(hex);
  }

  constructor(
    viewport: IViewportService,
    engine: IDataEngineService,
    history: IHistoryService,
    selector: ISelectorService,
  ) {
    super(viewport, engine, history, selector);
  }

  protected override meetsDragThreshold(dx: number, dy: number): boolean {
    // 1.8⑤：屏幕口径（两轴同时过阈的既有语义保留——防细长便签误建）
    const t = STICKY_DRAG_MIN / (this.viewport.vpScale$.value || 1);
    return Math.abs(dx) >= t && Math.abs(dy) >= t;
  }

  protected override shouldFollowDraft(dx: number, dy: number): boolean {
    return this.meetsDragThreshold(dx, dy);
  }

  protected override createWidget(x: number, y: number, width: number, height: number): string {
    const model = this.engine.add({
      id: genId(),
      type: 'STICKY',
      zOrder: this.engine.genInitialOrder(),
      color: this.defaultColor,
      text: '',
      x,
      y,
      width,
      height,
    } as never);
    return model.id;
  }
}
