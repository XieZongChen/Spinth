import 'fake-indexeddb/auto';
import { stubPixiCanvasDocument } from './helpers/pixiNodeEnv';
stubPixiCanvasDocument();
import { describe, expect, it, vi } from 'vitest';
import { makeTreeService, spec } from './helpers/mindServiceFixture';
import { createTypeToEditHandlers } from '../widgets/tree/service/treeTypeToEdit';

/**
 * IME 首键竞态（2026-09-26）：合成首键不得当普通字符全量替换。
 * 审查返工 P0-6 拆分后监听逻辑在 service/treeTypeToEdit.ts（installTypeToEdit
 * 由 initialize 挂 window 捕获）——测试改为真事件派发（Object.assign 补
 * keyCode 等 init 不可设属性）驱动同款行为。
 */

describe('IME 首键竞态（2026-09-26）：合成首键不得当普通字符全量替换', () => {
  /** 事件桩（node 环境无键盘管线——直接喂 handler，同拆分前口径）。
   *  preventDefault/stopPropagation 补真实签名（handler 消费路径需要） */
  type Handlers = ReturnType<typeof createTypeToEditHandlers>;
  const fire = (h: Handlers, init: Record<string, unknown>): void => {
    const e = {
      preventDefault: () => {},
      stopPropagation: () => {},
      ...init,
    } as unknown as KeyboardEvent;
    h.onTypeToEdit(e);
  };

  it('keyCode 229 / isComposing / Process → 进编辑+全选；普通字符才 replaceWith', () => {
    const { svc, model } = makeTreeService(spec('根', [spec('a')]));
    svc.initialize();
    const childId = model.root.children[0]!.id;
    svc.focusedNodeId = childId;
    const enter = vi.fn();
    (svc as unknown as { enterNodeEdit: unknown }).enterNodeEdit = enter;
    const handlers = createTypeToEditHandlers({ cursorMode$: { value: 'cursor' } } as never, {
      getFocused: () =>
        (
          svc as unknown as {
            getFocused(): { mapModel: { id: string }; node: { id: string } } | null;
          }
        ).getFocused(),
      enterNodeEdit: (mapId, nodeId, opts) => enter(mapId, nodeId, opts),
    });

    // ① macOS/Chrome 合成首键：key 是真实字符但 keyCode=229（isComposing 尚 false）
    fire(handlers, { key: 'n', keyCode: 229 });
    // ② 合成中后续按键 isComposing=true
    fire(handlers, { key: 'i', isComposing: true });
    // ③ Windows Process
    fire(handlers, { key: 'Process', keyCode: 229 });
    expect(enter).toHaveBeenCalledTimes(3);
    for (const call of enter.mock.calls) {
      expect(call[1]).toBe(childId);
      expect(call[2]).toEqual({ selectAll: true }); // 不携带 replaceWith——文本零污染
    }

    // ④ 普通字符（无 IME 特征）→ 原有 replaceWith 语义不变
    fire(handlers, { key: 'x', keyCode: 88 });
    expect(enter.mock.calls[3]![2]).toEqual({ replaceWith: 'x' });

    // ⑤ 空格 / 修饰键组合不触发（原有纪律）
    fire(handlers, { key: ' ', keyCode: 32 });
    fire(handlers, { key: 'c', ctrlKey: true, keyCode: 67 });
    expect(enter).toHaveBeenCalledTimes(4);
    svc.dispose();
  });

  it('compositionstart 重入幂等：同节点 enterNodeEdit 不重建编辑器（保住 IME 会话）', () => {
    const { svc, model } = makeTreeService(spec('根', [spec('a')]));
    svc.initialize();
    const childId = model.root.children[0]!.id;
    svc.focusedNodeId = childId; // 键入通道前置：焦点在子节点上
    // 真实 kernel 路径（批 3 起 textarea 生命周期归 PlainTextKernel）：
    // 以 body.appendChild 次数观测「重建」
    const appendChild = vi.spyOn(document.body, 'appendChild');
    const handlers2 = createTypeToEditHandlers({ cursorMode$: { value: 'cursor' } } as never, {
      getFocused: () =>
        (
          svc as unknown as {
            getFocused(): { mapModel: { id: string }; node: { id: string } } | null;
          }
        ).getFocused(),
      enterNodeEdit: (mapId, nodeId, opts) => svc.enterNodeEdit(mapId, nodeId, opts ?? {}),
    });

    fire(handlers2, { key: 'n', keyCode: 229 });
    handlers2.onCompositionStart({ target: {} } as unknown as CompositionEvent);
    // 重入路径：编辑器只建一次（229 首键 + compositionstart 重入不重建）；
    // 合成首键不得 replaceWith——textarea 值未被 'n' 污染
    expect(appendChild).toHaveBeenCalledTimes(1);
    expect((appendChild.mock.calls[0]![0] as unknown as { value: string }).value).not.toContain(
      'n',
    );
    svc.dispose();
  });
});
