import { BehaviorSubject } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';
import { GroupService } from '../platform/selector/groupService';
import type {
  IDataEngineService,
  IHistoryService,
  ISelectorService,
  IVmEngineService,
} from '../types';

/** 编排桩（docs/15 三层）：引擎/选区/历史全桩，只验 GroupService 的编排语义 */
interface StubWidget {
  id: string;
  type: string;
  zOrder: string;
  groupId?: string;
  startNodeId?: string | null;
  endNodeId?: string | null;
  bounds?: { x: number; y: number; width: number; height: number };
}

const R = (x: number, y: number) => ({ x, y, width: 10, height: 10 });

function makeEnv(widgets: StubWidget[]) {
  const updates: Array<{ id: string; patch: Record<string, unknown> }> = [];
  let transactCount = 0;
  const models = new Map(
    widgets.map((w) => [
      w.id,
      {
        capabilities: {
          groupable: w.type !== 'MIND_MAP',
          resizable: true,
          rotatable: false,
          movable: true,
          selectable: true,
          keepRatio: false,
        },
        toJSON: () => ({ ...w }),
        update: (patch: Record<string, unknown>) => {
          updates.push({ id: w.id, patch });
          Object.assign(w, patch);
        },
      },
    ]),
  );
  const engine = {
    getModelById: (id: string) => models.get(id),
    transact: (fn: () => void) => {
      transactCount++;
      fn();
    },
  };
  const vms = widgets.map((w) => ({
    id: w.id,
    type: w.type,
    root: { zOrder: w.zOrder },
    getBounds: () => w.bounds ?? R(0, 0),
  }));
  const vmEngine = {
    getAllVms: () => vms,
    getVmById: (id: string) => vms.find((v) => v.id === id),
  };
  const selected$ = new BehaviorSubject<string[]>([]);
  const history = { stopCapturing: vi.fn() };
  const svc = new GroupService(
    engine as unknown as IDataEngineService,
    vmEngine as unknown as IVmEngineService,
    { selected$ } as unknown as ISelectorService,
    history as unknown as IHistoryService,
  );
  return {
    svc,
    updates,
    history,
    selected$,
    get transactCount() {
      return transactCount;
    },
  };
}

describe('GroupService 建组（docs/18 §3.1）', () => {
  it('两自由元素：同 groupId 覆写 + zOrder 归拢 + 单事务一步 undo + 选区不变', () => {
    const env = makeEnv([
      { id: 'a', type: 'SHAPE', zOrder: 'a0', bounds: R(0, 0) },
      { id: 'b', type: 'TEXT', zOrder: 'a1', bounds: R(20, 0) },
      { id: 'x', type: 'SHAPE', zOrder: 'a2', bounds: R(200, 0) }, // 非成员（上侧边界）
    ]);
    env.selected$.next(['a', 'b']);
    expect(env.svc.canGroupSelection()).toBe(true);
    env.svc.groupSelection();
    const gid = env.svc.groupOf('a');
    expect(gid).toBeTruthy();
    expect(env.svc.groupOf('b')).toBe(gid);
    expect(env.svc.membersOf(gid!)).toEqual(['a', 'b']); // zOrder 序
    const zUpdates = env.updates.filter((u) => 'zOrder' in u.patch);
    expect(zUpdates).toHaveLength(2); // 归拢：两成员连续置于最高成员处
    expect(zUpdates.every((u) => ['a', 'b'].includes(u.id))).toBe(true);
    expect(env.transactCount).toBe(1);
    expect(env.history.stopCapturing).toHaveBeenCalledTimes(1);
    expect(env.selected$.value).toEqual(['a', 'b']);
  });

  it('混入脑图（groupable false）→ 整命令拒绝零写', () => {
    const env = makeEnv([
      { id: 'a', type: 'SHAPE', zOrder: 'a0' },
      { id: 'm', type: 'MIND_MAP', zOrder: 'a1' },
    ]);
    env.selected$.next(['a', 'm']);
    expect(env.svc.canGroupSelection()).toBe(false);
    env.svc.groupSelection();
    expect(env.updates).toHaveLength(0);
  });

  it('混入锚定连线（运行时锚定态判定）→ 整命令拒绝', () => {
    const env = makeEnv([
      { id: 'a', type: 'SHAPE', zOrder: 'a0' },
      { id: 'L', type: 'LINE', zOrder: 'a1', startNodeId: 'host' },
    ]);
    env.selected$.next(['a', 'L']);
    expect(env.svc.isGroupable('L')).toBe(false);
    expect(env.svc.canGroupSelection()).toBe(false);
    env.svc.groupSelection();
    expect(env.updates).toHaveLength(0);
  });

  it('单选不建组', () => {
    const env = makeEnv([{ id: 'a', type: 'SHAPE', zOrder: 'a0' }]);
    env.selected$.next(['a']);
    expect(env.svc.canGroupSelection()).toBe(false);
    env.svc.groupSelection();
    expect(env.updates).toHaveLength(0);
  });
});

