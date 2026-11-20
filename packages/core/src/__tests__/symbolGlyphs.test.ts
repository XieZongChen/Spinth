import { describe, expect, it } from 'vitest';
import { SYMBOL_GLYPHS, SYMBOL_KINDS } from '../widgets/symbol/symbolGlyphs.generated';
import { SYMBOL_OPTIONS } from '../widgets/symbol/symbolService';

/**
 * 符号字形表护栏（specs/symbol-widget §4.1/§4.7）：清单双向覆盖 + 生成期
 * 约束的运行时复核（生成脚本硬校验之外的第二道闸——防手改生成文件）。
 */
describe('SYMBOL_GLYPHS / SYMBOL_KINDS / SYMBOL_OPTIONS', () => {
  it('SYMBOL_KINDS 与 SYMBOL_GLYPHS 键一一对应', () => {
    expect([...SYMBOL_KINDS]).toEqual(Object.keys(SYMBOL_GLYPHS));
  });

  it('SYMBOL_OPTIONS 与字形表双向覆盖（加 SVG 忘加菜单项即红，反之亦然）', () => {
    expect(SYMBOL_OPTIONS).toHaveLength(13);
    const optionIds = SYMBOL_OPTIONS.map((o) => o.id);
    expect(new Set(optionIds).size).toBe(13); // 无重复 id
    const glyphIds = Object.keys(SYMBOL_GLYPHS);
    for (const id of optionIds) expect(glyphIds).toContain(id);
    for (const kind of SYMBOL_KINDS) expect(optionIds).toContain(kind);
    // §4.1 顺序即分组顺序（网络设备 → 数据存储 → 文档）首尾抽检
    expect(optionIds[0]).toBe('net-server');
    expect(optionIds[optionIds.length - 1]).toBe('doc-folder');
  });

  it('每个字形是 <svg 且不含禁用 token（生成脚本白名单的运行时复核）', () => {
    const forbidden = [
      'style=',
      '<defs',
      'href',
      'xlink',
      '<use',
      '<image',
      '<text',
      'transform',
      'class=',
      'id=',
      // polyline/polygon：PIXI GraphicsContext.svg 对 points 解析有缺陷
      // （specs/symbol-widget 资产约束修订），一律 path 表达
      '<polyline',
      '<polygon',
      'points=',
    ];
    for (const [kind, svg] of Object.entries(SYMBOL_GLYPHS)) {
      expect(svg.startsWith('<svg'), kind).toBe(true);
      for (const token of forbidden) {
        expect(svg.includes(token), `${kind} 含禁用 token ${token}`).toBe(false);
      }
      // 颜色只允许 tint 乘法基色 #ffffff（currentColor 生成期归一）
      const colors = svg.match(/#[0-9a-fA-F]{3,8}\b/g) ?? [];
      expect(
        colors.every((c) => c === '#ffffff'),
        `${kind} 出现非法硬编码色`,
      ).toBe(true);
    }
  });
});
