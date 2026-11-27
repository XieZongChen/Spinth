// @vitest-environment jsdom
import { BehaviorSubject } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';
import { Container } from 'pixi.js';
import { canQuickAdd, hitWidget } from '../widgets/line/lineHitTest';
import { LineAnchorIndicator } from '../widgets/line/lineAnchorIndicator';
import { LineHoverOverlay } from '../widgets/line/lineHoverOverlay';
import { LineQuickAdd } from '../widgets/line/lineQuickAdd';
import { anchorOf } from '../widgets/line/lineGeometry';
import type { IHostGeom, IRect } from '../common/geometry';

/**
 * 轴宿主的连线拾取与悬停反馈（specs/sequence-diagram §4.8，批次 2）：
 * hitWidget 容差环按到轴段的距离、isConnectionTarget 跳过、quick-add 资格单源、
 * 拉线悬停轴上出单点。
 * 夹具：生命线 (200,100,120,520)——轴 x = 260、轴段 y 136…620；普通形状
 * (100,100,80,60)。
 */

const LIFELINE: IRect = { x: 200, y: 100, width: 120, height: 520 };
const SHAPE: IRect = { x: 100, y: 100, width: 80, height: 60 };
const geomOf = (rect: IRect): IHostGeom => ({ rect, rotation: 0 });

function axisVm(id = 'l1') {
  const axis = { x: 260, top: 136, bottom: 620 };
  return {
    id,
    type: 'LIFELINE',
    getBounds: () => ({ ...LIFELINE }),
    getHostGeom: () => geomOf(LIFELINE),
    getRotation: () => 0,
    getAxisAnchor: () => axis,
    // 轴锚点（LifelineVm 同式：x 让出一个线端留隙）——四向连接点会聚在轴中段
    getAnchorPoint: (join: 'top' | 'right' | 'bottom' | 'left', t = 0.5) => ({
      x: axis.x + (join === 'right' ? -5 : join === 'left' ? 5 : 0),
      y: axis.top + (axis.bottom - axis.top) * t,
    }),
  };
}

function shapeVm(id = 's1', rect: IRect = SHAPE) {
  return {
    id,
    type: 'SHAPE',
    getBounds: () => ({ ...rect }),
    getHostGeom: () => geomOf(rect),
    getRotation: () => 0,
    // bbox 边插值（与基类默认实现同式）
    getAnchorPoint: (join: 'top' | 'right' | 'bottom' | 'left', t = 0.5) =>
      anchorOf(rect, join, 0, t),
  };
}

/** 桩引擎：严格命中 / 容差环两段各返回调用方给的清单 */
function engineOf(pointHits: unknown[], ringCands: unknown[]) {
  return {
    getVmByPoint: vi.fn(() => pointHits),
    getVmsInRect: vi.fn(() => ringCands),
  } as never;
}

const viewport = { vpScale$: { value: 1 } } as never;

