/**
 * 对齐/分布/微移命令族（specs/api-surface §3.1 Step 4）——自 boardCommands.ts
 * 逐字迁入：微移 + 对齐六向 + 分布两向 + 参与集解析（锚定线剔除/组折叠）+
 * 单事务批量位移。BoardCommands 同名方法一行委托至此；公开签名与编排时序
 * 零变化（alignCommand.test 的时序断言是护栏）。
 */
import type { IBoardCommandHost } from './boardHost';
import type { IHostGeom, IRect } from './common/geometry';
import { translatePoints } from './common/geometry';
import {
  computeAlignDeltas,
  computeDistributeDeltas,
  type AlignMode,
  type DistributeAxis,
  type IDelta,
} from './platform/selector/alignOps';
import { collapseGroupParticipants, type ICollapsedPart } from './platform/selector/groupOps';

/** 对齐/分布参与项（docs/05 §7）——自 boardCommands.ts 迁入（命令区私有契约）；
 *  linePoints 仅自由线携带（落库分流标记）。localRect/rotation 是 reattach
 *  输入语义（docs/05 §8）——bounds 仍世界 AABB（对齐数学基准） */
export interface IAlignParticipant {
  id: string;
  vm: {
    id: string;
    commitDrag(init: IRect, dx: number, dy: number): void;
    getLocalRect(): IRect;
    /** 条边让位的宿主探针（specs/sequence-diagram §4.1；缺省 = 无）与宿主几何 */
    anchorFollowHosts?(): string[];
    getHostGeom?(): IHostGeom;
  };
  bounds: IRect;
  localRect: IRect;
  rotation: number;
  linePoints?: Array<[number, number]>;
}

/** 键盘微移（docs/09 §2）：一个事务合并本次所有选中元素的位移。
 *  走交互几何契约（docs/05 §4.4）：rect 型平移 x/y，points 型（LINE/PEN）平移 points。
 *  容器级联（specs/container-frame §4.5）：展开后逐件位移，同事务内跑归属
 *  判定（ids = 展开前选区）——rectOf = getLocalRect() + 位移（事务内 state
 *  是位移前值，加 delta 即落点；未移动的父容器 localRect 即权威值）。 */
export function nudgeSelected(
  ctx: IBoardCommandHost,
  dx: number,
  dy: number,
  _shift: boolean,
): void {
  if (!ctx.viewport?.editable$.value) return;
  const ids = ctx.selector?.selected$.value ?? [];
  if (ids.length === 0) return;
  // 级联查找：容器 ∪ 激活条随行（specs/sequence-diagram §5.3）；未合成时回落 frame
  const frames = ctx.cascade ?? ctx.frame;
  const expanded = frames ? frames.expandForCascade(ids) : ids;
  ctx.engine!.transact(() => {
    for (const id of expanded) {
      const vm = ctx.vmEngine?.getVmById(id);
      if (vm) {
        vm.commitDrag(vm.getLocalRect(), dx, dy);
      }
    }
    if (frames) {
      const moved = new Set(expanded);
      frames.reconcileParents(ids, (id) => {
        const lr = ctx.vmEngine?.getVmById(id)?.getLocalRect() ?? {
          x: 0,
          y: 0,
          width: 0,
          height: 0,
        };
        return moved.has(id)
          ? { x: lr.x + dx, y: lr.y + dy, width: lr.width, height: lr.height }
          : lr;
      });
    }
  });
  // 撤销项切分（Batch 1 · 1.11①）：按住方向键 key-repeat（几十 ms 间隔）在
  // 500ms captureTimeout 窗口内全部并项——一次 undo 弹回整段位移。
  // 关窗之前先把随条变的东西重算掉（并入本次微移）：带宿主探针的件（激活条 → 其
  // 生命线的条边让位）与纵向挪过激活条上下沿的轴消息；普通件的锚定线仍由微任务相
  // 重算（既有行为）
  for (const id of ids) {
    const vm = ctx.vmEngine?.getVmById(id);
    if (!vm) continue;
    if (vm.isAxisMessage?.()) ctx.lineService?.refreshLine(id);
    for (const host of vm.anchorFollowHosts?.() ?? []) {
      const hostVm = ctx.vmEngine?.getVmById(host);
      if (hostVm) ctx.lineService?.reattach(host, hostVm.getHostGeom());
    }
  }
  ctx.history?.stopCapturing();
}

