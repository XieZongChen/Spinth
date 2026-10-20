import { vi } from 'vitest';

/**
 * node 环境下的 pixi Text 测量桩：pixi 的 BrowserAdapter 在测量时依赖
 * document.createElement('canvas') 与全局 CanvasRenderingContext2D（node 均无）。
 * 提供最小实现 —— measureText 宽度按每字符 10px（与测试 mono 度量器一致）。
 * 仅测试用；浏览器环境不走此路径。
 */
export function stubPixiCanvasDocument(): void {
  if (typeof document !== 'undefined') return;
  const ctx = {
    font: '',
    measureText: (text: string) => ({ width: text.length * 10 }),
  };
  const canvas = {
    getContext: () => ctx,
    width: 0,
    height: 0,
    style: {} as Record<string, string>,
  };
  // 通用 DOM 元素桩（textarea/div 等——编辑会话测试驱动真实 kernel 用；
  // 属性赋值天然可写，监听为 noop：node 环境无事件循环语义）
  const makeElement = (): Record<string, unknown> => ({
    style: {},
    addEventListener: () => {},
    removeEventListener: () => {},
    appendChild: () => {},
    removeChild: () => {},
    remove: () => {},
    contains: () => false,
    focus: () => {},
    select: () => {},
    blur: () => {},
    setSelectionRange: () => {},
  });
  vi.stubGlobal('document', {
    createElement: (tag: string) => (tag === 'canvas' ? { ...canvas } : makeElement()),
    getElementById: () => null,
    body: {
      appendChild: () => {},
      removeChild: () => {},
      contains: () => false,
    },
  });
  // CanvasTextMetrics.experimentalLetterSpacingSupported 探测 ctx 原型上的 letterSpacing
  vi.stubGlobal(
    'CanvasRenderingContext2D',
    class CanvasRenderingContext2D {
      measureText(text: string): { width: number } {
        return { width: text.length * 10 };
      }
    },
  );
}
