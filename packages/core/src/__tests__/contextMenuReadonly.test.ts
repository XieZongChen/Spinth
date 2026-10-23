// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { ContextMenuService } from '../platform/contextMenu/contextMenuService';
import type { ISelectorService, IViewportService, IVmEngineService } from '../types';

/**
 * 右键只读降级（docs/21 §4 只读可交互面矩阵）：右键是 DOM 事件，不经
 * viewport 指针闸门——服务层必须自守：只读不建选区（选区会把 ActionBar
 * 整条带进只读画布）、不出元素菜单、canPaste 恒 false。
 */
describe('ContextMenuService 只读语义', () => {
  function setup(opts: { editable: boolean; hits: Array<{ id: string }> }) {
    const container = document.createElement('div');
    const viewport = {
      container,
      editable$: { value: opts.editable },
      // 桩对齐 IViewportService 用面（服务只读 container/toWorld/editable$）
      toWorld: (p: { x: number; y: number }) => ({ x: p.x, y: p.y, clone: () => ({ x: 0, y: 0 }) }),
    } as unknown as IViewportService;
    const selector = {
      selected$: { value: [] as string[] },
      setSelected: vi.fn(),
    } as unknown as ISelectorService;
    const vmEngine = {
      getVmByPoint: vi.fn(() => opts.hits),
    } as unknown as IVmEngineService;
    const hasClipboard = vi.fn(() => true);
    const svc = new ContextMenuService(viewport, selector, vmEngine, hasClipboard, () => 'cursor');
    svc.initialize();
    const rightClick = (): void => {
      container.dispatchEvent(
        new MouseEvent('contextmenu', { clientX: 120, clientY: 80, bubbles: true }),
      );
    };
    return { svc, selector, vmEngine, hasClipboard, rightClick };
  }

  it('只读 + 命中元素：setSelected 零调用、onWidget=false、canPaste=false、菜单仍打开', () => {
    const { svc, selector, rightClick } = setup({ editable: false, hits: [{ id: 'w1' }] });
    rightClick();
    expect(selector.setSelected).not.toHaveBeenCalled();
    expect(svc.options$.value).toEqual({
      show: true,
      x: 120,
      y: 80,
      onWidget: false,
      canPaste: false,
    });
    svc.dispose();
  });

  it('可写 + 命中元素：就地选中（现状回归）、onWidget=true、canPaste 直通缓冲', () => {
    const { svc, selector, rightClick } = setup({ editable: true, hits: [{ id: 'w1' }] });
    rightClick();
    expect(selector.setSelected).toHaveBeenCalledWith(['w1']);
    expect(svc.options$.value).toEqual({
      show: true,
      x: 120,
      y: 80,
      onWidget: true,
      canPaste: true,
    });
    svc.dispose();
  });

  it('只读 + 命中空白：同样不触碰选区（未命中清空分支也整条跳过）', () => {
    const { svc, selector, rightClick } = setup({ editable: false, hits: [] });
    rightClick();
    expect(selector.setSelected).not.toHaveBeenCalled();
    expect(svc.options$.value.onWidget).toBe(false);
    svc.dispose();
  });

  it('只读时 canPaste 不看 hasClipboard（缓冲有内容也恒 false）', () => {
    const { svc, hasClipboard, rightClick } = setup({ editable: false, hits: [{ id: 'w1' }] });
    rightClick();
    expect(hasClipboard).not.toHaveBeenCalled();
    expect(svc.options$.value.canPaste).toBe(false);
    svc.dispose();
  });
});
