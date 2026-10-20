import { describe, expect, it } from 'vitest';
import { Container, Graphics } from 'pixi.js';
import { BaseWidgetVm } from '../base/baseWidgetVm';
import { SelectionVm } from '../platform/selection/selectionVm';
import { resizeRect, type HandleDir } from '../platform/rectEditor/resizeMath';
import type { IOnStateChangedInfo } from '../types';
import type { IWidgetData } from '../types';

/**
 * 渲染同步回归测试（docs/14 五规则）。
 * 守卫拖拽/缩放系列线上 bug：倍速漂移、框滞后、缩放平移、松手回弹。
 */

// ---------- 测试用具体 VM ----------

class TestWidgetVm extends BaseWidgetVm<IWidgetData> {
  renderCalls = 0;
  private g = new Graphics();

  constructor() {
    super({
      id: 't1',
      type: 'SHAPE',
      zOrder: 'a0',
      shapeType: 'rect',
      color: '#e8f0fb',
      borderStyle: 'solid',
      text: '',
      x: 0,
      y: 0,
      width: 100,
      height: 100,
    });
    this.root.addChild(this.g);
    this.redraw(100, 100);
  }

  /** 真实 VM 语义：render 以最新状态重绘图形（local bounds 随之更新） */
  override render(_prev: IWidgetData, next: IWidgetData): void {
    this.renderCalls++;
    this.redraw(next.width, next.height);
  }

  /** rect 型语义：state 几何 × scale（getBounds 为抽象契约，子类按数据语义实现） */
  override getBounds() {
    const b = this.state;
    return {
      x: this.root.x,
      y: this.root.y,
      width: b.width * this.root.scale.x,
      height: b.height * this.root.scale.y,
    };
  }

  private redraw(w: number, h: number): void {
    this.g.clear().rect(0, 0, w, h).fill({ color: 0xffffff });
  }

  hitTestPoint(): boolean {
    return false;
  }
}

const flushMicrotask = () => new Promise<void>((r) => setTimeout(r, 0));

// ---------- 规则 2：先渲染后广播 ----------

describe('规则 2：setState 广播发生在渲染之后（docs/14）', () => {
  it('onStateChanged$ 回调执行时 render 已完成且 getBounds 为新几何', async () => {
    const vm = new TestWidgetVm();
    const seen: Array<{ renderCallsAtEmit: number; boundsW: number }> = [];
    vm.onStateChanged$.subscribe(() => {
      seen.push({ renderCallsAtEmit: vm.renderCalls, boundsW: Math.round(vm.getBounds().width) });
    });
    vm.setState({ width: 300 });
    expect(vm.renderCalls).toBe(0); // 同步阶段未渲染（微任务批处理）
    await flushMicrotask();
    expect(vm.renderCalls).toBe(1);
    expect(seen).toHaveLength(1);
    // 回调执行时渲染已完成（renderCalls 先于 emit），且 bounds 是新值
    expect(seen[0]).toEqual({ renderCallsAtEmit: 1, boundsW: 300 });
  });

  it('同 tick 多次 setState 合并为一次广播，diff 字段合并', async () => {
    const vm = new TestWidgetVm();
    const events: IOnStateChangedInfo[] = [];
    vm.onStateChanged$.subscribe((e) => events.push(e));
    vm.setState({ width: 200 });
    vm.setState({ height: 150 });
    await flushMicrotask();
    expect(events).toHaveLength(1);
    expect(events[0]!.diff).toMatchObject({ width: 200, height: 150 });
  });

  it('同值 setState 不产生广播（写前 diff）', async () => {
    const vm = new TestWidgetVm();
    const events: IOnStateChangedInfo[] = [];
    vm.onStateChanged$.subscribe((e) => events.push(e));
    vm.setState({ width: 100 }); // 与初始值相同
    await flushMicrotask();
    expect(events).toHaveLength(0);
  });
});

// ---------- 规则 4：几何读取缩放感知 ----------

describe('规则 4：getBounds 缩放感知（docs/14）', () => {
  it('scale ≠ 1 时返回乘以 scale 的真实视觉尺寸', () => {
    const vm = new TestWidgetVm();
    vm.root.scale.set(2, 1.5);
    const b = vm.getBounds();
    expect(b.width).toBe(200); // 100 × 2
    expect(b.height).toBe(150); // 100 × 1.5
  });

  it('scale 回 1 后恢复基准尺寸（渲染归位语义）', () => {
    const vm = new TestWidgetVm();
    vm.root.scale.set(3, 3);
    vm.root.scale.set(1, 1);
    expect(vm.getBounds().width).toBe(100);
  });
});

// ---------- 规则 1：跟随框绝对定位 ----------

