import type { IDataEngineService, IVmEngineService } from '../../types';
import type { ILineAnchorData } from './lineQuickAdd';

/**
 * 同边多线错开与自环嵌套分档（specs/flowchart-closeout §7.3/§7.5，§23 拆分自
 * lineAnchorFollow——<400 铁律；纯函数域供落库重路由与绘制/端点预览共享同源
 * 分配：预览不传档会出现「拖拽中内环、松手跳外环」的可见跳变）。
 */

/** 沿边错开 t 分配（键 `${end}|${nodeId}|${join}|${lineId}`）+ 自环嵌套档 */
export interface IPortSpread {
  ports: Map<string, number>;
  /** 同边多自环按 id 字典序 1..n（n=1 不进表 → routeSelfLoop 缺省 scale 1） */
  selfLoopSpan: Map<string, number>;
}

/** 扫全部 LINE vm → 锚定字段投影（collect 与计算分离：预览路径复用收集） */
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

/**
 * 纯派生不落库——每轮按线 id 字典序重算一致（组内加/删线会让他位线让位，
 * 可接受），零写入不产生幻影事务（samePoints 守卫继续有效）；显式 port 优先
 * 不参与分配，n=1 或未锚定恒 0.5（旧行为）。
 * 分组键 = `(nodeId, join)`——同一锚边上的出发线与进入线共享同一排槽位（早期
 * 按端拆组会让「从 A 右边出发」与「进入 A 右边」各取 0.5 在同一锚点重叠）。
 * **同边自环两端豁免**：两端各占一槽会被分到 0.4/0.6，锚点差 0.2×边长 ≥8px
 * 反而绕过 routeSelfLoop 的重合展开分支、把 U 压成 0.2×边宽（120 边 = 24px ≪
 * 设计跨度 max(80, 边长/2)）——自环两端恒 0.5 交由 routeSelfLoop 按目标跨度
 * 展开，也不挤占同边其他线的槽位。
 * **同边多自环嵌套**：n 条同边自环按 id 字典序赋 spanScale 1..n——跨度与车道
 * 深度同比放大（80/钳边长、走廊 30/60/…），内环嵌外环不重叠；短边钳顶后
 * （n 使目标跨度 ≥ 边长即开始）跨度钳到边长、竖段共线——挂账。
 */
export function computePortSpread(lines: Array<ILineAnchorData & { id: string }>): IPortSpread {
  const groups = new Map<string, Array<{ end: 's' | 'e'; id: string }>>();
  const loops = new Map<string, string[]>(); // key → 同边自环 lineId（嵌套分档）
  for (const data of lines) {
    // 同边自环（两端同节点同 join）整条豁免错开槽位（见上注释），另收进
    // loops 分档（n>1 时嵌套展开）
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
      continue;
    }
    for (const end of ['s', 'e'] as const) {
      const nodeId = end === 's' ? data.startNodeId : data.endNodeId;
      const join = end === 's' ? data.startJoin : data.endJoin;
      const port = end === 's' ? data.startPort : data.endPort;
      if (!nodeId || !join || port !== undefined) continue;
      const key = `${nodeId}|${join}`;
      const g = groups.get(key) ?? [];
      g.push({ end, id: data.id });
      groups.set(key, g);
    }
  }
  const ports = new Map<string, number>();
  for (const [key, entries] of groups) {
    if (entries.length <= 1) continue; // n=1 → 0.5 缺省（旧行为）
    // 字典序稳定：先线 id、再端符（同线两端相邻——自环对称展开）
    entries.sort((p, q) => (p.id < q.id ? -1 : p.id > q.id ? 1 : p.end < q.end ? -1 : 1));
    entries.forEach((ent, i) => {
      const t = 0.2 + (0.6 * (i + 1)) / (entries.length + 1);
      ports.set(`${ent.end}|${key}|${ent.id}`, Math.min(0.9, Math.max(0.1, t)));
    });
  }
  const selfLoopSpan = new Map<string, number>();
  for (const ids of loops.values()) {
    if (ids.length <= 1) continue; // 单自环缺省 scale 1
    ids.sort();
    ids.forEach((id, i) => selfLoopSpan.set(id, i + 1));
  }
  return { ports, selfLoopSpan };
}

/**
 * 预览路径便捷查询：该线的自环嵌套档（undefined = 单自环/非自环 →
 * routeSelfLoop 缺省 1）。**live 覆写**：预览帧的 routeSelfLoop 在
 * `model.update(endNodeId)` 之前求值——读 model 会滞后一帧（拉线首帧
 * endNodeId 还是 null，档位算错 → 松手 reattachAll 跳变，四轮审查实测）；
 * 用当帧已知的锚定字段覆写该线数据再算，首帧即同源。每帧 O(线数) toJSON
 * ——与 applyMove 既有 collectRouteObstacles、previewFollow 同口径。
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
  return computePortSpread(lines).selfLoopSpan.get(lineId);
}
