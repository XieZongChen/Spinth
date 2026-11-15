import { describe, expect, it } from 'vitest';
import * as spinth from '../index';

/**
 * 包入口公开导出冻结（specs/tree-diagrams §11.2 / Phase 0c）：1.0 是公开 API
 * 基线，重构（目录迁移/改名）不得删改旧符号的可用性与形状——误删即此处红，
 * 防止「编译期没引用方、运行时宿主还在用」的静默破坏。
 */

describe('publicExports（1.0 mind 导出冻结）', () => {
  it('布局纯函数：layoutMindTree 可调用、类型签名兼容', () => {
    expect(typeof spinth.layoutMindTree).toBe('function');
    const r = spinth.layoutMindTree({ id: 'r', width: 10, height: 10, children: [] });
    expect(r.bbox).toEqual({ x: 0, y: 0, width: 10, height: 10 });
  });

  it('分支色：BRANCH_COLORS 六色数组 + branchColorAt 循环取色', () => {
    expect(spinth.BRANCH_COLORS).toHaveLength(6);
    expect(spinth.branchColorAt(0)).toBe(spinth.BRANCH_COLORS[0]);
    expect(spinth.branchColorAt(6)).toBe(spinth.BRANCH_COLORS[0]);
    expect(spinth.branchColorAt(-1)).toBe(spinth.BRANCH_COLORS[5]);
  });

  it('视觉常量：MIND_ROOT_STYLE/MIND_NODE_STYLE/MIND_COLORS/NODE_MAX_WIDTH 原值', () => {
    expect(spinth.MIND_ROOT_STYLE.fontSize).toBe(28);
    expect(spinth.MIND_NODE_STYLE.fontSizeFirst).toBe(18);
    expect(spinth.MIND_NODE_STYLE.fontSizeNode).toBe(14);
    expect(spinth.MIND_COLORS.rootFill).toBe('#1f2937');
    expect(spinth.MIND_COLORS.lineFallback).toBe('#22ab68');
    expect(spinth.NODE_MAX_WIDTH).toBe(360);
  });
});
