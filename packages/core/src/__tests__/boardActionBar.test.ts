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
      'borderColor',
      'borderWidth',
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

  it('SHAPE：流程图样式批三项（specs/flowchart-closeout §4.2）——无填充选项/边框色板/宽度档位/缺省值', () => {
    const s = buildActionBarSchema(
      makeHost({
        selected: ['w1'],
        vm: { id: 'w1', type: 'SHAPE' },
        data: { borderColor: '#000000', borderWidth: 2, fill: 'none' },
      }),
      () => 0,
    );
    const byId = Object.fromEntries((s?.items ?? []).map((i) => [i.id, i]));
    // 填充 popover 末位挂「无填充」（color:'none' 分流写 fill，styleCommands）
    const colorOpts = byId.color?.options ?? [];
    expect(colorOpts[colorOpts.length - 1]).toMatchObject({ id: 'none', label: '无填充' });
    expect(byId.borderColor?.value).toBe('#000000');
    expect((byId.borderColor?.options ?? []).map((o) => o.id)).toEqual([
      '#1f2937',
      '#000000',
      '#ffffff',
      '#2563eb',
      '#dc2626',
      '#059669',
    ]);
    expect(byId.borderWidth?.value).toBe('2');
    expect((byId.borderWidth?.options ?? []).map((o) => o.id)).toEqual(['1', '2', '4']);
    // 无填充态：填充 value 如实 = 'none'（触发钮显示「无填充」图标——data.color
    // 保留旧值只是渲染不读，UI 不得说谎）
    expect(byId.color?.value).toBe('none');
    // 缺省：边框色空串（未写过 = 派生色）+ 触发钮派生色点、边框宽回落 1
    const s2 = buildActionBarSchema(
      makeHost({ selected: ['w1'], vm: { id: 'w1', type: 'SHAPE' }, data: {} }),
      () => 0,
    );
    const byId2 = Object.fromEntries((s2?.items ?? []).map((i) => [i.id, i]));
    expect(byId2.borderColor?.value).toBe('');
    // 派生色点 = darkenHex(默认填充 #e8f0fb, 0.25) = #aeb4bc（shapeStyle 同式）
    expect(byId2.borderColor?.displaySwatch).toBe('#aeb4bc');
    expect(byId2.borderWidth?.value).toBe('1');
    // 显式 borderColor 时 value 命中选项、无需兜底色点
    const s3 = buildActionBarSchema(
      makeHost({
        selected: ['w1'],
        vm: { id: 'w1', type: 'SHAPE' },
        data: { color: '#ffffff', borderColor: '#000000' },
      }),
      () => 0,
    );
    const byId3 = Object.fromEntries((s3?.items ?? []).map((i) => [i.id, i]));
    expect(byId3.borderColor?.value).toBe('#000000');
    expect(byId3.borderColor?.displaySwatch).toBeUndefined();
    expect(byId3.color?.value).toBe('#ffffff');
    // 文字色触发钮兜底（shapeType 判别 SHAPE）：fill 三态全收——无填充随主题
    // （light #333333）、深填充自适应白（shapeVm 单源）；TEXT/STICKY 无 shapeType
    // 不注入（STICKY 的便签底色不被误当填充）
    expect(byId.textColor?.displaySwatch).toBeUndefined(); // 顶层 fill:'none' shape
    expect(byId2.textColor?.displaySwatch).toBeUndefined(); // 缺省 color（非 string）
    const s4 = buildActionBarSchema(
      makeHost({
        selected: ['w1'],
        vm: { id: 'w1', type: 'SHAPE' },
        data: { shapeType: 'rect', color: '#000000' },
      }),
      () => 0,
    );
    const byId4 = Object.fromEntries((s4?.items ?? []).map((i) => [i.id, i]));
    expect(byId4.textColor?.displaySwatch).toBe('#ffffff'); // 黑填充自适应
    const s5 = buildActionBarSchema(
      makeHost({
        selected: ['w1'],
        vm: { id: 'w1', type: 'SHAPE' },
        data: { shapeType: 'rect', color: '#000000', fill: 'none' },
      }),
      () => 0,
    );
    const byId5 = Object.fromEntries((s5?.items ?? []).map((i) => [i.id, i]));
    expect(byId5.textColor?.displaySwatch).toBe('#333333'); // 无填充随主题 light
    const s6 = buildActionBarSchema(
      makeHost({
        selected: ['w1'],
        vm: { id: 'w1', type: 'STICKY' },
        data: { color: '#fff3b0' },
      }),
      () => 0,
    );
    const byId6 = Object.fromEntries((s6?.items ?? []).map((i) => [i.id, i]));
    expect(byId6.textColor?.displaySwatch).toBeUndefined(); // 非 SHAPE 不注入
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
