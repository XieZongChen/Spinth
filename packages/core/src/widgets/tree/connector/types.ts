/** 树连线公共契约（specs/tree-diagrams §6.1）：策略输出纯命令数组，
 *  Vm 只负责 Graphics 执行——根贝塞尔也能单测，预览与实物同源。 */

/** 连线画笔指令（VM 层逐条落到 PIXI Graphics，纯逻辑可单测） */
export type IConnectorCmd =
  | { op: 'moveTo'; x: number; y: number }
  | { op: 'lineTo'; x: number; y: number }
  | { op: 'arc'; cx: number; cy: number; r: number; start: number; end: number; ccw: boolean }
  | { op: 'cubicTo'; c1x: number; c1y: number; c2x: number; c2y: number; x: number; y: number };

/** 兼容别名（1.0 公开导出名） */
export type ConnectorCmd = IConnectorCmd;

/** 连线策略入参：父子矩形（同一坐标系）+ 侧向（org 为 null）+ 子层深 +
 *  线色（mind 分支色由调用方沿父链取好传入；org 固定色由 kind 提供、Vm 填充） */
export interface ITreeEdge {
  parent: { x: number; y: number; width: number; height: number };
  child: { x: number; y: number; width: number; height: number };
  side: 'left' | 'right' | null;
  depth: number;
  lineColor: string;
}
