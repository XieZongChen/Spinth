import { BehaviorSubject, Subject } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';
import { TextService } from '../widgets/text/textService';
import type { IEditSessionDescriptor, IEditingService } from '../types';

/**
 * textService 桩测试（docs/17 批 1/C3）：descriptor 工厂（style 传递 /
 * emptyTextPolicy delete-widget / onCommit 尾巴）+ styleWatch 防回环 +
 * reflowHeight。stub EditingService 捕获 descriptor 断言声明面。
 */

function makeHarness() {
  const styleWatchHandlers: Array<() => void> = [];
  const model = {
    toJSON: vi.fn(() => ({ text: '<p>hello</p>', fontSize: undefined, textColor: undefined })),
    update: vi.fn(),
    updateRect: vi.fn(),
    capabilities: { resizable: true },
    yData: {
      observeDeep: (h: () => void) => styleWatchHandlers.push(h),
      unobserveDeep: () => {},
    },
  };
  const vm = {
    type: 'TEXT',
    // 高度 60 ≠ 测高 40（1 行 × 24 + pad 16）→ drift 触发 updateRect 断言
    getBounds: () => ({ x: 0, y: 0, width: 240, height: 60 }),
    getLocalRect: () => ({ x: 0, y: 0, width: 240, height: 60 }), // 1.7：测高走数据矩形
    getHostGeom: () => ({ rect: { x: 0, y: 0, width: 240, height: 60 }, rotation: 0 }),
    getRotation: () => 0,
    flushUpdate: vi.fn(),
    onStateChanged$: new BehaviorSubject({ diff: {}, local: true }),
  };
  const descriptors: IEditSessionDescriptor[] = [];
  const exits: Array<{ discard?: boolean } | undefined> = [];
  const editing: IEditingService = {
    begin: (d) => descriptors.push(d),
    exitActive: (opts) => exits.push(opts),
    editingWidgetId: null,
    activeKernel: null,
    session$: new Subject<void>(),
  };
  const added: Array<Record<string, unknown>> = [];
  const selector = { selected$: new BehaviorSubject<string[]>([]), setSelected: vi.fn() };
  const svc = new TextService(
    {
      registerGlobalEventListener: () => {},
      setCursorMode: () => {},
      vpBounds$: new BehaviorSubject({ x: 0, y: 0, width: 1000, height: 600 }),
    } as never,
    {
      getModelById: (id: string) => (id === 'w1' ? model : undefined),
      add: (w: Record<string, unknown>) => added.push(w),
      genInitialOrder: () => 'a0',
      transact: (fn: () => void) => fn(),
    } as never,
    { getVmById: (id: string) => (id === 'w1' ? vm : undefined) } as never,
    selector as never,
    { stopCapturing: vi.fn() } as never,
    editing,
  );
  return { svc, model, vm, descriptors, exits, styleWatchHandlers, added, selector };
}

