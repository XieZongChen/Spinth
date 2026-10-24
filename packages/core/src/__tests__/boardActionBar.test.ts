import { BehaviorSubject } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';
import type { IActionBarHost } from '../boardHost';
import { buildActionBarSchema } from '../boardActionBar';

/**
 * ActionBar schema 分支锁（specs/api-surface §6.1）：迁移到 boardActionBar.ts
 * 后的逐分支快照——slot 顺序/禁用规则/默认值回退都是 E2E toolbar 之外的
 * 单测护栏。桩只覆盖用到的字段（显式 cast 声明不完整性）。
 */
function makeHost(opts: {
  selected: string[];
  vm?: { id: string; type: string } | null;
  data?: Record<string, unknown>;
  groupState?: { id: 'group' | 'ungroup'; disabled: boolean };
  mindNodeFocused?: boolean;
  focusedLineColor?: string;
}) {
  const vm = opts.vm ?? null;
  return {
    selector: { selected$: new BehaviorSubject<string[]>(opts.selected) },
    vmEngine: { getVmById: (id: string) => (vm && id === vm.id ? vm : undefined) },
    engine: {
      getModelById: (id: string) =>
        vm && id === vm.id ? { toJSON: () => opts.data ?? {} } : undefined,
    },
    group: opts.groupState ? { getGroupActionState: () => opts.groupState } : undefined,
    mindService: {
      isNodeFocused: () => opts.mindNodeFocused ?? false,
      getFocusedLineColor: () => opts.focusedLineColor ?? null,
    },
  } as unknown as IActionBarHost;
}

describe('buildActionBarSchema 早退', () => {
  it('无选中 → null', () => {
    expect(buildActionBarSchema(makeHost({ selected: [] }), () => 0)).toBeNull();
  });

  it('单选但 vm 缺失（vmEngine 查无此件）→ null', () => {
    expect(buildActionBarSchema(makeHost({ selected: ['w1'] }), () => 0)).toBeNull();
  });
});

describe('buildActionBarSchema 多选分支', () => {
  it('2 参与者：6 对齐键可点、2 分布键禁用、group 键态来自 getGroupActionState', () => {
    const cb = vi.fn(() => 2);
    const schema = buildActionBarSchema(
      makeHost({
        selected: ['a', 'b'],
        groupState: { id: 'ungroup', disabled: false },
      }),
      cb,
    );
    expect(schema?.type).toBe('*');
    const items = schema?.items ?? [];
    expect(items.map((i) => i.id)).toEqual([
      'align-left',
      'align-hcenter',
      'align-right',
      'align-top',
      'align-vcenter',
      'align-bottom',
      'dist-h',
      'dist-v',
      'ungroup',
    ]);
    expect(items.slice(0, 6).every((i) => !i.disabled)).toBe(true);
    expect(items.slice(6, 8).every((i) => i.disabled)).toBe(true);
    expect(items[8]).toMatchObject({ id: 'ungroup', label: '解组', disabled: false });
    expect(cb).toHaveBeenCalledTimes(1);
  });

  it('3 参与者：分布键可点；group 服务缺省回落禁用编组键', () => {
    const schema = buildActionBarSchema(makeHost({ selected: ['a', 'b', 'c'] }), () => 3);
    const items = schema?.items ?? [];
    expect(items.slice(6, 8).every((i) => !i.disabled)).toBe(true);
    expect(items[8]).toMatchObject({ id: 'group', disabled: true });
  });

  it('参与数回调只在多选分支调用（单选不计算参与集）', () => {
    const cb = vi.fn(() => 99);
    buildActionBarSchema(makeHost({ selected: ['w1'], vm: { id: 'w1', type: 'IMAGE' } }), cb);
    expect(cb).not.toHaveBeenCalled();
  });
});

