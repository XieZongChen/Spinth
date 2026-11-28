import { describe, expect, it } from 'vitest';
import type { IAxisAnchor } from '../types/base';
import type { IRect } from '../common/geometry';
import {
  ACTIVATION_DEFAULT_DROP,
  ACTIVATION_MIN_HEIGHT,
  ACTIVATION_WIDTH,
  activationBind,
  activationDropRect,
  constrainActivationResize,
  resolveActivationHost,
} from '../widgets/sequence/sequenceOps';

/**
 * 激活条几何与绑定判定（specs/sequence-diagram §3.4 / §3.5 / §5.1 / §7.1）：
 * 纯函数单源——绑定宿主判定、创建落点（x 归中 / y = 按下高度 / 高度钳制）、
 * 锁宽缩放整形。夹具轴 x = 300、轴段 y 136…656（生命线 y 100 高 600、头框 36）。
 */

const AXIS: IAxisAnchor = { x: 300, top: 136, bottom: 656 };
const HOSTS = [
  { id: 'l2', axis: { x: 640, top: 136, bottom: 656 } },
  { id: 'l1', axis: AXIS },
];
/** 中心线落在 cx 的条（宽恒定） */
const barAt = (cx: number, y: number, h = 80): IRect => ({
  x: cx - ACTIVATION_WIDTH / 2,
  y,
  width: ACTIVATION_WIDTH,
  height: h,
});

describe('resolveActivationHost（§5.1 绑定判定）', () => {
  it('中心线贴合轴（容差恰 6）且与轴段有纵向重叠 → 绑定该生命线', () => {
    expect(resolveActivationHost(barAt(300, 300), HOSTS)).toBe('l1');
    expect(resolveActivationHost(barAt(306, 300), HOSTS)).toBe('l1');
    expect(resolveActivationHost(barAt(294, 300), HOSTS)).toBe('l1');
  });

  it('中心线超出容差（7）→ 不绑定', () => {
    expect(resolveActivationHost(barAt(307, 300), HOSTS)).toBeUndefined();
    expect(resolveActivationHost(barAt(293, 300), HOSTS)).toBeUndefined();
  });

  it('与轴段无纵向重叠 → 不绑定（条在头框高度 / 轴底以下）', () => {
    expect(resolveActivationHost(barAt(300, 100, 30), HOSTS)).toBeUndefined(); // 100…130 < 136
    expect(resolveActivationHost(barAt(300, 660, 30), HOSTS)).toBeUndefined(); // 660 > 656
  });

  it('端点相接算重叠（闭合区间，与 barHalfAt 的覆盖口径一致）', () => {
    expect(resolveActivationHost(barAt(300, 106, 30), HOSTS)).toBe('l1'); // 底 = 136 = 轴顶
    expect(resolveActivationHost(barAt(300, 656, 16), HOSTS)).toBe('l1'); // 顶 = 656 = 轴底
  });

  it('多条命中取传入序首个（调用方按 zOrder 降序排好 = 最上者胜）；空宿主表不绑定', () => {
    const both = [...HOSTS, { id: 'l0', axis: { x: 302, top: 0, bottom: 1000 } }];
    expect(resolveActivationHost(barAt(301, 300), both)).toBe('l1');
    expect(resolveActivationHost(barAt(640, 300), both)).toBe('l2');
    expect(resolveActivationHost(barAt(300, 300), [])).toBeUndefined();
  });
});

describe('activationBind（§5.1 绑定落库判定）', () => {
  const L1 = HOSTS[1]!;
  const at = (cx: number) => barAt(cx, 300);

  it('未绑定 → 命中：写入绑定并归中（x = 轴 − 半宽）', () => {
    expect(activationBind(at(303), L1, undefined)).toEqual({ lifelineId: 'l1', x: 295 });
  });

  it('已绑定在该宿主：已居中 → null（零写）；偏离中心 → 只归中、不动绑定', () => {
    expect(activationBind(at(300), L1, 'l1')).toBeNull();
    expect(activationBind(at(303), L1, 'l1')).toEqual({ x: 295 });
  });

  it('命中别的宿主 → 换绑并归中；无命中且当前有绑定 → 解绑（lifelineId: undefined 删键）', () => {
    expect(activationBind(at(300), L1, 'l9')).toEqual({ lifelineId: 'l1', x: 295 });
    expect(activationBind(at(380), undefined, 'l1')).toEqual({ lifelineId: undefined });
  });

  it('无命中且本就未绑定 → null（零写）', () => {
    expect(activationBind(at(380), undefined, undefined)).toBeNull();
  });
});

