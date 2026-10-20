// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { BehaviorSubject } from 'rxjs';
import { PlainTextKernel } from '../platform/textEngine/plainTextKernel';
import type { IEditSessionDescriptor, IPlainEditorStyle } from '../types';

/**
 * plain 内核桩测试（docs/17 §3）：textarea 生命周期——34ms 节流落库 / flush
 * 尾字 / blur 落库 / Esc discard / 同 nodeKey 重入不重建 DOM（IME 保护）。
 */

const style: IPlainEditorStyle = {
  fontSize: 18,
  lineHeightPx: 18,
  color: '#fff',
  background: '#1f2937',
  paddingX: 8,
  paddingY: 4,
};

function makeKernel() {
  const exitRequests: Array<{ discard?: boolean } | undefined> = [];
  const kernel = new PlainTextKernel(
    {
      vpScale$: new BehaviorSubject(1),
      vpBounds$: new BehaviorSubject({ x: 0, y: 0, width: 800, height: 600 }),
      worldToClient: (p: { x: number; y: number }) => ({ ...p }),
    } as never,
    (opts) => exitRequests.push(opts),
  );
  return { kernel, exitRequests };
}

function descriptor(over: Partial<IEditSessionDescriptor> = {}): IEditSessionDescriptor {
  return {
    widgetId: 'mm-1',
    kernel: 'plain',
    nodeKey: 'n1',
    getRect: () => ({ x: 0, y: 0, width: 80, height: 30 }),
    getContent: () => '原文案',
    style,
    onCommit: vi.fn(),
    emptyTextPolicy: 'keep',
    ...over,
  };
}

/** DOM textarea 模拟输入（程序赋值 + input 事件——真实键盘路径的等价合成） */
function typeInto(kernel: PlainTextKernel, value: string): void {
  const ta = (kernel as unknown as { ta: HTMLTextAreaElement | null }).ta;
  ta!.value = value;
  ta!.dispatchEvent(new Event('input', { bubbles: true }));
}

afterEach(() => {
  vi.useRealTimers();
});

describe('PlainTextKernel（docs/17 §3 textarea 内核）', () => {
  it('begin 建 DOM；同 nodeKey 重入不重建（IME 保护）——appendChild 计数为证', () => {
    const { kernel } = makeKernel();
    const spy = vi.spyOn(document.body, 'appendChild');
    kernel.begin(descriptor());
    kernel.begin(descriptor({ plainCursor: 'selectAll' }));
    expect(spy).toHaveBeenCalledTimes(1); // 重入零重建
    kernel.end(false);
    spy.mockRestore();
  });

  it('异 nodeKey 重建（同图换节点）', () => {
    const { kernel } = makeKernel();
    const spy = vi.spyOn(document.body, 'appendChild');
    kernel.begin(descriptor());
    kernel.begin(descriptor({ nodeKey: 'n2' }));
    expect(spy).toHaveBeenCalledTimes(2);
    kernel.end(false);
    spy.mockRestore();
  });

  it('输入 → 34ms 节流 onCommit（vi fake timers）', () => {
    vi.useFakeTimers();
    const { kernel } = makeKernel();
    const d = descriptor();
    kernel.begin(d);
    typeInto(kernel, '新文案');
    expect(d.onCommit).not.toHaveBeenCalled();
    vi.advanceTimersByTime(35);
    expect(d.onCommit).toHaveBeenCalledWith('新文案');
    kernel.end(false);
  });

  it('end(false)：以 textarea 现值落库（flush 尾字——程序赋值不经 input 事件也生效）', () => {
    const { kernel } = makeKernel();
    const d = descriptor();
    kernel.begin(d);
    const ta = (kernel as unknown as { ta: HTMLTextAreaElement | null }).ta!;
    ta.value = '直接改值不派事件';
    kernel.end(false);
    expect(d.onCommit).toHaveBeenCalledWith('直接改值不派事件');
  });

  it('end(true) = discard：pending 不落库 + Esc 经 requestExit({discard:true}) 上抛', () => {
    vi.useFakeTimers();
    const { kernel, exitRequests } = makeKernel();
    const d = descriptor();
    kernel.begin(d);
    typeInto(kernel, '会被丢弃');
    const ta = (kernel as unknown as { ta: HTMLTextAreaElement | null }).ta!;
    ta.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(exitRequests).toEqual([{ discard: true }]);
    kernel.end(true);
    expect(d.onCommit).not.toHaveBeenCalled();
  });

  it('blur → requestExit()（不带 discard——落库退出）', () => {
    const { kernel, exitRequests } = makeKernel();
    kernel.begin(descriptor());
    const ta = (kernel as unknown as { ta: HTMLTextAreaElement | null }).ta!;
    ta.dispatchEvent(new FocusEvent('blur', { bubbles: false }));
    expect(exitRequests).toEqual([undefined]);
    kernel.end(false);
  });
});
