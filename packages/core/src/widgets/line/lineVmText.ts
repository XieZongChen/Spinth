import { Rectangle, Text } from 'pixi.js';
import { hexToNum } from '../../common/color';
import { pointAtRatio, type IPt } from './lineMath';
import { htmlToPlainText } from '../text/textVm';
import { defaultLineTextColor } from '../../platform/textEngine/theme';
import type { LineData } from '../../types';

/** 线上文字渲染域（docs/07 §2 LINE 落地）：文字常量、常驻 Text 节点工厂、
 *  per-实例排版应用与镂空矩形计算。纯函数 + 工厂，不持有渲染副作用——
 *  addChild/position 等节点编排归 LineVm。 */

/** 线上文字（视觉规格：12px 深灰，白底由镂空切分自然形成） */
export const LINE_TEXT_FONT_SIZE = 12;
/** 线上文字行高（倍数，视觉规格 1.4）——编辑 DOM（lineTextEditor）与 pixi 渲染
 *  （ensureTextNode 经 fontSize×此值换算像素）同源消费；此前渲染未设行高按 1.0
 *  倍度量，编辑/退出两态文字高度跳变（批 lineHeight 顺修同源） */
export const LINE_TEXT_LINE_HEIGHT = 1.4;
/** 镂空矩形相对文字 bbox 的外扩（视觉规格：文字四周留白） */
export const KNOCKOUT_PADDING = 4;

/** 常驻文字节点工厂（anchor 居中；默认主题色——具体样式由 applyLineTextStyle
 *  按 per-实例 override 覆盖）。Text 实例常驻复用（文字不变只挪位置，节点拖拽
 *  带动连线跟随时不再每帧重建 canvas 栅格化纹理）。 */
export function createLineTextNode(): Text {
  const node = new Text({
    text: '',
    style: {
      fontFamily: 'sans-serif',
      fontSize: LINE_TEXT_FONT_SIZE,
      lineHeight: LINE_TEXT_FONT_SIZE * LINE_TEXT_LINE_HEIGHT,
      fill: hexToNum(defaultLineTextColor()),
      align: 'center',
    },
  });
  node.anchor.set(0.5);
  return node;
}

/** per-实例排版 override（docs/17 §4）：style 可变——赋值触发重栅格化，
 *  Text 实测宽高变化后镂空/滑移命中自动跟随。行高同源（批 lineHeight 顺修）：
 *  pixi lineHeight 是像素单位 = fs × 1.4，与编辑 DOM 的 1.4 倍逐像素一致——
 *  消除编辑/退出两态高度跳变 */
export function applyLineTextStyle(
  textNode: Text,
  plain: string,
  style: Pick<LineData, 'text' | 'textRatio' | 'fontSize' | 'textColor'>,
): void {
  const fs = style.fontSize ?? LINE_TEXT_FONT_SIZE;
  const fill = hexToNum(style.textColor ?? defaultLineTextColor());
  const lh = fs * LINE_TEXT_LINE_HEIGHT;
  if (textNode.style.fontSize !== fs) textNode.style.fontSize = fs;
  if (textNode.style.lineHeight !== lh) textNode.style.lineHeight = lh;
  if (textNode.style.fill !== fill) textNode.style.fill = fill;
  if (textNode.text !== plain) textNode.text = plain;
}

/** 镂空矩形与文字锚点计算（drawLine 纯几何部分）：
 * - 编辑期（有 editorFrame）：镂空 = 编辑器框实测矩形——空文字（未落库）即断线，
 *   且框含 padding/border 比文字 bbox 大一圈（按 bbox 切线会从框边缘穿过，
 *   2026-10-02 实测揪出）；
 * - 有文字：镂空宽高用 Text 实测而非字符数估算——中文每字约 1em，0.62 系数
 *   会窄 40%，线会从文字两端穿过（外部审查揪出）。
 * 先应用样式再量尺寸（实测宽高随 fontSize/lineHeight 变化）。 */
export function computeLineTextKnockout(
  pts: IPt[],
  style: Pick<LineData, 'text' | 'textRatio' | 'fontSize' | 'textColor'>,
  opts: {
    textEditing: boolean;
    editorFrame: { width: number; height: number } | null;
    textNode: Text;
  },
): { knockout: Rectangle | null; textAnchor: IPt | null; hasText: boolean } {
  const plain = htmlToPlainText(style.text || '');
  let knockout: Rectangle | null = null;
  let textAnchor: IPt | null = null;
  const hasText = plain.trim().length > 0;
  if (opts.textEditing && opts.editorFrame) {
    textAnchor = pointAtRatio(pts, style.textRatio).point;
    knockout = new Rectangle(
      textAnchor.x - opts.editorFrame.width / 2,
      textAnchor.y - opts.editorFrame.height / 2,
      opts.editorFrame.width,
      opts.editorFrame.height,
    );
  } else if (hasText) {
    applyLineTextStyle(opts.textNode, plain, style);
    const { point } = pointAtRatio(pts, style.textRatio);
    textAnchor = point;
    const w = opts.textNode.width + KNOCKOUT_PADDING * 2;
    const h = opts.textNode.height + KNOCKOUT_PADDING * 2;
    knockout = new Rectangle(point.x - w / 2, point.y - h / 2, w, h);
  }
  return { knockout, textAnchor, hasText };
}
