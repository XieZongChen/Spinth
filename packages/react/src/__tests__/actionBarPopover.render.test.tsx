// @vitest-environment jsdom
/**
 * ActionBar popover 互斥（2026-11 用户实测：多个触发钮可同时开面板）：
 * 开合单源上提 ActionBar（openPopoverId）——连点两个触发钮同屏至多一面板；
 * bar 内 pointerdown（被容器 stopPropagation 遮蔽、到不了 window
 * outside-click）由容器统一收起。手法同 readonlyGate.render：createRoot +
 * act + store 直写，零新依赖。
 */
import { act } from 'react';
import type { ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ActionBar } from '../components/ActionBar';
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

/** 派发原生事件（React 合成事件在根容器代理，bubbles 即达） */
function fire(el: Element, type: 'pointerdown' | 'click'): void {
  act(() => {
    el.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true }));
  });
}

function trigger(label: string): HTMLButtonElement {
  const btn = host.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`);
  if (!btn) throw new Error(`trigger[${label}] not found`);
  return btn;
}

describe('ActionBar popover 互斥（开合单源 openPopoverId）', () => {
  const schema: IActionBarSchema = {
    type: 'SHAPE',
    items: [
      {
        id: 'color',
        kind: 'popover',
        label: '填充',
        value: 'none',
        options: [
          { id: 'none', label: '无' },
          { id: 'blue', label: '蓝' },
        ],
      },
      {
        id: 'fontSize',
        kind: 'popover',
        label: '字号',
        value: 'md',
        options: [{ id: 'md', label: '中' }],
      },
    ],
  };
  const bounds = { x: 40, y: 40, width: 120, height: 80 };

  function mount(): void {
    setState({ editable: true, actionBar: { schema, bounds } });
    render(<ActionBar />);
  }

  function restore(): void {
    const base = useSpinthStore.getState();
    setState({ editable: base.editable, actionBar: base.actionBar });
  }

  it('点触发钮 A 开面板；再点触发钮 B → A 收 B 开（同屏至多一面板）', () => {
    mount();
    fire(trigger('填充'), 'pointerdown');
    fire(trigger('填充'), 'click');
    expect(host.querySelectorAll('[data-spinth-popover-panel]')).toHaveLength(1);
    expect(trigger('填充').getAttribute('aria-expanded')).toBe('true');

    fire(trigger('字号'), 'pointerdown');
    fire(trigger('字号'), 'click');
    expect(host.querySelectorAll('[data-spinth-popover-panel]')).toHaveLength(1);
    expect(trigger('填充').getAttribute('aria-expanded')).toBe('false');
    expect(trigger('字号').getAttribute('aria-expanded')).toBe('true');
    restore();
  });

  it('面板开着时点 bar 内非面板区域（栏空白）→ 收起并回焦触发钮（焦点不落地）', () => {
    mount();
    fire(trigger('填充'), 'pointerdown');
    fire(trigger('填充'), 'click');
    expect(host.querySelectorAll('[data-spinth-popover-panel]')).toHaveLength(1);

    const bar = host.querySelector('[data-spinth-action-bar]');
    if (!bar) throw new Error('action bar not found');
    fire(bar, 'pointerdown'); // target = 栏自身（面板/触发钮之外）
    expect(host.querySelectorAll('[data-spinth-popover-panel]')).toHaveLength(0);
    expect(trigger('填充').getAttribute('aria-expanded')).toBe('false');
    expect(document.activeElement).toBe(trigger('填充')); // 面板卸载焦点回触发钮
    restore();
  });

  it('只读往返（editable 翻 false 再回 true，schema 引用不变）→ 面板不自动重开', () => {
    mount();
    fire(trigger('填充'), 'pointerdown');
    fire(trigger('填充'), 'click');
    expect(host.querySelectorAll('[data-spinth-popover-panel]')).toHaveLength(1);

    setState({ editable: false }); // bar 消失（schema 未变，[schema] effect 不触发）
    setState({ editable: true });
    expect(host.querySelectorAll('[data-spinth-popover-panel]')).toHaveLength(0);
    expect(trigger('填充').getAttribute('aria-expanded')).toBe('false');
    restore();
  });

  it('Esc 收起且回焦触发钮', () => {
    mount();
    fire(trigger('填充'), 'pointerdown');
    fire(trigger('填充'), 'click');
    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    });
    expect(host.querySelectorAll('[data-spinth-popover-panel]')).toHaveLength(0);
    expect(document.activeElement).toBe(trigger('填充'));
    restore();
  });

  it('schema 重建（换选区）→ 面板收起', () => {
    mount();
    fire(trigger('填充'), 'pointerdown');
    fire(trigger('填充'), 'click');
    expect(host.querySelectorAll('[data-spinth-popover-panel]')).toHaveLength(1);

    setState({ actionBar: { schema: { ...schema }, bounds } }); // 新 schema 身份 = 选区重建
    expect(host.querySelectorAll('[data-spinth-popover-panel]')).toHaveLength(0);
    restore();
  });
});
