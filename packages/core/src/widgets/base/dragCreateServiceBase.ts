import { Point } from 'pixi.js';
import { Disposable } from '../../base/disposable';
import type {
  CursorMode,
  IDataEngineService,
  IHistoryService,
  IPointerEventInfo,
  ISelectorService,
  IViewportService,
} from '../../types';
import type { IRect } from '../../common/geometry';
import { DRAG_TRACTION_SCREEN } from '../../common/interaction';

/**
 * 「框型控件」创建工具的模板基类（docs/04 §2，对标既有设计 ShareShapeService）：
 * 指针三段流在基类焊死——down 记起点 → move 过阈值建草稿并跟手 → up 收尾。
 * 松手收尾：单击（未建草稿）按默认尺寸落件、仅划撤销边界，工具保持（可连击
 * 放置）；拖拽画图 stopCapturing + 选中新控件 + 回选择工具。
 * 子类只声明 scope / 默认尺寸 / 阈值与下限，并实现 createWidget 落库。
 */
export abstract class DragCreateServiceBase extends Disposable {
  private start: Point | null = null;
  private editingId: string | null = null;

  protected constructor(
    protected readonly viewport: IViewportService,
    protected readonly engine: IDataEngineService,
    private readonly history: IHistoryService,
    private readonly selector: ISelectorService,
  ) {
    super();
  }

  /** 工具 scope：registerGlobalEventListener 的 mode */
  protected abstract readonly scope: CursorMode;

  /** 单击（未触发拖拽创建）松手时的默认尺寸 */
  protected abstract readonly defaultSize: { width: number; height: number };

  /** 拖拽草稿的最小尺寸下限（跟手期间钳制） */
  protected readonly minDraftSize = { width: 1, height: 1 };

  /** 拖拽创建触发判定（默认：位移达到单击/拖拽分界）。分界复用选中拖拽的起拖
   *  阻尼（10 屏幕 px，docs/05 §4.1）：单击时手抖滑出几 px 不该画出小图形——
   *  屏幕口径每帧现读缩放（世界口径 4x 下要拖 40 屏幕 px、0.05x 下 1px 即触发） */
  protected meetsDragThreshold(dx: number, dy: number): boolean {
    return Math.hypot(dx, dy) >= DRAG_TRACTION_SCREEN / (this.viewport.vpScale$.value || 1);
  }

  /** 草稿创建后每帧是否继续跟手（覆写可实现「回缩到阈值下冻结」等语义） */
  protected shouldFollowDraft(_dx: number, _dy: number): boolean {
    return true;
  }

  /** 落库创建一个控件，返回其 id */
  protected abstract createWidget(x: number, y: number, width: number, height: number): string;

  initialize(): void {
    this.viewport.registerGlobalEventListener(this.scope, {
      // 手势取消（Batch 1 · 1.9）：start/editingId 悬空会使下次 down 覆写 start、
      // 草稿跳变——cancel 显式复位（草稿已成形者 editingId 分支走 up 同款收尾）
      onPointerCancel: () => {
        // 只清会话状态（start/editingId）——不落库（up 会按坐标建件，占位坐标
        // 会产出怪件）；已实时落库的草稿由 undo 回退（stopCapturing 由下次操作切）
        this.start = null;
        this.editingId = null;
      },
      onPointerDown: (e) => {
        this.start = e.world.clone();
      },
      onPointerMove: (e) => this.onPointerMove(e),
      onPointerUp: () => this.onPointerUp(),
      onPointerUpOutside: () => this.onPointerUp(),
    });
  }

  private onPointerMove(e: IPointerEventInfo): void {
    if (!this.start) return;
    const dx = e.world.x - this.start.x;
    const dy = e.world.y - this.start.y;
    if (!this.editingId) {
      if (!this.meetsDragThreshold(dx, dy)) return;
      // 触发瞬间以「起点为锚、当前为对角」建草稿（含下限钳制）；
      // 等值写入由 yRectSet 守卫去重，创建帧无需再跟手写一次
      const r = this.draftRect(dx, dy);
      this.editingId = this.createWidget(r.x, r.y, r.width, r.height);
      return;
    }
    if (this.shouldFollowDraft(dx, dy)) {
      this.engine.getModelById(this.editingId)?.updateRect(this.draftRect(dx, dy));
    }
  }

  /** 松手收尾只看会话状态（起点 / 是否已建草稿），不读松手坐标：单击以按下点
   *  落件，拖拽画图的几何已由最后一帧 move 写入 */
  private onPointerUp(): void {
    if (this.start && !this.editingId) {
      // 单击：默认尺寸，以按下点为中心——按下点是用户瞄准处；单击容许
      // 分界内的滑移，松手点可能偏出近 10 屏幕 px
      const d = this.defaultSize;
      this.createWidget(this.start.x - d.width / 2, this.start.y - d.height / 2, d.width, d.height);
      // 撤销项切分（Batch 1 · 1.11②）：单击创建此前无 stopCapturing——与 500ms
      // 内的下一操作（如随手拖动新件）并成一个 undo 项，「建件+拖动」一起消失
      this.history.stopCapturing();
    }
    if (this.editingId) {
      this.history.stopCapturing();
      // 创建完成即回选择工具并选中新控件——否则用户画完想拖动时
      // 仍在工具模式，每次拖动都误创建新控件
      this.selector.setSelected([this.editingId]);
      this.viewport.setCursorMode('cursor');
    }
    this.start = null;
    this.editingId = null;
  }

  /** 草稿矩形：起点锚定 + 当前为对角 + 下限钳制 */
  private draftRect(dx: number, dy: number): IRect {
    const s = this.start!;
    const m = this.minDraftSize;
    return {
      x: s.x + Math.min(0, dx),
      y: s.y + Math.min(0, dy),
      width: Math.max(m.width, Math.abs(dx)),
      height: Math.max(m.height, Math.abs(dy)),
    };
  }
}
