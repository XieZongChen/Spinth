import { BehaviorSubject } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';
import { ClipboardService } from '../platform/clipboard/clipboardService';

/**
 * SYMBOL + 锚定线同批复制粘贴（specs/symbol-widget §2.5/§9.1）：快照复制 →
 * id 重排 → 连线端点重映射到新符号。ClipboardService 级桩测（engine.add
 * 捕获落库对象断言引用修正），JS 环境跑（navigator.clipboard 写失败被吞——
 * 内部 buffer 路径正是断言对象）。
 */

function makeHarness(snapshots: Array<Record<string, unknown>>) {
  const byId = new Map(snapshots.map((s) => [s.id as string, s]));
  const added: Array<Record<string, unknown>> = [];
  const selectedCalls: string[][] = [];
  const svc = new ClipboardService(
    {
      getModelById: (id: string) => ({ toJSON: () => ({ ...byId.get(id) }) }),
      add: (w: Record<string, unknown>) => added.push({ ...w }),
      removeByIds: () => {},
      genInitialOrder: () => 'z' + Math.random().toString(36).slice(2, 8),
      transact: (fn: () => void) => fn(),
    } as never,
    {
      getVmById: (id: string) => {
        const d = byId.get(id)!;
        return { getBounds: () => ({ x: d.x, y: d.y, width: d.width, height: d.height }) };
      },
    } as never,
    {
      selected$: new BehaviorSubject(snapshots.map((s) => s.id as string)),
      setSelected: (ids: string[]) => selectedCalls.push(ids),
    } as never,
    {
      editable$: new BehaviorSubject(true),
      vpBounds$: new BehaviorSubject({ x: 0, y: 0, width: 1000, height: 600 }),
    } as never,
    { stopCapturing: vi.fn() } as never,
  );
  return { svc, added, selectedCalls };
}

const FIXTURES = [
  {
    id: 'sym1',
    type: 'SYMBOL',
    zOrder: 'a0',
    symbol: 'net-router',
    label: 'A 路由',
    x: 100,
    y: 100,
    width: 96,
    height: 128,
  },
  {
    id: 'sym2',
    type: 'SYMBOL',
    zOrder: 'a1',
    symbol: 'net-database',
    label: 'B 库',
    color: '#dc2626',
    x: 300,
    y: 100,
    width: 96,
    height: 128,
  },
  {
    id: 'ln1',
    type: 'LINE',
    zOrder: 'a2',
    lineType: 'elbowed',
    startNodeId: 'sym1',
    endNodeId: 'sym2',
    x: 196,
    y: 148,
    width: 104,
    height: 0,
    points: [
      [196, 148],
      [300, 148],
    ],
  },
];

describe('SYMBOL + 锚定线同批复制粘贴（端点重映射）', () => {
  it('粘贴后线端点指向新符号 id；符号字段与相对布局保持', async () => {
    const h = makeHarness(FIXTURES);
    await h.svc.copySelected();
    expect(h.svc.hasBuffer).toBe(true);
    h.svc.pasteAt({ x: 600, y: 400 });

    expect(h.added).toHaveLength(3);
    const newSyms = h.added.filter((w) => w.type === 'SYMBOL');
    const newLine = h.added.find((w) => w.type === 'LINE')!;
    // id 全部重排（新 id ≠ 源 id）
    expect(new Set(h.added.map((w) => w.id as string)).size).toBe(3);
    for (const w of h.added) expect(FIXTURES.map((f) => f.id)).not.toContain(w.id);
    // 连线端点重映射到同批新符号（而非源 id / null）
    expect(newSyms.map((s) => s.id)).toContain(newLine.startNodeId);
    expect(newSyms.map((s) => s.id)).toContain(newLine.endNodeId);
    // 符号字段保真（symbol/label/color 逐字段）
    const router = newSyms.find((s) => s.symbol === 'net-router')!;
    expect(router.label).toBe('A 路由');
    expect('color' in router).toBe(false);
    const db = newSyms.find((s) => s.symbol === 'net-database')!;
    expect(db.label).toBe('B 库');
    expect(db.color).toBe('#dc2626');
    // 相对布局保持（同批平移量一致：A 与 B 的 x 差仍 200）
    expect((db.x as number) - (router.x as number)).toBe(200);
    // points 世界坐标型平移（不留在原位）
    expect((newLine.points as Array<[number, number]>)[0]![0]).toBeGreaterThan(196);
    // 粘贴后重新选中新件、撤销边界切分
    expect(h.selectedCalls.at(-1)).toEqual(h.added.map((w) => w.id));
  });
});
