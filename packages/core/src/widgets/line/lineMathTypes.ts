import type { IPoint } from '../../common/geometry';

/** 连线路径点（IPoint 别名，语义化导出） */
export type IPt = IPoint;

/** 四边方向（specs/flowchart-closeout §7.1：单源在 common/geometry——bboxAnchor
 *  与 VM 基类 getAnchorPoint 默认实现共用；此处 re-export 保既有 import 路径） */
export type { JoinDir } from '../../common/geometry';
