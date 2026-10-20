import { BehaviorSubject } from 'rxjs';
import type { IActionBarOption } from '../../types';
import { Disposable } from '../../base/disposable';
import { genId } from '../../utils/id';
import type {
  IDataEngineService,
  IHistoryService,
  IPointerEventInfo,
  IViewportService,
} from '../../types';
import type { PenModel } from './penModel';

/** 采样节流（既有设计 60ms 同款） */
const SAMPLE_MS = 60;

/** 画笔默认色六色（docs/04 §2 工具默认参数节）：与 LINE/PEN ActionBar 色板同源——
 *  id/swatch = hex，label 走 hex（色板类选项无中文文案惯例，tooltip 由 UI 兜底） */
export const PEN_COLOR_PALETTE = [
  '#4b5563',
  '#1f2937',
  '#2563eb',
  '#dc2626',
  '#059669',
  '#d97706',
] as const;
export const PEN_COLOR_OPTIONS = PEN_COLOR_PALETTE.map((hex) => ({
  id: hex,
  label: hex,
  swatch: hex,
}));

/** 笔宽四档（线宽笔宽批 2026-10-14）：2/4/8/12，默认 4——icon 圆点大小示意；
 *  flyout 第二组与 ActionBar popover 共用；超越既有设计两档（2/6） */
export const PEN_WIDTH_STEPS = [2, 4, 8, 12] as const;
export const PEN_WIDTH_OPTIONS: IActionBarOption[] = PEN_WIDTH_STEPS.map((n) => ({
  id: String(n),
  label: `${n} 像素笔宽`,
  icon: `pen-width-${n}`,
}));

/** 画笔交互层：pen 工具按下起笔 → move 节流采样全量写 → up 收笔 */
export class PenService extends Disposable {
  /** 工具默认颜色（会话级，docs/04 §2——初始 #1f2937 = 原创建硬编码值） */
  private defaultColor = '#1f2937';
  readonly defaultColor$ = new BehaviorSubject<string>(this.defaultColor);

  /** 工具默认笔宽（会话级，线宽笔宽批）：四档 2/4/8/12，默认 4（与 schema default 同源） */
  private defaultWidth = 4;
  readonly defaultStrokeWidth$ = new BehaviorSubject<number>(4);

  private drawingId: string | null = null;
  private lastSample = 0;

  get defaultPenColor(): string {
    return this.defaultColor;
  }

  get defaultStrokeWidth(): number {
    return this.defaultWidth;
  }

  /** 工具坞/ActionBar 写通道：档位制（非档位值静默拒绝，line 宽同款） */
  setDefaultStrokeWidth(w: number): void {
    if (!PEN_WIDTH_STEPS.includes(w as (typeof PEN_WIDTH_STEPS)[number])) return;
    if (w === this.defaultWidth) return;
    this.defaultWidth = w;
    this.defaultStrokeWidth$.next(w);
  }

  /** 工具坞二级菜单写通道（hex 校验；非手势无编辑冲突面） */
  setDefaultPenColor(hex: string): void {
    if (typeof hex !== 'string' || !/^#[0-9a-f]{6}$/i.test(hex)) return;
    if (hex === this.defaultColor) return;
    this.defaultColor = hex;
    this.defaultColor$.next(hex);
  }

  constructor(
    private viewport: IViewportService,
    private engine: IDataEngineService,
    private history: IHistoryService,
  ) {
    super();
  }

  initialize(): void {
    this.viewport.registerGlobalEventListener('pen', {
      onPointerDown: (e) => this.onPointerDown(e),
      onPointerMove: (e) => this.onPointerMove(e),
      onPointerUp: () => this.onPointerUp(),
      onPointerUpOutside: () => this.onPointerUp(),
      // 手势取消（Batch 1 · 1.9）：打断 ≠ 点击——残留笔按 up 同款收尾
      // （<2 点删除防孤儿、已成形笔 stopCapturing 切 undo 项），不选中新件
      onPointerCancel: () => this.onPointerUp(),
    });
  }

  private onPointerDown(e: IPointerEventInfo): void {
    const id = genId();
    this.drawingId = id;
    this.lastSample = 0;
    this.engine.add({
      id,
      type: 'PEN',
      zOrder: this.engine.genInitialOrder(),
      points: [[e.world.x, e.world.y]],
      color: this.defaultColor,
      // 默认档零字段（fontSize 先例）：=4 不落库回落 schema default
      ...(this.defaultWidth !== 4 ? { strokeWidth: this.defaultWidth } : {}),
    } as never);
  }

  private onPointerMove(e: IPointerEventInfo): void {
    if (!this.drawingId) return;
    const now = performance.now();
    if (now - this.lastSample < SAMPLE_MS) return;
    this.lastSample = now;
    const model = this.engine.getModelById(this.drawingId) as PenModel | undefined;
    // Y.Array 增量 push（update 帧只含新点，docs/16 §2）
    model?.appendPoint([e.world.x, e.world.y]);
  }

  private onPointerUp(): void {
    if (!this.drawingId) return;
    // 单点（未拖动）→ 删除
    const model = this.engine.getModelById(this.drawingId);
    if (model) {
      const pts = (model.toJSON() as unknown as { points: unknown[] }).points;
      if (pts.length < 2) {
        this.engine.removeByIds([this.drawingId]);
      } else {
        this.history.stopCapturing();
      }
    }
    this.drawingId = null;
  }
}