/** 多选几何命令：对齐六向（docs/05 §7，参考口径——以参与集最小包围盒为基准）。
 *  参与集 = 选中集剔除锚定线（见 collectAlignParticipants）；参与数 <2 整体 no-op。 */
export function alignSelection(ctx: IBoardCommandHost, mode: AlignMode): void {
  if (!ctx.viewport?.editable$.value) return;
  const entries = collectCollapsedParticipants(ctx);
  if (entries.length < 2) return;
  applyGeometryDeltas(
    ctx,
    entries,
    computeAlignDeltas(
      entries.map((e) => e.bounds),
      mode,
    ),
  );
}

/** 多选几何命令：分布两向（沿轴排序后等距化相邻间隙，两端不动）；<3 整体 no-op */
export function distributeSelection(ctx: IBoardCommandHost, axis: DistributeAxis): void {
  if (!ctx.viewport?.editable$.value) return;
  const entries = collectCollapsedParticipants(ctx);
  if (entries.length < 3) return;
  applyGeometryDeltas(
    ctx,
    entries,
    computeDistributeDeltas(
      entries.map((e) => e.bounds),
      axis,
    ),
  );
}

/** 对齐/分布参与集：锚定线剔除（resolver 单源判定，见 resolveAlignParticipant） */
function collectAlignParticipants(ctx: IBoardCommandHost): IAlignParticipant[] {
  const ids = ctx.selector?.selected$.value ?? [];
  const parts: IAlignParticipant[] = [];
  for (const id of ids) {
    const p = resolveAlignParticipant(ctx, id);
    if (p) parts.push(p);
  }
  return parts;
}

/** 参与集 + 组折叠（docs/18 §5）：**整组在集**并为单参与体（union bounds，
 *  delta 由 applyGeometryDeltas 同值摊回每成员——相对位置不变）；Alt 部分
 *  在集按单体参与（参考：组内选择 = 个体） */
export function collectCollapsedParticipants(
  ctx: IBoardCommandHost,
): ICollapsedPart<IAlignParticipant>[] {
  return collapseGroupParticipants(
    collectAlignParticipants(ctx),
    (id) => ctx.group?.groupOf(id) ?? undefined,
    (g) => ctx.group?.membersOf(g) ?? [],
  );
}

/** 单个选中项的对齐参与解析（schema 可用性与命令参与集的**单源**，2026-10-10
 *  审查处置：双份判定会漂移）：锚定线（任一端绑定宿主——位置由锚定系统拥有：
 *  宿主在集内被移动时经 anchor-follow 自动重路由跟随，宿主不动则不动，
 *  docs/05 §7）返回 null；自由线携带 points 快照（落库走 points 平移而非
 *  commitDrag——LINE 的 commitDrag 是 §4.4 例外的空操作，与「线不可整体
 *  拖动」拍板零冲突）。契约面不暴露 vm.state，LINE 判定走 model.toJSON()。 */
function resolveAlignParticipant(ctx: IBoardCommandHost, id: string): IAlignParticipant | null {
  const vm = ctx.vmEngine?.getVmById(id);
  if (!vm) return null;
  // 容器不参与对齐/分布（specs/container-frame §4.9，锚定线同款剔除）：
  // delta 只移动容器、子元素留在原地——「容器子集移动」接进 delta 分摊是
  // 后置能力；剔除后参与数不足时六向对齐/两向分布按钮各自禁用（既有逻辑）
  if (vm.type === 'FRAME') return null;
  if (vm.type === 'LINE') {
    const data = ctx.engine?.getModelById(id)?.toJSON() as unknown as
      | {
          startNodeId?: string | null;
          endNodeId?: string | null;
          points?: Array<[number, number]>;
        }
      | undefined;
    if (!data || data.startNodeId || data.endNodeId || !Array.isArray(data.points)) return null;
    return {
      id: vm.id,
      vm,
      bounds: vm.getBounds(),
      localRect: vm.getLocalRect(),
      rotation: vm.getRotation(),
      linePoints: data.points,
    };
  }
  return {
    id: vm.id,
    vm,
    bounds: vm.getBounds(),
    localRect: vm.getLocalRect(),
    rotation: vm.getRotation(),
  };
}

