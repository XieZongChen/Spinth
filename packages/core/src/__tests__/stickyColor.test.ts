import { describe, expect, it } from 'vitest';
import { resolveStickyColor, STICKY_DEFAULT_COLOR } from '../widgets/sticky/stickyVm';

describe('resolveStickyColor（2026-09 数据模型统一 hex）', () => {
  it('hex 直通', () => {
    expect(resolveStickyColor('#c8ecd0')).toBe('#c8ecd0');
  });

  it('旧语义名映射（IndexedDB 旧文档兼容）', () => {
    expect(resolveStickyColor('yellow')).toBe('#fff3b0');
    expect(resolveStickyColor('green')).toBe('#c8ecd0');
    expect(resolveStickyColor('blue')).toBe('#c9e3f7');
    expect(resolveStickyColor('pink')).toBe('#f9d3e0');
  });

  it('未知值兜底默认色', () => {
    expect(resolveStickyColor('whatever')).toBe(STICKY_DEFAULT_COLOR);
  });
});
