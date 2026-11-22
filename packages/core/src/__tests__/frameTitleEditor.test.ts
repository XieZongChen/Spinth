// @vitest-environment jsdom
import { BehaviorSubject } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';
import { FrameTitleEditor } from '../widgets/frame/frameTitleEditor';
import type { IEditSessionDescriptor, IEditingService } from '../types';
import { FRAME_TITLE_LINE_HEIGHT } from '../widgets/frame/frameGeometry';

/** 容器标题 plain 编辑会话（specs/container-frame §4.10）：descriptor 语义、
 *  同值跳过、空标题 keep、Enter 恒提交、只读早退、写过才切撤销项。
 *  symbolEdit.test 同款桩法：editing 桩捕获 descriptor 直驱回调。 */

function makeHarness(editable = true) {
  const data: Record<string, unknown> = {
    id: 'f1',
    type: 'FRAME',
    zOrder: 'a0',
    title: '审批',
    color: '#ffffff',
    x: 100,
    y: 50,
    width: 320,
    height: 220,
  };
  const updates: Array<Record<string, unknown>> = [];
  const model = {
    toJSON: () => ({ ...data }),
    update: (patch: Record<string, unknown>) => {
      updates.push(patch);
      Object.assign(data, patch);
    },
  };
  const vmCalls: string[] = [];
  const vm = {
    id: 'f1',
    type: 'FRAME',
    setTitleEditing: (on: boolean) => vmCalls.push(on ? 'enter' : 'exit'),
  };
  let descriptor: IEditSessionDescriptor | null = null;
  const editing: IEditingService = {
    begin: (d) => {
      descriptor = d;
      d.onEnter?.(); // 真实 EditingService 语义：开会话即进编辑
    },
    exitActive: vi.fn(),
    editingWidgetId: null,
    activeKernel: null,
    session$: { subscribe: () => ({ unsubscribe: () => {} }) } as never,
  };
  const stopCapturing = vi.fn();
  const editor = new FrameTitleEditor(
    { editable$: new BehaviorSubject(editable), zoomIn: vi.fn(), zoomOut: vi.fn() } as never,
    { getModelById: () => model } as never,
    { getVmById: () => vm } as never,
    { stopCapturing } as never,
    editing,
  );
  return {
    editor,
    data,
    updates,
    vmCalls,
    stopCapturing,
    exitActive: editing.exitActive,
    getDescriptor: () => descriptor,
  };
}

describe('FrameTitleEditor（§4.10）', () => {
  it('开 plain 会话：descriptor 声明正确（getRect 世界坐标、单行样式、keep、进编辑清画布标题）', () => {
    const h = makeHarness();
    expect(h.editor.enterTitleEdit('f1')).toBe(true);
    const d = h.getDescriptor()!;
    expect(d.widgetId).toBe('f1');
    expect(d.kernel).toBe('plain');
    expect(d.nodeKey).toBe('title');
    expect(d.emptyTextPolicy).toBe('keep');
    expect(d.getContent()).toBe('审批');
    // 标题文字区（世界）：top 带内 PAD 10 + 垂直居中 (28-18)/2 = 5 → y = 50+5
    expect(d.getRect()).toEqual({ x: 110, y: 55, width: 300, height: 18 });
    const style = d.style as { fontSize: number; lineHeightPx: number; color: string };
    expect(style.fontSize).toBe(13);
    expect(style.lineHeightPx).toBe(FRAME_TITLE_LINE_HEIGHT);
    expect(style.color).toBe('#333333'); // 白带自适应深字
    expect(h.vmCalls).toEqual(['enter']); // onEnter 清画布标题（编辑器独占）
    expect(h.editor.editingWidgetId).toBe('f1');
  });

  it('left 侧 getRect：表头列垂直居中同源', () => {
    const h = makeHarness();
    h.data.headerSide = 'left';
    h.editor.enterTitleEdit('f1');
    const d = h.getDescriptor()!;
    // (220-18)/2 = 101 → y = 50+101；x = 100+10；宽 112-20 = 92
    expect(d.getRect()).toEqual({ x: 110, y: 151, width: 92, height: 18 });
  });

  it('onCommit：同值跳过；真变更 update({title}) 并标记写过（onExit 才切窗）', () => {
    const h = makeHarness();
    h.editor.enterTitleEdit('f1');
    const d = h.getDescriptor()!;
    d.onCommit('审批'); // 同值
    expect(h.updates).toEqual([]);
    d.onCommit('跨职能审批');
    expect(h.updates).toEqual([{ title: '跨职能审批' }]);
    // 未退出不 stopCapturing
    expect(h.stopCapturing).not.toHaveBeenCalled();
    d.onExit?.(false, { discarded: false });
    expect(h.stopCapturing).toHaveBeenCalledTimes(1); // 一次编辑一步 undo
    expect(h.vmCalls).toEqual(['enter', 'exit']); // 退出恢复画布标题
  });

  it('onExit 未写过不切窗；discarded（Esc）不 stopCapturing', () => {
    const h = makeHarness();
    h.editor.enterTitleEdit('f1');
    const d = h.getDescriptor()!;
    d.onExit?.(false, { discarded: false });
    expect(h.stopCapturing).not.toHaveBeenCalled();

    h.editor.enterTitleEdit('f1');
    const d2 = h.getDescriptor()!;
    d2.onCommit('新标题');
    d2.onExit?.(true, { discarded: true }); // Esc 丢弃
    expect(h.stopCapturing).not.toHaveBeenCalled();
  });

  it('onPlainKeyDown：Enter（含 Shift）恒提交返回 true；IME 合成不抢键', () => {
    const h = makeHarness();
    h.editor.enterTitleEdit('f1');
    const d = h.getDescriptor()!;
    const kd = d.onPlainKeyDown!;
    expect(h.exitActive).not.toHaveBeenCalled();
    expect(kd({ key: 'Enter', preventDefault: () => {} } as never)).toBe(true);
    expect(h.exitActive).toHaveBeenCalledTimes(1);
    expect(kd({ key: 'Enter', shiftKey: true, preventDefault: () => {} } as never)).toBe(true); // 单行：Shift+Enter 也是提交
    expect(kd({ key: 'Enter', isComposing: true, preventDefault: () => {} } as never)).toBe(false); // IME 不抢
    expect(kd({ key: 'a', preventDefault: () => {} } as never)).toBe(false); // 其余放行
  });

  it('只读早退：editable=false 不开会话', () => {
    const h = makeHarness(false);
    expect(h.editor.enterTitleEdit('f1')).toBe(false);
    expect(h.editor.isEditing).toBe(false);
    expect(h.getDescriptor()).toBeNull();
  });

  it('editingService null（未组装）与非容器 id：静默 no-op / 拒绝', () => {
    const editor = new FrameTitleEditor(
      { editable$: new BehaviorSubject(true) } as never,
      { getModelById: () => null } as never,
      { getVmById: () => undefined } as never,
      { stopCapturing: vi.fn() } as never,
      null,
    );
    expect(editor.enterTitleEdit('f1')).toBe(false);
    const h = makeHarness();
    h.data.type = 'SHAPE';
    expect(h.editor.enterTitleEdit('f1')).toBe(false);
  });
});
