import { describe, expect, it } from 'vitest';
import { contrastRatio } from '../common/contrast';
import { setTextTheme } from '../platform/textEngine/theme';
import {
  SHAPE_TEXT_COLOR,
  defaultTextColorForFill,
  resolveShapeTextStyle,
} from '../widgets/shape/shapeVm';
import { SHAPE_PALETTE, TEXT_COLOR_PALETTE } from '../actionBarOptions';
import { LIFELINE_HEAD_BORDER, LIFELINE_HEAD_COLOR } from '../widgets/sequence/lifelineGeometry';
import { ACTIVATION_BORDER, ACTIVATION_FILL } from '../widgets/sequence/sequenceOps';
import { defaultTextColor } from '../platform/textEngine/theme';

/**
 * 对比度护栏（specs/flowchart-closeout §16）：黑填充（#000000）配默认深字
 * #333333 仅 1.66:1 的返工锁——默认字色随填充自适应（shapeVm 单源）、
 * 文字色板补浅色兜底、白边框定位为深底选项（不逐色硬锁边框 vs 画布）。
 */

describe('contrastRatio（WCAG sRGB）', () => {
  it('黑白极值 21:1；已知组合取两位小数', () => {
    expect(contrastRatio('#000000', '#ffffff')).toBe(21);
    expect(contrastRatio('#333333', '#000000')).toBe(1.66); // 返工动因
    expect(contrastRatio('#4b5563', '#000000')).toBeLessThan(4.5); // 旧色板最亮色在黑底也不达
    expect(contrastRatio('#ffffff', '#000000')).toBeGreaterThanOrEqual(4.5);
  });
});

describe('默认字色自适应（defaultTextColorForFill）', () => {
  it('填充色板每色：默认字色对比度 ≥ 4.5:1（AA 文本）', () => {
    for (const fill of SHAPE_PALETTE) {
      const text = defaultTextColorForFill('solid', fill);
      const ratio = contrastRatio(text, fill);
      expect(ratio, `默认字色 ${text} on ${fill} = ${ratio}:1（应 ≥4.5）`).toBeGreaterThanOrEqual(
        4.5,
      );
    }
  });

  it('浅填充维持 #333333（老文档零漂移）；深填充切白；无填充随主题（dark #ededf2）', () => {
    expect(defaultTextColorForFill('solid', '#e8f0fb')).toBe(SHAPE_TEXT_COLOR);
    expect(defaultTextColorForFill('solid', '#ffffff')).toBe(SHAPE_TEXT_COLOR);
    expect(defaultTextColorForFill('solid', '#000000')).toBe('#ffffff');
    // 无填充 = 文字直对画布底（与 TEXT 同场景）——随主题默认，浅色态维持深字
    expect(defaultTextColorForFill('none', '#000000')).toBe(SHAPE_TEXT_COLOR);
    expect(defaultTextColorForFill(undefined, undefined)).toBe(SHAPE_TEXT_COLOR);

    setTextTheme('dark');
    try {
      const dark = defaultTextColorForFill('none', '#000000');
      expect(dark).toBe('#ededf2'); // #333333 on #1b1b22 仅 1.36:1
      expect(contrastRatio(dark, '#1b1b22')).toBeGreaterThanOrEqual(4.5); // 深画布 AA
      // 实色填充不主题化（填充色是实例数据）
      expect(defaultTextColorForFill('solid', '#000000')).toBe('#ffffff');
      expect(defaultTextColorForFill('solid', '#e8f0fb')).toBe(SHAPE_TEXT_COLOR);
    } finally {
      setTextTheme('light'); // 复位保证测试隔离（theme.test 同款）
    }
  });

  it('resolveShapeTextStyle：per-实例 textColor 恒优先；缺省走自适应', () => {
    expect(
      resolveShapeTextStyle({ textColor: '#333333', fill: 'solid', color: '#000000' }).color,
    ).toBe('#333333'); // 用户显式深字不做主
    expect(resolveShapeTextStyle({ fill: 'solid', color: '#000000' }).color).toBe('#ffffff');
    expect(resolveShapeTextStyle({ fill: 'solid', color: '#fef3c7' }).color).toBe(SHAPE_TEXT_COLOR);
  });
});

describe('文字色板可达性（TEXT_COLOR_PALETTE）', () => {
  it('深浅双底各至少一色可达 ≥4.5:1（黑填充与白画布都可读）', () => {
    const okOnBlack = TEXT_COLOR_PALETTE.filter((c) => contrastRatio(c, '#000000') >= 4.5);
    const okOnWhite = TEXT_COLOR_PALETTE.filter((c) => contrastRatio(c, '#ffffff') >= 4.5);
    expect(okOnBlack.length).toBeGreaterThanOrEqual(2);
    expect(okOnWhite.length).toBeGreaterThanOrEqual(2);
  });

  it('含白与浅灰（黑填充默认白字可显式选回）', () => {
    expect(TEXT_COLOR_PALETTE).toContain('#ffffff');
    expect(TEXT_COLOR_PALETTE).toContain('#f9fafb');
  });
});

describe('容器标题缺省色 vs 带底色（specs/container-frame §5.4 双态护栏）', () => {
  it('填充色板每色：标题缺省色对比度 ≥ 4.5:1（白底深字/深底浅字自适应）', async () => {
    const { resolveFrameTitleColor } = await import('../widgets/frame/frameVm');
    for (const fill of SHAPE_PALETTE) {
      const title = resolveFrameTitleColor({ color: fill });
      const ratio = contrastRatio(title, fill);
      expect(
        ratio,
        `标题缺省色 ${title} on ${fill} = ${ratio}:1（应 ≥4.5）`,
      ).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('无填充对画布走主题墨色：dark 主题下 #ededf2 on #1b1b22 ≥ 4.5:1', async () => {
    const { resolveFrameTitleColor } = await import('../widgets/frame/frameVm');
    expect(resolveFrameTitleColor({ fill: 'none', color: '#ffffff' })).toBe('#333333'); // light
    setTextTheme('dark');
    try {
      expect(resolveFrameTitleColor({ fill: 'none', color: '#ffffff' })).toBe('#ededf2');
      expect(contrastRatio('#ededf2', '#1b1b22')).toBeGreaterThanOrEqual(4.5);
    } finally {
      setTextTheme('light');
    }
  });
});

describe('生命线配色（specs/sequence-diagram §3.6）', () => {
  it('标签 / 描边色对白头框底 ≥ 4.5:1（写死配色，不随主题）', () => {
    expect(contrastRatio(LIFELINE_HEAD_BORDER, LIFELINE_HEAD_COLOR)).toBeGreaterThanOrEqual(4.5);
  });

  it('轴色 = 主题墨色：dark 下对画布底 #1b1b22 ≥ 4.5:1', () => {
    setTextTheme('dark');
    try {
      expect(defaultTextColor()).toBe('#ededf2');
      expect(contrastRatio(defaultTextColor(), '#1b1b22')).toBeGreaterThanOrEqual(4.5);
    } finally {
      setTextTheme('light');
    }
  });
});

describe('激活条配色（specs/sequence-diagram §3.6）', () => {
  it('描边色对白填充 ≥ 4.5:1（写死配色，绑定与否、明暗主题都相同）', () => {
    expect(contrastRatio(ACTIVATION_BORDER, ACTIVATION_FILL)).toBeGreaterThanOrEqual(4.5);
  });
});
