import { Point, type Rectangle } from 'pixi.js';
import { BaseWidgetVm } from '../../base/baseWidgetVm';
import { markRender } from '../../common/render';
import { measureDoc, createCanvasMeasurer, type IDocView } from '../../platform/textEngine/measure';
import { htmlToDoc } from '../../platform/textEngine/htmlDoc';
import { defaultTextColor, textThemeVersion } from '../../platform/textEngine/theme';
import { DocDisplay, type ITextRenderService } from '../../platform/textEngine/docDisplay';
import { type IHostGeom, type IRect } from '../../common/geometry';
import type { TextData } from '../../types';
import {
  pointInRotatedRect,
  rotatedRectBounds,
  rotatedRectIntersectsRect,
} from '../../platform/rectEditor/rotateMath';

/** 文本控件默认样式（视觉规格：与 DOM 编辑器一致保证像素对齐） */
export const TEXT_FONT = 'sans-serif';
export const TEXT_FONT_SIZE = 16;
/** 字号档位表（docs/04 §2 工具默认参数节）：工具坞二级菜单与 ActionBar 字号 popover 共用 */
// 含 STICKY 默认 15（stickyVm STICKY_FONT_SIZE）——默认档入表可显可选
// （缺档时触发钮落 FALLBACK 圆点，2026-10-16 用户实测揪出）
export const TEXT_FONT_SIZE_STEPS = [12, 14, 15, 16, 20, 24, 32] as const;
export const FONT_SIZE_OPTIONS = TEXT_FONT_SIZE_STEPS.map((n) => ({
  id: String(n),
  label: `${n} 号`,
  text: String(n),
}));
export const TEXT_LINE_HEIGHT = 1.5;
/** 文本控件最小宽（编辑落点）与内边距 */
export const TEXT_MIN_WIDTH = 40;
export const TEXT_PADDING = 8;
/** 点击创建的默认控件宽（文字元素特性：初始容纳一行标题/短句——曾 40+16=56
 *  窄框致密集换行，2026-10-07 挂账清理批 C1；各元素默认尺寸矩阵见 docs/17） */
export const TEXT_DEFAULT_WIDTH = 240;

/** HTML → 纯文本（自本文件收单源至 platform/textEngine/plainText.ts，2026-10-06
 *  编辑会话批 1——EditingService 与渲染降级共用；re-export 保旧 import 路径） */
import { htmlToPlainText } from '../../platform/textEngine/plainText';
export { htmlToPlainText };

/** 排版解析（docs/17 §4 per-实例：model override → 控件常量默认）——
 *  渲染（measureDoc/DocDisplay）与编辑 profile（textService）同源消费 */
export function resolveTextStyle(state: {
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
    fontFamily: TEXT_FONT,
    fontSize: state.fontSize ?? TEXT_FONT_SIZE,
    lineHeight: state.lineHeight ?? TEXT_LINE_HEIGHT,
    // 主题默认色（docs/17 C2）：per-实例 textColor 优先，无 override 随主题
    color: state.textColor ?? defaultTextColor(),
  };
}

/**
 * 文本控件视图层（preview 态）：measureDoc（含 marks/排版 override）→ DocDisplay
 * 两级渲染 + 主题版本/排版键守卫的纯平移快速路径。select/edit 态由统一编辑会话
 * EditingService 编排（docs/17），本类仅经 setTextEditing 钩子配合（隐藏/早退）。
 */
export class TextVm extends BaseWidgetVm<TextData & IRect> {
  private docDisplay: DocDisplay | null = null;
  /** 上次渲染的主题版本（快速路径守卫——主题变化不在 state diff 里，需显式比对） */
  private renderedThemeVer = -1;
  /** 编辑态开关（descriptor onEnter/onExit 闭包直调，STICKY/SHAPE 同模式）：
   *  进编辑清出 docDisplay（真隐藏）+ 编辑期 render 早退；退出自 refresh——
   *  全量恢复由 docDisplay===null 保证（快速路径首条件不命中），单源不变量 */
  private _textEditing = false;

  setTextEditing(editing: boolean): void {
    if (this._textEditing === editing) return;
    this._textEditing = editing;
    if (!editing) {
      // 退出强制全量恢复：refresh = render(state,state) 绕写前 diff（「state 无
      // 新变化则 render 不跑」）；docDisplay 为 null 使快速路径不命中；与最后
      // flush 的微任务 render 可能一次冗余——最终一致
      this.refresh();
      return;
    }
    // 进编辑：立即清出画布文字（防双显窗口期——早退不再维护 docDisplay）
    this.docDisplay?.destroy();
    this.docDisplay = null;
    markRender();
  }

  /** 纹理服务经 ServiceRegistry 注入（无服务时 DocDisplay 恒为高清 Text 模式，单测路径） */
  constructor(private readonly textRender: ITextRenderService | null = null) {
    super({
      id: '',
      type: 'TEXT',
      zOrder: '',
      text: '',
      fontSize: undefined,
      textColor: undefined,
      align: undefined,
      lineHeight: undefined,
      x: 0,
      y: 0,
      width: 0,
      height: 0,
    });
    this.root.eventMode = 'none';
  }

  override render(prev: TextData & IRect, next: TextData & IRect): void {
    // 编辑期早退（节能隐藏，STICKY/SHAPE 同模式）：34ms 落库触发的重绘全免；
    // setState/onStateChanged$ 广播链不受影响（短路只能放 render 内）
    if (this._textEditing) {
      this.applyRootTransform(next.x, next.y, next.width, next.height, next.rotation ?? 0);
      return;
    }
    // ⑧ 复用（docs/16 ⑧）：text/width（断行输入）与排版 override 全未变 =
    // 纯几何平移——复用 DocDisplay 只改 position，跳过 DOMParser/measureDoc/
    // 纹理重建（排版键必须纳入守卫：改字号被当平移跳过 = 丢渲染；主题版本
    // 同理——主题切换不进 state diff，经 renderedThemeVer 显式守卫）
    if (
      this.docDisplay &&
      prev.text === next.text &&
      prev.width === next.width &&
      prev.fontSize === next.fontSize &&
      prev.textColor === next.textColor &&
      prev.align === next.align &&
      prev.lineHeight === next.lineHeight &&
      this.renderedThemeVer === textThemeVersion()
    ) {
      this.applyRootTransform(next.x, next.y, next.width, next.height, next.rotation ?? 0);
      // 位置变化影响可视性/清晰度档位（拖出屏幕应降级、拖回应升级）——
      // 曾只靠 vpBounds/vpScale 触发，拖动出屏永远不重评（docs/16 P3 ① 尾巴）
      this.textRender?.markDirty();
      return;
    }
    this.renderedThemeVer = textThemeVersion();
    const innerWidth = Math.max(next.width - TEXT_PADDING * 2, 1);
    const style = resolveTextStyle(next);
    const view: IDocView = measureDoc(
      {
        // marks 渲染（docs/17 §4 刀 3）：TipTap HTML → 段落 span（bold/color）；
        // 段对象浅拷贝补 align（spans 共享只读，不污染解析缓存）
        paragraphs: htmlToDoc(next.text).map((p) => ({ ...p, align: next.align })),
        maxWidth: innerWidth,
        style,
      },
      { measurer: createCanvasMeasurer() },
    );
    this.docDisplay?.destroy();
    this.docDisplay = new DocDisplay(view, style, this.textRender);
    this.docDisplay.position.set(TEXT_PADDING, TEXT_PADDING);
    // 清旧 child 后挂新
    for (const c of [...this.root.children]) c.destroy();
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
