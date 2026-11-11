// @vitest-environment jsdom
/**
 * 右键菜单键盘协议（specs/a11y-closeout §5.3/§5.8，批次 B W1）：打开聚焦
 * 首项、方向键跳过禁用、Esc/Tab 关闭（经 stub board 走真实 close 链路把
 * store 翻回 show=false）、工具坞单 Tab 停靠 + 方向键移动。手法同
 * readonlyGate.render：createRoot + act + store 直写，零新依赖。
 */
import { act } from 'react';
import type { ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ContextMenu } from '../components/ContextMenu';
import { Toolbar } from '../components/Toolbar';
import { bindBoard, unbindBoard } from '../store/commands';
import { useSpinthStore, type SpinthUiState } from '../store/spinthStore';
import type { BoardPublicApi } from '@spinth/core';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLElement;
let root: Root;

beforeEach(() => {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  unbindBoard();
});

function render(el: ReactNode): void {
  act(() => root.render(el));
}

function setState(patch: Partial<SpinthUiState>): void {
  act(() => useSpinthStore.setState(patch));
}

function pressKey(el: Element, key: string): void {
  act(() => {
    el.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
  });
}

const MENU_ITEMS = () =>
  Array.from(
    host.querySelectorAll<HTMLButtonElement>('[data-spinth-context-menu] [role="menuitem"]'),
  );

describe('ContextMenu 键盘协议', () => {
  it('打开即聚焦首个非禁用项；仅一个 tabIndex=0 停靠', () => {
    const base = useSpinthStore.getState();
    setState({
      contextMenu: { show: true, x: 50, y: 50, onWidget: true, canPaste: false, canPrune: false },
    });
    render(<ContextMenu />);
    const items = MENU_ITEMS();
    expect(items.length).toBeGreaterThan(0);
    // canPaste=false：首项「复制」非禁用 → 聚焦
    expect(document.activeElement).toBe(items[0]);
    expect(items.filter((b) => b.tabIndex === 0)).toHaveLength(1);
    setState({ contextMenu: base.contextMenu });
  });

  it('ArrowDown 跳过禁用项与分隔线；Home/End 落首尾', () => {
    const base = useSpinthStore.getState();
    setState({
      contextMenu: { show: true, x: 50, y: 50, onWidget: true, canPaste: false, canPrune: false },
    });
    render(<ContextMenu />);
    const items = MENU_ITEMS();
    // 元素菜单序：复制 剪切 粘贴(dis) | 置顶 置底 | 删除
    items[1]!.focus(); // 剪切
    pressKey(items[1]!, 'ArrowDown');
    expect(document.activeElement).toBe(items[3]); // 跳过禁用的粘贴 → 置顶
    pressKey(items[3]!, 'End');
    expect(document.activeElement).toBe(items[items.length - 1]); // 删除
    pressKey(items[items.length - 1]!, 'Home');
    expect(document.activeElement).toBe(items[0]);
    setState({ contextMenu: base.contextMenu });
  });

  it('Esc 关闭菜单（真实 close 链路翻 store）', () => {
    const base = useSpinthStore.getState();
    bindBoard({
      closeContextMenu: () =>
        useSpinthStore.setState((s) => ({ contextMenu: { ...s.contextMenu, show: false } })),
    } as unknown as BoardPublicApi);
    setState({
      contextMenu: { show: true, x: 50, y: 50, onWidget: false, canPaste: false, canPrune: false },
    });
    render(<ContextMenu />);
    pressKey(host.querySelector('[data-spinth-context-menu]')!, 'Escape');
    expect(useSpinthStore.getState().contextMenu.show).toBe(false);
    setState({ contextMenu: base.contextMenu });
  });

  it('Tab 同样关闭（非模态：显式归还路径）', () => {
    const base = useSpinthStore.getState();
    bindBoard({
      closeContextMenu: () =>
        useSpinthStore.setState((s) => ({ contextMenu: { ...s.contextMenu, show: false } })),
    } as unknown as BoardPublicApi);
    setState({
      contextMenu: { show: true, x: 50, y: 50, onWidget: false, canPaste: false, canPrune: false },
    });
    render(<ContextMenu />);
    pressKey(host.querySelector('[data-spinth-context-menu]')!, 'Tab');
    expect(useSpinthStore.getState().contextMenu.show).toBe(false);
    setState({ contextMenu: base.contextMenu });
  });
});

describe('Toolbar roving（单 Tab 停靠 + 方向键移动，specs §5.7）', () => {
  it('恰好一个 tabIndex=0；ArrowRight 在按钮间移动', () => {
    const base = useSpinthStore.getState();
    setState({ editable: true });
    render(<Toolbar />);
    const dock = host.querySelector<HTMLElement>('[data-spinth-toolbar]');
    expect(dock).not.toBeNull();
    const stops = Array.from(dock!.querySelectorAll<HTMLButtonElement>('button')).filter(
      (b) => b.tabIndex === 0,
    );
    expect(stops).toHaveLength(1); // 12+3 钮只占一个 Tab 停靠
    const buttons = Array.from(dock!.querySelectorAll<HTMLButtonElement>('[data-roving-item]'));
    expect(buttons.length).toBeGreaterThanOrEqual(12);
    const first = buttons[0]!;
    first.focus();
    expect(document.activeElement).toBe(first);
    pressKey(dock!, 'ArrowRight');
    expect(document.activeElement).toBe(buttons[1]);
    setState({ editable: base.editable });
  });
});
