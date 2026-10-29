import 'fake-indexeddb/auto';
import { stubPixiCanvasDocument } from './helpers/pixiNodeEnv';
stubPixiCanvasDocument();
import { describe, expect, it, vi } from 'vitest';
import { makeTreeService, spec } from './helpers/mindServiceFixture';

describe('IME 首键竞态（2026-09-26）：合成首键不得当普通字符全量替换', () => {
  /** 合成 KeyboardEvent 桩（jsdom 无键盘事件管线，直接喂 handler） */
  const fakeKey = (init: Partial<KeyboardEvent>): KeyboardEvent =>
    ({
      metaKey: false,
      ctrlKey: false,
      altKey: false,
      shiftKey: false,
      isComposing: false,
      target: {},
      preventDefault: () => {},
      stopPropagation: () => {},
      ...init,
    }) as unknown as KeyboardEvent;

  it('keyCode 229 / isComposing / Process → 进编辑+全选；普通字符才 replaceWith', () => {
    const { svc, model } = makeTreeService(spec('根', [spec('a')]));
    svc.initialize();
    const childId = model.root.children[0]!.id;
    svc.focusedNodeId = childId;
    const enter = vi.fn();
    (svc as unknown as { enterNodeEdit: unknown }).enterNodeEdit = enter;

    // ① macOS/Chrome 合成首键：key 是真实字符但 keyCode=229（isComposing 尚 false）
    svc['onTypeToEdit'](fakeKey({ key: 'n', keyCode: 229 }));
    // ② 合成中后续按键 isComposing=true
    svc['onTypeToEdit'](fakeKey({ key: 'i', isComposing: true }));
    // ③ Windows Process
    svc['onTypeToEdit'](fakeKey({ key: 'Process', keyCode: 229 }));
    expect(enter).toHaveBeenCalledTimes(3);
    for (const call of enter.mock.calls) {
      expect(call[1]).toBe(childId);
      expect(call[2]).toEqual({ selectAll: true }); // 不携带 replaceWith——文本零污染
    }

    // ④ 普通字符（无 IME 特征）→ 原有 replaceWith 语义不变
    svc['onTypeToEdit'](fakeKey({ key: 'x', keyCode: 88 }));
    expect(enter.mock.calls[3]![2]).toEqual({ replaceWith: 'x' });

    // ⑤ 空格 / 修饰键组合不触发（原有纪律）
    svc['onTypeToEdit'](fakeKey({ key: ' ', keyCode: 32 }));
    svc['onTypeToEdit'](fakeKey({ key: 'c', ctrlKey: true, keyCode: 67 }));
    expect(enter).toHaveBeenCalledTimes(4);
  });

  it('compositionstart 重入幂等：同节点 enterNodeEdit 不重建编辑器（保住 IME 会话）', () => {
    const { svc, model } = makeTreeService(spec('根', [spec('a')]));
    svc.initialize();
    const childId = model.root.children[0]!.id;
    svc.focusedNodeId = childId; // 键入通道前置：焦点在子节点上
    // 真实 kernel 路径（批 3 起 textarea 生命周期归 PlainTextKernel）：
    // 以 body.appendChild 次数观测「重建」
    const appendChild = vi.spyOn(document.body, 'appendChild');

    svc['onTypeToEdit'](fakeKey({ key: 'n', keyCode: 229 }));
    svc['onCompositionStart']({ target: {} } as unknown as CompositionEvent);
    // 重入路径：编辑器只建一次（229 首键 + compositionstart 重入不重建）；
    // 合成首键不得 replaceWith——textarea 值未被 'n' 污染
    expect(appendChild).toHaveBeenCalledTimes(1);
    expect((appendChild.mock.calls[0]![0] as unknown as { value: string }).value).not.toContain(
      'n',
    );
  });
});
