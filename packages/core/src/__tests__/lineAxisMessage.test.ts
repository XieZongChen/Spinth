import { describe, expect, it } from 'vitest';
import { axisMessageKind, shiftedAxisPorts } from '../widgets/line/lineAxisMessage';

/**
 * 轴消息判定与端口平移（specs/sequence-diagram §2.5 S2 / §4.5，批次 2）：纯函数，
 * 不落「是否消息」标记。夹具：轴 A（x=260，y 136…620，长 484）、轴 B（x=640，
 * y 136…420，长 284）。
 */

const AX = { x: 260, top: 136, bottom: 620 };
const BX = { x: 640, top: 136, bottom: 420 };
const axisOf = (id: string | null) => (id === 'l1' ? AX : id === 'l2' ? BX : null);
const msg = (over: Record<string, unknown>) => ({
  lineType: 'STRAIGHT',
  pinned: false,
  startNodeId: 'l1',
  endNodeId: 'l2',
  ...over,
});

describe('axisMessageKind（S2 纯派生）', () => {
  it('horizontal = STRAIGHT ∧ 两端锚定在两个不同的轴宿主', () => {
    expect(axisMessageKind(msg({}), axisOf)).toBe('horizontal');
  });

  it('self = ELBOWED ∧ 非 pinned ∧ 两端锚定在同一条轴', () => {
    expect(axisMessageKind(msg({ lineType: 'ELBOWED', endNodeId: 'l1' }), axisOf)).toBe('self');
  });

  it('其余一律 null', () => {
    expect(axisMessageKind(msg({ lineType: 'ELBOWED' }), axisOf)).toBeNull(); // 折线跨轴
    expect(axisMessageKind(msg({ startNodeId: null }), axisOf)).toBeNull(); // 单端锚定
    expect(axisMessageKind(msg({ endNodeId: 's1' }), axisOf)).toBeNull(); // 一端是普通件
    expect(
      axisMessageKind(msg({ lineType: 'ELBOWED', endNodeId: 'l1', pinned: true }), axisOf),
    ).toBeNull(); // pinned 自环
    expect(axisMessageKind(msg({ lineType: 'CURVE' }), axisOf)).toBeNull();
    expect(axisMessageKind(msg({}), () => null)).toBeNull(); // 宿主无轴（退化件）
  });
});

describe('shiftedAxisPorts', () => {
  const ends = [
    { axis: AX, port: 0.5 }, // y = 378，向下余量 242
    { axis: BX, port: 0.5 }, // y = 278，向下余量 142
  ];

  it('两端同移 dy：新端口 4 位小数，dy 原样返回', () => {
    const out = shiftedAxisPorts(ends, 60);
    expect(out.dy).toBe(60);
    expect(out.ports).toEqual([0.624, 0.7113]);
  });

  it('钳到两端都留在各自轴内：取较紧的一端，返回钳后的 dy', () => {
    const out = shiftedAxisPorts(ends, 200);
    expect(out.dy).toBe(142);
    expect(out.ports).toEqual([0.7934, 1]);
  });

  it('向上同理（负向钳制）', () => {
    const out = shiftedAxisPorts(
      [
        { axis: AX, port: 0.1 }, // y = 184.4，向上余量 48.4
        { axis: BX, port: 0.5 }, // 向上余量 142
      ],
      -60,
    );
    expect(out.dy).toBeCloseTo(-48.4, 6);
    expect(out.ports[0]).toBe(0);
    expect(out.ports[1]).toBe(0.3296);
  });

  it('幂等：dy = 0 端口不变；恰好钳为 0 时同样零变化', () => {
    expect(shiftedAxisPorts(ends, 0)).toEqual({ dy: 0, ports: [0.5, 0.5] });
    expect(shiftedAxisPorts([{ axis: BX, port: 1 }], 30)).toEqual({ dy: 0, ports: [1] });
  });

  it('退化端（轴长 ≤ 0）不可移：整条消息钳为 dy = 0', () => {
    const out = shiftedAxisPorts(
      [
        { axis: AX, port: 0.5 },
        { axis: { x: 1, top: 10, bottom: 10 }, port: 0 },
      ],
      60,
    );
    expect(out).toEqual({ dy: 0, ports: [0.5, 0] });
  });

  it('空清单：dy 原样、端口空', () => {
    expect(shiftedAxisPorts([], 60)).toEqual({ dy: 60, ports: [] });
  });
});