describe('buildActionBarSchema 单选分支', () => {
  it('SHAPE：shapeType 取当前值；缺省回落 rect；排版项 value 带默认', () => {
    const s1 = buildActionBarSchema(
      makeHost({
        selected: ['w1'],
        vm: { id: 'w1', type: 'SHAPE' },
        data: { shapeType: 'ellipse' },
      }),
      () => 0,
    );
    expect(s1?.type).toBe('SHAPE');
    expect(s1?.items.map((i) => i.id)).toEqual([
      'shapeType',
      'color',
      'borderStyle',
      'fontSize',
      'textColor',
      'lineHeight',
      'align',
    ]);
    expect(s1?.items[0]?.value).toBe('ellipse');
    const s2 = buildActionBarSchema(
      makeHost({ selected: ['w1'], vm: { id: 'w1', type: 'SHAPE' }, data: {} }),
      () => 0,
    );
    expect(s2?.items[0]?.value).toBe('rect');
    const byId = Object.fromEntries((s2?.items ?? []).map((i) => [i.id, i]));
    expect(byId.fontSize?.value).toBe('16');
    expect(byId.lineHeight?.value).toBe('1.5');
    expect(byId.align?.value).toBe('center');
  });

  it('LINE：8 项顺序固定（线型/线宽/虚线/双箭头/颜色 + 字号/文字色）', () => {
    const s = buildActionBarSchema(
      makeHost({ selected: ['w1'], vm: { id: 'w1', type: 'LINE' }, data: {} }),
      () => 0,
    );
    expect(s?.items.map((i) => i.id)).toEqual([
      'lineType',
      'strokeWidth',
      'dashed',
      'startArrow',
      'endArrow',
      'color',
      'fontSize',
      'textColor',
    ]);
    expect(s?.items[0]?.value).toBe('STRAIGHT');
    expect(s?.items.find((i) => i.id === 'dashed')?.kind).toBe('toggle');
  });

  it('PEN：笔宽 + 颜色两项；STICKY：便签色 + 全套排版；TEXT：仅排版四项', () => {
    const pen = buildActionBarSchema(
      makeHost({ selected: ['w1'], vm: { id: 'w1', type: 'PEN' }, data: {} }),
      () => 0,
    );
    expect(pen?.items.map((i) => i.id)).toEqual(['strokeWidth', 'color']);
    const sticky = buildActionBarSchema(
      makeHost({ selected: ['w1'], vm: { id: 'w1', type: 'STICKY' }, data: {} }),
      () => 0,
    );
    expect(sticky?.items.map((i) => i.id)).toEqual([
      'color',
      'fontSize',
      'textColor',
      'lineHeight',
      'align',
    ]);
    expect(sticky?.items[0]?.value).toBe('#fff3b0');
    const text = buildActionBarSchema(
      makeHost({ selected: ['w1'], vm: { id: 'w1', type: 'TEXT' }, data: {} }),
      () => 0,
    );
    expect(text?.items.map((i) => i.id)).toEqual(['fontSize', 'textColor', 'lineHeight', 'align']);
  });

  it('MIND_MAP：节点焦点只出分支色（value 来自 getFocusedLineColor）；根焦点空 items', () => {
    const node = buildActionBarSchema(
      makeHost({
        selected: ['w1'],
        vm: { id: 'w1', type: 'MIND_MAP' },
        mindNodeFocused: true,
        focusedLineColor: '#8b5cf6',
      }),
      () => 0,
    );
    expect(node?.items).toHaveLength(1);
    expect(node?.items[0]).toMatchObject({ id: 'lineColor', value: '#8b5cf6' });
    const root = buildActionBarSchema(
      makeHost({ selected: ['w1'], vm: { id: 'w1', type: 'MIND_MAP' } }),
      () => 0,
    );
    expect(root?.items).toEqual([]);
  });

  it('IMAGE：空 items', () => {
    const s = buildActionBarSchema(
      makeHost({ selected: ['w1'], vm: { id: 'w1', type: 'IMAGE' } }),
      () => 0,
    );
    expect(s?.type).toBe('IMAGE');
    expect(s?.items).toEqual([]);
  });
});
