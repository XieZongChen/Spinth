import type { IRect } from '../../common/geometry';

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
 */

/** 拖拽热区的扩展高度（既有设计 DROP_AREA_VERTICAL_PADDING） */
export const DROP_AREA_VERTICAL_PADDING = 80;
/** 拖拽热区朝子节点侧的扩展宽度（既有设计 DROP_AREA_HORIZONTAL_PADDING） */
export const DROP_AREA_HORIZONTAL_PADDING = 120;

export type IDropTarget =
  /** direction：落点为根时新一级分支的侧向（既有设计 move 的 json.direction = hit.direction） */
  | { kind: 'asChild'; nodeId: string; index: number; direction?: 'left' | 'right' }
  /** direction：插入侧 = 被悬停节点的侧向（根层左右分支混排，光看 index 反推邻居会判错侧） */
  | { kind: 'asSibling'; parentId: string; index: number; direction?: 'left' | 'right' };

export interface IDropHit {
  target: IDropTarget;
  distance: number;
}

export interface IDropAreaInput {
  /** 节点本体（容器局部坐标） */
  originRect: IRect;
  /** 侧向：决定水平扩区朝哪一侧、以及子竖条贴哪一边 */
  direction: 'left' | 'right';
  /** 子节点矩形（该侧布局序；传入前已排除被拖子树） */
  childRects: Array<{ rect: IRect }>;
  /** current 带命中（节点上方/下方 80px 内、节点列宽内）→ 目标 */
  currentTarget: (pos: 'before' | 'after') => IDropTarget | null;
  /** 子区第 pos 位命中（0..children.length）→ 目标 */
  childTarget: (pos: number) => IDropTarget | null;
}

export class DropArea {
  /** 本体 + 内外扩区（命中此区才继续判 current/子区） */
  readonly area: IRect;
  /** 父区域全高带（节点列宽，上下扩区全高） */
  readonly current: IRect;
  private readonly childStrips: IRect[] = [];

  constructor(private readonly input: IDropAreaInput) {
    const o = input.originRect;
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

  /** 命中测试（未命中返回 null = 空白） */
  hitTest(point: { x: number; y: number }): IDropHit | null {
    if (!contains(this.area, point)) return null;

    const o = this.input.originRect;
    // 2) current 带 → before/after（按 current 中线）
    if (contains(this.current, point)) {
      const mid = this.current.y + this.current.height / 2;
      const pos = point.y <= mid ? 'before' : 'after';
      const target = this.input.currentTarget(pos);
      return target ? { target, distance: rectDistanceY(o, point.y) } : null;
    }

    // 3) 子区分界（既有设计 hitTest：lastY 从扩区顶开始，逐子取中线分段）
    const pos = this.childIndexAt(point.y);
    const target = this.input.childTarget(pos);
    if (!target) return null;
    return { target, distance: this.childDistance(pos, point.y, o) };
  }

  /** y 落在哪个插入下标（0..n）：分段边界 = 各子节点中线 */
  private childIndexAt(y: number): number {
    let lastY = this.area.y;
    for (let i = 0; i < this.childStrips.length; i++) {
      const s = this.childStrips[i]!;
      const mid = s.y + s.height / 2;
      if (y >= lastY && y <= mid) return i;
      lastY = mid;
    }
    return this.childStrips.length;
  }

  /** 候选择优距离（既有设计 hitTestDrop 内 distance 分支） */
  private childDistance(pos: number, y: number, origin: IRect): number {
    if (this.childStrips.length === 0) return Math.abs(y - (origin.y + origin.height / 2));
    if (pos === 0) return rectDistanceY(this.childStrips[0]!, y);
    if (pos >= this.childStrips.length)
      return rectDistanceY(this.childStrips[this.childStrips.length - 1]!, y);
    return Math.min(
      rectDistanceY(this.childStrips[pos - 1]!, y),
      rectDistanceY(this.childStrips[pos]!, y),
    );
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
