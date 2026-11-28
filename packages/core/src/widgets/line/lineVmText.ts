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

/** 轴对齐文字盒（世界坐标；手柄 / 探针的参照形状） */
export interface ILineTextBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

const centeredBox = (c: IPt, width: number, height: number): ILineTextBox => ({
  x: c.x - width / 2,
  y: c.y - height / 2,
  width,
  height,
});

/** 侧别文字（线在线上 / 下方，不切线） */
export const lineTextIsOffLine = (style: Pick<LineData, 'textSide'>): boolean =>
  style.textSide === 'above' || style.textSide === 'below';

/**
 * 线上文字锚点单源（specs/sequence-diagram §4.9）——渲染、编辑框（lineTextEditor
 * 的 getRect）、文字命中（lineVmHit）三处共用：
 * - 缺省 = 路径点（文字骑线镂空，旧文档逐值不变）；
 * - above / below = 路径点沿法向偏移「盒高 / 2 + KNOCKOUT_PADDING」——留隙落在字形
 *   与线之间。法向 = 路径方向的左侧法向（屏幕系 y 向下，左→右的水平线其上方为
 *   y 负向）；路径朝左（dir.x < 0）时翻转——近水平线段的「上方」恒为**视觉**上方，
 *   右→左画的消息与左→右同款；竖直线段的侧别退化为沿线一侧（向下 = above 在右侧、
 *   向上在左侧）。文字不旋转。
 * boxHeight 由调用方给：渲染与命中 = Text 实测高，编辑期 = 编辑器框高（编辑框没有
 * Text 节点；框比文字 bbox 高一圈，用文字高会让编辑框压线）。
 */
export function textAnchorOf(
  pts: IPt[],
  style: Pick<LineData, 'textRatio' | 'textSide'>,
  boxHeight: number,
): IPt {
  const { point, dir } = pointAtRatio(pts, style.textRatio);
  if (!lineTextIsOffLine(style)) return point;
  const len = Math.hypot(dir.x, dir.y) || 1;
  const sign = (style.textSide === 'above' ? 1 : -1) * (dir.x < 0 ? -1 : 1);
  const off = (boxHeight / 2 + KNOCKOUT_PADDING) * sign;
  return { x: point.x + (dir.y / len) * off, y: point.y - (dir.x / len) * off };
}

/** 镂空矩形、文字盒与文字锚点（drawLine 纯几何部分）：
 * - 编辑期（有 editorFrame）：文字盒 = 编辑器框实测矩形——空文字（未落库）即断线，
 *   且框含 padding/border 比文字 bbox 大一圈（按 bbox 切线会从框边缘穿过，
 *   2026-10-02 实测揪出）；
 * - 有文字：文字盒宽高用 Text 实测而非字符数估算——中文每字约 1em，0.62 系数
 *   会窄 40%，线会从文字两端穿过（外部审查揪出）。
 * 先应用样式再量尺寸（实测宽高随 fontSize/lineHeight 变化）。
 * - `textBox`：文字盒——胶囊手柄与 `lineKnockout` 探针的参照，恒在（有字或编辑期）。
 *   骑线 = 字形 + KNOCKOUT_PADDING 外扩（即镂空矩形）；侧别 = 字形盒不外扩——留隙
 *   已经落在字形与线之间，再外扩盒边会压回线上，`capsuleAnchors` 拿它切路径会
 *   把整条线切没；
 * - `knockout`：切线矩形——骑线时即文字盒；侧别文字不切线，为 null（盒不与线
 *   相交，胶囊回到路径中点口径）。 */
export function computeLineTextKnockout(
  pts: IPt[],
  style: Pick<LineData, 'text' | 'textRatio' | 'textSide' | 'fontSize' | 'textColor'>,
  opts: {
    textEditing: boolean;
    editorFrame: { width: number; height: number } | null;
    textNode: Text;
  },
): {
  knockout: Rectangle | null;
  textBox: ILineTextBox | null;
  textAnchor: IPt | null;
  hasText: boolean;
} {
  const plain = htmlToPlainText(style.text || '');
  const hasText = plain.trim().length > 0;
  const offLine = lineTextIsOffLine(style);
  let textAnchor: IPt | null = null;
  let textBox: ILineTextBox | null = null;
  if (opts.textEditing && opts.editorFrame) {
    textAnchor = textAnchorOf(pts, style, opts.editorFrame.height);
    textBox = centeredBox(textAnchor, opts.editorFrame.width, opts.editorFrame.height);
  } else if (hasText) {
    applyLineTextStyle(opts.textNode, plain, style);
    textAnchor = textAnchorOf(pts, style, opts.textNode.height);
    const pad = offLine ? 0 : KNOCKOUT_PADDING;
    textBox = centeredBox(
      textAnchor,
      opts.textNode.width + pad * 2,
      opts.textNode.height + pad * 2,
    );
  }
  const knockout =
    textBox && !offLine ? new Rectangle(textBox.x, textBox.y, textBox.width, textBox.height) : null;
  return { knockout, textBox, textAnchor, hasText };
}
