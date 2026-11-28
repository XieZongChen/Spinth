// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import {
  computeLineTextKnockout,
  KNOCKOUT_PADDING,
  textAnchorOf,
} from '../widgets/line/lineVmText';
import { hitTestLineText } from '../widgets/line/lineVmHit';
import { LineTextEditor, type ILineEditorHost } from '../widgets/line/lineTextEditor';
import type { IEditSessionDescriptor, IEditingService, LineData } from '../types';

/**
 * 线上文字侧别（specs/sequence-diagram §4.9）：锚点单源 textAnchorOf（缺省 = 路径点；
 * above / below 沿法向偏移「盒高 / 2 + KNOCKOUT_PADDING」，近水平线段恒为视觉上方——
 * 路径朝左时翻转）、侧别文字不切线但文字盒仍在（手柄 / 探针参照）、命中与编辑框跟随。
 */

const H = 16.8; // 12px × 1.4 行高
const OFF = H / 2 + KNOCKOUT_PADDING; // 12.4

const near = (a: number, b: number, note?: string): void => {
  expect(Math.abs(a - b), note).toBeLessThan(1e-6);
};

const LR = [
  { x: 0, y: 0 },
  { x: 100, y: 0 },
];
const RL = [
  { x: 100, y: 0 },
  { x: 0, y: 0 },
];

describe('textAnchorOf（锚点单源）', () => {
  it('缺省 = 路径点（现状逐值不变）：ratio 定位、不偏移', () => {
    const a = textAnchorOf(LR, { textRatio: 0.5 }, H);
    expect(a).toEqual({ x: 50, y: 0 });
    const b = textAnchorOf(LR, { textRatio: 0.25 }, H);
    expect(b).toEqual({ x: 25, y: 0 });
  });

  it('左→右水平线：above 在线上方（y 负向）、below 在线下方，距离 = 盒高 / 2 + 内边距', () => {
    const up = textAnchorOf(LR, { textRatio: 0.5, textSide: 'above' }, H);
    expect(up.x).toBe(50);
    near(up.y, -OFF);
    const down = textAnchorOf(LR, { textRatio: 0.5, textSide: 'below' }, H);
    expect(down.x).toBe(50);
    near(down.y, OFF);
  });

  it('右→左水平线：翻转法向——above 仍是视觉上方（消息可以从任一端画）', () => {
    const up = textAnchorOf(RL, { textRatio: 0.5, textSide: 'above' }, H);
    expect(up.x).toBe(50);
    near(up.y, -OFF);
    const down = textAnchorOf(RL, { textRatio: 0.5, textSide: 'below' }, H);
    near(down.y, OFF);
  });

  it('竖直线段：侧别退化为沿线一侧（向下 = above 在右侧；向上 = above 在左侧）', () => {
    const down = [
      { x: 0, y: 0 },
      { x: 0, y: 100 },
    ];
    const up = [
      { x: 0, y: 100 },
      { x: 0, y: 0 },
    ];
    near(textAnchorOf(down, { textRatio: 0.5, textSide: 'above' }, H).x, OFF);
    near(textAnchorOf(down, { textRatio: 0.5, textSide: 'below' }, H).x, -OFF);
    near(textAnchorOf(up, { textRatio: 0.5, textSide: 'above' }, H).x, -OFF);
    expect(textAnchorOf(down, { textRatio: 0.5, textSide: 'above' }, H).y).toBe(50);
  });

  it('斜线：沿单位左法向偏移（方向 (0.6, 0.8) 的 above = (+0.8, −0.6) × 距离）', () => {
    const diag = [
      { x: 0, y: 0 },
      { x: 60, y: 80 },
    ];
    const p = textAnchorOf(diag, { textRatio: 0.5, textSide: 'above' }, H);
    near(p.x, 30 + 0.8 * OFF);
    near(p.y, 40 - 0.6 * OFF);
  });

  it('盒高参与偏移：盒越高离线越远；退化路径（单点）不抛错', () => {
    near(textAnchorOf(LR, { textRatio: 0.5, textSide: 'above' }, 40).y, -24);
    expect(() =>
      textAnchorOf([{ x: 3, y: 4 }], { textRatio: 0.5, textSide: 'above' }, H),
    ).not.toThrow();
  });
});

