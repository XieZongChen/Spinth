import { describe, expect, it } from 'vitest';
import { LineQuickAdd } from '../widgets/line/lineQuickAdd';
import type { IRect } from '../common/geometry';

/**
 * quickAddPlan 决策树桩测试（docs/08 §10 批次 2 单一决策「预览即结果」）：
 * 空闲正对创建 / 已有出线交替错开 / 落位被孤立元素占只连线 / 落位带线让 1 槽。
 * stub vmEngine 决定「占位检测 / 出线计数」两输入，plan 输出几何即断言对象。
 */

const SB: IRect = { x: 100, y: 100, width: 120, height: 80 };

function makeQuickAdd(
  vmStubs: Array<{ id: string; bounds: IRect; lines?: Array<[string, string, string | null]> }>,
) {
  const shapeVms = vmStubs.map((s) => ({
    id: s.id,
    type: 'SHAPE',
    getBounds: () => ({ ...s.bounds }),
    getHostGeom: () => ({ rect: { ...s.bounds }, rotation: 0 }),
    getVmsInRect: undefined,
  }));
  const shapeAny = shapeVms as unknown as Array<{ id: string; getBounds: () => IRect }>;
  const lineModels = new Map(
    vmStubs.flatMap((s) =>
      (s.lines ?? []).map(([lineId, startId, endId]) => [
        lineId,
        { startNodeId: startId, endNodeId: endId, startJoin: 'right', endJoin: 'left' },
      ]),
    ),
  );
  return new LineQuickAdd(
    { vpScale$: { value: 1 }, worldToClient: (p: { x: number; y: number }) => ({ ...p }) } as never,
    {
      getModelById: (id: string) =>
        lineModels.has(id) ? { toJSON: () => lineModels.get(id) } : undefined,
    } as never,
    {
      // 真实语义粗筛：与查询矩形相交才返回（stub 全量返回会让远处元素误占位）
      getVmsInRect: (r: IRect) =>
        shapeAny.filter((v) => {
          const b = v.getBounds();
          return (
            b.x < r.x + r.width &&
            b.x + b.width > r.x &&
            b.y < r.y + r.height &&
            b.y + b.height > r.y
          );
        }),
      getAllVms: () =>
        vmStubs.flatMap((s) => (s.lines ?? []).map(([lineId]) => ({ id: lineId, type: 'LINE' }))),
    } as never,
    { selected$: { value: ['src'] } } as never,
    {} as never,
    {} as never,
  );
}

describe('quickAddPlan 决策树（docs/08 §10 批次 2）', () => {
  it('方向空闲：正对创建（偏移 0），新形状在 GAP 110 外、对边接入', () => {
    const qa = makeQuickAdd([]);
    const plan = qa.plan('src', SB, { x: 220, y: 140 }, 'right', null);
    if (plan.kind !== 'create') throw new Error('期望 create');
    // 正对：中心 y = 源中心 y（140）
    expect(plan.rect.y + plan.rect.height / 2).toBeCloseTo(140, 5);
    expect(plan.rect.x).toBeCloseTo(220 + 110, 5); // anchor 220 + GAP110
    expect(plan.endJoin).toBe('left');
  });

  it('已有 1 条出线：第 2 槽交替错开（branchSlotOffset 符号约定：奇数槽取负 = 先上/先左）', () => {
    const qa = makeQuickAdd([
      {
        id: 'holder',
        bounds: { x: 1000, y: 1000, width: 10, height: 10 },
        lines: [['line-1', 'src', 'other']],
      },
    ]);
    const plan = qa.plan('src', SB, { x: 220, y: 140 }, 'right', null);
    if (plan.kind !== 'create') throw new Error('期望 create');
    // stagger=1 → off = -(height+70) = -150：中心 y 上移一整个卡位（先上）
    expect(plan.rect.y + plan.rect.height / 2).toBeCloseTo(140 - 150, 5);
  });

  it('落位被无连线孤立元素占：只连线（connect），不建新形状', () => {
    // 占位元素中心 = 正对落位中心（220+110=330, 140）→ rect 覆盖
    const occupied: IRect = { x: 330 - 60, y: 140 - 40, width: 120, height: 80 };
    const qa = makeQuickAdd([{ id: 'occupier', bounds: occupied }]);
    const plan = qa.plan('src', SB, { x: 220, y: 140 }, 'right', null);
    expect(plan.kind).toBe('connect');
    if (plan.kind === 'connect') expect(plan.targetId).toBe('occupier');
  });

  it('excludeLineId：草稿线自身不计出线（首击即错开建新的反例守卫）', () => {
    // draft 挂在远处 holder 上（不占正对落位、不构成占位检测命中）
    const qa = makeQuickAdd([
      {
        id: 'holder',
        bounds: { x: 1000, y: 1000, width: 10, height: 10 },
        lines: [['draft', 'src', null]],
      },
    ]);
    const excluded = qa.plan('src', SB, { x: 220, y: 140 }, 'right', 'draft');
    if (excluded.kind !== 'create') throw new Error('期望 create');
    expect(excluded.rect.y + excluded.rect.height / 2).toBeCloseTo(140, 5); // 正对（0 出线）
  });
});
