import { Container, Graphics } from 'pixi.js';
import type { IRect } from '../../../common/geometry';
import { markRender } from '../../../common/render';
import { rootStartX, rootT } from './../connector/mind';

/**
 * 脑图拖拽落点预览（docs/11 §6，对齐既有设计 mindDraggerVm.renderFakeNode）：
 * **40×16 蓝色圆角预置块**（尺寸与真实节点同源，落点后长什么样一目了然）+
 * 预连线（非根 = 父到块的正交折线；根 = 与实物同参数的三次贝塞尔）。
 *
 * 与既有设计的差异（有意）：既有设计把根预连线插进 widget 层并压 zOrder 让线走在节点
 * 下方，spinth 统一画在 optionLayer 浮层——只影响预连线与节点的遮挡关系。
 */

/** 预置块尺寸/圆角/间距/颜色（既有设计 constants：FAKE_NODE_*） */
export const FAKE_NODE_WIDTH = 40;
export const FAKE_NODE_HEIGHT = 16;
export const FAKE_NODE_RADIUS = 4;
export const FAKE_VERTICAL_MARGIN = 16;
export const FAKE_COLOR = 0x4e95ff;
/** 预连线粗细（比实物细，属预览语义） */
const LINK_WIDTH = 2.5;

export interface IFakeBlockInput {
  /** 落点父节点（预置块挂到它的子位） */
  dest: IRect;
  /** 落点前一个兄弟（同侧；null = 首位/无兄弟） */
  before: IRect | null;
  /** 落点后一个兄弟（同侧；null = 末位/无兄弟） */
  after: IRect | null;
  /** 子树朝向（决定块在父的哪一侧） */
  direction: 'left' | 'right';
  /** 父→子的主轴偏移（根层 100 / 其余 48；横向沿 x、竖向沿 y） */
  offset: number;
  /** 主轴（specs §8.3）：'y' = 横向（默认）；'x' = 竖向（缝隙沿 y、块在父上/下） */
  axis?: 'x' | 'y';
}

/**
 * 预置块矩形（既有设计 mindDraggerVm.calculateFakeBounds 逐分支移植）：
 * 两侧都有兄弟 → 缝隙居中；只有前一个 → 其后 +16；只有后一个 → 其前 −16；
 * 都没有 → 与父跨轴居中。竖向为横向的转置（specs §6.5 预览与实物同向）。
 */
export function fakeBlockRect(input: IFakeBlockInput): IRect {
  const { dest, before, after, direction, offset } = input;
  if (input.axis === 'x') {
    const y =
      direction === 'left' ? dest.y - offset - FAKE_NODE_HEIGHT : dest.y + dest.height + offset;
    let x = dest.x;
    if (before && after) {
      const beforeRight = before.x + before.width;
      x = beforeRight + (after.x - beforeRight - FAKE_NODE_WIDTH) / 2;
    } else if (before) {
      x = before.x + before.width + FAKE_VERTICAL_MARGIN;
    } else if (after) {
      x = after.x - FAKE_NODE_WIDTH - FAKE_VERTICAL_MARGIN;
    } else {
      x = dest.x + (dest.width - FAKE_NODE_WIDTH) / 2;
    }
    return { x, y, width: FAKE_NODE_WIDTH, height: FAKE_NODE_HEIGHT };
  }
  const x = direction === 'left' ? dest.x - offset - FAKE_NODE_WIDTH : dest.x + dest.width + offset;
  let y = dest.y;

  if (before && after) {
    const beforeBottom = before.y + before.height;
    y = beforeBottom + (after.y - beforeBottom - FAKE_NODE_HEIGHT) / 2;
  } else if (before) {
    y = before.y + before.height + FAKE_VERTICAL_MARGIN;
  } else if (after) {
    y = after.y - FAKE_NODE_HEIGHT - FAKE_VERTICAL_MARGIN;
  } else {
    y = dest.y + (dest.height - FAKE_NODE_HEIGHT) / 2;
  }
  return { x, y, width: FAKE_NODE_WIDTH, height: FAKE_NODE_HEIGHT };
}

