import type { IRect } from '../../../common/geometry';
import type { IDropAreaInput, IDropHit, IDropTarget } from './types';

export type { IDropAreaInput, IDropHit, IDropTarget };

/**
 * DropArea 三层矩形热区（docs/11 §6，几何与优先级对齐既有设计 dropArea.ts + baseNodeVm.buildDropArea）：
 *
 * ```
 * 父区域全高带（current）：节点所在列、上下各扩 80px → before/after
 * 本体 + 内外扩区（area）  ：节点本体、上下扩 80px、朝子节点侧扩 120px
 * 子节点零宽竖条（children）：每个子节点贴父侧的一条零宽竖条，用作 y 分界
 * ```
 *
 * 命中优先级（既有设计 mindNodeVm.hitTestDrop / mindRootVm.hitTestDrop 同序）：
 * 1) 不在扩区内 → null（= 空白，拖出成新图）
 * 2) 命中 current 带 → 交给 currentTarget 决定（非根 = 与该节点做兄弟；根 = 插到该侧首/尾）
 * 3) 否则按子区竖条分界取插入下标 → childTarget
 *
 * 每次命中同时给出 distance（点到相关矩形的纵向距离）：跨节点候选择优用
 * （既有设计 hitTestChildrenDrop 取 distance 最小者）。根节点不参与距离比较。
 *
 * 纯逻辑层：不持 PIXI 对象；rect 为同一坐标系（调用方决定世界/容器局部）。
 * 树形图族（specs/tree-diagrams §8.3）：轴参数化（横/竖）在 Phase 2 落位。
 */

/** 拖拽热区的扩展高度（既有设计 DROP_AREA_VERTICAL_PADDING） */
export const DROP_AREA_VERTICAL_PADDING = 80;
/** 拖拽热区朝子节点侧的扩展宽度（既有设计 DROP_AREA_HORIZONTAL_PADDING） */
export const DROP_AREA_HORIZONTAL_PADDING = 120;

export class DropArea {
  /** 本体 + 内外扩区（命中此区才继续判 current/子区） */
  readonly area: IRect;
  /** 父区域全高带（节点列宽，上下扩区全高） */
  readonly current: IRect;
  private readonly childStrips: IRect[] = [];

  constructor(private readonly input: IDropAreaInput) {
    const o = input.originRect;
    if (input.axis === 'x') {
      // 竖向（specs §8.3 轴换 x）：本体左右扩 80、朝子侧（上/下）扩 120；
      // current 全宽带；子零高横条（上树取子下边、下树取子上边）
      const topPad = input.direction === 'left' ? DROP_AREA_HORIZONTAL_PADDING : 0;
      const bottomPad = input.direction === 'left' ? 0 : DROP_AREA_HORIZONTAL_PADDING;
      this.area = {
        x: o.x - DROP_AREA_VERTICAL_PADDING,
        y: o.y - topPad,
        width: o.width + DROP_AREA_VERTICAL_PADDING * 2,
        height: o.height + topPad + bottomPad,
      };
      this.current = { x: this.area.x, y: o.y, width: this.area.width, height: o.height };
      for (const c of input.childRects) {
        const y = input.direction === 'left' ? c.rect.y + c.rect.height : c.rect.y;
        this.childStrips.push({ x: c.rect.x, y, width: c.rect.width, height: 0 });
      }
      return;
    }
    const leftPad = input.direction === 'left' ? DROP_AREA_HORIZONTAL_PADDING : 0;
    const rightPad = input.direction === 'left' ? 0 : DROP_AREA_HORIZONTAL_PADDING;
    this.area = {
      x: o.x - leftPad,
      y: o.y - DROP_AREA_VERTICAL_PADDING,
      width: o.width + leftPad + rightPad,
      height: o.height + DROP_AREA_VERTICAL_PADDING * 2,
    };
    // current = 节点所在列、扩区全高（既有设计：current.y = dropArea.y; current.height = dropArea.height）
    this.current = { x: o.x, y: this.area.y, width: o.width, height: this.area.height };
    // 子竖条：零宽，位于子节点贴父侧的那条边（左树取右边，右树取左边）
    for (const c of input.childRects) {
      const x = input.direction === 'left' ? c.rect.x + c.rect.width : c.rect.x;
      this.childStrips.push({ x, y: c.rect.y, width: 0, height: c.rect.height });
    }
  }

