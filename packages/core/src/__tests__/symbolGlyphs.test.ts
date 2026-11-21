import { describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
// @ts-expect-error -- 仓库根 .mjs 无类型声明（负向夹具只用 ok/svg/error 字段）
import { validateAsset } from '../../../../scripts/build-symbol-glyphs.mjs';
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

  it('生成器负向夹具：非法 SVG 逐类拒收（specs/symbol-widget §9.1）', () => {
    const ok = (raw: string) => validateAsset('fixture', raw);
    // polyline/polygon（PIXI points 解析缺陷，§4.3 修订）
    expect(ok('<svg viewBox="0 0 48 48"><polyline points="1,1 2,2"/></svg>').ok).toBe(false);
    expect(ok('<svg viewBox="0 0 48 48"><polygon points="1,1 2,2 3,3"/></svg>').ok).toBe(false);
    // 硬编码色 / transform / 错 viewBox / 超尺寸 / 白名单外属性
    expect(
      ok('<svg viewBox="0 0 48 48"><circle cx="24" cy="24" r="13" stroke="#ff0000"/></svg>').ok,
    ).toBe(false);
    expect(ok('<svg viewBox="0 0 48 48"><g transform="translate(1)"/></svg>').ok).toBe(false);
    expect(ok('<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="6"/></svg>').ok).toBe(false);
    // 6KB 上限：'M1 1L2 2' 8 字节 ×800 = 6.4KB 超限
    expect(ok(`<svg viewBox="0 0 48 48"><path d="${'M1 1L2 2'.repeat(800)}"/></svg>`).ok).toBe(
      false,
    );
    expect(
      ok('<svg viewBox="0 0 48 48"><circle cx="24" cy="24" r="13" opacity="0.5"/></svg>').ok,
    ).toBe(false);
    // 正向基线：合法资产 ok 且 currentColor 归一 #ffffff
    const good = ok(
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48"><circle cx="24" cy="24" r="13" stroke="currentColor"/></svg>',
    );
    expect(good.ok).toBe(true);
    if (good.ok) {
      expect(good.svg).toContain('#ffffff');
      expect(good.svg).not.toContain('currentColor');
    }
  });

  it('生成产物与 assets 实时一致（spawn --check；改生成文件/资产未重建即红）', () => {
    // 路径从本文件解析（cwd 随运行方式漂移：pnpm -r test 在 packages/core、
    // 根 pnpm test/test:coverage 在仓库根——曾致 CI coverage 步找不到脚本）
    const script = join(
      dirname(fileURLToPath(import.meta.url)),
      '..',
      '..',
      '..',
      '..',
      'scripts',
      'build-symbol-glyphs.mjs',
    );
    const r = spawnSync(process.execPath, [script, '--check'], { encoding: 'utf8' });
    expect(r.status, r.stderr || r.stdout).toBe(0);
  });
});
