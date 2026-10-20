import { Graphics, Point, type Rectangle } from 'pixi.js';
import { BaseWidgetVm } from '../../base/baseWidgetVm';
import { markRender } from '../../common/render';
import { darkenHex, hexToNum } from '../../common/color';
import { measureDoc, createCanvasMeasurer, type IDocView } from '../../platform/textEngine/measure';
import { DocDisplay, type ITextRenderService } from '../../platform/textEngine/docDisplay';
import { htmlToDoc } from '../../platform/textEngine/htmlDoc';
import { type IHostGeom, type IRect } from '../../common/geometry';
import type { StickyData } from '../../types';
import {
  pointInRotatedRect,
  rotatedRectBounds,
  rotatedRectIntersectsRect,
} from '../../platform/rectEditor/rotateMath';

/** 便签默认色（视觉规格：原「yellow」语义色的 hex） */
export const STICKY_DEFAULT_COLOR = '#fff3b0';

/** 便签底色四色板（docs/04 §2 工具默认参数节）：工具坞二级菜单与 ActionBar 便签色 popover 共用 */
export const STICKY_COLOR_PALETTE = ['#fff3b0', '#c8ecd0', '#c9e3f7', '#f9d3e0'] as const;
export const STICKY_COLOR_OPTIONS = STICKY_COLOR_PALETTE.map((hex) => ({
  id: hex,
  label: hex,
  swatch: hex,
}));

/** 历史语义名 → hex（IndexedDB 旧文档兼容；新数据一律 hex） */
const LEGACY_SEMANTIC_COLORS: Record<string, string> = {
  yellow: '#fff3b0',
  green: '#c8ecd0',
  blue: '#c9e3f7',
  pink: '#f9d3e0',
};

/** 便签色值归一：hex 直用，旧语义名映射（2026-09 数据模型统一 hex） */
export function resolveStickyColor(color: string): string {
  if (color.startsWith('#')) return color;
  return LEGACY_SEMANTIC_COLORS[color] ?? STICKY_DEFAULT_COLOR;
}

/** 便签文本样式（导出：textService 编辑入口同源消费，docs/07 §7） */
export const STICKY_FONT_SIZE = 15;
export const STICKY_LINE_HEIGHT = 1.45;
export const STICKY_PADDING = 14;
export const STICKY_TEXT_COLOR = '#4a3f35';
const DEFAULT_SIZE = 180;

/** 排版解析（docs/17 §4 per-实例：model override → 便签常量默认）——
 *  渲染与编辑 profile（textService）同源消费；底色 color 与文字色独立 */
export function resolveStickyTextStyle(state: {
  fontSize?: number;
  textColor?: string;
  lineHeight?: number;
}): {
  fontFamily: string;
  fontSize: number;
  lineHeight: number;
  color: string;
} {
  return {
    fontFamily: 'sans-serif',
    fontSize: state.fontSize ?? STICKY_FONT_SIZE,
    lineHeight: state.lineHeight ?? STICKY_LINE_HEIGHT,
    color: state.textColor ?? STICKY_TEXT_COLOR,
  };
}

/**
 * 便签视图层（preview 态）：色块 + 文本（复用测量引擎/DocDisplay，docs/07 §6）。
 * 文字编辑经统一编辑会话（textService descriptor，docs/17）——单击已选中进编辑。
 */
export class StickyVm extends BaseWidgetVm<StickyData & IRect> {
  private readonly bg = new Graphics();
  private docDisplay: DocDisplay | null = null;
  /** 编辑态开关（descriptor onEnter/onExit 闭包直调，TEXT/SHAPE 同模式）：进编辑
   *  清出 docDisplay（真隐藏）+ 编辑期 render 早退（跳过 bg/DocDisplay 全量重建，
   *  编辑视觉由 DOM 编辑器独占）；退出自 refresh——全量恢复由 docDisplay===null
   *  保证（快速路径首条件不命中），单源不变量 */
  private _textEditing = false;

  setTextEditing(editing: boolean): void {
    if (this._textEditing === editing) return;
    this._textEditing = editing;
    if (!editing) {
      // 退出强制全量恢复（render(state,state) 绕写前 diff；与最后 flush 的
      // 微任务 render 可能一次冗余——最终一致）
      this.refresh();
      return;
    }
    // 进编辑：立即清出画布文字（防双显窗口期——早退不再维护 docDisplay）
    this.docDisplay?.destroy();
    this.docDisplay = null;
    markRender();
  }

  /** 纹理服务经 ServiceRegistry 注入（便签文本与 TEXT 控件共享两级渲染，docs/07 §6） */
  constructor(private readonly textRender: ITextRenderService | null = null) {
    super({
      id: '',
      type: 'STICKY',
      zOrder: '',
      color: STICKY_DEFAULT_COLOR,
      text: '',
      fontSize: undefined,
      textColor: undefined,
      align: undefined,
      lineHeight: undefined,
      x: 0,
      y: 0,
      width: DEFAULT_SIZE,
      height: DEFAULT_SIZE,
    });
    this.root.addChild(this.bg);
  }

