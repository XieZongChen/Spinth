import { describe, expect, it } from 'vitest';
import {
  axisAnchorPoint,
  axisAnchorWithInset,
  axisJoinFor,
  axisPortFor,
  isAxisHost,
  MESSAGE_ASYNC_POLICY,
  MESSAGE_RETURN_POLICY,
  MESSAGE_SYNC_POLICY,
  resolveAnchorPick,
} from '../widgets/line/lineAxisAnchor';
import { LINE_END_GAP } from '../widgets/line/linePath';

/**
 * 轴上几何与落点（specs/sequence-diagram §3.2 / §4.2，批次 2）：连线层的纯函数，
 * 生命线与消息共用——连线层不能反向依赖 sequence，所以轴上几何不放 lifelineGeometry。
 * 夹具：生命线 (200,100,120,520) 的轴 x = 260、轴段 y 136…620（长 484）。
 */

const AXIS = { x: 260, top: 136, bottom: 620 };
const GEOM = { rect: { x: 200, y: 100, width: 120, height: 520 }, rotation: 0 };

describe('拉线策略预设（§4.3）', () => {
  const ON_AXIS = {
    horizontal: true,
    requireAxisTargets: true,
    freeEnds: false,
    selfMessage: true,
  };

  it('同步消息：ELBOWED 草稿、实心箭头、标签在线上方、两端必须落轴', () => {
    expect(MESSAGE_SYNC_POLICY).toEqual({
      style: {
        lineType: 'ELBOWED',
        startArrow: 'none',
        endArrow: 'solid',
        dashed: false,
        textSide: 'above',
      },
      ...ON_AXIS,
    });
  });

  it('异步 = 同步换开放箭头；返回 = 异步加虚线；行为位与标签侧别同同步', () => {
    expect(MESSAGE_ASYNC_POLICY).toEqual({
      ...MESSAGE_SYNC_POLICY,
      style: { ...MESSAGE_SYNC_POLICY.style, endArrow: 'arrow' },
    });
    expect(MESSAGE_RETURN_POLICY).toEqual({
      ...MESSAGE_ASYNC_POLICY,
      style: { ...MESSAGE_ASYNC_POLICY.style, dashed: true },
    });
  });
});

describe('轴上几何（§3.2）', () => {
  it('axisAnchorPoint：t 沿轴段插值（两端 = 轴段端点）', () => {
    expect(axisAnchorPoint(AXIS, 0)).toEqual({ x: 260, y: 136 });
    expect(axisAnchorPoint(AXIS, 0.5)).toEqual({ x: 260, y: 378 });
    expect(axisAnchorPoint(AXIS, 1)).toEqual({ x: 260, y: 620 });
    expect(axisAnchorPoint(AXIS, 0.25)).toEqual({ x: 260, y: 257 });
  });

  it('axisJoinFor：指针在轴的哪一侧——p.x ≥ 轴取 right（轴上按下按右侧）', () => {
    expect(axisJoinFor(AXIS, { x: 400, y: 200 })).toBe('right');
    expect(axisJoinFor(AXIS, { x: 260, y: 200 })).toBe('right');
    expect(axisJoinFor(AXIS, { x: 259.9, y: 200 })).toBe('left');
  });

  it('axisPortFor：高度 → 轴上比例；两端钳制；4 位小数', () => {
    expect(axisPortFor(AXIS, 136)).toBe(0);
    expect(axisPortFor(AXIS, 620)).toBe(1);
    expect(axisPortFor(AXIS, 378)).toBeCloseTo(0.5, 6);
    // 520 高的轴上两位小数量化到 5px——4 位小数才够「加长保高度」重写端口不跳
    expect(axisPortFor(AXIS, 137)).toBe(0.0021);
    expect(axisPortFor(AXIS, 137)).not.toBe(0);
    // 轴外：钳到 [0,1]
    expect(axisPortFor(AXIS, 0)).toBe(0);
    expect(axisPortFor(AXIS, 9999)).toBe(1);
  });

  it('axisPortFor：退化轴（长 ≤ 0）不产生 NaN', () => {
    expect(axisPortFor({ x: 1, top: 10, bottom: 10 }, 12)).toBe(0);
    expect(axisPortFor({ x: 1, top: 10, bottom: 4 }, 12)).toBe(0);
  });

  it('axisAnchorWithInset：x = 轴 + sign(join) × (barHalf − 留隙)；y = 轴上高度', () => {
    // 无激活条（批次 2 恒如此）：让出一个线端留隙，箭头恰好停在轴上
    expect(axisAnchorWithInset(AXIS, 'right', 0.5, 0)).toEqual({
      x: 260 - LINE_END_GAP,
      y: 378,
    });
    expect(axisAnchorWithInset(AXIS, 'left', 0.5, 0)).toEqual({
      x: 260 + LINE_END_GAP,
      y: 378,
    });
    // top / bottom 不横向让位（sign = 0）
    expect(axisAnchorWithInset(AXIS, 'top', 0.25, 0)).toEqual({ x: 260, y: 257 });
    expect(axisAnchorWithInset(AXIS, 'bottom', 0, 7)).toEqual({ x: 260, y: 136 });
    // 绑定了半宽 5 的激活条：锚点落在条边（barHalf − 留隙 = 0）
    expect(axisAnchorWithInset(AXIS, 'right', 0.5, 5)).toEqual({ x: 260, y: 378 });
    expect(axisAnchorWithInset(AXIS, 'left', 0.5, 12)).toEqual({ x: 253, y: 378 });
  });
});

