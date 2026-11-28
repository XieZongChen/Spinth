// @vitest-environment jsdom
import { BehaviorSubject } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';
import { LifelineLabelEditor } from '../widgets/sequence/lifelineLabelEditor';
import type { IEditSessionDescriptor, IEditingService, IPlainEditorStyle } from '../types';
import {
  LIFELINE_HEAD_BORDER,
  LIFELINE_HEAD_COLOR,
  LIFELINE_LABEL_LINE_HEIGHT,
  LIFELINE_LABEL_MAX_CHARS,
  LIFELINE_LABEL_PAD_X,
} from '../widgets/sequence/lifelineGeometry';
import { graphemes } from '../platform/textEngine/measure';

/** 生命线标签 plain 编辑会话（specs/sequence-diagram §3.7）：descriptor 语义、
 *  同值跳过、落库清洗（空白折一 / 截 64 字素）、空标签 keep、Enter 恒提交、
 *  只读早退、按下点不在头框内拒绝、写过才切撤销项。
 *  frameTitleEditor.test 同款桩法：editing 桩捕获 descriptor 直驱回调。 */

function makeHarness(editable = true) {
  const data: Record<string, unknown> = {
    id: 'l1',
    type: 'LIFELINE',
    zOrder: 'a0',
    label: '用户',
    x: 100,
    y: 50,
    width: 120,
    height: 520,
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
    id: 'l1',
    type: 'LIFELINE',
    setLabelEditing: (on: boolean) => vmCalls.push(on ? 'enter' : 'exit'),
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
  const editor = new LifelineLabelEditor(
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

describe('LifelineLabelEditor（§3.7）', () => {
  it('开 plain 会话：descriptor 声明正确（标签区世界坐标、居中单行样式、keep、进编辑清画布标签）', () => {
    const h = makeHarness();
    expect(h.editor.enterLabelEdit('l1')).toBe(true);
    const d = h.getDescriptor()!;
    expect(d.widgetId).toBe('l1');
    expect(d.kernel).toBe('plain');
    expect(d.nodeKey).toBe('label');
    expect(d.emptyTextPolicy).toBe('keep');
    expect(d.plainCursor).toBe('end');
    expect(d.getContent()).toBe('用户');
    // 标签文字区（世界）：头框内缩左右 8、占头区高 36 → x = 100 + 8
    const area = { x: 100 + LIFELINE_LABEL_PAD_X, y: 50, width: 120 - 16, height: 36 };
    expect(d.getRect()).toEqual(area);
    const style = d.style as {
      fontSize: number;
      lineHeightPx: number;
      color: string;
      background: string;
      textAlign: string;
      maxWidth: number;
    };
    expect(style.fontSize).toBe(14);
    expect(style.lineHeightPx).toBe(LIFELINE_LABEL_LINE_HEIGHT);
    expect(style.color).toBe(LIFELINE_HEAD_BORDER); // 渲染同色
    expect(style.background).toBe(LIFELINE_HEAD_COLOR);
    expect(style.textAlign).toBe('center'); // 与画布标签同居中（提交不跳位）
    expect(style.maxWidth).toBe(area.width);
    expect(h.vmCalls).toEqual(['enter']); // onEnter 清画布标签（编辑器独占）
    expect(h.editor.editingWidgetId).toBe('l1');
    expect(h.editor.isEditing).toBe(true);
  });

  it('actor 头：getRect 取小人下方的标签带（y = 50 + 36，高度钳到 bbox 内）', () => {
    const h = makeHarness();
    h.data.head = 'actor';
    h.editor.enterLabelEdit('l1');
    expect(h.getDescriptor()!.getRect()).toEqual({ x: 108, y: 86, width: 104, height: 36 });
  });

  it('编辑器底色：矩形头 = 头框白底；actor 头 = 透明（画布上的标签没有底，暗色主题下白块突兀）', () => {
    const box = makeHarness();
    box.editor.enterLabelEdit('l1');
    expect((box.getDescriptor()!.style as IPlainEditorStyle).background).toBe(LIFELINE_HEAD_COLOR);
    box.editor.exitLabelEdit(false);
    const actor = makeHarness();
    actor.data.head = 'actor';
    actor.editor.enterLabelEdit('l1');
    expect((actor.getDescriptor()!.style as IPlainEditorStyle).background).toBe('transparent');
    actor.editor.exitLabelEdit(false);
  });

  it('getRect 实时求值：落库 / 拖拽后跟随数据几何', () => {
    const h = makeHarness();
    h.editor.enterLabelEdit('l1');
    const d = h.getDescriptor()!;
    Object.assign(h.data, { x: 300, y: 20, width: 200, height: 600 });
    expect(d.getRect()).toEqual({ x: 308, y: 20, width: 184, height: 36 });
  });

  it('onCommit：同值跳过；真变更写清洗后的 label（连续空白折一 + trim）并标记写过', () => {
    const h = makeHarness();
    h.editor.enterLabelEdit('l1');
    const d = h.getDescriptor()!;
    d.onCommit('用户'); // 同值
    expect(h.updates).toEqual([]);
    d.onCommit('  核心\n交换机  A ');
    expect(h.updates).toEqual([{ label: '核心 交换机 A' }]);
    expect(h.stopCapturing).not.toHaveBeenCalled(); // 未退出不切窗
    d.onExit?.(false, { discarded: false });
    expect(h.stopCapturing).toHaveBeenCalledTimes(1); // 一次编辑一步 undo
    expect(h.vmCalls).toEqual(['enter', 'exit']); // 退出恢复画布标签
    expect(h.editor.isEditing).toBe(false);
  });

  it('onCommit：按字素截到 64（emoji / 组合序列不拆）；清洗后与现值相同不算写过', () => {
    const h = makeHarness();
    h.editor.enterLabelEdit('l1');
    const d = h.getDescriptor()!;
    const emoji = '👍'.repeat(LIFELINE_LABEL_MAX_CHARS + 5);
    d.onCommit(emoji);
    const written = h.updates.at(-1)!.label as string;
    expect([...graphemes(written)]).toHaveLength(LIFELINE_LABEL_MAX_CHARS);
    h.updates.length = 0;
    const again = h.getDescriptor()!;
    again.onCommit(`${'👍'.repeat(LIFELINE_LABEL_MAX_CHARS)}   `); // 清洗后同值
    expect(h.updates).toEqual([]);
  });

  it('空标签 keep：清空文字不删生命线，label 落空串', () => {
    const h = makeHarness();
    h.editor.enterLabelEdit('l1');
    const d = h.getDescriptor()!;
    expect(d.emptyTextPolicy).toBe('keep');
    d.onCommit('');
    expect(h.updates).toEqual([{ label: '' }]);
  });

  it('onExit 未写过不切窗；discarded（Esc）不 stopCapturing', () => {
    const h = makeHarness();
    h.editor.enterLabelEdit('l1');
    h.getDescriptor()!.onExit?.(false, { discarded: false });
    expect(h.stopCapturing).not.toHaveBeenCalled();

    h.editor.enterLabelEdit('l1');
    const d2 = h.getDescriptor()!;
    d2.onCommit('支付服务');
    d2.onExit?.(false, { discarded: true }); // Esc 丢弃
    expect(h.stopCapturing).not.toHaveBeenCalled();
  });

  it('onPlainKeyDown：Enter（含 Shift）恒提交返回 true；IME 合成不抢键；Cmd ± 缩放画布', () => {
    const h = makeHarness();
    h.editor.enterLabelEdit('l1');
    const kd = h.getDescriptor()!.onPlainKeyDown!;
    expect(h.exitActive).not.toHaveBeenCalled();
    expect(kd({ key: 'Enter', preventDefault: () => {} } as never)).toBe(true);
    expect(h.exitActive).toHaveBeenCalledTimes(1);
    expect(kd({ key: 'Enter', shiftKey: true, preventDefault: () => {} } as never)).toBe(true); // 单行
    expect(kd({ key: 'Enter', isComposing: true, preventDefault: () => {} } as never)).toBe(false);
    expect(kd({ key: 'a', preventDefault: () => {} } as never)).toBe(false);
  });

  it('只读早退：editable=false 不开会话', () => {
    const h = makeHarness(false);
    expect(h.editor.enterLabelEdit('l1')).toBe(false);
    expect(h.editor.isEditing).toBe(false);
    expect(h.getDescriptor()).toBeNull();
  });

  it('editingService null（未组装）与非生命线 id：静默 no-op / 拒绝', () => {
    const editor = new LifelineLabelEditor(
      { editable$: new BehaviorSubject(true) } as never,
      { getModelById: () => null } as never,
      { getVmById: () => undefined } as never,
      { stopCapturing: vi.fn() } as never,
      null,
    );
    expect(editor.enterLabelEdit('l1')).toBe(false);
    const h = makeHarness();
    h.data.type = 'SHAPE';
    expect(h.editor.enterLabelEdit('l1')).toBe(false);
  });
});

describe('LifelineLabelEditor 进入入口（§7.2：再点一次头框才进，点轴不算）', () => {
  // 头框 (100,50,120,36)，轴 x = 160、y 86…570
  it('带按下点：在头框内开会话（含远离轴的左右两端）；点轴 / 头框外拒绝', () => {
    const h = makeHarness();
    expect(h.editor.enterLabelEdit('l1', { x: 105, y: 60 })).toBe(true);
    h.editor.exitLabelEdit(false);
    h.getDescriptor()!.onExit?.(false, { discarded: true });
    expect(h.editor.enterLabelEdit('l1', { x: 160, y: 300 })).toBe(false); // 轴
    expect(h.editor.enterLabelEdit('l1', { x: 160, y: 90 })).toBe(false); // 头框下沿外 4px
    expect(h.editor.enterLabelEdit('l1', { x: 130, y: 49 })).toBe(false); // 头框上方
  });

  it('不带按下点（键盘等入口）：直接开会话', () => {
    const h = makeHarness();
    expect(h.editor.enterLabelEdit('l1')).toBe(true);
  });
});
