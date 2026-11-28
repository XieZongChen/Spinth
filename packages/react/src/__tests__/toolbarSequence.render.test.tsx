// @vitest-environment jsdom
/**
 * 工具坞「时序图」入口（specs/sequence-diagram §8.1，批次 1）：第 12 钮、
 * 图元组二级菜单（种类记忆走工具默认参数聚合表——符号按钮同款）、只读禁用、
 * 幽灵示意。harness 照 toolFlyout.render.test（createRoot + act，零新依赖）。
 */
import { act } from 'react';
import type { ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Toolbar } from '../components/Toolbar';
import { ToolGhost } from '../components/ToolGhost';
import { spinthCommands } from '../store/commands';
import { useSpinthStore } from '../store/spinthStore';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLElement;
let root: Root;

function render(el: ReactNode): void {
  act(() => root.render(el));
}

/** 工具坞里的工具钮（带 aria-pressed 的只有工具——撤销/重做/删除不带） */
function toolButtons(): HTMLButtonElement[] {
  return [
    ...document.querySelectorAll<HTMLButtonElement>('[data-spinth-toolbar] button[aria-pressed]'),
  ];
}

function click(el: Element): void {
  act(() => el.dispatchEvent(new MouseEvent('click', { bubbles: true })));
}

describe('工具坞「时序图」入口', () => {
  beforeEach(() => {
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
    useSpinthStore.setState({ cursorMode: 'cursor', editable: true, defaultToolOptions: {} });
  });
  afterEach(() => {
    act(() => root.unmount());
    host.remove();
    vi.restoreAllMocks();
    useSpinthStore.setState({ cursorMode: 'cursor', editable: true, defaultToolOptions: {} });
  });

  it('工具坞共 12 个工具钮，时序图是最后一钮：「时序图 (Q)」+ 二级菜单语义', () => {
    render(<Toolbar />);
    const tools = toolButtons();
    expect(tools).toHaveLength(12);
    const seq = tools.at(-1)!;
    expect(seq.title).toBe('时序图 (Q)');
    expect(seq.getAttribute('aria-label')).toBe('时序图 (Q)');
    expect(seq.getAttribute('aria-pressed')).toBe('false');
    expect(seq.getAttribute('aria-haspopup')).toBe('menu');
    // 工具钮的可访问名互不重复
    const names = tools.map((b) => b.getAttribute('aria-label'));
    expect(new Set(names).size).toBe(names.length);
  });

  it('点击 → setCursorMode(sequence)；激活后 aria-pressed=true 并出图元组二级菜单', () => {
    const setMode = vi.spyOn(spinthCommands, 'setCursorMode');
    render(<Toolbar />);
    click(toolButtons().at(-1)!);
    expect(setMode).toHaveBeenCalledWith('sequence');
    act(() =>
      useSpinthStore.setState({
        cursorMode: 'sequence',
        defaultToolOptions: { sequence: { kind: 'lifeline' } },
      }),
    );
    const seq = toolButtons().at(-1)!;
    expect(seq.getAttribute('aria-pressed')).toBe('true');
    expect(seq.getAttribute('aria-expanded')).toBe('true');
    const items = [
      ...document.querySelectorAll<HTMLElement>('[data-spinth-tool-flyout] [role="menuitemradio"]'),
    ];
    // 两组：图元（生命线 / 激活条）+ 消息（同步 / 异步 / 返回）
    expect(items.map((i) => i.getAttribute('aria-label'))).toEqual([
      '生命线',
      '激活条',
      '同步消息',
      '异步消息',
      '返回消息',
    ]);
    expect(items[0]!.getAttribute('aria-checked')).toBe('true'); // 当前种类点亮
    expect(items.slice(1).every((i) => i.getAttribute('aria-checked') === 'false')).toBe(true);
    // 选中项 → 工具默认参数聚合表（mode + 参数名 + 选项 id）
    const setOpt = vi.spyOn(spinthCommands, 'setDefaultToolOption');
    click(items[0]!);
    expect(setOpt).toHaveBeenCalledWith('sequence', 'kind', 'lifeline');
    click(items[1]!);
    expect(setOpt).toHaveBeenCalledWith('sequence', 'kind', 'activation');
  });

  it('两组共用一个当前值：记忆为消息种类时只有消息组的一项点亮，图元组不亮', () => {
    render(<Toolbar />);
    act(() =>
      useSpinthStore.setState({
        cursorMode: 'sequence',
        defaultToolOptions: { sequence: { kind: 'message-async' } },
      }),
    );
    const items = [
      ...document.querySelectorAll<HTMLElement>('[data-spinth-tool-flyout] [role="menuitemradio"]'),
    ];
    const lit = items
      .filter((i) => i.getAttribute('aria-checked') === 'true')
      .map((i) => i.getAttribute('aria-label'));
    expect(lit).toEqual(['异步消息']);
    // 组间有一条分隔线（浮层根的直接子节点；图标自身的 aria-hidden 在更深层）
    expect(document.querySelectorAll('[data-spinth-tool-flyout] > [aria-hidden]').length).toBe(1);
  });

  it('记忆为激活条时图元组的「激活条」点亮', () => {
    render(<Toolbar />);
    act(() =>
      useSpinthStore.setState({
        cursorMode: 'sequence',
        defaultToolOptions: { sequence: { kind: 'activation' } },
      }),
    );
    const lit = [
      ...document.querySelectorAll<HTMLElement>('[data-spinth-tool-flyout] [aria-checked="true"]'),
    ].map((i) => i.getAttribute('aria-label'));
    expect(lit).toEqual(['激活条']);
  });

  it('点消息项 → setDefaultToolOption(sequence, kind, 消息种类 id)', () => {
    const setOpt = vi.spyOn(spinthCommands, 'setDefaultToolOption');
    render(<Toolbar />);
    act(() => useSpinthStore.setState({ cursorMode: 'sequence' }));
    const byName = (n: string) =>
      [
        ...document.querySelectorAll<HTMLElement>(
          '[data-spinth-tool-flyout] [role="menuitemradio"]',
        ),
      ].find((i) => i.getAttribute('aria-label') === n)!;
    click(byName('返回消息'));
    expect(setOpt).toHaveBeenCalledWith('sequence', 'kind', 'message-return');
    click(byName('异步消息'));
    expect(setOpt).toHaveBeenCalledWith('sequence', 'kind', 'message-async');
  });

  it('二级菜单未拿到种类记忆时按缺省点亮（聚合表无 sequence 条目）', () => {
    render(<Toolbar />);
    act(() => useSpinthStore.setState({ cursorMode: 'sequence', defaultToolOptions: {} }));
    const item = document.querySelector<HTMLElement>(
      '[data-spinth-tool-flyout] [role="menuitemradio"]',
    );
    expect(item?.getAttribute('aria-label')).toBe('生命线');
  });

  it('只读态禁用（写工具同款；选择/抓手仍可用）', () => {
    act(() => useSpinthStore.setState({ editable: false }));
    render(<Toolbar />);
    const tools = toolButtons();
    const byName = (n: string) => tools.find((b) => b.getAttribute('aria-label')?.startsWith(n))!;
    expect(byName('时序图').disabled).toBe(true);
    expect(byName('选择').disabled).toBe(false);
    expect(byName('抓手').disabled).toBe(false);
  });

  it('幽灵示意：sequence 模式渲染静态「时序图」图标（两条虚线轴 + 消息箭头）', () => {
    render(<ToolGhost />);
    expect(document.querySelector('[data-spinth-tool-ghost]')).toBeNull(); // cursor 无幽灵
    act(() => useSpinthStore.setState({ cursorMode: 'sequence' }));
    const ghost = document.querySelector<HTMLElement>('[data-spinth-tool-ghost="sequence"]');
    expect(ghost).not.toBeNull();
    const svg = ghost!.querySelector('svg')!;
    expect(svg).not.toBeNull();
    expect(svg.querySelectorAll('line[stroke-dasharray]').length).toBeGreaterThanOrEqual(2);
    expect(svg.querySelectorAll('rect').length).toBe(2); // 两个参与者头框
  });
});
