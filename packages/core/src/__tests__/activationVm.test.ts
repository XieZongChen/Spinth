// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { Point } from 'pixi.js';
import { ActivationVm } from '../widgets/sequence/activationVm';
import { ACTIVATION_HIT_PAD, ACTIVATION_WIDTH } from '../widgets/sequence/sequenceOps';
import type { IBaseModel, ActivationData } from '../types';
import type { IRect } from '../common/geometry';

/**
 * 激活条视图层（specs/sequence-diagram §3.5 / §3.6 / §4.1，批次 3）：探针返回值、
 * 预览感知的世界矩形（首帧渲染前 / 拖拽 / 缩放预览中都正确——barsOf 依赖它）、
 * 点击判定外扩、锁宽整形接线。夹具条 x 295、y 300、10×80（轴 x = 300）。
 */

function fakeModel(initial: Record<string, unknown>) {
  const model = {
    id: initial.id,
    yData: {
      get: (key: string) => initial[key],
      observeDeep: vi.fn(),
      unobserveDeep: vi.fn(),
    },
    update: vi.fn((patch: Record<string, unknown>) => {
      Object.assign(initial, patch);
    }),
    updateRect: vi.fn(),
    toJSON: () => ({ ...initial }),
  };
  return model as unknown as IBaseModel<ActivationData & IRect>;
}

function make(over: Record<string, unknown> = {}) {
  const model = fakeModel({
    id: 'a1',
    type: 'ACTIVATION',
    zOrder: 'a0',
    x: 295,
    y: 300,
    width: ACTIVATION_WIDTH,
    height: 80,
    ...over,
  });
  const vm = new ActivationVm();
  vm.setModel(model);
  return { vm, model };
}

const DATA_RECT = { x: 295, y: 300, width: 10, height: 80 };

describe('ActivationVm：世界矩形预览感知', () => {
  it('首帧渲染前（粘贴收尾事务里就会被人问）= 数据矩形，不是原点', () => {
    const { vm } = make();
    expect(vm.getBounds()).toEqual(DATA_RECT);
    expect(vm.getLocalRect()).toEqual(DATA_RECT);
  });

  it('渲染后 = 数据矩形；拖拽预览随 root 平移；全量渲染归位', () => {
    const { vm } = make();
    vm.flushUpdate();
    expect(vm.getBounds()).toEqual(DATA_RECT);
    vm.applyDragPreview(DATA_RECT, 30, -40);
    expect(vm.getBounds()).toEqual({ x: 325, y: 260, width: 10, height: 80 });
    vm.render(vm.state, vm.state);
    expect(vm.getBounds()).toEqual(DATA_RECT);
  });

  it('缩放预览：矩形 = 整形后的目标（scale 只作用于高度）', () => {
    const { vm } = make();
    vm.flushUpdate();
    vm.applyResizePreview(DATA_RECT, { x: 295, y: 300, width: 10, height: 140 });
    expect(vm.getBounds()).toEqual({ x: 295, y: 300, width: 10, height: 140 });
  });
});

describe('ActivationVm：探针', () => {
  it('不作连线目标、豁免避障、只沿纵轴缩放', () => {
    const { vm } = make();
    expect(vm.isConnectionTarget()).toBe(false);
    expect(vm.isRouteObstacle()).toBe(false);
    expect(vm.resizeAxis()).toBe('v');
  });

  it('anchorFollowHosts：已绑定 → [lifelineId]；未绑定 → []', () => {
    expect(make({ lifelineId: 'l1' }).vm.anchorFollowHosts()).toEqual(['l1']);
    expect(make().vm.anchorFollowHosts()).toEqual([]);
  });

  it('绑定读模型不读状态：事务刚写入、vm 状态还是合批旧值时探针已给出新宿主', () => {
    const { vm, model } = make({ lifelineId: 'l1' });
    vm.flushUpdate();
    model.update({ lifelineId: 'l2' }); // 微任务未跑：vm.state.lifelineId 仍是 'l1'
    expect(vm.state.lifelineId).toBe('l1');
    expect(vm.anchorFollowHosts()).toEqual(['l2']);
    model.update({ lifelineId: undefined });
    expect(vm.anchorFollowHosts()).toEqual([]);
  });

  it('constrainResize 接纯函数：se 手柄只留高度变化', () => {
    const { vm } = make();
    expect(
      vm.constrainResize!(DATA_RECT, { x: 310, y: 300, width: 40, height: 120 }, 'se'),
    ).toEqual({ x: 295, y: 300, width: 10, height: 120 });
  });
});

describe('ActivationVm：命中与配色', () => {
  it('条身命中；外扩 2 世界 px 内仍命中，再远不命中', () => {
    const { vm } = make();
    vm.flushUpdate();
    const inside = new Point(300, 340);
    const nearEdge = new Point(295 - ACTIVATION_HIT_PAD + 0.5, 340);
    const far = new Point(295 - ACTIVATION_HIT_PAD - 0.5, 340);
    expect(vm.hitTestPoint(inside)).toBe(true);
    expect(vm.hitTestPoint(nearEdge)).toBe(true);
    expect(vm.hitTestPoint(far)).toBe(false);
  });
});
