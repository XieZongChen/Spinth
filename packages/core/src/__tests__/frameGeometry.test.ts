import { describe, expect, it } from 'vitest';
import { graphemes } from '../platform/textEngine/measure';
import {
  FRAME_HIT_EDGE,
  FRAME_HIT_EDGE_MAX,
  frameHeaderRect,
  frameHitTest,
  frameTitleRect,
  frameTitleWidth,
  truncateTitle,
} from '../widgets/frame/frameGeometry';

/** 等宽 mock 测宽器（每字素 10px——symbolGeometry.test 同款口径） */
const measure10 = (s: string): number => [...graphemes(s)].length * 10;

describe('frameGeometry 标题带（§3.2）', () => {
  it('top = 整宽 × 28；left = 112 × 整高', () => {
    expect(frameHeaderRect(320, 220, 'top')).toEqual({ x: 0, y: 0, width: 320, height: 28 });
    expect(frameHeaderRect(320, 220, 'left')).toEqual({ x: 0, y: 0, width: 112, height: 220 });
  });

  it('超小容器带宽钳制（不出负尺寸/超整尺寸）', () => {
    expect(frameHeaderRect(50, 20, 'top')).toEqual({ x: 0, y: 0, width: 50, height: 20 });
    expect(frameHeaderRect(60, 200, 'left')).toEqual({ x: 0, y: 0, width: 60, height: 200 });
  });

  it('标题可用宽：top = w − 2×PAD；left = 112 − 2×PAD；下限 0', () => {
    expect(frameTitleWidth(320, 220, 'top')).toBe(300);
    expect(frameTitleWidth(320, 220, 'left')).toBe(92);
    expect(frameTitleWidth(10, 100, 'top')).toBe(0);
  });

  it('标题文字矩形：带内左内边距 + 垂直居中（top 与 left 同口径）', () => {
    const top = frameTitleRect(320, 220, 'top');
    expect(top).toEqual({ x: 10, y: (28 - 18) / 2, width: 300, height: 18 });
    const left = frameTitleRect(320, 220, 'left');
    expect(left).toEqual({ x: 10, y: (220 - 18) / 2, width: 92, height: 18 });
  });

  it('矮容器标题行高随带钳制（band.height < 行高时占满带）', () => {
    const r = frameTitleRect(320, 14, 'top');
    expect(r.height).toBe(14);
    expect(r.y).toBe(0);
  });
});

describe('truncateTitle（§3.2 单行截断，同 SYMBOL 口径）', () => {
  it('未超宽原样返回（含空串）', () => {
    expect(truncateTitle('', 100, measure10)).toBe('');
    expect(truncateTitle('审批流', 100, measure10)).toBe('审批流');
  });

  it('超宽截断加省略号（每字素 10px：30px 宽容 2 字素 + …）', () => {
    expect(truncateTitle('跨职能审批流程', 30, measure10)).toBe('跨职…');
  });

  it('恰好放不下任何前缀时只剩省略号', () => {
    expect(truncateTitle('AB', 5, measure10)).toBe('…');
  });

  it('字素级切分（emoji 不被劈成半个）', () => {
    // 👨‍👩‍👧 是 8 个 code point / 1 个字素；measure10 按字素计宽（含省略号）
    // 宽 20 容 2 字素 = 1 emoji + …
    expect(truncateTitle('👨‍👩‍👧X👨‍👩‍👧', 20, measure10)).toBe('👨‍👩‍👧…');
  });
});

describe('frameHitTest（§3.3 标题带 ∪ 边框环）', () => {
  const rect = { x: 100, y: 50, width: 320, height: 220 };
  const edge = 8;

  it('标题带内命中（top：y < 28；left：x < 112）', () => {
    expect(frameHitTest({ x: 150, y: 60 }, rect, 'top', edge)).toBe(true);
    expect(frameHitTest({ x: 150, y: 200 }, rect, 'left', edge)).toBe(true);
  });

  it('边框环内命中（贴边 8px 环带）', () => {
    expect(frameHitTest({ x: 104, y: 150 }, rect, 'top', edge)).toBe(true); // 左边框
    expect(frameHitTest({ x: 415, y: 260 }, rect, 'top', edge)).toBe(true); // 右边框
    expect(frameHitTest({ x: 300, y: 264 }, rect, 'top', edge)).toBe(true); // 底边框
  });

  it('内部空白不命中（点空白 = 清选区，不被大容器吃掉）', () => {
    expect(frameHitTest({ x: 260, y: 160 }, rect, 'top', edge)).toBe(false);
    expect(frameHitTest({ x: 260, y: 160 }, rect, 'left', edge)).toBe(false);
  });

  it('环外不命中', () => {
    expect(frameHitTest({ x: 99, y: 160 }, rect, 'top', edge)).toBe(false);
    expect(frameHitTest({ x: 200, y: 271 }, rect, 'top', edge)).toBe(false);
  });

  it('超小容器任一边不足两倍环宽 = 整块命中（仍抓得住）', () => {
    const tiny = { x: 0, y: 0, width: 12, height: 220 };
    expect(frameHitTest({ x: 6, y: 100 }, tiny, 'top', 8)).toBe(true);
  });

  it('命中环宽入参即世界值（缩放折算由调用方负责，上限 FRAME_HIT_EDGE_MAX）', () => {
    expect(FRAME_HIT_EDGE).toBe(8);
    expect(FRAME_HIT_EDGE_MAX).toBe(32);
    // 0.2x 缩放折算 40 → 钳 32：环 32px 内命中
    expect(frameHitTest({ x: 131, y: 160 }, rect, 'top', 32)).toBe(true);
    expect(frameHitTest({ x: 135, y: 160 }, rect, 'top', 32)).toBe(false);
  });
});
