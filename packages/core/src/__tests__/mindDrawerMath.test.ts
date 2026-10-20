import { describe, expect, it } from 'vitest';
import {
  mindF,
  rootT,
  rootStartX,
  rootEnd,
  nodePathPoints,
  nodeConnectorPath,
  NODE_LINE_AGGREGATED,
  ROOT_CURVE_START_PADDING,
} from '../widgets/mind/mindDrawerMath';

describe('脑图连线数学（docs/11 §5）', () => {
  it('f(x)：单调递增、边界 0/1、三段连续', () => {
    expect(mindF(0)).toBe(0);
    expect(mindF(1500)).toBeLessThanOrEqual(0.9); // 第一段末（未达 S1 满值）
    expect(mindF(3000)).toBeCloseTo(0.98, 2); // S1+S2 饱和（既有设计 0.9+0.08）
    // 单调性抽样
    let prev = -1;
    for (let x = 0; x <= 1500; x += 50) {
      const v = mindF(x);
      expect(v).toBeGreaterThanOrEqual(prev);
      prev = v;
    }
    // 三段交界连续（P1.x=0.17 → x=255; P2.x=0.83 → x=1245）
    expect(Math.abs(mindF(255) - mindF(254.9))).toBeLessThan(0.01);
    expect(Math.abs(mindF(1245) - mindF(1244.9))).toBeLessThan(0.01);
  });

  it('f(x) 三段连续（贝塞尔末 → 线性起 → 饱和）', () => {
    expect(Math.abs(mindF(1500) - mindF(1501))).toBeLessThan(0.01);
    expect(Math.abs(mindF(3000) - mindF(3001))).toBeLessThan(0.001);
  });

  it('t 参数：近中心靠边 (|t|→1)、远端逼近中点 (|t|→0)，且全程不倒号', () => {
    // f=0 → t=±1（起点贴根的两端）
    expect(rootT(0, false)).toBeCloseTo(1, 5);
    expect(rootT(0, true)).toBeCloseTo(-1, 5);
    // 超出饱和段后仍靠中点（既有设计 f 饱和于 0.98 → t 恒 > 0）
    expect(rootT(1500, false)).toBeGreaterThan(0);
    expect(rootT(3000, false)).toBeCloseTo(1 - 0.98, 2);
    // 回归：修复 S2 之前 f 会涨到 1.8，t = 1-fx 转负 → 起点跑到根中心另一侧
    for (const x of [0, 500, 1500, 1667, 2250, 3000, 5000]) {
      expect(rootT(x, false)).toBeGreaterThanOrEqual(0);
      expect(rootT(x, true)).toBeLessThanOrEqual(0);
    }
  });

  it('startX：middleX + axisWidth·t，axisWidth = rootWidth/2 - 24', () => {
    const rootW = 200;
    const centerX = 100;
    // t=1（靠右边缘）：startX = 100 + (100-24)·1 = 176
    expect(rootStartX(centerX, rootW, 1)).toBe(centerX + rootW / 2 - ROOT_CURVE_START_PADDING);
    // t=0（中点）：startX = 100
    expect(rootStartX(centerX, rootW, 0)).toBe(centerX);
    // t=-1（靠左边缘）
    expect(rootStartX(centerX, rootW, -1)).toBe(centerX - rootW / 2 + ROOT_CURVE_START_PADDING);
  });

  it('rootEnd：左侧子取右边中点，右侧子取左边中点', () => {
    const rect = { x: 100, y: 200, width: 60, height: 24 };
    expect(rootEnd(rect, true)).toEqual({ x: 160, y: 212 });
    expect(rootEnd(rect, false)).toEqual({ x: 100, y: 212 });
  });

  it('nodePathPoints：折线 4 点，midX = 父子边中点', () => {
    const parent = { x: 0, y: 0, width: 100, height: 40 };
    const child = { x: 200, y: 50, width: 80, height: 20 };
    const pts = nodePathPoints(parent, child);
    expect(pts.length).toBe(4);
    expect(pts[0]).toEqual({ x: 100, y: 20 }); // 父右边中点
    expect(pts[3]).toEqual({ x: 200, y: 60 }); // 子左边中点
    expect(pts[1]!.x).toBe(pts[2]!.x); // 垂直段共享
  });
});

describe('鱼骨连线路径（既有设计 drawer.drawNodeLine：聚合成线 + 真圆弧）', () => {
  const parent = { x: 0, y: 0, width: 100, height: 40 };
  const child = { x: 148, y: 80, width: 80, height: 20 };

  it('子节点在下方：聚合线在父边 +24，圆弧落在子节点上边 −R 处', () => {
    const cmds = nodeConnectorPath(parent, child);
    expect(cmds[0]).toEqual({ op: 'moveTo', x: 100, y: 20 });
    expect(cmds[1]).toEqual({ op: 'lineTo', x: 100 + NODE_LINE_AGGREGATED, y: 20 });
    // 子中线 = 90，向下 → cy = 90 - 8
    expect(cmds[2]).toEqual({ op: 'lineTo', x: 100 + NODE_LINE_AGGREGATED, y: 82 });
    expect(cmds[3]).toMatchObject({ op: 'arc', cx: 124 + 8, cy: 82, r: 8 });
    expect(cmds[4]).toEqual({ op: 'lineTo', x: 148, y: 90 });
  });

  it('子节点在上方：圆弧镜像', () => {
    const up = nodeConnectorPath(parent, { x: 148, y: -60, width: 80, height: 20 });
    expect(up[2]).toEqual({ op: 'lineTo', x: 100 + NODE_LINE_AGGREGATED, y: -42 });
    expect(up[3]).toMatchObject({ op: 'arc', cy: -42, r: 8 });
  });

  it('左树：聚合线在父边 −24、圆弧在左侧', () => {
    const cmds = nodeConnectorPath(parent, { x: -228, y: 80, width: 80, height: 20 });
    expect(cmds[1]).toEqual({ op: 'lineTo', x: 0 - NODE_LINE_AGGREGATED, y: 20 });
    expect(cmds[3]).toMatchObject({ op: 'arc', cx: -24 - 8 });
  });

  it('小台阶（0 < |Δy| < 2R）：单段 S 曲线，不画钩状圆弧（既有设计 TODO 的补全）', () => {
    // 子节点块相对父中心常有 ~2px 偏移（末尾外边距口径）——用 R8 圆弧会画出小钩子
    const cmds = nodeConnectorPath(parent, { x: 148, y: 12, width: 80, height: 20 });
    expect(cmds).toHaveLength(2);
    expect(cmds[0]).toEqual({ op: 'moveTo', x: 100, y: 20 });
    expect(cmds[1]).toEqual({
      op: 'cubicTo',
      c1x: 100 + NODE_LINE_AGGREGATED,
      c1y: 20,
      c2x: 100 + NODE_LINE_AGGREGATED,
      c2y: 22,
      x: 148,
      y: 22,
    });
  });

  it('台阶达到 2R 及以上：仍走鱼骨 + 真圆弧（大落差保持既有设计视觉）', () => {
    const cmds = nodeConnectorPath(parent, { x: 148, y: 36, width: 80, height: 20 });
    expect(cmds.some((c) => c.op === 'arc')).toBe(true);
  });

  it('首尾水平（|Δy| < 1）：直接直线', () => {
    const cmds = nodeConnectorPath(parent, { x: 148, y: 10, width: 80, height: 20 });
    expect(cmds).toEqual([
      { op: 'moveTo', x: 100, y: 20 },
      { op: 'lineTo', x: 148, y: 20 },
    ]);
  });
});
