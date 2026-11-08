import { TYPES_WHERE } from '../../types';
import { Disposable } from '../../base/disposable';
import type { IRect } from '../../common/geometry';
import type {
  IDataEngineService,
  ISelectorService,
  IViewportService,
  IVmEngineService,
} from '../../types';
import {
  buildRefLines,
  snapRect,
  snapResize,
  type IRefLineSet,
  type ISnapResult,
  type IStickyRefLines,
} from './adsorber';
import { snapEqualSpacing, type ISpacingGap } from './spacingGuides';
import { RefLineVm } from './refLineVm';

/** 参照物类型（docs/06 §2）：矩形语义控件全部参与（IMAGE 为未来类型，先登记）。
 *  LINE/PEN 刻意不参与：斜线/笔迹的 bbox 会产生大量无实体的幻影边，误导吸附。 */
// 参照四类从注册表派生（第五刀：能力位 referenceable 单源）
const REFERENCE_TYPES = new Set(TYPES_WHERE('referenceable'));
/** 吸附阈值：6 屏幕像素（换算世界坐标） */
const ADSORB_DISTANCE_SCREEN = 6;
/** 深缩放保护：阈值 < 1 世界单位（zoom > 6x）时跳过吸附——阈值已小于 1 世界
 *  像素，吸附只剩幻影抖动（既有设计先例，误差修复批 A2 一并收口） */
const MIN_ADSORB_DISTANCE_WORLD = 1;

/**
 * 参考线服务（docs/06）：懒重建参照线集（选中/视口/数据变化置脏），
 * 向拖拽（snapForDrag）与缩放（snapResizeEdge）提供吸附与命中线绘制。
 */
export class RefLineService extends Disposable {
  private vm!: RefLineVm;
  private refLines: IRefLineSet = { v: [], h: [] };
  /** 参照物原始矩形（等间距配对用——6 线集丢了矩形形状，docs/06 §7） */
  private referenceRects: IRect[] = [];
  /** 最近一次等间距命中（徽标数据；E2E 探针消费） */
  private lastGaps: ISpacingGap[] = [];
  /** 粘滞会话状态：上一帧命中线（docs/06 §3）。Service 持有、显式传参给纯函数，
   *  纯函数保持幂等（docs/14 规则 3 边界）；hideMatches / 深缩放跳过时清空 */
  private sticky: IStickyRefLines = { v: [], h: [] };
  private dirty = true;

  constructor(
    private viewport: IViewportService,
    private vmEngine: IVmEngineService,
    /** 惰性获取 selector：与 SelectorService 相互依赖，组合根用 getter 解环 */
    private getSelector: () => ISelectorService,
    private engine: IDataEngineService,
  ) {
    super();
  }

  initialize(): void {
    this.vm = new RefLineVm(this.viewport.optionLayer);
    const markDirty = (): void => {
      this.dirty = true;
    };
    this.addDisposable(
      this.getSelector().selected$.subscribe(markDirty),
      this.viewport.vpBounds$.subscribe(markDirty),
      this.engine.onModelCreated$.subscribe(markDirty),
      this.engine.onModelRemoved$.subscribe(markDirty),
      // 几何变化置脏（docs/06 §3）：本地交互面 pointerdown 必 setSelected（selected$
      // 无 diff、每次发射）天然重建——本通道补的是**拖拽/缩放进行中**的其他元素
      // 几何变化（协同远端移动等选中/视窗/增删都不触发的窗口）与语义正确性
      this.engine.onModelUpdated$.subscribe(markDirty),
    );
  }