describe('hitWidget：容差环对轴宿主按到轴段的距离', () => {
  it('贴包围盒外沿 8px 内按下不算命中——离轴还有 50 多 px，不该起消息', () => {
    const vm = axisVm();
    // (326, 300)：包围盒右边 320 外 6px（按包围盒算在环内），离轴 66
    expect(hitWidget(engineOf([], [vm]), viewport, { x: 326, y: 300 })).toBeNull();
    // (196, 300)：包围盒左边外 4px，离轴 64
    expect(hitWidget(engineOf([], [vm]), viewport, { x: 196, y: 300 })).toBeNull();
    // 头框右侧外 4px：头框是实心块，严格命中已覆盖；环不算
    expect(hitWidget(engineOf([], [vm]), viewport, { x: 324, y: 110 })).toBeNull();
  });

  it('轴旁 8px 内、轴段端点外 8px 内按环命中', () => {
    const vm = axisVm();
    expect(hitWidget(engineOf([], [vm]), viewport, { x: 264, y: 300 })).toEqual({
      id: 'l1',
      geom: geomOf(LIFELINE),
    });
    expect(hitWidget(engineOf([], [vm]), viewport, { x: 262, y: 624 })).toEqual({
      id: 'l1',
      geom: geomOf(LIFELINE),
    });
    // 轴段端点外 20px：不命中
    expect(hitWidget(engineOf([], [vm]), viewport, { x: 262, y: 640 })).toBeNull();
  });

  it('普通件的容差环不变（按包围盒）', () => {
    const vm = shapeVm();
    expect(hitWidget(engineOf([], [vm]), viewport, { x: 105, y: 103 })?.id).toBe('s1');
    expect(hitWidget(engineOf([], [vm]), viewport, { x: 192, y: 103 })).toBeNull();
  });

  it('严格命中优先于环：压在轴上直接返回，不走进环清单', () => {
    const vm = axisVm();
    const engine = engineOf([vm], [shapeVm()]);
    expect(hitWidget(engine, viewport, { x: 260, y: 300 })?.id).toBe('l1');
    expect(
      (engine as unknown as { getVmsInRect: ReturnType<typeof vi.fn> }).getVmsInRect,
    ).not.toHaveBeenCalled();
  });
});

describe('hitWidget：isConnectionTarget() === false 的件跳过继续取下层', () => {
  it('指针落在激活条上 → 取到下层的生命线（两段循环都跳过）', () => {
    const bar = {
      id: 'b1',
      type: 'ACTIVATION',
      getBounds: () => ({ x: 255, y: 300, width: 10, height: 100 }),
      getHostGeom: () => geomOf({ x: 255, y: 300, width: 10, height: 100 }),
      isConnectionTarget: () => false,
    };
    const life = axisVm();
    expect(hitWidget(engineOf([bar, life], []), viewport, { x: 260, y: 350 })?.id).toBe('l1');
    // 环里只剩不可作目标的件：不命中
    expect(hitWidget(engineOf([], [bar]), viewport, { x: 252, y: 350 })).toBeNull();
  });

  it('未实现探针的件照常作目标（缺省语义）', () => {
    const vm = shapeVm();
    expect(hitWidget(engineOf([vm], []), viewport, { x: 140, y: 130 })?.id).toBe('s1');
  });
});

describe('canQuickAdd：四向连接点与抓取的资格单源', () => {
  it('普通形状可；线 / 画笔不可（既有口径）', () => {
    const line = { id: 'x', type: 'LINE' };
    const pen = { id: 'x', type: 'PEN' };
    expect(canQuickAdd(shapeVm())).toBe(true);
    expect(canQuickAdd(line)).toBe(false);
    expect(canQuickAdd(pen)).toBe(false);
    expect(canQuickAdd(null)).toBe(false);
    expect(canQuickAdd(undefined)).toBe(false);
  });

  it('轴宿主不可——消息从轴上任意高度起线，四向连接点只会聚在轴中段', () => {
    expect(canQuickAdd(axisVm())).toBe(false);
  });

  it('isConnectionTarget() === false 不可', () => {
    expect(canQuickAdd({ ...shapeVm(), isConnectionTarget: () => false })).toBe(false);
    expect(canQuickAdd({ ...shapeVm(), isConnectionTarget: () => true })).toBe(true);
  });
});

