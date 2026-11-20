import { describe, expect, it } from 'vitest';
import { resolveSymbolColor } from '../widgets/symbol/symbolVm';
import { setTextTheme } from '../platform/textEngine/theme';
import { TEXT_COLOR_PALETTE } from '../actionBarOptions';
import { contrastRatio } from '../common/contrast';

/**
 * 符号着色单源测试（specs/symbol-widget §4.4/§9.1）：缺省随主题墨色、显式
 * color 优先且不随主题反转（实例数据语义）；色板可达性护栏。
 */

describe('resolveSymbolColor（着色单源）', () => {
  it('缺省随主题：light #333333 / dark #ededf2', () => {
    setTextTheme('light');
    expect(resolveSymbolColor({})).toBe('#333333');
    setTextTheme('dark');
    expect(resolveSymbolColor({})).toBe('#ededf2');
    setTextTheme('light'); // 还原（主题是模块态）
  });

  it('显式 color 优先且不随主题反转（写入即固定）', () => {
    setTextTheme('light');
    expect(resolveSymbolColor({ color: '#dc2626' })).toBe('#dc2626');
    setTextTheme('dark');
    expect(resolveSymbolColor({ color: '#dc2626' })).toBe('#dc2626');
    setTextTheme('light');
  });
});

describe('符号色板可达性（TEXT_COLOR_PALETTE，文本口径）', () => {
  // 画布底（shapeContrast.test 同源口径）
  const LIGHT_BG = '#ffffff';
  const DARK_BG = '#1b1b22';

  it('每个色在浅/深两种画布底至少一底 ≥ 4.5:1', () => {
    for (const hex of TEXT_COLOR_PALETTE) {
      const light = contrastRatio(hex, LIGHT_BG);
      const dark = contrastRatio(hex, DARK_BG);
      expect(
        Math.max(light, dark) >= 4.5,
        `${hex} 双底均不达（light ${light.toFixed(2)} / dark ${dark.toFixed(2)}）`,
      ).toBe(true);
    }
  });

  it('主题墨色在两种画布底上都 ≥ 4.5:1', () => {
    expect(contrastRatio('#333333', LIGHT_BG)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio('#ededf2', DARK_BG)).toBeGreaterThanOrEqual(4.5);
  });
});
