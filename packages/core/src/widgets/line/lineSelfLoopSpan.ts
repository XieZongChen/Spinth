import type { IDataEngineService, IVmEngineService } from '../../types';
import type { ILineAnchorData } from './lineQuickAdd';

/**
 * 同边自环嵌套分档（specs/flowchart-closeout §7.5）。
 *
 * 同边多线自动错开已在 2026-11-15 产品拍板 B 中取消：所有非显式 port 的线端
 * 恒为边中点 0.5，同边多条线共享同一起笔点（视觉单点引出）；需要分开时由
 * 端点拖拽写入显式 startPort/endPort。因此本模块只保留自环跨度档位——同边
 * 多自环按 id 字典序赋 spanScale 1..n，跨度与车道深度同比放大，内环嵌外环
 * 分层不重叠（短边高倍钳顶后仍部分共线——挂账）。
 */

/** 同边多自环档位（键 = lineId；单自环不进表 → routeSelfLoop 缺省 scale 1） */
export interface ISelfLoopSpans {
  selfLoopSpan: Map<string, number>;
}

/** 扫全部 LINE vm → 锚定字段投影（selfLoopSpanOf 的 live 覆写路径复用） */
export function collectLineDatas(
  engine: {
    getModelById(id: string): { toJSON(): unknown } | undefined;
  },
  vmEngine: { getAllVms(): Array<{ id: string; type: string }> },
): Array<ILineAnchorData & { id: string }> {
  const out: Array<ILineAnchorData & { id: string }> = [];
  for (const vm of vmEngine.getAllVms()) {
    if (vm.type !== 'LINE') continue;
    const data = engine.getModelById(vm.id)?.toJSON() as unknown as
      (ILineAnchorData & { id: string }) | undefined;
    if (data) out.push(data);
  }
  return out;
}

/** 同边自环嵌套档：n 条按 id 字典序 1..n；n=1 不进表。 */
export function computeSelfLoopSpans(
  lines: Array<ILineAnchorData & { id: string }>,
): ISelfLoopSpans {
  const loops = new Map<string, string[]>();
  for (const data of lines) {
    if (
      data.startNodeId &&
      data.startNodeId === data.endNodeId &&
      data.startJoin &&
      data.startJoin === data.endJoin
    ) {
      const key = `${data.startNodeId}|${data.startJoin}`;
      const l = loops.get(key) ?? [];
      l.push(data.id);
      loops.set(key, l);
    }
  }
  const selfLoopSpan = new Map<string, number>();
  for (const ids of loops.values()) {
    if (ids.length <= 1) continue;
    ids.sort();
    ids.forEach((id, i) => selfLoopSpan.set(id, i + 1));
  }
  return { selfLoopSpan };
}

/**
 * 预览路径便捷查询：该线的自环嵌套档（undefined = 单自环/非自环 → routeSelfLoop
 * 缺省 1）。**live 覆写**：预览帧的 routeSelfLoop 在 `model.update(endNodeId)`
 * 之前求值——读 model 会滞后一帧（拉线首帧 endNodeId 还是 null，档位算错 →
 * 松手 reattachAll 跳变，四轮审查实测）；用当帧已知的锚定字段覆写该线数据再算，
 * 首帧即同源。每帧 O(线数) toJSON——与 applyMove 既有 collectRouteObstacles、
 * previewFollow 同口径。
 */
export function selfLoopSpanOf(
  engine: IDataEngineService,
  vmEngine: IVmEngineService,
  lineId: string,
  live: Pick<
    ILineAnchorData,
    'startNodeId' | 'startJoin' | 'endNodeId' | 'endJoin' | 'startPort' | 'endPort'
  >,
): number | undefined {
  const lines = collectLineDatas(engine, vmEngine);
  const i = lines.findIndex((l) => l.id === lineId);
  if (i >= 0) lines[i] = { ...lines[i]!, ...live };
  return computeSelfLoopSpans(lines).selfLoopSpan.get(lineId);
}
