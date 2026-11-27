// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { LineVm } from '../widgets/line/lineVm';
import type { IAxisAnchor, IBaseModel, ISequenceLookup, LineData } from '../types';
import type { IRect } from '../common/geometry';

/**
 * LineVm 的轴消息语义（specs/sequence-diagram §4.5，批次 2）：isAxisMessage 探针
 * （render 时按锚定字段重算）、拖线身只动 y 的预览、松手一次写
 * { startPort, endPort, points }。普通线的四覆写仍是空操作。
 * 夹具：消息 M 从轴 A（x=260，y 136…620）到轴 B（x=640，y 136…420），
 * A 侧 y = 378（port 0.5）、B 侧 y = 278（port 0.5）。
 */

const AX: IAxisAnchor = { x: 260, top: 136, bottom: 620 };
const BX: IAxisAnchor = { x: 640, top: 136, bottom: 420 };
const axisOf = (id: string | null): IAxisAnchor | null =>
  id === 'l1' ? AX : id === 'l2' ? BX : null;

function fakeModel(initial: Record<string, unknown>) {
  const patchLog: Array<Record<string, unknown>> = [];
  let onChange: (() => void) | null = null;
  const model = {
    id: initial.id,
    yData: {
      observeDeep: (fn: (e: unknown, tr: { local: boolean }) => void) => {
        onChange = () => fn(undefined, { local: true });
      },
      unobserveDeep: () => {
        onChange = null;
      },
    },
    update: vi.fn((patch: Record<string, unknown>) => {
      patchLog.push(patch);
      Object.assign(initial, patch);
      onChange?.();
    }),
    updateRect: vi.fn(),
    toJSON: () => initial,
    patchLog,
  };
  return model as unknown as IBaseModel<LineData & IRect> & {
    patchLog: Array<Record<string, unknown>>;
  };
}

function make(
  over: Record<string, unknown> = {},
  lookup: ((id: string | null) => IAxisAnchor | null) | null = axisOf,
) {
  const vm = new LineVm(lookup ? { axisOf: lookup } : null);
  const model = fakeModel({
    id: 'm1',
    type: 'LINE',
    zOrder: 'a0',
    startNodeId: 'l1',
    endNodeId: 'l2',
    startJoin: 'right',
    endJoin: 'left',
    startPort: 0.5,
    endPort: 0.5,
    lineType: 'STRAIGHT',
    pinned: false,
    points: [
      [255, 378],
      [645, 278],
    ],
    color: '#4b5563',
    strokeWidth: 2,
    startArrow: 'none',
    endArrow: 'solid',
    dashed: false,
    text: '',
    textRatio: 0.5,
    x: 0,
    y: 0,
    width: 0,
    height: 0,
    ...over,
  });
  vm.setModel(model);
  vm.flushUpdate();
  return { vm, model, lookup };
}

describe('LineVm.isAxisMessage（render 时按锚定字段重算并缓存）', () => {
  it('两端锚在两条轴上的直线 = 轴消息；普通线 / 未注入查询 = 不是', () => {
    expect(make().vm.isAxisMessage()).toBe(true);
    expect(make({ endNodeId: 's1' }).vm.isAxisMessage()).toBe(false);
    expect(make({}, null).vm.isAxisMessage()).toBe(false);
  });

  it('锚定字段变化后随 render 重算（切型 / 解绑）', () => {
    const { vm, model } = make();
    model.update({ lineType: 'ELBOWED' }); // 折线跨轴不是轴消息
    vm.flushUpdate();
    expect(vm.isAxisMessage()).toBe(false);
    model.update({ endNodeId: 'l1', startJoin: 'right', endJoin: 'right' });
    vm.flushUpdate();
    expect(vm.isAxisMessage()).toBe(true); // 自消息（同轴折线自环）同样是轴消息
  });
});

describe('LineVm 轴消息的拖拽预览与落库', () => {
  it('预览：root 只纵向平移（绝对定位），getBounds 跟随；普通线仍空操作', () => {
    const { vm } = make();
    vm.applyDragPreview(vm.getLocalRect(), 40, 60);
    expect({ x: vm.root.x, y: vm.root.y }).toEqual({ x: 0, y: 60 });
    expect(vm.getBounds().y).toBe(278 + 60);
    const plain = make({ endNodeId: 's1' });
    plain.vm.applyDragPreview(plain.vm.getLocalRect(), 40, 60);
    expect({ x: plain.vm.root.x, y: plain.vm.root.y }).toEqual({ x: 0, y: 0 });
  });

  it('落库：一次 update 写 { startPort, endPort, points }——端口同移、points 整体加 dy', () => {
    const { vm, model } = make();
    vm.commitDrag(vm.getLocalRect(), 40, 60);
    expect(model.update).toHaveBeenCalledTimes(1);
    const [patch] = model.patchLog;
    expect(patch).toEqual({
      startPort: 0.624,
      endPort: 0.7113,
      points: [
        [255, 438],
        [645, 338],
      ],
    });
  });

  it('拖出轴底被钳住：dy 取两端都留在轴内的最大值（普通线不写）', () => {
    const { vm, model } = make();
    vm.commitDrag(vm.getLocalRect(), 0, 200);
    expect(model.patchLog[0]).toEqual({
      startPort: 0.7934,
      endPort: 1,
      points: [
        [255, 520],
        [645, 420],
      ],
    });
    const plain = make({ endNodeId: 's1' });
    plain.vm.commitDrag(plain.vm.getLocalRect(), 40, 60);
    expect(plain.model.update).not.toHaveBeenCalled();
  });

  it('dy = 0 零写入（左右微移对轴消息无效）', () => {
    const { vm, model } = make();
    vm.commitDrag(vm.getLocalRect(), 40, 0);
    expect(model.update).not.toHaveBeenCalled();
  });

  it('自消息：两端端口同移、环的 points 整体平移', () => {
    const { vm, model } = make({
      lineType: 'ELBOWED',
      endNodeId: 'l1',
      endPort: 0.8,
      points: [
        [255, 378],
        [225, 378],
        [225, 523.2],
        [255, 523.2],
      ],
    });
    vm.commitDrag(vm.getLocalRect(), 0, -24);
    expect(model.patchLog[0]).toEqual({
      startPort: 0.4504,
      endPort: 0.7504,
      points: [
        [255, 354],
        [225, 354],
        [225, 499.2],
        [255, 499.2],
      ],
    });
  });
});

describe('LineVm 构造注入的只读查询', () => {
  it('未注入查询（缺省）：isAxisMessage 恒 false，不抛错', () => {
    const vm = new LineVm();
    expect(vm.isAxisMessage()).toBe(false);
  });

  it('lookup 类型满足 ISequenceLookup 的轴查询面', () => {
    const lookup: Pick<ISequenceLookup, 'axisOf'> = { axisOf };
    expect(lookup.axisOf('l1')).toEqual(AX);
  });
});