  override render(_prev: StickyData & IRect, next: StickyData & IRect): void {
    // 编辑期早退（节能隐藏，TEXT/SHAPE 同模式）：34ms 落库触发的重绘全免；
    // setState/onStateChanged$ 广播链不受影响（短路只能放 render 内）
    if (this._textEditing) {
      this.applyRootTransform(next.x, next.y, next.width, next.height, next.rotation ?? 0);
      return;
    }
    // 纯平移快速路径（textVm 同模式，本笔补齐——此前便签连拖动都全量重画）：
    // bg/文字渲染输入全未变 = 只挪 root；位置变化影响纹理档位（拖出屏降级）
    // 仍需 markDirty 重评
    if (
      this.docDisplay &&
      (_prev.text || '') === (next.text || '') &&
      _prev.width === next.width &&
      _prev.height === next.height &&
      _prev.color === next.color &&
      _prev.fontSize === next.fontSize &&
      _prev.textColor === next.textColor &&
      _prev.align === next.align &&
      _prev.lineHeight === next.lineHeight
    ) {
      this.applyRootTransform(next.x, next.y, next.width, next.height, next.rotation ?? 0);
      this.textRender?.markDirty();
      return;
    }
    const fill = resolveStickyColor(next.color);
    this.bg.clear();
    this.bg
      .roundRect(0, 0, next.width, next.height, 4)
      .fill({ color: hexToNum(fill) })
      .stroke({ width: 1, color: darkenHex(fill, 0.22) }); // 深一档描边（同 shape 规则）

    const textStyle = resolveStickyTextStyle(next);
    const view: IDocView = measureDoc(
      {
        // marks 渲染（docs/17 §4 刀 3）：与 textVm 同链路（段浅拷贝补 align）
        paragraphs: htmlToDoc(next.text || '').map((p) => ({ ...p, align: next.align })),
        maxWidth: Math.max(next.width - STICKY_PADDING * 2, 1),
        overflow: 'hidden',
        style: textStyle,
      },
      { measurer: createCanvasMeasurer() },
    );
    this.docDisplay?.destroy();
    this.docDisplay = new DocDisplay(view, textStyle, this.textRender);
    // 便签重绘频繁：直接替换 child（bg 保留，doc 替换）
    for (const c of [...this.root.children]) {
      if (c !== this.bg) c.destroy();
    }
    this.docDisplay.position.set(STICKY_PADDING, STICKY_PADDING);
    this.root.addChild(this.docDisplay);

    this.applyRootTransform(next.x, next.y, next.width, next.height, next.rotation ?? 0);
    // 拖拽/缩放反馈用过 root.scale，全量渲染归位时重置（applyRootTransform
    // 不碰 scale——「快速路径不碰 scale」是既定语义，docs/16 ⑧ 探针同源）
    this.root.scale.set(1);
  }

  hitTestPoint(p: Point): boolean {
    const b = this.state;
    const w = b.width * this.root.scale.x;
    const h = b.height * this.root.scale.y;
    return pointInRotatedRect(
      p,
      { x: this.root.x - w / 2, y: this.root.y - h / 2, width: w, height: h },
      this.root.rotation,
    );
  }

  override hitTestRect(r: Rectangle): boolean {
    return rotatedRectIntersectsRect(this.getLocalRect(), this.state.rotation ?? 0, {
      x: r.x,
      y: r.y,
      width: r.width,
      height: r.height,
    });
  }

  /** 世界 AABB（docs/05 §8 拆分；θ=0 与旧实现逐字节等价） */
  override getBounds(): IRect {
    const b = this.state;
    const w = b.width * this.root.scale.x;
    const h = b.height * this.root.scale.y;
    return rotatedRectBounds(
      { x: this.root.x - w / 2, y: this.root.y - h / 2, width: w, height: h },
      this.root.rotation,
    );
  }

  /** 数据矩形（未旋转局部系，docs/05 §8） */
  override getLocalRect(): IRect {
    return { x: this.state.x, y: this.state.y, width: this.state.width, height: this.state.height };
  }
  /** 锚定链宿主几何（docs/05 §8）：「放平矩形」= 以视觉中心（root.position，
   *  预览感知）为心、视觉尺寸的轴对齐矩形 + θ——anchorOf(rect, dir, θ) 的
   *  边中点向量相对中心正确（首版 off=R·pivot 反推是局部原点世界位，θ≠0 错） */
  override getHostGeom(): IHostGeom {
    const w = this.state.width * this.root.scale.x;
    const h = this.state.height * this.root.scale.y;
    return {
      rect: { x: this.root.x - w / 2, y: this.root.y - h / 2, width: w, height: h },
      rotation: this.root.rotation,
    };
  }

  override dispose(): void {
    this.docDisplay?.destroy();
    super.dispose();
  }
}
