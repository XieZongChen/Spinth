// @vitest-environment jsdom
/**
 * ToolFlyout 定位定点单测（plan/flyout-culling-linear-edge-scroll 问题 1）：
 * 锚点闩锁修复——React 宿主 ref 晚于子树 layout effect 挂载，ToolFlyout 首挂载
 * 读锚点必为 null；dev StrictMode 双跑掩盖、生产表现为「创建内容后才出现」。
 * harness 照 contextMenuProtocol.render.test.tsx（createRoot + act，零新依赖），
 * rAF 用可控队列桩精确推帧。jsdom 无 StrictMode，可复现生产时序。
 */
import { act } from 'react';
import type { ReactNode } from 'react';
import { Profiler } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ToolFlyout, type IToolFlyoutGroup } from '../components/ToolFlyout';
import { Toolbar } from '../components/Toolbar';
import { useSpinthStore } from '../store/spinthStore';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const GROUP: IToolFlyoutGroup = {
  options: [{ id: 'a', label: '选项 A' }],
  current: 'a',
  activeClass: 'bg-surface-active text-ink',
  onPick: () => {},
};

/** jsdom 的 rect/offset 全零；锚点矩形用字面量桩（place 只读四个字段） */
function makeRect(left: number, top: number, width = 40, height = 40): DOMRect {
  return { left, top, width, height, x: left, y: top, right: 0, bottom: 0 } as DOMRect;
}

/** 可控 rAF 队列：flushFrames 内精确执行到期帧（vi.advanceTimersToNextFrame
 *  与 jsdom 原生 rAF 的组合行为不透明，手写队列最确定） */
let frames: Array<{ id: number; cb: () => void }> = [];
let rafSeq = 0;

function flushFrames(n: number): void {
  for (let i = 0; i < n; i += 1) {
    const due = frames;
    frames = [];
    for (const f of due) f.cb();
  }
}

let host: HTMLElement;
let root: Root;

function render(el: ReactNode): void {
  act(() => root.render(el));
}

function flyout(): HTMLElement | null {
  return document.querySelector<HTMLElement>('[data-spinth-tool-flyout]');
}

describe('ToolFlyout 定位（锚点闩锁回归）', () => {
  beforeEach(() => {
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
    frames = [];
    rafSeq = 0;
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation((cb: FrameRequestCallback) => {
      rafSeq += 1;
      frames.push({ id: rafSeq, cb: () => cb(0) });
      return rafSeq;
    });
    vi.spyOn(window, 'cancelAnimationFrame').mockImplementation((id: number) => {
      frames = frames.filter((f) => f.id !== id);
    });
  });
  afterEach(() => {
    act(() => root.unmount());
    host.remove();
    frames = [];
    vi.restoreAllMocks();
  });

  it('延迟锚点：前两次 null → rAF 补帧后落位（不再被首测失败闩死）', () => {
    let calls = 0;
    render(
      <ToolFlyout
        anchorRect={() => {
          calls += 1;
          return calls <= 2 ? null : makeRect(200, 300);
        }}
        groups={[GROUP]}
      />,
    );
    const f = flyout()!;
    expect(f.style.visibility).toBe('hidden'); // 挂载帧 + 第 1 补帧均拿不到锚点
    act(() => flushFrames(1));
    expect(f.style.visibility).toBe('hidden'); // 第 2 次仍 null
    act(() => flushFrames(1));
    expect(f.style.visibility).toBe('visible'); // 第 3 次拿到 → 落位
    expect(f.style.left).toBe('220px'); // cx=220（jsdom offsetWidth=0）
    expect(f.style.top).toBe('292px');
    expect(f.style.left).not.toBe('-9999px');
  });

  it('Toolbar 激活即落位（无 StrictMode；锚点经 layout effect 受控提供）', () => {
    const base = useSpinthStore.getState();
    render(<Toolbar />);
    expect(flyout()).toBeNull(); // cursor 模式无面板
    act(() => useSpinthStore.setState({ cursorMode: 'pen' }));
    const f = flyout()!;
    // 旧代码：首提交 ToolFlyout effect 先于按钮 ref 挂载 → pos 闩 null →
    // 等 Toolbar 无关重渲染（如 canUndo 翻转）才可见
    expect(f.style.visibility).toBe('visible');
    act(() => useSpinthStore.setState({ cursorMode: base.cursorMode }));
    expect(flyout()).toBeNull(); // 切走自动卸载（纯派生可见性不变）
  });

  it('窗口 resize 锚点移动 → 面板同帧跟随', () => {
    let rect = makeRect(200, 300);
    render(<ToolFlyout anchorRect={() => rect} groups={[GROUP]} />);
    const f = flyout()!;
    expect(f.style.left).toBe('220px');
    rect = makeRect(400, 300);
    act(() => window.dispatchEvent(new Event('resize')));
    expect(f.style.left).toBe('420px');
  });

  it('同值 resize 不反复重渲染（setPos 同值短路）', () => {
    const rect = makeRect(200, 300);
    let commits = 0;
    render(
      <Profiler
        id="flyout"
        onRender={() => {
          commits += 1;
        }}
      >
        <ToolFlyout anchorRect={() => rect} groups={[GROUP]} />
      </Profiler>,
    );
    expect(commits).toBe(2); // 挂载提交 + 首测落位补渲染（layout effect 内 setPos）
    // 连发 5 次同值 resize：短路后仅 React 文档化的「首次同值 bailout 渲染」
    // 可能多 1 次提交（≤3）；旧代码每次 resize 新 pos 对象 → 2+5=7 次提交
    for (let i = 0; i < 5; i += 1) act(() => window.dispatchEvent(new Event('resize')));
    expect(commits).toBeLessThanOrEqual(3);
  });
});
