import { describe, expect, it } from 'vitest';
import { parseInsetPx, readSafeInsets } from './safeArea';

/** 解析与兜底（specs/a11y-closeout §7.4）：非 px/空/垃圾值一律 0，
 *  无 DOM 环境全 0——「默认桌面 0 时布局不变」是 M1 的硬约束 */
describe('parseInsetPx', () => {
  it('px 数值正常解析（含小数与负值）', () => {
    expect(parseInsetPx('47px')).toBe(47);
    expect(parseInsetPx('12.5px')).toBe(12.5);
    expect(parseInsetPx('-4px')).toBe(-4);
    expect(parseInsetPx('  44px  ')).toBe(44); // CSS 变量取值常带空白
  });

  it('空/非 px 单位/垃圾值 → 0', () => {
    expect(parseInsetPx('')).toBe(0);
    expect(parseInsetPx(undefined)).toBe(0);
    expect(parseInsetPx(null)).toBe(0);
    expect(parseInsetPx('env(safe-area-inset-top)')).toBe(0); // env 未求值透传
    expect(parseInsetPx('10em')).toBe(0);
    expect(parseInsetPx('calc(44px)')).toBe(0);
  });

  it('无 DOM 环境（node）readSafeInsets 全 0', () => {
    // react 包默认 node 环境跑测——document 未定义是常态而非异常
    expect(readSafeInsets()).toEqual({ top: 0, right: 0, bottom: 0, left: 0 });
  });
});
