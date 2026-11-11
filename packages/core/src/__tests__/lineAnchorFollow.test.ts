import { BehaviorSubject } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';
import { LineAnchorFollow } from '../widgets/line/lineAnchorFollow';

/**
 * 锚定跟随协作者守卫（2026-10-10 审计补测——此前零直接单测）：
 * - reattach 的 points 内容级同值跳过（samePoints）：几何命令急切 reattach 后
 *   onStateChanged$ 微任务相重入不得写幻影事务（undo 裂项家族的另一半守卫；
 *   急切路径时序由 alignCommand.test 锁定）
 * - previewFollow 手势期零模型写（docs/00 铁律 4）
 * - unbindFrom 删除解绑：只解被删端、points 不动
 * STRAIGHT 线型走「只替换锚定端点」分支，锚点数学 = anchorOf 边中点（可精确断言）。
 */

function statefulLineModel(initial: Record<string, unknown>) {
  const store = { data: { ...initial } };
  const calls: Array<Record<string, unknown>> = [];
  return {
    store,
    calls,
    model: {
      toJSON: () => store.data,
      update: vi.fn((patch: Record<string, unknown>) => {
        calls.push(patch);
        store.data = { ...store.data, ...patch };
      }),
    },
  };
}

describe('LineAnchorFollow.reattach 同值跳过（幂等守卫）', () => {
  function make() {
    const pen = statefulLineModel({
      lineType: 'STRAIGHT',
      startNodeId: 'N1',
      endNodeId: 'N2',
      startJoin: 'right',
      endJoin: 'left',
      points: [
        [0, 5],
        [100, 5],
      ],
    });
    const lineVm = { id: 'L1', type: 'LINE', previewRoute: vi.fn() };
    const follow = new LineAnchorFollow(
      { getModelById: (id: string) => (id === 'L1' ? pen.model : undefined) } as never,
      { getAllVms: () => [lineVm], getVmById: () => null } as never,
      { selected$: new BehaviorSubject<string[]>([]) } as never,
    );
    return { follow, pen };
  }

  it('bounds 变化 → update 写新 points；同 bounds 重入（微任务相）→ 内容级同值跳过不写', () => {
    const { follow, pen } = make();
    // N1 (0,0,10,10) 右边中点 = (10,5)：points[0] 0→10，与旧值不同 → 写
    follow.reattach('N1', { rect: { x: 0, y: 0, width: 10, height: 10 }, rotation: 0 });
    expect(pen.model.update).toHaveBeenCalledTimes(1);
    expect(pen.calls[0]).toEqual({
      points: [
        [10, 5],
        [100, 5],
      ],
    });

    // 同 bounds 再来一次（急切 reattach 后微任务相的重复调用）——points 已同值，跳过
    follow.reattach('N1', { rect: { x: 0, y: 0, width: 10, height: 10 }, rotation: 0 });
    expect(pen.model.update).toHaveBeenCalledTimes(1);

    // bounds 再变 → 又写（跳过不得吞掉真变化）
    follow.reattach('N1', { rect: { x: 20, y: 0, width: 10, height: 10 }, rotation: 0 });
    expect(pen.model.update).toHaveBeenCalledTimes(2);
    expect(pen.calls[1]).toEqual({
      points: [
        [30, 5],
        [100, 5],
      ],
    });
  });

  it('无关节点（非线端点）reattach 不触碰线模型', () => {
    const { follow, pen } = make();
    follow.reattach('OTHER', { rect: { x: 0, y: 0, width: 10, height: 10 }, rotation: 0 });
    expect(pen.model.update).not.toHaveBeenCalled();
  });
});

describe('LineAnchorFollow.previewFollow 手势期零模型写', () => {
  it('按预览 bounds 重算路由走视觉通道（previewRoute），不写模型', () => {
    const pen = statefulLineModel({
      lineType: 'STRAIGHT',
      startNodeId: 'N1',
      endNodeId: null,
      startJoin: 'right',
      endJoin: null,
      points: [
        [0, 5],
        [100, 5],
      ],
    });
    const lineVm = { id: 'L1', type: 'LINE', previewRoute: vi.fn() };
    const follow = new LineAnchorFollow(
      { getModelById: () => pen.model } as never,
      {
        getAllVms: () => [lineVm],
        getVmById: (id: string) =>
          id === 'N1'
            ? {
                getBounds: () => ({ x: 0, y: 0, width: 10, height: 10 }),
                getHostGeom: () => ({ rect: { x: 0, y: 0, width: 10, height: 10 }, rotation: 0 }),
                // 锚点单源经 vm.getAnchorPoint（specs/flowchart-closeout §7.1）——
                // 桩与基类默认实现同式（bbox 边插值 + θ）
                getAnchorPoint: (join: 'top' | 'right' | 'bottom' | 'left', t = 0.5) =>
                  join === 'right'
                    ? { x: 10, y: t * 10 }
                    : join === 'left'
                      ? { x: 0, y: t * 10 }
                      : join === 'top'
                        ? { x: t * 10, y: 0 }
                        : { x: t * 10, y: 10 },
              }
            : null,
      } as never,
      { selected$: new BehaviorSubject(['N1']) } as never,
    );
    follow.previewFollow();
    expect(lineVm.previewRoute).toHaveBeenCalledWith([
      { x: 10, y: 5 },
      { x: 100, y: 5 },
    ]);
    expect(pen.model.update).not.toHaveBeenCalled();
  });
});

describe('LineAnchorFollow.unbindFrom 删除解绑', () => {
  it('被删宿主端置 null（含 join），未删端与 points 不动；无关联线零写', () => {
    const bound = statefulLineModel({
      lineType: 'STRAIGHT',
      startNodeId: 'A',
      startJoin: 'right',
      endNodeId: 'B',
      endJoin: 'left',
      points: [
        [0, 5],
        [100, 5],
      ],
    });
    const untouched = statefulLineModel({
      lineType: 'STRAIGHT',
      startNodeId: 'C',
      startJoin: 'right',
      endNodeId: null,
      points: [
        [0, 0],
        [5, 5],
      ],
    });
    const models: Record<string, unknown> = { L1: bound.model, L2: untouched.model };
    const follow = new LineAnchorFollow(
      { getModelById: (id: string) => models[id] } as never,
      {
        getAllVms: () => [
          { id: 'L1', type: 'LINE' },
          { id: 'L2', type: 'LINE' },
        ],
        getVmById: () => null,
      } as never,
      { selected$: new BehaviorSubject<string[]>([]) } as never,
    );
    follow.unbindFrom(['A']);
    expect(bound.model.update).toHaveBeenCalledWith({ startNodeId: null, startJoin: null });
    // patch 不含 points——线端保持原位
    expect(Object.keys(bound.calls[0] as Record<string, unknown>)).not.toContain('points');
    expect(untouched.model.update).not.toHaveBeenCalled();
  });
});
