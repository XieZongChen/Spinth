// @vitest-environment jsdom
/**
 * 只读呈现门禁（docs/21 §4 只读可交互面矩阵）：core 修语义（选区/工具/手势），
 * react 修呈现——持久铬件禁用（工具坞三键），浮动件隐藏（ActionBar/
 * MindAddButtons，附着对象在只读态本就不存在）。手法同 components.render：
 * createRoot + act + store 直写，零新依赖。
 */
import { act } from 'react';
import type { ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Toolbar } from '../components/Toolbar';
import { ActionBar } from '../components/ActionBar';
import { MindAddButtons } from '../components/MindAddButtons';
import { useSpinthStore, type SpinthUiState } from '../store/spinthStore';
import type { IActionBarSchema } from '@spinth/core';

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
});

function render(el: ReactNode): void {
  act(() => root.render(el));
}

function setState(patch: Partial<SpinthUiState>): void {
  act(() => useSpinthStore.setState(patch));
}

/** 按 title 找按钮并取原生 disabled */
const disabledByTitle = (title: string): boolean => {
  const btn = host.querySelector<HTMLButtonElement>(`button[title="${title}"]`);
  if (!btn) throw new Error(`button[title="${title}"] not found`);
  return btn.disabled;
};

describe('Toolbar 只读三键（矩阵：undo/redo/delete 禁用，视图工具可用）', () => {
  it('editable=false 且历史非空/有选区：三键仍禁用（不留"可点但静默 no-op"）', () => {
    const base = useSpinthStore.getState();
    setState({ editable: false, canUndo: true, canRedo: true, selectedCount: 1 });
    render(<Toolbar />);
    expect(disabledByTitle('撤销 (Cmd+Z)')).toBe(true);
    expect(disabledByTitle('重做 (Shift+Cmd+Z)')).toBe(true);
    expect(disabledByTitle('删除选中 (Delete)')).toBe(true);
    setState({
      editable: base.editable,
      canUndo: base.canUndo,
      canRedo: base.canRedo,
      selectedCount: base.selectedCount,
    });
  });

  it('editable=true 同状态：三键可点（区分验证——禁用来自只读而非状态）', () => {
    const base = useSpinthStore.getState();
    setState({ editable: true, canUndo: true, canRedo: true, selectedCount: 1 });
    render(<Toolbar />);
    expect(disabledByTitle('撤销 (Cmd+Z)')).toBe(false);
    expect(disabledByTitle('重做 (Shift+Cmd+Z)')).toBe(false);
    expect(disabledByTitle('删除选中 (Delete)')).toBe(false);
    setState({
      editable: base.editable,
      canUndo: base.canUndo,
      canRedo: base.canRedo,
      selectedCount: base.selectedCount,
    });
  });
});

describe('ActionBar 只读不渲染 + disabled 契约', () => {
  const schema: IActionBarSchema = {
    type: 'SHAPE',
    items: [
      { id: 'align-left', kind: 'action', label: '左对齐', disabled: true },
      {
        id: 'fill',
        kind: 'popover',
        label: '填充',
        value: 'none',
        options: [{ id: 'none', label: '无' }],
        disabled: true,
      },
      { id: 'bold', kind: 'toggle', label: '加粗', value: false, disabled: true },
    ],
  };
  const bounds = { x: 40, y: 40, width: 120, height: 80 };

  it('editable=false：整条不渲染（含删除/导出入口）', () => {
    const base = useSpinthStore.getState();
    setState({ editable: false, actionBar: { schema, bounds } });
    render(<ActionBar />);
    expect(host.querySelectorAll('[data-spinth-action-bar]')).toHaveLength(0);
    setState({ editable: base.editable, actionBar: base.actionBar });
  });

  it('editable=true：渲染一条', () => {
    const base = useSpinthStore.getState();
    setState({ editable: true, actionBar: { schema, bounds } });
    render(<ActionBar />);
    expect(host.querySelectorAll('[data-spinth-action-bar]')).toHaveLength(1);
    setState({ editable: base.editable, actionBar: base.actionBar });
  });

  it('disabled 契约：action/popover/toggle 三类控件都尊重 item.disabled', () => {
    const base = useSpinthStore.getState();
    setState({ editable: true, actionBar: { schema, bounds } });
    render(<ActionBar />);
    for (const label of ['左对齐', '填充', '加粗']) {
      const btn = host.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`);
      expect(btn, label).toBeTruthy();
      expect(btn!.disabled, label).toBe(true);
    }
    setState({ editable: base.editable, actionBar: base.actionBar });
  });
});

describe('MindAddButtons 只读不渲染', () => {
  const state = {
    bounds: { x: 0, y: 0, width: 100, height: 40 },
    isRoot: true,
    direction: 'right' as const,
    slotLeft: -10,
    slotRight: 110,
  };

  it('editable=false：焦点残留也不渲染', () => {
    const base = useSpinthStore.getState();
    setState({ editable: false, mindAddButtons: state });
    render(<MindAddButtons />);
    expect(host.querySelectorAll('button')).toHaveLength(0);
    setState({ editable: base.editable, mindAddButtons: base.mindAddButtons });
  });

  it('editable=true：根节点渲染左右两键（区分验证）', () => {
    const base = useSpinthStore.getState();
    setState({ editable: true, mindAddButtons: state });
    render(<MindAddButtons />);
    expect(host.querySelectorAll('button')).toHaveLength(2);
    setState({ editable: base.editable, mindAddButtons: base.mindAddButtons });
  });
});
