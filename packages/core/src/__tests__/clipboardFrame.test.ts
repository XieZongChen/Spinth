import { BehaviorSubject } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';
import { ClipboardService } from '../platform/clipboard/clipboardService';
import type { IFrameLookup } from '../types';

/**
 * 容器 + 子元素复制粘贴（specs/container-frame §4.7）：快照展开带子、
 * parentId 桶映射（批内父 → 新容器 id / 批外父置空）、容器先入批（I3 层级在
 * 创建数据里即正确）、无父副本的落点归属（粘贴批之后另起事务调
 * adoptByLanding，同一捕获窗）。ClipboardService 级桩测（clipboardSymbol
 * 同款；JS 环境——内部 buffer 路径）；判定本身在 frameService /
 * clipboardLanding 测试。
 */

interface Widget {
  id: string;
  type: string;
  zOrder?: string;
  parentId?: string;
  x: number;
  y: number;
  width: number;
  height: number;
  [k: string]: unknown;
}

function makeHarness(widgets: Widget[], opts: { selected?: string[]; frames?: boolean } = {}) {
  const byId = new Map(widgets.map((w) => [w.id, { ...w }]));
  const added: Array<Record<string, unknown>> = [];
  const updateLog: Array<{ id: string; patch: Record<string, unknown> }> = [];
  /** 调用时序日志：事务开合 / 落点归属 / 撤销窗收口 */
  const log: string[] = [];
  const framesLookup: IFrameLookup = {
    isFrame: (id) => byId.get(id)?.type === 'FRAME',
    childIds: (fid) => widgets.filter((w) => w.parentId === fid).map((w) => w.id),
    expandForCascade: (ids) => {
      const out: string[] = [];
      for (const id of ids) {
        out.push(id);
        if (byId.get(id)?.type === 'FRAME') {
          for (const w of widgets) if (w.parentId === id && !out.includes(w.id)) out.push(w.id);
        }
      }
      return out;
    },
    reconcileParents: () => {},
    adoptByLanding: vi.fn(() => {
      log.push('adoptByLanding');
    }),
    createMarqueeFrameFilter: () => null,
    // 粘贴路径不再调（容器先入批后无钳制可做）——保留桩只为断言「零调用」
    computeLayerClamps: vi.fn(() => []),
  };
  let zSeq = 0;
  const svc = new ClipboardService(
    {
      getModelById: (id: string) => ({
        toJSON: () => ({ ...byId.get(id) }),
        update: (patch: Record<string, unknown>) => updateLog.push({ id, patch }),
      }),
      add: (w: Record<string, unknown>) => {
        added.push({ ...w });
        zSeq++;
      },
      removeByIds: vi.fn(),
      genInitialOrder: () => `z${zSeq}`,
      transact: (fn: () => void) => {
        log.push('tx:begin');
        fn();
        log.push('tx:end');
      },
    } as never,
    {
      getVmById: (id: string) => {
        const d = byId.get(id)!;
        return { getBounds: () => ({ x: d.x, y: d.y, width: d.width, height: d.height }) };
      },
    } as never,
    {
      selected$: new BehaviorSubject(opts.selected ?? widgets.map((w) => w.id)),
      setSelected: () => {},
    } as never,
    {
      editable$: new BehaviorSubject(true),
      vpBounds$: new BehaviorSubject({ x: 0, y: 0, width: 1000, height: 600 }),
    } as never,
    {
      stopCapturing: vi.fn(() => {
        log.push('stopCapturing');
      }),
    } as never,
    opts.frames === false ? () => null : () => framesLookup,
  );
  return { svc, added, updateLog, framesLookup, log };
}

const FIXTURE = (): Widget[] => [
  { id: 'f1', type: 'FRAME', x: 100, y: 100, width: 300, height: 200 },
  { id: 'c1', type: 'SHAPE', parentId: 'f1', x: 150, y: 150, width: 50, height: 50 },
  { id: 'c2', type: 'SHAPE', parentId: 'f1', x: 220, y: 150, width: 50, height: 50 },
];