/** computeLineTextKnockout 的 Text 桩：样式可写、宽高可读（真 Text 在 jsdom 下量不出字宽） */
function textStub(
  width = 60,
  height = H,
): { style: object; text: string; width: number; height: number } {
  return { style: {}, text: '', width, height };
}

/** PIXI Rectangle → 纯对象（toEqual 不认多出来的 type 字段） */
const plain = (r: { x: number; y: number; width: number; height: number } | null) =>
  r ? { x: r.x, y: r.y, width: r.width, height: r.height } : null;

describe('computeLineTextKnockout（镂空 vs 文字盒）', () => {
  it('缺省：镂空 = 文字盒（文字实测尺寸 + 内边距），锚点在路径点上', () => {
    const r = computeLineTextKnockout(
      LR,
      { text: '登录', textRatio: 0.5 },
      {
        textEditing: false,
        editorFrame: null,
        textNode: textStub() as never,
      },
    );
    expect(r.hasText).toBe(true);
    expect(r.textAnchor).toEqual({ x: 50, y: 0 });
    expect(plain(r.knockout)).toEqual({ x: 16, y: -12.4, width: 68, height: 24.8 });
    expect(r.textBox).toEqual({ x: 16, y: -12.4, width: 68, height: 24.8 });
  });

  it('above：不切线（knockout 为空），文字盒 = 字形盒、在线上方（盒底离线一个内边距）', () => {
    const r = computeLineTextKnockout(
      LR,
      { text: '登录', textRatio: 0.5, textSide: 'above' },
      {
        textEditing: false,
        editorFrame: null,
        textNode: textStub() as never,
      },
    );
    expect(r.knockout).toBeNull();
    expect(r.textBox).toEqual({ x: 20, y: -20.8, width: 60, height: 16.8 });
    expect(r.textAnchor).toEqual({ x: 50, y: -12.4 });
    // 盒底 = 线 y − 内边距：留白落在字形与线之间，线完整；胶囊拿这个盒切路径
    // 不会切到线（外扩内边距的盒边会压回线上，把整条线切没）
    near(r.textBox!.y + r.textBox!.height, -KNOCKOUT_PADDING);
  });

  it('below：文字盒在线下方（盒顶离线一个内边距）', () => {
    const r = computeLineTextKnockout(
      LR,
      { text: '登录', textRatio: 0.5, textSide: 'below' },
      {
        textEditing: false,
        editorFrame: null,
        textNode: textStub() as never,
      },
    );
    expect(r.knockout).toBeNull();
    near(r.textBox!.y, KNOCKOUT_PADDING);
  });

  it('编辑期：盒高取编辑器框高；缺省切线（现状）、侧别不切线', () => {
    const base = { textEditing: true, editorFrame: { width: 200, height: 40 } };
    const onLine = computeLineTextKnockout(
      LR,
      { text: '', textRatio: 0.5 },
      {
        ...base,
        textNode: textStub() as never,
      },
    );
    expect(plain(onLine.knockout)).toEqual({ x: -50, y: -20, width: 200, height: 40 });
    expect(onLine.textBox).toEqual({ x: -50, y: -20, width: 200, height: 40 });
    const above = computeLineTextKnockout(
      LR,
      { text: '', textRatio: 0.5, textSide: 'above' },
      {
        ...base,
        textNode: textStub() as never,
      },
    );
    expect(above.knockout).toBeNull();
    // 偏移按框高：40 / 2 + 4 = 24 → 框顶到框底 [−44, −4]，框底离线一个留隙
    expect(above.textBox).toEqual({ x: -50, y: -44, width: 200, height: 40 });
  });

  it('无文字且非编辑期：镂空与文字盒都为空', () => {
    const r = computeLineTextKnockout(
      LR,
      { text: '', textRatio: 0.5, textSide: 'above' },
      {
        textEditing: false,
        editorFrame: null,
        textNode: textStub() as never,
      },
    );
    expect(r.knockout).toBeNull();
    expect(r.textBox).toBeNull();
    expect(r.hasText).toBe(false);
  });
});

