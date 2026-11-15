/** 树导航公共契约（specs/tree-diagrams §8.1）：导航策略输入轻量导航树，
 *  不依赖 Yjs/PIXI——边界情形单测锁死。 */

/** 轻量导航树节点（TreeService 从 TreeNodeModel 构建；parent 反向引用建树时填） */
export interface INavNode {
  id: string;
  /** 自身 direction（仅根的直接子节点落盘，深层缺省——有效值沿父链回溯） */
  direction?: 'left' | 'right';
  parent: INavNode | null;
  children: INavNode[];
}

/** 一维区间（节点在屏幕上的 y 跨度 / 可视区跨度） */
export interface ISpan {
  top: number;
  bottom: number;
}

/** rootInsertSide 的结构子集入参（INavNode 天然满足） */
export interface IRootSideInput {
  direction?: 'left' | 'right';
  children: ReadonlyArray<{ direction?: 'left' | 'right' }>;
}

/** 屏幕像素矩形（焦点跟随用；left/right/top/bottom 四边） */
export interface IScreenRect {
  left: number;
  top: number;
  right: number;
  bottom: number;
}