describe('textService descriptor 工厂（docs/17 批 1）', () => {
  it('enterEdit：向 EditingService 声明 delete-widget 空文本策略 + 默认排版 style', () => {
    const h = makeHarness();
    h.svc.enterEdit('w1');
    expect(h.descriptors).toHaveLength(1);
    const d = h.descriptors[0]!;
    expect(d.kernel).toBe('html');
    expect(d.widgetId).toBe('w1');
    expect(d.emptyTextPolicy).toBe('delete-widget');
    expect(d.style).toMatchObject({ fontSize: 16, lineHeight: 1.5 });
    expect(d.getContent()).toBe('<p>hello</p>');
    expect(d.getRect()).toMatchObject({ x: 8, y: 8 }); // bounds + padding
    expect(h.svc.editingWidgetId).toBe('w1');
  });

  it('STICKY 分流：便签常量（15/1.45）', () => {
    const h = makeHarness();
    (h.vm as unknown as { type: string }).type = 'STICKY';
    h.svc.enterEdit('w1');
    expect(h.descriptors[0]!.style).toMatchObject({ fontSize: 15, lineHeight: 1.45 });
  });

  it('lineHeight per-实例：override 透传编辑 style（默认 1.5，批 lineHeight 落地）', () => {
    const h = makeHarness();
    (h.model.toJSON as ReturnType<typeof vi.fn>).mockReturnValue({
      text: '<p>x</p>',
      lineHeight: 1.8,
    });
    h.svc.enterEdit('w1');
    expect(h.descriptors[0]!.style).toMatchObject({ fontSize: 16, lineHeight: 1.8 });
  });

  it('SHAPE 分支（docs/17 §6）：图形常量 + keep 空文本策略 + 编辑框内接矩形', () => {
    const h = makeHarness();
    (h.vm as unknown as { type: string }).type = 'SHAPE';
    (h.model.toJSON as ReturnType<typeof vi.fn>).mockReturnValue({
      text: '',
      shapeType: 'ellipse',
    });
    h.svc.enterEdit('w1');
    const d = h.descriptors[0]!;
    // keep：空文本不删形状（LINE 同语义——与 TEXT/STICKY 的 delete-widget 分流）
    expect(d.emptyTextPolicy).toBe('keep');
    expect(d.style).toMatchObject({ fontSize: 16, lineHeight: 1.5, textAlign: 'center' });
    // 编辑框 anchor center：x/y = 图形中心（bounds 240×60 → (120,30)）、宽 = ellipse
    // 内接宽（240/√2，与画布换行 maxWidth 同源）；内容对称生长 = 打字中途实时居中
    expect(d.getRect()).toMatchObject({ x: 120, y: 30, width: 240 / Math.SQRT2 });
    expect(d.style).toMatchObject({ anchor: 'center' });
    // SHAPE 提交（autoHeight 开、只撑不缩）：短文公式值 < 当前高 60 → 只落 text
    // 不写高（空文本归一空串走 DOMParser——node 垫片下 htmlToPlainText 降级返回
    // 原文，归一路径由 E2E 浏览器环境验证）
    d.onCommit('<p>形状文字</p>');
    expect(h.model.update).toHaveBeenCalledWith({ text: '<p>形状文字</p>' });
    expect(h.model.updateRect).not.toHaveBeenCalled();
  });

  it('onCommit 尾巴：text 落库 + autoHeight 重测写回（drift > 0.5 才写）', () => {
    const h = makeHarness();
    h.svc.enterEdit('w1');
    h.descriptors[0]!.onCommit('<p>hello</p>');
    expect(h.model.update).toHaveBeenCalledWith({ text: '<p>hello</p>' });
    // measureDoc 在 node 垫片 canvas 下按 10px/字估宽——高度 24 ≠ 40 → 写回
    expect(h.model.updateRect).toHaveBeenCalled();
  });

  it('exitEdit → editing.exitActive 转发', () => {
    const h = makeHarness();
    h.svc.enterEdit('w1');
    h.svc.exitEdit();
    expect(h.exits).toEqual([undefined]);
  });
});

describe('textService styleWatch 防回环（docs/17 C3）', () => {
  it('text 变更（排版未变）不重放 begin；fontSize 变更重放新 style', () => {
    const h = makeHarness();
    h.svc.enterEdit('w1');
    expect(h.descriptors).toHaveLength(1);

    // 模拟 onCommit 落库触发的 observeDeep（排版未变——防回环应吞掉）
    h.styleWatchHandlers.forEach((fn) => fn());
    expect(h.descriptors).toHaveLength(1);

    // 排版变更（协同远端改字号）→ 重放
    (h.model.toJSON as ReturnType<typeof vi.fn>).mockReturnValue({
      text: '<p>x</p>',
      fontSize: 24,
      textColor: undefined,
    });
    h.styleWatchHandlers.forEach((fn) => fn());
    expect(h.descriptors).toHaveLength(2);
    expect(h.descriptors[1]!.style).toMatchObject({ fontSize: 24 });
  });

  it('lineHeight 变更同样触发跟随重放（防回环比对含第四键，批 lineHeight 落地）', () => {
    const h = makeHarness();
    h.svc.enterEdit('w1');
    // fontSize/textColor 不变、仅 lineHeight 变（协同远端改行高）
    (h.model.toJSON as ReturnType<typeof vi.fn>).mockReturnValue({
      text: '<p>x</p>',
      lineHeight: 2.0,
    });
    h.styleWatchHandlers.forEach((fn) => fn());
    expect(h.descriptors).toHaveLength(2);
    expect(h.descriptors[1]!.style).toMatchObject({ fontSize: 16, lineHeight: 2.0 });
  });

  it('reflowHeight：直接触发 commitEdit 测高（ActionBar 改字号路径）', () => {
    const h = makeHarness();
    h.svc.reflowHeight('w1');
    expect(h.model.updateRect).toHaveBeenCalled();
  });

  it('pasteText：纯文本建 TEXT——转义 + \\n→<br> + 视口中心 + 选中（docs/09 留白销账）', () => {
    const h = makeHarness();
    h.svc.pasteText('第一行<b>粗</b>\n第二行');
    expect(h.added).toHaveLength(1);
    const w = h.added[0] as unknown as Record<string, unknown>;
    expect(w.type).toBe('TEXT');
    expect(w.text).toBe('<p>第一行&lt;b&gt;粗&lt;/b&gt;<br>第二行</p>');
    // 视口中心（1000×600 → 中心 500,300）+ 尺寸/选中
    expect(w.x).toBe(500 - 240 / 2);
    expect(w.height).toBe(2 * 16 * 1.5 + 16);
    expect(h.selector.setSelected).toHaveBeenCalled();
  });
});