export class TreeDropPreview {
  private readonly g = new Graphics();
  /** 最近一次绘制的预置块（世界坐标；dev 探针/E2E 断言用） */
  lastBlock: IRect | null = null;

  constructor(optionLayer: Container) {
    this.g.eventMode = 'none';
    optionLayer.addChild(this.g);
  }

  /** 画预置块 + 预连线（dest/block 均为世界坐标；竖向预连线与实物同向） */
  show(opts: {
    block: IRect;
    dest: IRect;
    isRoot: boolean;
    direction: 'left' | 'right';
    vertical?: boolean;
  }): void {
    const { block, dest, isRoot, direction } = opts;
    this.lastBlock = { ...block };
    const left = direction === 'left';
    const g = this.g;
    g.clear();
    g.roundRect(block.x, block.y, block.width, block.height, FAKE_NODE_RADIUS).fill({
      color: FAKE_COLOR,
      alpha: 0.9,
    });

    if (opts.vertical) {
      this.drawLinkVertical(block, dest, isRoot, left);
      return;
    }

    const midY = block.y + block.height / 2;
    const destMidY = dest.y + dest.height / 2;
    if (isRoot) {
      // 根连线：与实物同参数的三次贝塞尔（t 与 calculateAwesomeParamT 同源）
      const startX = rootStartX(
        dest.x + dest.width / 2,
        dest.width,
        rootT(Math.abs(midY - destMidY), left),
      );
      const endX = left ? block.x + block.width : block.x;
      const cpX = startX + (endX - startX) * 0.2;
      g.moveTo(startX, destMidY)
        .quadraticCurveTo(cpX, midY, endX, midY)
        .stroke({ width: LINK_WIDTH, color: FAKE_COLOR, alpha: 0.6 });
      markRender();
      return;
    }

    // 普通节点：与实物折线同走向（父边 → 聚合线 → 子边中点）
    const startX = left ? dest.x : dest.x + dest.width;
    const endX = left ? block.x + block.width : block.x;
    const midX = left ? dest.x - 24 : dest.x + dest.width + 24; // NODE_LINE_AGGREGATED
    g.moveTo(startX, destMidY)
      .lineTo(midX, destMidY)
      .lineTo(midX, midY)
      .lineTo(endX, midY)
      .stroke({ width: LINK_WIDTH, color: FAKE_COLOR, alpha: 0.6 });
    markRender();
  }

  /** 竖向预连线（specs §6.5）：根 = t 按水平距的贝塞尔（垂直出）；普通 = 垂直出 →
   *  水平干（聚合线 ±24）→ 子上/下边中点——与实物连线同向 */
  private drawLinkVertical(block: IRect, dest: IRect, isRoot: boolean, up: boolean): void {
    const g = this.g;
    const midX = block.x + block.width / 2;
    const destMidX = dest.x + dest.width / 2;
    if (isRoot) {
      const startY = rootStartX(
        dest.y + dest.height / 2,
        dest.height,
        rootT(Math.abs(midX - destMidX), up),
      );
      const endY = up ? block.y + block.height : block.y;
      const cpY = startY + (endY - startY) * 0.2;
      g.moveTo(destMidX, startY)
        .quadraticCurveTo(midX, cpY, midX, endY)
        .stroke({ width: LINK_WIDTH, color: FAKE_COLOR, alpha: 0.6 });
      markRender();
      return;
    }
    const startY = up ? dest.y : dest.y + dest.height;
    const endY = up ? block.y + block.height : block.y;
    const midY = up ? dest.y - 24 : dest.y + dest.height + 24; // NODE_LINE_AGGREGATED
    g.moveTo(destMidX, startY)
      .lineTo(destMidX, midY)
      .lineTo(midX, midY)
      .lineTo(midX, endY)
      .stroke({ width: LINK_WIDTH, color: FAKE_COLOR, alpha: 0.6 });
    markRender();
  }

  hide(): void {
    this.g.clear();
    this.lastBlock = null;
    markRender();
  }

  destroy(): void {
    this.g.destroy();
  }
}