describe('activationDropRect（§7.1 创建落点）', () => {
  it('x 归中到轴、顶 = 按下高度、单击向下 80', () => {
    expect(activationDropRect(AXIS, 300, ACTIVATION_DEFAULT_DROP)).toEqual({
      x: 295,
      y: 300,
      width: 10,
      height: 80,
    });
  });

  it('拖拽跟手：高度 = 下拉量；向上拖 / 不足下限钳到 16', () => {
    expect(activationDropRect(AXIS, 300, 44)!.height).toBe(44);
    expect(activationDropRect(AXIS, 300, 10)!.height).toBe(ACTIVATION_MIN_HEIGHT);
    expect(activationDropRect(AXIS, 300, -30)!.height).toBe(ACTIVATION_MIN_HEIGHT);
  });

  it('底不出轴底：可用高度不足 80 时截到轴底', () => {
    expect(activationDropRect(AXIS, 600, 80)).toEqual({ x: 295, y: 600, width: 10, height: 56 });
  });

  it('按下点距轴底不足 16（钳 ≥ 16 与底不出轴底不可同时满足）→ null = 不建', () => {
    expect(activationDropRect(AXIS, 645, 80)).toBeNull(); // 余 11
    expect(activationDropRect(AXIS, 640, 80)).not.toBeNull(); // 余 16：恰可建
    expect(activationDropRect(AXIS, 700, 80)).toBeNull(); // 轴底以下
  });
});

describe('constrainActivationResize（§3.5 锁宽整形）', () => {
  const start: IRect = { x: 295, y: 300, width: 10, height: 80 }; // 底 = 380，中心 300

  it('s 手柄：顶不动、高度跟手；n 手柄：底不动（被拖边跟手）', () => {
    expect(
      constrainActivationResize(start, { x: 295, y: 300, width: 10, height: 140 }, 's'),
    ).toEqual({ x: 295, y: 300, width: 10, height: 140 });
    expect(
      constrainActivationResize(start, { x: 295, y: 260, width: 10, height: 120 }, 'n'),
    ).toEqual({ x: 295, y: 260, width: 10, height: 120 });
  });

  it('高度钳到下限 16（n 手柄压过底边也不翻面）', () => {
    expect(
      constrainActivationResize(start, { x: 295, y: 370, width: 10, height: 10 }, 'n'),
    ).toEqual({ x: 295, y: 364, width: 10, height: 16 });
  });

  it('横向手柄分量被丢弃：宽恒 10、x = 起点中心 − 半宽（吸附 / 指针把 next 拉偏也不动）', () => {
    for (const dir of ['e', 'w', 'ne', 'nw', 'se', 'sw'] as const) {
      expect(
        constrainActivationResize(start, { x: 310, y: 300, width: 40, height: 80 }, dir),
        dir,
      ).toEqual({ x: 295, y: 300, width: 10, height: 80 });
    }
    // 角手柄的纵向分量照常生效
    expect(
      constrainActivationResize(start, { x: 310, y: 300, width: 40, height: 120 }, 'se'),
    ).toEqual({ x: 295, y: 300, width: 10, height: 120 });
  });

  it('数据宽度异常的条：按起点中心归中并归一到恒宽', () => {
    const odd: IRect = { x: 296, y: 300, width: 8, height: 80 };
    expect(constrainActivationResize(odd, { x: 296, y: 300, width: 8, height: 100 }, 's')).toEqual({
      x: 295,
      y: 300,
      width: 10,
      height: 100,
    });
  });
});