describe('拉线悬停轴宿主：轴上指针高度出单点', () => {
  function makeOverlay(vm: unknown) {
    return new LineHoverOverlay(
      { optionLayer: new Container(), vpScale$: { value: 1 } } as never,
      { getVmById: () => vm } as never,
      { selected$: new BehaviorSubject<string[]>([]) } as never,
      { isSessionBusy: () => false, isEditing: () => false, isDrawing: () => false } as never,
    );
  }
  const cleanup = (o: LineHoverOverlay): void =>
    (o as unknown as { indicator: LineAnchorIndicator }).indicator.destroy();

  it('showDrawFeedback：轴宿主 + 指针位置 → 单点落在轴上（x = 轴、y = 指针高度）', () => {
    const o = makeOverlay(axisVm());
    o.showDrawFeedback('l1', geomOf(LIFELINE), 0, { x: 300, y: 300 });
    expect(o.anchorHoverDebug).toEqual([{ x: 260, y: 300 }]);
    expect(o.anchorActiveDebug).toBe(0);
    cleanup(o);
  });

  it('showDrawFeedback：轴外高度钳到轴段端点', () => {
    const o = makeOverlay(axisVm());
    o.showDrawFeedback('l1', geomOf(LIFELINE), 0, { x: 300, y: 900 });
    expect(o.anchorHoverDebug).toEqual([{ x: 260, y: 620 }]);
    cleanup(o);
  });

  it('showDrawFeedback：普通件照旧四向轮廓锚点（第三参之后的实参不参与）', () => {
    const o = makeOverlay(shapeVm());
    o.showDrawFeedback('s1', geomOf(SHAPE), 2, { x: 300, y: 300 });
    expect(o.anchorHoverDebug).toEqual([
      { x: 140, y: 100 },
      { x: 180, y: 130 },
      { x: 140, y: 160 },
      { x: 100, y: 130 },
    ]);
    expect(o.anchorActiveDebug).toBe(2);
    cleanup(o);
  });

  it('hideDrawFeedback 清快照', () => {
    const o = makeOverlay(axisVm());
    o.showDrawFeedback('l1', geomOf(LIFELINE), 0, { x: 300, y: 300 });
    o.hideDrawFeedback();
    expect(o.anchorHoverDebug).toBeNull();
    cleanup(o);
  });
});

describe('LineAnchorIndicator.showPoint', () => {
  it('单点显示 / 隐藏', () => {
    const indicator = new LineAnchorIndicator(new Container());
    expect(indicator.visible).toBe(false);
    indicator.showPoint({ x: 260, y: 378 });
    expect(indicator.visible).toBe(true);
    indicator.hide();
    expect(indicator.visible).toBe(false);
    indicator.destroy();
  });
});

describe('maybeAnchorGrab：选中轴宿主时点击连接点位置不触发 quick-add', () => {
  function makeQuickAdd(vm: unknown) {
    const beginSession = vi.fn();
    const qa = new LineQuickAdd(
      {
        vpScale$: { value: 1 },
        worldToClient: (p: { x: number; y: number }) => ({ ...p }),
      } as never,
      { genInitialOrder: () => 'a0', add: vi.fn() } as never,
      { getVmById: () => vm } as never,
      { selected$: new BehaviorSubject<string[]>(['l1']) } as never,
      {} as never,
      {
        beginSession,
        endSession: vi.fn(),
        throttledMove: vi.fn(),
        settle: vi.fn(),
        hideOverlays: vi.fn(),
        getDefaultStrokeWidth: () => 2,
        getDefaultLineType: () => 'ELBOWED',
        getStartAnchor: () => null,
      } as never,
    );
    return { qa, beginSession };
  }

  it('轴宿主：指针压在连接点抓取半径内也返回 false、不建会话', () => {
    const { qa, beginSession } = makeQuickAdd(axisVm());
    // 右侧连接点锚点 (255, 378) 的外移点 (279, 378) 上——普通件在这个位置会触发
    expect(qa.maybeAnchorGrab({ x: 280, y: 379 })).toBe(false);
    expect(beginSession).not.toHaveBeenCalled();
  });

  it('普通形状：外移点抓取半径内照常触发', () => {
    const { qa, beginSession } = makeQuickAdd(shapeVm());
    // 右侧连接点 (180,130) 的外移点 (204,130) 附近
    expect(qa.maybeAnchorGrab({ x: 206, y: 131 })).toBe(true);
    expect(beginSession).toHaveBeenCalledTimes(1);
    // 收掉手势期 window 监听（不污染后续用例）
    window.dispatchEvent(new PointerEvent('pointerup', { clientX: 206, clientY: 131 }));
  });
});
