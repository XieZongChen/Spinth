import { describe, expect, it } from 'vitest';
import {
  setTextTheme,
  defaultTextColor,
  defaultLineTextColor,
  textThemeVersion,
} from '../platform/textEngine/theme';

/** 主题模块纯逻辑（docs/17 C2）：版本递增守卫 + 双态取色 */

describe('textEngine/theme（docs/17 C2）', () => {
  it('版本递增：切换主题 +1、同值切换不增（快速路径守卫的防抖语义）', () => {
    const v0 = textThemeVersion();
    setTextTheme('dark');
    expect(textThemeVersion()).toBe(v0 + 1);
    setTextTheme('dark'); // 同值 no-op
    expect(textThemeVersion()).toBe(v0 + 1);
    setTextTheme('light');
    expect(textThemeVersion()).toBe(v0 + 2);
  });

  it('双态取色：dark 用 tokens 同源浅色，light 用原默认；复位保证测试隔离', () => {
    setTextTheme('dark');
    expect(defaultTextColor()).toBe('#ededf2');
    expect(defaultLineTextColor()).toBe('#a6a6b3');
    setTextTheme('light');
    expect(defaultTextColor()).toBe('#333333');
    expect(defaultLineTextColor()).toBe('#1f2937');
  });
});
