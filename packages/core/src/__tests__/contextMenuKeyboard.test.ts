// @vitest-environment jsdom
import { BehaviorSubject } from 'rxjs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ContextMenuService } from '../platform/contextMenu/contextMenuService';
import type { IViewportService, ISelectorService, IVmEngineService } from '../types';

/**
 * 键盘打开路径（specs/a11y-closeout §5.6/§5.8）：openFromKeyboard 三分支
 * 锚点推导 + Shift+F10/Menu 原生监听 + 输入态豁免。桩模式沿用
 * contextMenuReadonly.test（viewport/selector/vmEngine 窄桩）。
 */
function makeSvc(
  opts: { editable?: boolean; selected?: string[]; selectionBounds?: boolean } = {},
) {
  const editable$ = new BehaviorSubject<boolean>(opts.editable ?? true);
  const selected$ = new BehaviorSubject<string[]>(opts.selected ?? []);
  const vp = {
    container: document.createElement('div'),
    editable$,
    cursorMode$: new BehaviorSubject<'cursor'>('cursor'),
    getPageBounds: () => ({ x: 0, y: 0, width: 800, height: 600 }),
    worldToClient: (p: { x: number; y: number }) => ({
      x: p.x + 400,
      y: p.y + 300,
      clone() {
        return this;
      },
    }),
  };
  const vms = new Map<string, object>();
  if (opts.selectionBounds) {
    vms.set('w1', { getBounds: () => ({ x: 100, y: 50, width: 20, height: 10 }) });
  }
  const hasClipboard = vi.fn(() => true);
  const svc = new ContextMenuService(
    vp as unknown as IViewportService,
    { selected$, setSelected: vi.fn() } as unknown as ISelectorService,
    { getVmById: (id: string) => vms.get(id) } as unknown as IVmEngineService,
    hasClipboard,
    () => 'cursor',
  );
  return { svc, editable$, hasClipboard };
}

afterEach(() => {
  document.body.innerHTML = '';
});

describe('ContextMenuService.openFromKeyboard（specs/a11y-closeout §5.6）', () => {
  it('只读 → 画布菜单：页面包络中心锚点、onWidget=false、canPaste 恒 false（docs/21 §4 同语义）', () => {
    const { svc } = makeSvc({ editable: false });
    svc.openFromKeyboard();
    // 页面中心 {400,300} → worldToClient 桩 {+400,+300}
    expect(svc.options$.value).toEqual({
      show: true,
      x: 800,
      y: 600,
      onWidget: false,
      canPaste: false,
      canPrune: false,
    });
    svc.dispose();
  });

  it('可写无选中 → 画布菜单：同锚点、canPaste 与右键同源 hasClipboard', () => {
    const { svc, hasClipboard } = makeSvc({ editable: true, selected: [] });
    svc.openFromKeyboard();
    expect(svc.options$.value).toMatchObject({ show: true, onWidget: false, canPaste: true });
    expect(hasClipboard).toHaveBeenCalledTimes(1);
    svc.dispose();
  });

  it('可写有选中 → 元素菜单：选中世界外接矩形中心的屏幕锚点、onWidget=true', () => {
    const { svc } = makeSvc({ editable: true, selected: ['w1'], selectionBounds: true });
    svc.openFromKeyboard();
    // 选中 union {100,50,20,10} 中心 {110,55} → worldToClient 桩 {510,355}
    expect(svc.options$.value).toEqual({
      show: true,
      x: 510,
      y: 355,
      onWidget: true,
      canPaste: true,
      canPrune: false,
    });
    svc.dispose();
  });
});

describe('Shift+F10 / Menu 键原生监听（specs/a11y-closeout §5.6）', () => {
  it('Shift+F10：命中开菜单且 preventDefault', () => {
    const { svc } = makeSvc({ editable: true });
    svc.initialize();
    const ev = new KeyboardEvent('keydown', {
      key: 'F10',
      shiftKey: true,
      bubbles: true,
      cancelable: true,
    });
    window.dispatchEvent(ev);
    expect(svc.options$.value.show).toBe(true);
    expect(ev.defaultPrevented).toBe(true);
    svc.dispose();
  });

  it('Menu 键（无 shift）同样打开', () => {
    const { svc } = makeSvc({ editable: true });
    svc.initialize();
    window.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'ContextMenu', bubbles: true, cancelable: true }),
    );
    expect(svc.options$.value.show).toBe(true);
    svc.dispose();
  });

  it('输入态目标（input）不开不拦截；裸 F10（无 shift）不触发', () => {
    const { svc } = makeSvc({ editable: true });
    svc.initialize();
    const input = document.createElement('input');
    document.body.appendChild(input);
    const inEv = new KeyboardEvent('keydown', {
      key: 'F10',
      shiftKey: true,
      bubbles: true,
      cancelable: true,
    });
    input.dispatchEvent(inEv);
    expect(svc.options$.value.show).toBe(false);
    expect(inEv.defaultPrevented).toBe(false);
    window.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'F10', bubbles: true, cancelable: true }),
    );
    expect(svc.options$.value.show).toBe(false);
    svc.dispose();
  });
});