/** 单事务批量位移 + 锚定线急切重路由 + stopCapturing（= 一次撤销）。
 *  输入为组折叠后的参与体（docs/18 §5）：组参与体的 delta 同值摊回每成员
 *  （相对位置不变）。选区框经 onStateChanged$ 自动跟随。急切重路由必须在
 *  transact 之后（Yjs 观察者相 vm.state 已同步刷新，可取准确 bounds）、
 *  stopCapturing 之前（其事务经 captureTimeout 窗口并入同一撤销项）——若留给
 *  onStateChanged$ 微任务相（渲染后才广播）则裂成第二个 undo 项
 *  （2026-10-10 E2E 实测揪出）；微任务相的重复 reattach 被 points 同值
 *  跳过拦下（lineAnchorFollow）。 */
function applyGeometryDeltas(
  ctx: IBoardCommandHost,
  entries: ICollapsedPart<IAlignParticipant>[],
  deltas: IDelta[],
): void {
  // 位移表（参与体 + 随行件 → 初值矩形与 delta）：绑定判定的 rectOf 全走算术
  const moved = new Map<string, { rect: IRect; dx: number; dy: number }>();
  ctx.engine!.transact(() => {
    entries.forEach((entry, i) => {
      const d = deltas[i];
      if (!d || (d.dx === 0 && d.dy === 0)) return; // 已在目标位，省一次写（组参与体整块省）
      for (const p of entry.members) {
        moved.set(p.id, { rect: p.localRect, dx: d.dx, dy: d.dy });
        if (p.linePoints) {
          // 自由线：points 平移（粘贴同款通道，updateSelectedStyle 的 as never 先例）
          ctx.engine
            ?.getModelById(p.vm.id)
            ?.update({ points: translatePoints(p.linePoints, d.dx, d.dy) } as never);
        } else {
          p.vm.commitDrag(p.localRect, d.dx, d.dy);
        }
      }
    });
    // 随行件（specs/sequence-diagram §1.2 G-11 / §9.6 陷阱 9）：参与体经级联查找
    // 展开带出的件（生命线 → 绑定的激活条）按各自宿主的 delta 同事务位移——否则
    // 「分布水平」一次就把全部激活条留在原地
    const participants = [...moved.keys()];
    for (const hostId of participants) {
      const host = moved.get(hostId)!;
      for (const fid of ctx.cascade?.expandForCascade([hostId]) ?? []) {
        if (moved.has(fid) || participants.includes(fid)) continue;
        const vm = ctx.vmEngine?.getVmById(fid);
        if (!vm) continue;
        const rect = vm.getLocalRect();
        moved.set(fid, { rect, dx: host.dx, dy: host.dy });
        vm.commitDrag(rect, host.dx, host.dy);
      }
    }
    // 参与体里的激活条：绑定重判（归中 / 解绑），与位移同一事务（S7）
    ctx.sequence?.reconcileActivations(participants, (id) => {
      const m = moved.get(id);
      const r = m?.rect ??
        ctx.vmEngine?.getVmById(id)?.getLocalRect() ?? { x: 0, y: 0, width: 0, height: 0 };
      return m ? { x: r.x + m.dx, y: r.y + m.dy, width: r.width, height: r.height } : r;
    });
  });
  // 移动过的非线参与者：带动锚定线重路由（reattach 内部对无锚定线的形状 no-op）。
  // bounds 用 p.bounds + delta 纯算术（对齐无拖拽预览、root 是旧值不能读 getBounds；
  // 平移不改尺寸，bbox 刚体随移——MIND_MAP 宿主也正确，toJSON 的占位 rect 反而错）
  for (let i = 0; i < entries.length; i++) {
    const d = deltas[i];
    if (!d || (d.dx === 0 && d.dy === 0)) continue;
    for (const p of entries[i]!.members) {
      if (p.linePoints) continue;
      ctx.lineService?.reattach(p.vm.id, {
        rect: {
          x: p.localRect.x + d.dx,
          y: p.localRect.y + d.dy,
          width: p.localRect.width,
          height: p.localRect.height,
        },
        rotation: p.rotation,
      });
      // 探针给出的其他宿主（激活条 → 未动的生命线）：条的位置变了，消息让位随之变
      for (const host of p.vm.anchorFollowHosts?.() ?? []) {
        const hostVm = host === p.id ? p.vm : ctx.vmEngine?.getVmById(host);
        const geom = hostVm?.getHostGeom?.();
        if (geom && host !== p.id) ctx.lineService?.reattach(host, geom);
      }
    }
  }
  ctx.history?.stopCapturing();
}
