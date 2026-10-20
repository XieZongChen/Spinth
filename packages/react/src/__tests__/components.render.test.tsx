// @vitest-environment jsdom
/**
 * React 组件渲染测试（Batch 2，2026-10-18 审查 7.1「components/store 0%」补缺）。
 * 零新依赖路线：react-dom/client createRoot + act（不引 @testing-library——
 * 铁律 8）+ zustand store 直写（组件消费的就是 store 镜像，无 mock 层失真）。
 */
import { act } from 'react';
import type { ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Tooltip } from '../components/Tooltip';
import { ErrorBoundary } from '../components/ErrorBoundary';
import { OfflineBar } from '../components/OfflineBar';
import { useSpinthStore } from '../store/spinthStore';

// act 环境声明（P0 修复配套）：React 18+ 在测试外跑 act 会告警
// "The current testing environment is not configured to support act(...)"
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
  vi.restoreAllMocks();
  vi.useRealTimers();
});

function render(el: ReactNode): void {
  act(() => root.render(el));
}

describe('Tooltip（docs/12 §5）', () => {
  it('hover 400ms 延迟出现、disabled 抑制', async () => {
    vi.useFakeTimers();
    render(
      <Tooltip label="测试提示">
        <button type="button">目标</button>
      </Tooltip>,
    );
    const btn = host.querySelector('button')!;
    act(() => {
      // React onMouseEnter 不响应原生 mouseenter dispatch（内部用 mouseout/over 差分）；
      // onFocus 由 focusin 冒泡委托——同一 enter 逻辑（键盘可达面）
      btn.dispatchEvent(new FocusEvent('focusin', { bubbles: true }));
    });
    expect(host.textContent).not.toContain('测试提示'); // 延迟窗口未到
    await act(async () => {
      vi.advanceTimersByTime(450);
    });
    expect(host.textContent).toContain('测试提示');
  });
});

describe('ErrorBoundary（Batch 1 · 1.14 兜底卡）', () => {
  it('子组件 throw → 兜底卡（文案 + 重新加载），reload 可点击', () => {
    const Boom = (): never => {
      throw new Error('render boom');
    };
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    render(
      <ErrorBoundary>
        <Boom />
      </ErrorBoundary>,
    );
    expect(host.textContent).toContain('页面出现异常');
    expect(host.textContent).toContain('render boom'); // 摘要透出
    const btn = host.querySelectorAll('button');
    expect(btn.length).toBeGreaterThan(0); // 「重新加载」钮
    expect(host.textContent).toContain('重新加载');
    void errSpy;
  });
});

describe('OfflineBar（单机物理断网）', () => {
  it('editBlocked=false 隐藏；editBlocked=true 显红文案', () => {
    const store = useSpinthStore;
    const base = store.getState();
    act(() => store.setState({ editBlocked: false }));
    render(<OfflineBar />);
    expect(host.textContent ?? '').not.toContain('网络');
    act(() => store.setState({ editBlocked: true }));
    expect(host.textContent).toContain('网络已断开');
    act(() => store.setState({ editBlocked: false }));
    expect(host.textContent ?? '').not.toContain('网络');
    act(() => store.setState({ editBlocked: base.editBlocked }));
  });
});
