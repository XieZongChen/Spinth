// @vitest-environment jsdom

import { BehaviorSubject, Subject } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';
import { TextService } from '../widgets/text/textService';
import { commitTextEdit } from '../widgets/text/textCommit';
import { editStyleOf } from '../widgets/text/textEditStyle';
import { setTextTheme } from '../platform/textEngine/theme';
import type { IEditSessionDescriptor, IEditingService } from '../types';

/**
 * SYMBOL 编辑链单测（specs/symbol-widget §5/§9.1）：editStyleOf 常量与着色、
 * descriptor（标签带中心 getRect / 纯文本 getContent / keep 空策略 / anchor
 * center）、提交端纯文本落库（转义回文本、空白折叠、64 字素截断、零几何写）。
 */

function makeSymbolHarness(label: string, color?: string) {
  const modelJSON: Record<string, unknown> = {
    symbol: 'net-router',
    label,
    ...(color ? { color } : {}),
  };
  const model = {
    toJSON: vi.fn(() => ({ ...modelJSON })),
    update: vi.fn(),
    updateRect: vi.fn(),
    yData: { observeDeep: () => {}, unobserveDeep: () => {} },
  };
  const vm = {
    type: 'SYMBOL',
    getBounds: () => ({ x: 0, y: 0, width: 96, height: 128 }),
    getLocalRect: () => ({ x: 0, y: 0, width: 96, height: 128 }),
    getHostGeom: () => ({ rect: { x: 0, y: 0, width: 96, height: 128 }, rotation: 0 }),
    getRotation: () => 0,
    flushUpdate: vi.fn(),
    onStateChanged$: new BehaviorSubject({ diff: {}, local: true }),
  };
  const descriptors: IEditSessionDescriptor[] = [];
  const editing: IEditingService = {
    begin: (d) => descriptors.push(d),
    exitActive: () => {},
    editingWidgetId: null,
    activeKernel: null,
    session$: new Subject<void>(),
  };
  const svc = new TextService(
    { registerGlobalEventListener: () => {}, setCursorMode: () => {} } as never,
    {
      getModelById: (id: string) => (id === 'w1' ? model : undefined),
      add: () => {},
      genInitialOrder: () => 'a0',
      transact: (fn: () => void) => fn(),
    } as never,
    { getVmById: (id: string) => (id === 'w1' ? vm : undefined) } as never,
    { selected$: new BehaviorSubject<string[]>([]), setSelected: vi.fn() } as never,
    { stopCapturing: vi.fn() } as never,
    editing,
  );
  return { svc, model, vm, descriptors };
}

describe('editStyleOf SYMBOL 分支', () => {
  it('16 / 1.5 / center / 字色 resolveSymbolColor（缺省随主题）', () => {
    setTextTheme('light');
    const st = editStyleOf('SYMBOL', {});
    expect(st).toMatchObject({ fontSize: 16, lineHeight: 1.5, align: 'center' });
    expect(st.color).toBe('#333333');
  });

  it('显式 color 透传（编辑器与画布同色，进编辑不跳色）', () => {
    const st = editStyleOf('SYMBOL', { color: '#2563eb' });
    expect(st.color).toBe('#2563eb');
  });
});

describe('textService descriptor（SYMBOL）', () => {
  it('getRect = 标签带中心（anchor center，宽 = 可用宽），空策略 keep', () => {
    const h = makeSymbolHarness('核心路由');
    h.svc.enterEdit('w1');
    const d = h.descriptors[0]!;
    expect(d.emptyTextPolicy).toBe('keep');
    // style 是内核联合类型（html|plain），anchor 只在 html 侧——窄化读
    expect((d.style as { anchor?: string }).anchor).toBe('center');
    // 96×128 at (0,0)：带中心 y = 128 - 12 = 116；宽 = 96 - 8 = 88
    expect(d.getRect()).toEqual({ x: 48, y: 116, width: 88, height: 0 });
  });

  it('getContent：label 转义进 <p>（html 内核），空标签空段', () => {
    const h = makeSymbolHarness('a<b>&c');
    h.svc.enterEdit('w1');
    expect(h.descriptors[0]!.getContent()).toBe('<p>a&lt;b&gt;&amp;c</p>');
    const h2 = makeSymbolHarness('');
    h2.svc.enterEdit('w1');
    expect(h2.descriptors[0]!.getContent()).toBe('<p></p>');
  });

  it('getRect 高度退化：矮件（h=30）带中心钳到 y=15（不飞出画布上方）', () => {
    const h = makeSymbolHarness('x');
    const geom = { rect: { x: 0, y: 0, width: 96, height: 30 }, rotation: 0 };
    h.vm.getHostGeom = () => geom as never;
    h.svc.enterEdit('w1');
    expect(h.descriptors[0]!.getRect()).toEqual({ x: 48, y: 18, width: 88, height: 0 });
  });
});

describe('commitTextEdit SYMBOL 分支（纯文本落库）', () => {
  function makeCommit(label: string) {
    const modelJSON: Record<string, unknown> = { symbol: 'net-router', label };
    const model = { toJSON: vi.fn(() => ({ ...modelJSON })), update: vi.fn(), updateRect: vi.fn() };
    const vm = { type: 'SYMBOL', getLocalRect: () => ({ x: 0, y: 0, width: 96, height: 128 }) };
    const deps = {
      engine: { getModelById: () => model },
      vmEngine: { getVmById: () => vm },
    };
    return { model, deps };
  }

  it('HTML → 纯文本 → 落库 label；换行折一空格 + trim', () => {
    const { model, deps } = makeCommit('旧');
    commitTextEdit(
      deps as never,
      'w1',
      '<p>核心&nbsp;路由</p><p>第二段</p>',
      editStyleOf('SYMBOL', {}),
    );
    expect(model.update).toHaveBeenCalledWith({ label: '核心 路由 第二段' });
  });

  it('超 64 字素截断到 64（字素级）', () => {
    const { model, deps } = makeCommit('');
    const html = `<p>${'a'.repeat(65)}</p>`;
    commitTextEdit(deps as never, 'w1', html, editStyleOf('SYMBOL', {}));
    const patch = model.update.mock.calls[0]![0] as { label: string };
    expect(patch.label.length).toBe(64);
  });

  it('清空提交 label 空串（几何不变——updateRect 零调用）', () => {
    const { model, deps } = makeCommit('旧名字');
    commitTextEdit(deps as never, 'w1', '<p></p>', editStyleOf('SYMBOL', {}));
    expect(model.update).toHaveBeenCalledWith({ label: '' });
    expect(model.updateRect).not.toHaveBeenCalled();
    expect(model.update).toHaveBeenCalledTimes(1); // 只写 label，无二次排版写
  });
});