describe('规则 1：SelectionVm.moveTo 绝对定位（docs/14）', () => {
  it('重复 moveTo 为幂等设置，无累加（倍速漂移回归守卫）', () => {
    const parent = new Container();
    const vm = new SelectionVm(parent);
    // 模拟真实拖拽：选中显框后多次 pointermove，每次传「相对起点的全量 delta」
    // （moveTo 隐藏态跳过——2026-09-30：拖线身时曾把隐藏框拽出来现身）
    vm.showBounds([{ x: 100, y: 100, width: 50, height: 50 }]);
    vm.moveTo({ x: 100, y: 100, width: 50, height: 50 });
    vm.moveTo({ x: 107, y: 109, width: 50, height: 50 }); // +7,+9
    vm.moveTo({ x: 114, y: 118, width: 50, height: 50 }); // 再 +7,+9
    vm.moveTo({ x: 121, y: 127, width: 50, height: 50 }); // 再 +7,+9
    // 绝对定位：位置 = 最后一次设置值（不会变成 100+7×N 的复合累加）
    expect(vm.bounds).toEqual({ x: 121, y: 127, width: 50, height: 50 });
  });

  it('moveTo 后 bounds 立即可读；隐藏态跳过（bounds 不受污染）', () => {
    const parent = new Container();
    const vm = new SelectionVm(parent);
    vm.showBounds([{ x: 0, y: 0, width: 10, height: 10 }]);
    vm.moveTo({ x: 5, y: 5, width: 10, height: 10 });
    expect(vm.bounds).toEqual({ x: 5, y: 5, width: 10, height: 10 });
    vm.hide();
    vm.moveTo({ x: 99, y: 99, width: 10, height: 10 });
    expect(vm.bounds).toBeNull(); // 隐藏的框无位置语义
  });
});

// ---------- 规则 3：缩放数学无状态 ----------

const START = { x: 100, y: 100, width: 200, height: 100 };

describe('规则 3：resizeRect 无状态缩放数学（docs/14）', () => {
  it('东手柄 +40：宽度 +40，位置不动（缩放平移回归守卫）', () => {
    const r = resizeRect(START, 'e', { x: 340, y: 150 });
    expect(r).toEqual({ x: 100, y: 100, width: 240, height: 100 });
  });

  it('幂等：同一输入重复调用结果一致（复合漂移回归守卫）', () => {
    const world = { x: 340, y: 150 };
    const once = resizeRect(START, 'e', world);
    const twice = resizeRect(once, 'e', world); // 旧实现：以 once 为基准会再次 +40
    const thrice = resizeRect(twice, 'e', world);
    expect(twice).toEqual(once);
    expect(thrice).toEqual(once);
  });

  it('西手柄：左缘跟随光标、右缘不动', () => {
    const r = resizeRect(START, 'w', { x: 60, y: 150 });
    expect(r).toEqual({ x: 60, y: 100, width: 240, height: 100 });
  });

  it('北手柄：上缘跟随光标、下缘不动', () => {
    const r = resizeRect(START, 'n', { x: 150, y: 70 });
    expect(r).toEqual({ x: 100, y: 70, width: 200, height: 130 });
  });

  it('角手柄双轴生效（se）', () => {
    const r = resizeRect(START, 'se', { x: 350, y: 250 });
    expect(r).toEqual({ x: 100, y: 100, width: 250, height: 150 });
  });

  it('最小尺寸钳制', () => {
    const r = resizeRect(START, 'e', { x: 5, y: 150 });
    expect(r.width).toBe(8);
  });

  it('拖过头（反向越过对边）时钳制到最小尺寸', () => {
    const r = resizeRect(START, 'w', { x: 500, y: 150 }); // 向右拖西柄越过右缘
    expect(r.width).toBe(8);
    expect(r.x).toBe(292); // 右缘 300 - 8
  });

  it('八向手柄各自只影响对应轴（尺寸恒为正）', () => {
    const dirs: HandleDir[] = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];
    for (const dir of dirs) {
      const r = resizeRect(START, dir, { x: 350, y: 260 });
      expect(r.width).toBeGreaterThan(0);
      expect(r.height).toBeGreaterThan(0);
      // 'e' 只改宽度、's' 只改高度、'n' 只改 y/height、'w' 只改 x/width
      if (dir === 'e') expect(r).toMatchObject({ x: START.x, height: START.height });
      if (dir === 's') expect(r).toMatchObject({ x: START.x, y: START.y, width: START.width });
      if (dir === 'n') expect(r).toMatchObject({ x: START.x, width: START.width });
      if (dir === 'w') expect(r).toMatchObject({ y: START.y, height: START.height });
    }
  });
});