  /** 拖拽吸附：rect 为拖拽元素的初始包围盒。对齐（红）与等间距（橙）同 move
   *  内合并——同轴比较两者偏差，**更小者胜**（docs/06 §7：弱对齐不再截胡
   *  更准的等距解；平局对齐胜，语义更强）；异轴并存 */
  snapForDrag(initialRect: IRect, dx: number, dy: number): ISnapResult {
    const threshold = this.currentThreshold();
    this.lastGaps = [];
    if (threshold === null) {
      this.sticky = { v: [], h: [] };
      return { dx, dy, matchedV: [], matchedH: [] };
    }
    this.rebuildIfDirty();
    const align = snapRect(initialRect, dx, dy, this.refLines, threshold, this.sticky);
    const spacing = snapEqualSpacing(initialRect, dx, dy, this.referenceRects, threshold);
    // 同轴偏差比较：偏差 = |修正后位移 − 期望位移|（吸附拉动量）
    const alignWinsV =
      align.matchedV.length > 0 &&
      !(
        spacing.gaps.some((g) => g.axis === 'x') &&
        Math.abs(spacing.dx - dx) < Math.abs(align.dx - dx)
      );
    const alignWinsH =
      align.matchedH.length > 0 &&
      !(
        spacing.gaps.some((g) => g.axis === 'y') &&
        Math.abs(spacing.dy - dy) < Math.abs(align.dy - dy)
      );
    // 粘滞回写：只记实际画出的对齐线（该轴让位等距或未命中即清）
    this.sticky = {
      v: alignWinsV ? (align.matchedVDefs ?? []) : [],
      h: alignWinsH ? (align.matchedHDefs ?? []) : [],
    };
    const outDx = alignWinsV ? align.dx : spacing.dx;
    const outDy = alignWinsH ? align.dy : spacing.dy;
    const gaps = [
      ...(alignWinsV ? [] : spacing.gaps.filter((g) => g.axis === 'x')),
      ...(alignWinsH ? [] : spacing.gaps.filter((g) => g.axis === 'y')),
    ];
    this.lastGaps = gaps;
    const result: ISnapResult = {
      dx: outDx,
      dy: outDy,
      matchedV: alignWinsV ? align.matchedV : [],
      matchedH: alignWinsH ? align.matchedH : [],
    };
    this.drawMatches(result.matchedV, result.matchedH, gaps);
    return result;
  }

  /** dev/E2E：最近一次等间距命中的徽标数据（拖拽 move 间有效，up 后清） */
  get __spacingGaps(): ISpacingGap[] {
    return this.lastGaps;
  }

  /** 缩放吸附：只吸附被拖动的边 */
  snapForResize(rect: IRect, dir: string): { rect: IRect; matchedV: number[]; matchedH: number[] } {
    const threshold = this.currentThreshold();
    if (threshold === null) return { rect, matchedV: [], matchedH: [] };
    this.rebuildIfDirty();
    const result = snapResize(rect, dir, this.refLines, threshold);
    this.drawMatches(result.matchedV, result.matchedH, []);
    return result;
  }

  /** 当前世界阈值；深缩放（zoom > 6x）返回 null = 跳过吸附 */
  private currentThreshold(): number | null {
    const threshold = ADSORB_DISTANCE_SCREEN / this.viewport.vpScale$.value;
    return threshold < MIN_ADSORB_DISTANCE_WORLD ? null : threshold;
  }

  hideMatches(): void {
    this.lastGaps = [];
    this.sticky = { v: [], h: [] };
    this.vm.hide();
  }

  private drawMatches(matchedV: number[], matchedH: number[], gaps: ISpacingGap[]): void {
    if (matchedV.length === 0 && matchedH.length === 0 && gaps.length === 0) {
      this.vm.hide();
      return;
    }
    this.vm.show(
      matchedV,
      matchedH,
      gaps,
      this.viewport.vpBounds$.value,
      this.viewport.vpScale$.value,
    );
  }

  /** 可视区内参照物（剔除选中集）→ 6 线集（docs/06 §2；
   *  收集走空间索引粗筛——O(全量) → O(可视格)，docs/16 §1） */
  private rebuildIfDirty(): void {
    if (!this.dirty) return;
    this.dirty = false;
    const bounds = this.viewport.vpBounds$.value;
    const selected = new Set(this.getSelector().selected$.value);
    const rects: IRect[] = [];
    for (const vm of this.vmEngine.getVmsInRect(bounds)) {
      if (selected.has(vm.id)) continue;
      if (!REFERENCE_TYPES.has(vm.type)) continue;
      // 旋转件不产参照线（docs/05 §8 降级项）：AABB 边不是视觉边，
      // 吸附/等间距语义失真——LINE/PEN 豁免同款先例
      if (vm.getRotation() !== 0) continue;
      rects.push(vm.getBounds());
    }
    this.referenceRects = rects;
    this.refLines = buildRefLines(rects);
  }

  override dispose(): void {
    this.vm.destroy();
    super.dispose();
  }
}
