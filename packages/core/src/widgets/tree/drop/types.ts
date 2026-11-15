/** 树落点公共契约（specs/tree-diagrams §8.3）：dropArea 三层热区几何的
 *  目标/命中形状——纯数据，策略层（drop/mind、drop/org）与拖拽外壳共用。 */
import type { IRect } from '../../../common/geometry';

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
  /** 主轴（兄弟堆叠轴，specs/tree-diagrams §8.3）：'y' = 横向脑图（默认——
   *  本体上下扩 80/朝子侧 120、current 全高带、子零宽竖条）；
   *  'x' = 竖向（左右扩 80/朝上或下 120、current 全宽带、子零高横条） */
  axis?: 'x' | 'y';
}