describe('hitTestLineText（文字命中盒随侧别偏移）', () => {
  const root = { x: 0, y: 0 } as never;
  const sprite = { visible: true, width: 60, height: H } as never;
  // 命中只读 points / lineType / textRatio / textSide，其余字段按 LineData 补齐
  const base = {
    type: 'LINE',
    points: [
      [0, 0],
      [100, 0],
    ],
    text: '登录',
    textRatio: 0.5,
    lineType: 'STRAIGHT',
  } as LineData;

  it('缺省：线上的点命中文字盒（现状）', () => {
    expect(hitTestLineText({ x: 50, y: 2 } as never, root, base, sprite)).toBe(true);
    expect(hitTestLineText({ x: 50, y: -20 } as never, root, base, sprite)).toBe(false);
  });

  it('above：线上的点不再命中（点线身是选线），字形盒处命中（留隙不算文字）', () => {
    const s = { ...base, textSide: 'above' as const };
    expect(hitTestLineText({ x: 50, y: 2 } as never, root, s, sprite)).toBe(false);
    expect(hitTestLineText({ x: 50, y: -1 } as never, root, s, sprite)).toBe(false);
    expect(hitTestLineText({ x: 50, y: -4.5 } as never, root, s, sprite)).toBe(true);
    expect(hitTestLineText({ x: 50, y: -12.4 } as never, root, s, sprite)).toBe(true);
    expect(hitTestLineText({ x: 50, y: -25.5 } as never, root, s, sprite)).toBe(false);
  });
});

describe('LineTextEditor.getRect（编辑框跟随侧别）', () => {
  function makeEditor(data: Record<string, unknown>) {
    const vm = {
      id: 'ln1',
      type: 'LINE',
      flushUpdate: vi.fn(),
      setTextEditing: vi.fn(),
      setEditorFrame: vi.fn(),
    };
    const model = { toJSON: () => ({ id: 'ln1', type: 'LINE', ...data }) };
    let descriptor: IEditSessionDescriptor | null = null;
    const editing = {
      begin: (d: IEditSessionDescriptor) => {
        descriptor = d;
        d.onEnter?.();
      },
      exitActive: vi.fn(),
      editingWidgetId: null,
      activeKernel: null,
      session$: { subscribe: () => ({ unsubscribe: () => {} }) },
    } as unknown as IEditingService;
    const host: ILineEditorHost = { hideEditOverlays: vi.fn(), refreshHandles: vi.fn() };
    const editor = new LineTextEditor(
      { getModelById: () => model } as never,
      { getVmById: () => vm } as never,
      editing,
      host,
    );
    editor.enterTextEdit('ln1');
    return { descriptor: (): IEditSessionDescriptor => descriptor!, vm };
  }

  const points = [
    [0, 0],
    [100, 0],
  ];

  it('缺省：编辑框中心 = 路径点（现状）', () => {
    const h = makeEditor({ points, text: '登录', textRatio: 0.5 });
    expect(h.descriptor().getRect()).toEqual({ x: 50, y: 0, width: 0, height: 0 });
  });

  it('above：编辑框中心在线上方，偏移按编辑器框高（onFrameChange 喂入的实测高度）', () => {
    const h = makeEditor({ points, text: '登录', textRatio: 0.5, textSide: 'above' });
    // 首帧还没有框高：先按 0 高落位（框贴线），收到框高后上移——与 vm 侧同一盒高
    h.descriptor().onFrameChange?.({ width: 200, height: 40 });
    expect(h.vm.setEditorFrame).toHaveBeenCalledWith({ width: 200, height: 40 });
    expect(h.descriptor().getRect()).toEqual({ x: 50, y: -24, width: 0, height: 0 });
  });

  it('右→左的线：above 的编辑框同样在线上方', () => {
    const h = makeEditor({
      points: [
        [100, 0],
        [0, 0],
      ],
      text: '登录',
      textRatio: 0.5,
      textSide: 'above',
    });
    h.descriptor().onFrameChange?.({ width: 200, height: 40 });
    expect(h.descriptor().getRect()?.y).toBe(-24);
  });
});
