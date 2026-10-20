// @vitest-environment jsdom
// 回归：docs/07 §2 三态契约「Esc / 点击外部退出编辑」——点外退出布线曾缺失（Phase 2 验收发现）
import { describe, it, expect, vi, afterEach } from 'vitest';
import { BehaviorSubject } from 'rxjs';
import { RichTextEditor } from '../platform/textEngine/richTextEditor';
import type { IViewportService } from '../types';

function fakeViewport(): IViewportService {
  return {
    vpScale$: new BehaviorSubject(1),
    vpBounds$: new BehaviorSubject({ x: 0, y: 0, width: 800, height: 600 }),
    toScreen: (p: { x: number; y: number }) => ({ x: p.x, y: p.y }),
    worldToClient: (p: { x: number; y: number }) => ({ x: p.x, y: p.y }),
  } as unknown as IViewportService;
}

function fakeCallbacks() {
  return { onUpdate: vi.fn(), onUndo: vi.fn(), onRedo: vi.fn(), onExit: vi.fn() };
}

function pointerDownOn(el: Element): void {
  el.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, cancelable: true }));
}

/** 编辑器根 DOM（容器 #spinth-text-layer 的唯一子节点；dom 字段为私有） */
function editorDom(): Element {
  const dom = document.querySelector('#spinth-text-layer > div');
  if (!dom) throw new Error('editor dom not mounted');
  return dom;
}

afterEach(() => {
  document.getElementById('spinth-text-layer')?.remove();
});

describe('RichTextEditor 点外退出（onExit 布线）', () => {
  it('edit 态：点击编辑器外部触发 onExit，点击编辑器内部不触发', async () => {
    const cb = fakeCallbacks();
    const ed = new RichTextEditor(fakeViewport(), cb);
    ed.attachAndRemember({ x: 10, y: 10, width: 200, height: 40 }, '<p>hi</p>', 'edit', {
      fontSize: 16,
      color: '#333333',
      lineHeight: 1.5,
    });
    await vi.waitFor(() => expect(ed.editor.isEditable).toBe(true));

    pointerDownOn(document.body);
    expect(cb.onExit).toHaveBeenCalledTimes(1);

    cb.onExit.mockClear();
    pointerDownOn(editorDom());
    expect(cb.onExit).not.toHaveBeenCalled();

    ed.dispose();
  });

  it('select 态（DOM 透明只承接键盘）：点外不触发 onExit', async () => {
    const cb = fakeCallbacks();
    const ed = new RichTextEditor(fakeViewport(), cb);
    ed.attachAndRemember({ x: 0, y: 0, width: 100, height: 20 }, '<p>x</p>', 'select', {
      fontSize: 16,
      color: '#333333',
      lineHeight: 1.5,
    });
    await vi.waitFor(() => expect(ed.editor.isEditable).toBe(false));

    pointerDownOn(document.body);
    expect(cb.onExit).not.toHaveBeenCalled();

    ed.dispose();
  });

  it('preview 态（未 attach / 已 detach）：点外不触发 onExit', () => {
    const cb = fakeCallbacks();
    const ed = new RichTextEditor(fakeViewport(), cb);
    pointerDownOn(document.body);
    expect(cb.onExit).not.toHaveBeenCalled();

    ed.attachAndRemember({ x: 0, y: 0, width: 100, height: 20 }, '<p>x</p>', 'edit', {
      fontSize: 16,
      color: '#333333',
      lineHeight: 1.5,
    });
    ed.detach();
    pointerDownOn(document.body);
    expect(cb.onExit).not.toHaveBeenCalled();

    ed.dispose();
  });

  it('dispose 后移除 document 监听', async () => {
    const cb = fakeCallbacks();
    const ed = new RichTextEditor(fakeViewport(), cb);
    ed.attachAndRemember({ x: 0, y: 0, width: 100, height: 20 }, '<p>x</p>', 'edit', {
      fontSize: 16,
      color: '#333333',
      lineHeight: 1.5,
    });
    await vi.waitFor(() => expect(ed.editor.isEditable).toBe(true));
    ed.dispose();

    pointerDownOn(document.body);
    expect(cb.onExit).not.toHaveBeenCalled();
  });
});