describe('宿主判定与落点（§4.2）', () => {
  const axisVm = { getAxisAnchor: () => AXIS };
  // 普通件：没有探针（只有基类的锚点实现）
  const plainVm: object = { id: 's1', getAnchorPoint: () => ({ x: 0, y: 0 }) };

  it('isAxisHost：有 getAxisAnchor 即轴宿主；普通件 / null 不是', () => {
    expect(isAxisHost(axisVm)).toBe(true);
    expect(isAxisHost(plainVm)).toBe(false);
    expect(isAxisHost(null)).toBe(false);
    expect(isAxisHost(undefined)).toBe(false);
  });

  it('resolveAnchorPick：轴宿主按指针所在侧选边、端口 = 轴上比例（4 位小数）', () => {
    // 高瘦矩形上 nearestJoin 会返回 top / bottom——轴宿主只看指针在轴的哪一侧
    expect(resolveAnchorPick(axisVm, GEOM, { x: 300, y: 200 })).toEqual({
      join: 'right',
      port: 0.1322,
    });
    expect(resolveAnchorPick(axisVm, GEOM, { x: 100, y: 500 })).toEqual({
      join: 'left',
      port: 0.7521,
    });
    // 轴外高度钳到端点
    expect(resolveAnchorPick(axisVm, GEOM, { x: 100, y: -50 })).toEqual({
      join: 'left',
      port: 0,
    });
  });

  it('resolveAnchorPick：普通宿主 = nearestJoin + 无端口键值（与今日逐字节一致）', () => {
    expect(resolveAnchorPick(plainVm, GEOM, { x: 260, y: 90 })).toEqual({
      join: 'top',
      port: undefined,
    });
    expect(resolveAnchorPick(null, GEOM, { x: 330, y: 360 })).toEqual({
      join: 'right',
      port: undefined,
    });
    expect('port' in resolveAnchorPick(plainVm, GEOM, { x: 260, y: 90 })).toBe(true);
  });

  it('resolveAnchorPick：轴宿主把几何透传给探针（急刻重路由以落库后的几何为准）', () => {
    const seen: unknown[] = [];
    const vm = {
      getAxisAnchor: (g?: unknown) => {
        seen.push(g);
        return g ? { x: 999, top: 0, bottom: 100 } : null;
      },
    };
    expect(resolveAnchorPick(vm, GEOM, { x: 1000, y: 40 })).toEqual({
      join: 'right',
      port: 0.4,
    });
    expect(seen).toEqual([GEOM]);
  });

  it('resolveAnchorPick：探针返回 null（退化轴）按普通件处理', () => {
    const degenerate = { getAxisAnchor: () => null };
    expect(resolveAnchorPick(degenerate, GEOM, { x: 330, y: 360 })).toEqual({
      join: 'right',
      port: undefined,
    });
  });
});