  /** 命中测试（未命中返回 null = 空白）；主轴坐标 = axis==='x' ? point.x : point.y */
  hitTest(point: { x: number; y: number }): IDropHit | null {
    if (!contains(this.area, point)) return null;

    const axis = this.input.axis === 'x' ? 'x' : 'y';
    const cross = axis === 'x' ? point.x : point.y;
    // 2) current 带 → before/after（按 current 中线）
    if (contains(this.current, point)) {
      const mid =
        axis === 'x'
          ? this.current.x + this.current.width / 2
          : this.current.y + this.current.height / 2;
      const pos = cross <= mid ? 'before' : 'after';
      const target = this.input.currentTarget(pos);
      return target ? { target, distance: this.originDistance(cross) } : null;
    }

    // 3) 子区分界（既有设计 hitTest：lastPos 从扩区主轴起点开始，逐子取中线分段）
    const pos = this.childIndexAt(cross, axis);
    const target = this.input.childTarget(pos);
    if (!target) return null;
    return { target, distance: this.childDistance(pos, cross, axis) };
  }

  /** 主轴坐标落在哪个插入下标（0..n）：分段边界 = 各子节点中线 */
  private childIndexAt(p: number, axis: 'x' | 'y'): number {
    let last = axis === 'x' ? this.area.x : this.area.y;
    for (let i = 0; i < this.childStrips.length; i++) {
      const s = this.childStrips[i]!;
      const mid = axis === 'x' ? s.x + s.width / 2 : s.y + s.height / 2;
      if (p >= last && p <= mid) return i;
      last = mid;
    }
    return this.childStrips.length;
  }

  /** 候选择优距离（既有设计 hitTestDrop 内 distance 分支；沿主轴） */
  private childDistance(pos: number, p: number, axis: 'x' | 'y'): number {
    if (this.childStrips.length === 0) return this.originDistance(p);
    const d = (r: IRect): number => (axis === 'x' ? rectDistanceX(r, p) : rectDistanceY(r, p));
    if (pos === 0) return d(this.childStrips[0]!);
    if (pos >= this.childStrips.length) return d(this.childStrips[this.childStrips.length - 1]!);
    return Math.min(d(this.childStrips[pos - 1]!), d(this.childStrips[pos]!));
  }

  /** 点到本体矩形的**主轴**距离（跨轴落在本体投影内为 0） */
  private originDistance(p: number): number {
    const o = this.input.originRect;
    return this.input.axis === 'x' ? rectDistanceX(o, p) : rectDistanceY(o, p);
  }
}

function contains(r: IRect, p: { x: number; y: number }): boolean {
  return p.x >= r.x && p.x <= r.x + r.width && p.y >= r.y && p.y <= r.y + r.height;
}

/** 点到矩形的纵向距离（点在矩形 y 范围内为 0；既有设计 distanceBetweenRectAndPoint 同义） */
function rectDistanceY(r: IRect, y: number): number {
  if (y >= r.y && y <= r.y + r.height) return 0;
  return Math.min(Math.abs(y - r.y), Math.abs(y - r.y - r.height));
}

/** 点到矩形的横向距离（竖向主轴版；语义同 rectDistanceY 转置） */
function rectDistanceX(r: IRect, x: number): number {
  if (x >= r.x && x <= r.x + r.width) return 0;
  return Math.min(Math.abs(x - r.x), Math.abs(x - r.x - r.width));
}