describe('GroupService 解组（docs/18 §3.2）', () => {
  function grouped() {
    return makeEnv([
      { id: 'a', type: 'SHAPE', zOrder: 'a0', groupId: 'G1', bounds: R(0, 0) },
      { id: 'b', type: 'STICKY', zOrder: 'a1', groupId: 'G1', bounds: R(20, 0) },
      { id: 'x', type: 'SHAPE', zOrder: 'a2', bounds: R(200, 0) },
    ]);
  }

  it('整组在选：整组清 groupId，选区保持成员集', () => {
    const env = grouped();
    env.selected$.next(['a', 'b']);
    expect(env.svc.canUngroupSelection()).toBe(true);
    env.svc.ungroupSelection();
    const cleared = env.updates.filter((u) => 'groupId' in u.patch);
    expect(cleared).toHaveLength(2);
    expect(cleared.every((u) => u.patch.groupId === undefined)).toBe(true);
    expect(env.svc.groupOf('a')).toBeUndefined();
    expect(env.selected$.value).toEqual(['a', 'b']);
    expect(env.history.stopCapturing).toHaveBeenCalledTimes(1);
  });

  it('Alt 单选一名成员也算涉及：整组解', () => {
    const env = grouped();
    env.selected$.next(['a']);
    env.svc.ungroupSelection();
    expect(env.svc.groupOf('a')).toBeUndefined();
    expect(env.svc.groupOf('b')).toBeUndefined(); // 未选中的 b 同组被整组解
  });

  it('不涉组 no-op', () => {
    const env = grouped();
    env.selected$.next(['x']);
    expect(env.svc.canUngroupSelection()).toBe(false);
    env.svc.ungroupSelection();
    expect(env.updates).toHaveLength(0);
  });
});

describe('GroupService 选择接线（docs/18 §4）', () => {
  function env() {
    return makeEnv([
      { id: 'b', type: 'SHAPE', zOrder: 'a0', groupId: 'G1', bounds: R(20, 0) },
      { id: 'a', type: 'SHAPE', zOrder: 'a1', groupId: 'G1', bounds: R(0, 0) },
      { id: 'x', type: 'SHAPE', zOrder: 'a2', bounds: R(100, 100) },
    ]);
  }

  it('expandIds：组员 → 存活成员全集（zOrder 序）', () => {
    const e = env();
    expect(e.svc.expandIds(['a'])).toEqual(['b', 'a']);
  });

  it('toggleIds：整组加/移除', () => {
    const e = env();
    expect(e.svc.toggleIds(['x'], 'a')).toEqual(['x', 'b', 'a']);
    expect(e.svc.toggleIds(['x', 'b', 'a'], 'b')).toEqual(['x']);
  });

  it('createMarqueeFilter：整组全入框保留全集、半组整体剔除', () => {
    const e = env();
    const filter = e.svc.createMarqueeFilter();
    expect(filter(['a', 'x'], { x: -5, y: -5, width: 200, height: 200 })).toEqual(['b', 'a', 'x']);
    expect(filter(['a', 'b'], { x: -5, y: -5, width: 25, height: 20 })).toEqual([]);
  });
});

