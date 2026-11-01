// @vitest-environment jsdom
/**
 * roving autoFocus 定点单测（specs/a11y-closeout §13.5-9）：一次性标记 +
 * 容器清空重置的「重渲染不抢焦点」行为——E2E 只覆盖「重开聚焦首项」，
 * ProjectMenu busy/warning 重渲染路径无人守。harness 与断言风格照
 * contextMenuProtocol.render.test.tsx（createRoot + act，零新依赖）。
 */
import { act } from 'react';
import type { ReactNode } from 'react';
import { useRef } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { useRovingFocus } from '../a11y/useRovingFocus';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function Panel({
  busy,
  autoFocus,
  empty,
}: {
  busy?: string;
  autoFocus?: 'first' | false;
  empty?: boolean;
}) {
  const ref = useRef<HTMLDivElement | null>(null);
  const { onKeyDown, onFocus } = useRovingFocus({
    containerRef: ref,
    orientation: 'vertical',
    wrap: true,
    autoFocus: autoFocus ?? 'first',
  });
  return (
    <div ref={ref} onKeyDown={onKeyDown} onFocus={onFocus}>
      {empty ? null : (
        <>
          <button type="button" data-roving-item="">
            {busy ?? '一'}
          </button>
          <button type="button" data-roving-item="">
            二
          </button>
          <button type="button" data-roving-item="">
            三
          </button>
        </>
      )}
      <button type="button" id="outside">
        外部按钮
      </button>
    </div>
  );
}

let host: HTMLElement;
let root: Root;

function render(el: ReactNode): void {
  act(() => root.render(el));
}

function items(): HTMLElement[] {
  return [...document.querySelectorAll('[data-roving-item]')] as HTMLElement[];
}

function dockedIndex(): number {
  return items().findIndex((el) => el.tabIndex === 0);
}

describe('useRovingFocus autoFocus 定点（§13.5-9）', () => {
  beforeEach(() => {
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
  });
  afterEach(() => {
    act(() => root.unmount());
    host.remove();
  });

  it('挂载：聚焦首项，容器内恰好一个 tabIndex===0', () => {
    render(<Panel />);
    expect(document.activeElement, '挂载后焦点应在首项').toBe(items()[0]);
    expect(items().filter((el) => el.tabIndex === 0).length, '停靠位应唯一').toBe(1);
    expect(dockedIndex(), '停靠位应在首项（index 0）').toBe(0);
  });

  it('重渲染不抢焦点：焦点在非 roving 按钮上时改 props，焦点与停靠位不变', () => {
    render(<Panel />);
    const outside = document.getElementById('outside')!;
    act(() => outside.focus());
    expect(document.activeElement, '前置：焦点在外部按钮').toBe(outside);
    // 模拟 ProjectMenu busy/warning 类重渲染：同组件换 props 再渲染
    render(<Panel busy="正在导出…" />);
    expect(document.activeElement, '重渲染后焦点仍应在外部按钮（不被 autoFocus 抢走）').toBe(
      outside,
    );
    expect(dockedIndex(), '停靠位应仍在首项').toBe(0);
  });

  it('容器清空再填充：清空重置一次性标记，内容再现首项再次聚焦', () => {
    render(<Panel />);
    expect(document.activeElement, '首次挂载聚焦首项').toBe(items()[0]);
    render(<Panel empty />); // 面板条件卸载（项清空，仅剩外部按钮）
    expect(items().length, '清空后不应有 roving 项').toBe(0);
    render(<Panel />); // 重新打开：autoFocus 应再次生效
    expect(document.activeElement, '内容再现后首项应再次聚焦（重置语义）').toBe(items()[0]);
  });

  it('autoFocus: false：挂载不聚焦，但停靠位仍唯一', () => {
    render(<Panel autoFocus={false} />);
    expect(document.activeElement, 'autoFocus 关闭时不应聚焦首项').toBe(document.body);
    expect(items().filter((el) => el.tabIndex === 0).length, '停靠位仍应唯一（键盘导航可用）').toBe(
      1,
    );
  });
});