describe('容器复制粘贴（specs/container-frame §4.7）', () => {
  it('单选容器复制：快照带子（展开）；粘贴出 新容器+新子 且 parentId 指向新容器', async () => {
    const h = makeHarness(FIXTURE(), { selected: ['f1'] });
    await h.svc.copySelected();
    expect(h.svc.hasBuffer).toBe(true);
    h.svc.pasteAt({ x: 600, y: 400 });

    const newFrame = h.added.find((w) => w.type === 'FRAME')!;
    const newChildren = h.added.filter((w) => w.type === 'SHAPE');
    expect(newChildren).toHaveLength(2);
    // 批内父 → 新容器 id（不是原 f1）
    for (const c of newChildren) expect(c.parentId).toBe(newFrame.id);
    expect(newFrame.id).not.toBe('f1');
  });

  it('单选子复制（无容器在批）：批外父置空——不被原容器级联（归属落点容器与否由 adoptByLanding 另判）', async () => {
    const h = makeHarness(FIXTURE(), { selected: ['c1'] });
    await h.svc.copySelected();
    h.svc.pasteAt({ x: 600, y: 400 });
    const pasted = h.added.find((w) => w.type === 'SHAPE')!;
    // 键删除投影：值 undefined（真引擎 create 的 Object.is 守卫不下键；
    // 桩对象保留键但值必须为 undefined——两态都断言「不指向原容器」）
    expect(pasted.parentId).toBeUndefined();
  });

  it('容器先入批：选区序子在前时，副本容器 zOrder 仍低于批内全部子（I3）——零事后钳制写', async () => {
    // 人为让选中集 = [c1, c2, f1]（子在前）：若按快照序入批，容器最后入批 =
    // key 最高、盖住子。容器改排到批首——层级在创建数据里即正确
    const h = makeHarness(FIXTURE(), { selected: ['c1', 'c2', 'f1'] });
    await h.svc.copySelected();
    h.svc.pasteAt({ x: 600, y: 400 });
    expect(h.added.map((w) => w.type)).toEqual(['FRAME', 'SHAPE', 'SHAPE']);
    const frame = h.added.find((w) => w.type === 'FRAME')!;
    for (const c of h.added.filter((w) => w.type === 'SHAPE')) {
      expect(c.parentId).toBe(frame.id); // 桶映射不随入批序改变
      expect(String(frame.zOrder) < String(c.zOrder)).toBe(true);
    }
    // 不得退回「全部 add 后再 update 钳制」：同事务内该写入对刚建 vm 的观察者
    // 不可见（yjs 不为本事务新建的类型登记变更）——文档钳了、root.zOrder 没动
    expect(h.framesLookup.computeLayerClamps).not.toHaveBeenCalled();
    expect(h.updateLog).toHaveLength(0);
  });

  it('无容器批零钳制开销（computeLayerClamps 不调）', async () => {
    const fixture = [FIXTURE()[1]!, FIXTURE()[2]!]; // 只有形状
    const h = makeHarness(fixture, { selected: ['c1', 'c2'] });
    await h.svc.copySelected();
    h.svc.pasteAt({ x: 600, y: 400 });
    expect(h.framesLookup.computeLayerClamps).not.toHaveBeenCalled();
    expect(h.updateLog).toHaveLength(0);
  });

  it('粘贴收尾：无父副本的落点归属在粘贴批之后另起事务、stopCapturing 之前（同一捕获窗）', async () => {
    const h = makeHarness(FIXTURE(), { selected: ['c1', 'c2', 'f1'] });
    await h.svc.copySelected();
    h.svc.pasteAt({ x: 600, y: 400 });
    // 交全部新 id：哪些算「无父且可自动归属」由 adoptByLanding 单源判定
    expect(h.framesLookup.adoptByLanding).toHaveBeenCalledTimes(1);
    expect(vi.mocked(h.framesLookup.adoptByLanding).mock.calls[0]![0]).toEqual(
      h.added.map((w) => w.id),
    );
    // 批事务先闭合（批内写入对刚建 vm 的观察者不可见），归属写在自己的事务里，
    // 且落在 stopCapturing 之前——与粘贴同一步 undo
    expect(h.log).toEqual([
      'tx:begin',
      'tx:end',
      'tx:begin',
      'adoptByLanding',
      'tx:end',
      'stopCapturing',
    ]);
  });

  it('无容器语义（getFrames 为 null）：不调落点归属、不开第二个事务', async () => {
    const h = makeHarness(FIXTURE(), { selected: ['f1'], frames: false });
    await h.svc.copySelected();
    h.svc.pasteAt({ x: 600, y: 400 });
    expect(h.log).toEqual(['tx:begin', 'tx:end', 'stopCapturing']);
  });
});