describe('GroupService 组切换单钮 getGroupActionState（docs/18 §3.4 七态矩阵）', () => {
  it('散件（无组）→ 编组可用（建组）', () => {
    const env = makeEnv([
      { id: 'a', type: 'SHAPE', zOrder: 'a0' },
      { id: 'b', type: 'SHAPE', zOrder: 'a1' },
    ]);
    env.selected$.next(['a', 'b']);
    expect(env.svc.getGroupActionState()).toEqual({ id: 'group', disabled: false });
  });

  it('恰一个整组 → 解组可用（集合相等，顺序无关）', () => {
    const env = makeEnv([
      { id: 'a', type: 'SHAPE', zOrder: 'a0', groupId: 'G1' },
      { id: 'b', type: 'SHAPE', zOrder: 'a1', groupId: 'G1' },
    ]);
    env.selected$.next(['b', 'a']);
    expect(env.svc.getGroupActionState()).toEqual({ id: 'ungroup', disabled: false });
  });

  it('多整组 → 编组（合并意图，2026-10-17 二轮拍板）', () => {
    const env = makeEnv([
      { id: 'a', type: 'SHAPE', zOrder: 'a0', groupId: 'G1' },
      { id: 'b', type: 'SHAPE', zOrder: 'a1', groupId: 'G1' },
      { id: 'c', type: 'SHAPE', zOrder: 'a2', groupId: 'G2' },
      { id: 'd', type: 'SHAPE', zOrder: 'a3', groupId: 'G2' },
    ]);
    env.selected$.next(['a', 'b', 'c', 'd']);
    expect(env.svc.getGroupActionState()).toEqual({ id: 'group', disabled: false });
  });

  it('整组 + 散件 → 编组（收编）', () => {
    const env = makeEnv([
      { id: 'a', type: 'SHAPE', zOrder: 'a0', groupId: 'G1' },
      { id: 'b', type: 'SHAPE', zOrder: 'a1', groupId: 'G1' },
      { id: 'x', type: 'SHAPE', zOrder: 'a2' },
    ]);
    env.selected$.next(['a', 'b', 'x']);
    expect(env.svc.getGroupActionState()).toEqual({ id: 'group', disabled: false });
  });

  it('Alt 部分成员 + 散件 → 编组（改籍）', () => {
    const env = makeEnv([
      { id: 'a', type: 'SHAPE', zOrder: 'a0', groupId: 'G1' },
      { id: 'b', type: 'SHAPE', zOrder: 'a1', groupId: 'G1' },
      { id: 'x', type: 'SHAPE', zOrder: 'a2' },
    ]);
    env.selected$.next(['a', 'x']);
    expect(env.svc.getGroupActionState()).toEqual({ id: 'group', disabled: false });
  });

  it('兜底：锚定线 + 组员（编组不可行但涉组）→ 解组，不出死按钮', () => {
    const env = makeEnv([
      { id: 'a', type: 'SHAPE', zOrder: 'a0', groupId: 'G1' },
      { id: 'b', type: 'SHAPE', zOrder: 'a1', groupId: 'G1' },
      { id: 'L', type: 'LINE', zOrder: 'a2', startNodeId: 'host' },
    ]);
    env.selected$.next(['a', 'L']);
    expect(env.svc.getGroupActionState()).toEqual({ id: 'ungroup', disabled: false });
  });

  it('含不可组且不涉组 → 编组禁用；单选 → 编组禁用', () => {
    const m = makeEnv([
      { id: 'm', type: 'MIND_MAP', zOrder: 'a0' },
      { id: 'x', type: 'SHAPE', zOrder: 'a1' },
    ]);
    m.selected$.next(['m', 'x']);
    expect(m.svc.getGroupActionState()).toEqual({ id: 'group', disabled: true });

    const s = makeEnv([{ id: 'x', type: 'SHAPE', zOrder: 'a0' }]);
    s.selected$.next(['x']);
    expect(s.svc.getGroupActionState()).toEqual({ id: 'group', disabled: true });
  });
});
