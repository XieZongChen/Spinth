import type { ILineAnchorData } from './lineQuickAdd';

/**
 * 悬空连线扫描与清理（specs/flowchart-closeout §7.6，G-09）：
 * 「恰好一端 nodeId === null」= 断头线（删锚定节点遗留）——可一键清理；
 * 纯自由线（两端均 null）是合法图元不清除。纯函数——命令封装与菜单计数
 * 各自注入枚举源（vmEngine.getAllVms + engine.getModelById 的最小面）。
 */

/** 扫描源最小面：线存在性走 vm 枚举（与 unbindFrom 同口径），锚定字段走 toJSON */
export interface IDanglingScanSource {
  getAllVms(): Iterable<{ id: string; type: string }>;
  getModelById(id: string): { toJSON(): unknown } | undefined;
}

/** 线端锚定字段的最小 toJSON 投影（ILineAnchorData 的扫描子集） */
type AnchorProjection = Pick<ILineAnchorData, 'startNodeId' | 'endNodeId'>;

function isDangling(data: AnchorProjection): boolean {
  // 恰好一端 null（异或）——两端均 null 的纯自由线是合法图元
  return (data.startNodeId === null) !== (data.endNodeId === null);
}

/** 断头线 id 清单（命令删除集 / 计数共用） */
export function danglingLineIds(src: IDanglingScanSource): string[] {
  const ids: string[] = [];
  for (const vm of src.getAllVms()) {
    if (vm.type !== 'LINE') continue;
    const data = src.getModelById(vm.id)?.toJSON() as unknown as AnchorProjection | undefined;
    if (data && isDangling(data)) ids.push(vm.id);
  }
  return ids;
}

/** 数断头线（右键菜单禁用态：无匹配 → disabled） */
export function countDanglingLines(src: IDanglingScanSource): number {
  return danglingLineIds(src).length;
}