describe('SHAPE autoHeight（docs/17 §6，2026-10-10 四点拍板）', () => {
  // 椭圆 240×60：node 垫片测宽 9.6px/字（16×0.6），20 字 = 192 > 内接宽
  // 240/√2 ≈ 169.7 → 折 2 行 → 文字高 2×24 = 48 → 撑高公式 48×√2 ≈ 67.88 > 60
  const tallText = '<p>一二三四五六七八九十一二三四五六七八九十</p>';

  it('autoHeight 开：长文撑到公式高度（text+height 一个事务内）', () => {
    const h = makeHarness();
    (h.vm as unknown as { type: string }).type = 'SHAPE';
    (h.model.toJSON as ReturnType<typeof vi.fn>).mockReturnValue({
      text: '',
      shapeType: 'ellipse',
    });
    h.svc.enterEdit('w1');
    h.descriptors[0]!.onCommit(tallText);
    expect(h.model.update).toHaveBeenCalledWith({ text: tallText });
    expect(h.model.updateRect).toHaveBeenCalledWith({ height: 67.88 });
  });

  it('只撑不缩：短文公式值 < 当前高 → 只落 text 不写高（既有 SHAPE 用例语义收口）', () => {
    const h = makeHarness();
    (h.vm as unknown as { type: string }).type = 'SHAPE';
    (h.model.toJSON as ReturnType<typeof vi.fn>).mockReturnValue({ text: '', shapeType: 'rect' });
    h.svc.enterEdit('w1');
    h.descriptors[0]!.onCommit('<p>短</p>');
    expect(h.model.update).toHaveBeenCalledWith({ text: '<p>短</p>' });
    expect(h.model.updateRect).not.toHaveBeenCalled();
  });

  it('autoHeight 显式 false（手动缩放解除）：只落 text，长文也不撑', () => {
    const h = makeHarness();
    (h.vm as unknown as { type: string }).type = 'SHAPE';
    (h.model.toJSON as ReturnType<typeof vi.fn>).mockReturnValue({
      text: '',
      shapeType: 'ellipse',
      autoHeight: false,
    });
    h.svc.enterEdit('w1');
    h.descriptors[0]!.onCommit(tallText);
    expect(h.model.update).toHaveBeenCalledWith({ text: tallText });
    expect(h.model.updateRect).not.toHaveBeenCalled();
  });

  it(
    '空文本不撑高：矮形状（30 高 < 空行公式下限 54）空提交只落 text——' +
      '「单击已选中进编辑→拖角 blur flush」路径的 resize 覆盖 bug 守卫',
    () => {
      const h = makeHarness();
      (h.vm as unknown as { type: string }).type = 'SHAPE';
      (
        h.vm as unknown as {
          getBounds: () => { x: number; y: number; width: number; height: number };
        }
      ).getBounds = (
        h.vm as unknown as {
          getLocalRect: () => { x: number; y: number; width: number; height: number };
        }
      ).getLocalRect = () => ({ x: 0, y: 0, width: 240, height: 30 });
      (h.model.toJSON as ReturnType<typeof vi.fn>).mockReturnValue({ text: '', shapeType: 'rect' });
      h.svc.enterEdit('w1');
      h.descriptors[0]!.onCommit('');
      expect(h.model.update).toHaveBeenCalledWith({ text: '' });
      expect(h.model.updateRect).not.toHaveBeenCalled();
    },
  );

  it('reflowHeight 闸门：SHAPE 开（默认 undefined）放行走重排；关则整体 no-op', () => {
    const h = makeHarness();
    (h.vm as unknown as { type: string }).type = 'SHAPE';
    (h.model.toJSON as ReturnType<typeof vi.fn>).mockReturnValue({
      text: tallText,
      shapeType: 'ellipse',
    });
    h.svc.reflowHeight('w1');
    expect(h.model.update).toHaveBeenCalledWith({ text: tallText });
    expect(h.model.updateRect).toHaveBeenCalledWith({ height: 67.88 });

    const h2 = makeHarness();
    (h2.vm as unknown as { type: string }).type = 'SHAPE';
    (h2.model.toJSON as ReturnType<typeof vi.fn>).mockReturnValue({
      text: tallText,
      shapeType: 'ellipse',
      autoHeight: false,
    });
    h2.svc.reflowHeight('w1');
    expect(h2.model.update).not.toHaveBeenCalled();
    expect(h2.model.updateRect).not.toHaveBeenCalled();
  });
});
