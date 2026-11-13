import { describe, expect, it } from 'vitest';
import { setTextTheme } from '../platform/textEngine/theme';
import { editStyleOf } from '../widgets/text/textEditStyle';
import { STICKY_TEXT_COLOR } from '../widgets/sticky/stickyVm';

/**
 * 编辑样式字色单源（specs/flowchart-closeout §16 二轮返工）：SHAPE 编辑器
 * 字色与渲染 resolveShapeTextStyle 同走 defaultTextColorForFill——黑填充
 * 自适应白字（否则进编辑文字直接消失）、无填充随主题；TEXT/STICKY 分支
 * 不回归（TEXT 已随主题、STICKY 恒浅黄底深字）。
 */

describe('editStyleOf SHAPE 字色单源（与渲染 defaultTextColorForFill 对齐）', () => {
  it('黑填充：编辑器字色 = #ffffff（写死 #333 时黑底编辑文字不可见）', () => {
    const st = editStyleOf('SHAPE', { fill: 'solid', color: '#000000' });
    expect(st.color).toBe('#ffffff');
    expect(st.align).toBe('center'); // SHAPE 默认居中（渲染对称）
  });

  it('浅填充：维持 #333333（老文档零漂移）', () => {
    expect(editStyleOf('SHAPE', { fill: 'solid', color: '#e8f0fb' }).color).toBe('#333333');
    expect(editStyleOf('SHAPE', {}).color).toBe('#333333'); // 无 fill/color = 恒填充浅色
  });

  it('无填充随主题：dark = #ededf2（#333 on #1b1b22 仅 1.36:1）', () => {
    setTextTheme('dark');
    try {
      expect(editStyleOf('SHAPE', { fill: 'none', color: '#000000' }).color).toBe('#ededf2');
      // 缺 color 的防御分支同样随主题默认（运行时 model 恒有 color，不可达兜底）
      expect(editStyleOf('SHAPE', {}).color).toBe('#ededf2');
      // 实色填充不主题化（填充色是实例数据）
      expect(editStyleOf('SHAPE', { fill: 'solid', color: '#e8f0fb' }).color).toBe('#333333');
    } finally {
      setTextTheme('light');
    }
    expect(editStyleOf('SHAPE', { fill: 'none' }).color).toBe('#333333');
  });

  it('per-实例 textColor 恒优先（用户显式选色不做主）', () => {
    expect(
      editStyleOf('SHAPE', { textColor: '#dc2626', fill: 'solid', color: '#000000' }).color,
    ).toBe('#dc2626');
  });

  it('TEXT/STICKY 分支不回归：TEXT 随主题、STICKY 恒浅黄底深字', () => {
    expect(editStyleOf('TEXT', {}).color).toBe('#333333');
    setTextTheme('dark');
    try {
      expect(editStyleOf('TEXT', {}).color).toBe('#ededf2');
    } finally {
      setTextTheme('light');
    }
    expect(editStyleOf('STICKY', {}).color).toBe(STICKY_TEXT_COLOR); // 两主题皆可读
    setTextTheme('dark');
    try {
      expect(editStyleOf('STICKY', {}).color).toBe(STICKY_TEXT_COLOR);
    } finally {
      setTextTheme('light');
    }
  });
});
