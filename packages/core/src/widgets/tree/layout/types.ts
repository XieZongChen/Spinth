/** 树布局公共契约（specs/tree-diagrams §5.1）：输入可见树、输出相对根左上角
 *  位置与包围盒；纯函数不 import PIXI/Yjs/服务。公开别名源（包入口 re-export）。 */

export interface ILayoutNode {
  id: string;
  width: number;
  height: number;
  direction?: 'left' | 'right';
  children?: ILayoutNode[];
}

export interface ILayoutResult {
  /** 相对根左上角的位置 */
  positions: Map<string, { x: number; y: number }>;
  bbox: { x: number; y: number; width: number; height: number };
}
