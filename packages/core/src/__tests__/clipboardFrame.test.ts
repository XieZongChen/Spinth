import { BehaviorSubject } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';
import { ClipboardService } from '../platform/clipboard/clipboardService';
import type { IFrameLookup } from '../types';

/**
 * 容器 + 子元素复制粘贴（specs/container-frame §4.7）：快照展开带子、
 * parentId 桶映射（批内父 → 新容器 id / 批外父置空）、粘贴后 zOrder 钳制。
 * ClipboardService 级桩测（clipboardSymbol 同款；JS 环境——内部 buffer 路径）。
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

function makeHarness(widgets: Widget[], opts: { selected?: string[] } = {}) {
  const byId = new Map(widgets.map((w) => [w.id, { ...w }]));
  const added: Array<Record<string, unknown>> = [];
  const updateLog: Array<{ id: string; patch: Record<string, unknown> }> = [];
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
    computeLayerClamps: vi.fn((post: ReadonlyArray<{ id: string; zOrder: string }>) =>
      // 桩语义：批内（新 id 不在 byId——从粘贴 add 捕获里认类型）每容器
      // key ≥ 其批内最小子 key 时给一个更低的 key
      post
        .filter((p) => added.find((a) => a.id === p.id && a.type === 'FRAME'))
        .flatMap((f) => {
          const childZs = post
            .filter((p) => added.find((a) => a.id === p.id && a.parentId === f.id))
            .map((p) => p.zOrder);
          if (childZs.length === 0) return [];
          const minChild = childZs.reduce((a, b) => (a < b ? a : b));
          return f.zOrder < minChild ? [] : [{ id: f.id, zOrder: minChild + '0' }];
        }),
    ),
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
      transact: (fn: () => void) => fn(),
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
    { stopCapturing: vi.fn() } as never,
    () => framesLookup,
  );
  return { svc, added, updateLog, framesLookup };
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

  it('单选子复制（无容器在批）：批外父置空（落为顶层，不被原容器级联）', async () => {
    const h = makeHarness(FIXTURE(), { selected: ['c1'] });
    await h.svc.copySelected();
    h.svc.pasteAt({ x: 600, y: 400 });
    const pasted = h.added.find((w) => w.type === 'SHAPE')!;
    // 键删除投影：值 undefined（真引擎 create 的 Object.is 守卫不下键；
    // 桩对象保留键但值必须为 undefined——两态都断言「不指向原容器」）
    expect(pasted.parentId).toBeUndefined();
  });

  it('粘贴后钳制：容器 zOrder 压回批内子之下（I3）', async () => {
    // 快照序子在前、容器在后（source 排序天然如此时）——粘贴序子先入批
    const fixture = FIXTURE();
    // 人为让选中集 = [c1, c2, f1]（子在前）：粘贴批内容器最后入批 = key 最高
    const h = makeHarness(fixture, { selected: ['c1', 'c2', 'f1'] });
    await h.svc.copySelected();
    h.svc.pasteAt({ x: 600, y: 400 });
    // 钳制桩被调用且产出了写入
    expect(h.framesLookup.computeLayerClamps).toHaveBeenCalled();
    const clamp = h.updateLog.find((u) => 'zOrder' in u.patch);
    expect(clamp).toBeDefined();
  });

  it('无容器批零钳制开销（computeLayerClamps 不调）', async () => {
    const fixture = [FIXTURE()[1]!, FIXTURE()[2]!]; // 只有形状
    const h = makeHarness(fixture, { selected: ['c1', 'c2'] });
    await h.svc.copySelected();
    h.svc.pasteAt({ x: 600, y: 400 });
    expect(h.framesLookup.computeLayerClamps).not.toHaveBeenCalled();
    expect(h.updateLog).toHaveLength(0);
  });
});
