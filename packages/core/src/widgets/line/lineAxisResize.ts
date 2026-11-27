import type { IHostGeom } from '../../common/geometry';
import type { IAxisAnchor } from '../../types';
import { axisAnchorPoint, axisPortFor } from './lineAxisAnchor';
import type { ILineAnchorData } from './lineQuickAdd';
import { collectLineDatas } from './lineSelfLoopSpan';

/**
 * 加长保高度（specs/sequence-diagram §4.7，G-06）：轴宿主缩放后，对其上每个锚定端
 * 重写端口。纯函数域 + 接线函数；由组合根在 onResizeCommitted 里、既有急刻重路由
 * 之前调用——调用位置在 commitResize 之后、stopCapturing 之前 = 与缩放同一撤销项。
 * 纯平移（拖拽、微移、对齐、分布）不改 t，不经过这里。
 */

/** 单条线的端口补丁：只含变化的端 */
export interface IPortPatch {
  id: string;
  startPort?: number;
  endPort?: number;
}

/**
 * 轴宿主缩放后的端口重算（纯函数）：锚定在 hostId 上的每个端，旧锚点高度 = 旧轴上
 * 旧 port 的高度（缺省 0.5），新 port = 新轴上同高度的 port（r4）——落到新轴外的
 * 钳到端点（轴变短时 t = 1 / 0）。与旧 port 相同不写（不给没动的端添显式端口）。
 */
export function rewiredPorts(
  hostId: string,
  oldAxis: IAxisAnchor,
  newAxis: IAxisAnchor,
  lines: ReadonlyArray<ILineAnchorData>,
): IPortPatch[] {
  const portOn = (old: number | undefined): number | null => {
    const next = axisPortFor(newAxis, axisAnchorPoint(oldAxis, old ?? 0.5).y);
    return next === (old ?? 0.5) ? null : next;
  };
  const out: IPortPatch[] = [];
  for (const data of lines) {
    const patch: IPortPatch = { id: data.id };
    if (data.startNodeId === hostId) {
      const p = portOn(data.startPort);
      if (p !== null) patch.startPort = p;
    }
    if (data.endNodeId === hostId) {
      const p = portOn(data.endPort);
      if (p !== null) patch.endPort = p;
    }
    if (patch.startPort !== undefined || patch.endPort !== undefined) out.push(patch);
  }
  return out;
}

/**
 * 接线：宿主是轴宿主时按传入的前后几何求轴（prev = 缩放起点、next = 落库目标——
 * 不读 vm 当前几何：state 是微任务合批的旧值）并写入有变化的端口补丁。
 * 非轴宿主 / 任一侧无轴（退化件）= 零写入。
 */
export function rewirePortsAfterResize(
  hostId: string,
  prev: IHostGeom,
  next: IHostGeom,
  ctx: {
    engine: {
      getModelById(id: string): { toJSON(): unknown; update(patch: object): void } | undefined;
    };
    vmEngine: {
      getVmById(id: string): { getAxisAnchor?(geom?: IHostGeom): IAxisAnchor | null } | undefined;
      getAllVms(): Array<{ id: string; type: string }>;
    };
  },
): void {
  const host = ctx.vmEngine.getVmById(hostId);
  const oldAxis = host?.getAxisAnchor?.(prev) ?? null;
  const newAxis = host?.getAxisAnchor?.(next) ?? null;
  if (!oldAxis || !newAxis) return;
  for (const { id, ...patch } of rewiredPorts(
    hostId,
    oldAxis,
    newAxis,
    collectLineDatas(ctx.engine, ctx.vmEngine),
  )) {
    ctx.engine.getModelById(id)?.update(patch as never);
  }
}
