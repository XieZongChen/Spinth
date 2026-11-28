import { BehaviorSubject } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';
import { LineAnchorFollow } from '../widgets/line/lineAnchorFollow';
import { axisAnchorPoint, axisAnchorWithInset, axisPortFor } from '../widgets/line/lineAxisAnchor';
import type { IAxisAnchor } from '../types/base';
import type { IRect } from '../common/geometry';
import type { JoinDir } from '../widgets/line/lineMathTypes';

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

describe('LineAnchorFollow 同边多线单点（2026-11-15 B；原 §7.3/G-05 自动错开已取消）', () => {
  const GEOM = { rect: { x: 0, y: 0, width: 10, height: 10 }, rotation: 0 };

  function makeFollow(lines: Array<{ id: string; data: Record<string, unknown> }>, geom = GEOM) {
    const w = geom.rect.width;
    const h = geom.rect.height;
    const models = new Map(
      lines.map((l) => [
        l.id,
        statefulLineModel({ id: l.id, lineType: 'STRAIGHT', startJoin: 'right', ...l.data }),
      ]),
    );
    const lineVms = lines.map((l) => ({
      id: l.id,
      type: 'LINE',
      previewRoute: vi.fn(),
    }));
    const follow = new LineAnchorFollow(
      { getModelById: (id: string) => models.get(id)?.model } as never,
      {
        getAllVms: () => lineVms,
        getVmById: (id: string) =>
          id === 'N1'
            ? {
                getHostGeom: () => geom,
                getAnchorPoint: (join: 'top' | 'right' | 'bottom' | 'left', t = 0.5) =>
                  join === 'right'
                    ? { x: w, y: t * h }
                    : join === 'left'
                      ? { x: 0, y: t * h }
                      : join === 'top'
                        ? { x: t * w, y: 0 }
                        : { x: t * w, y: h },
              }
            : null,
      } as never,
      { selected$: new BehaviorSubject<string[]>([]) } as never,
    );
    return { follow, models };
  }

  const baseLine = (id: string, extra: Record<string, unknown> = {}) => ({
    id,
    data: {
      startNodeId: 'N1',
      endNodeId: null,
      endJoin: null,
      points: [
        [10, 5],
        [100, 5],
      ],
      ...extra,
    },
  });

  it('三条同边线（port 未写）：全部 0.5 单点引出，全部零写', () => {
    const { follow, models } = makeFollow([baseLine('LA'), baseLine('LB'), baseLine('LC')]);
    follow.reattach('N1', GEOM);
    // 2026-11-15 B：自动错开取消，三条线都留在 (10,5) 中点 → samePoints 全跳过
    for (const id of ['LA', 'LB', 'LC']) {
      expect(models.get(id)!.model.update).not.toHaveBeenCalled();
    }
  });

  it('显式 port 优先：固定端 0.9 照写，其余两线仍 0.5 零写', () => {
    const { follow, models } = makeFollow([
      baseLine('LA', { startPort: 0.9 }),
      baseLine('LB'),
      baseLine('LC'),
    ]);
    follow.reattach('N1', GEOM);
    expect(models.get('LA')!.calls.at(-1)).toEqual({
      points: [
        [10, 9],
        [100, 5],
      ],
    });
    expect(models.get('LB')!.model.update).not.toHaveBeenCalled();
    expect(models.get('LC')!.model.update).not.toHaveBeenCalled();
  });

  it('n=1 恒中点：单线不写 port，0.5 零写', () => {
    const { follow, models } = makeFollow([baseLine('LA')]);
    follow.reattach('N1', GEOM);
    // 已在 (10,5) 中点 → samePoints 跳过，零写入（幂等守卫继续有效）
    expect(models.get('LA')!.model.update).not.toHaveBeenCalled();
  });

  it('混合端：出发线与进入线同锚 N1 right → 都 0.5（不再自动错开）', () => {
    const { follow, models } = makeFollow([
      baseLine('LA'), // start 端锚 N1 right
      {
        id: 'LB', // end 端锚 N1 right（同边反向——按端拆组会各取 0.5 重叠）
        data: {
          startNodeId: null,
          startJoin: null,
          endNodeId: 'N1',
          endJoin: 'right',
          points: [
            [100, 5],
            [10, 5],
          ],
        },
      },
    ]);
    follow.reattach('N1', GEOM);
    // 两条都在中点 (10,5) → samePoints 全跳过（B：单点引出）
    expect(models.get('LA')!.model.update).not.toHaveBeenCalled();
    expect(models.get('LB')!.model.update).not.toHaveBeenCalled();
  });

  it('同边自环整条豁免错开（specs/flowchart-closeout §7.5 二轮返工）：两端恒 0.5', () => {
    const { follow, models } = makeFollow([
      {
        id: 'LA',
        data: {
          startNodeId: 'N1',
          endNodeId: 'N1',
          endJoin: 'right',
          points: [
            [10, 5],
            [10, 5],
          ],
        },
      },
    ]);
    follow.reattach('N1', GEOM);
    // 两端恒 0.5 → 锚点重合 (10,5) → STRAIGHT 替换后与原 points 同值 →
    // samePoints 跳过零写入（ELBOWED 下 |Δ|<8 → routeSelfLoop 按目标跨度
    // max(80, 边长/2) 展开——跨度断言见 lineRoute.test）
    expect(models.get('LA')!.model.update).not.toHaveBeenCalled();
  });

  it('自环 + 普通线同边：两者都 0.5，互不挤位（B 单点）', () => {
    const { follow, models } = makeFollow([
      baseLine('LA'), // 普通线 start 端锚 N1 right
      {
        id: 'LZ', // 同边自环（right/right）
        data: {
          startNodeId: 'N1',
          endNodeId: 'N1',
          endJoin: 'right',
          points: [
            [10, 5],
            [10, 5],
          ],
        },
      },
    ]);
    follow.reattach('N1', GEOM);
    // 普通线固定 0.5、自环两端 0.5，均在中点 → 零写
    expect(models.get('LA')!.model.update).not.toHaveBeenCalled();
    expect(models.get('LZ')!.model.update).not.toHaveBeenCalled();
  });

  it('同边双自环嵌套（§7.5 三轮）：id 序内环 80 / 外环 120 + 车道分层不重叠', () => {
    const geom = { rect: { x: 0, y: 0, width: 120, height: 80 }, rotation: 0 };
    const loop = (id: string) => ({
      id,
      data: {
        startNodeId: 'N1',
        endNodeId: 'N1',
        startJoin: 'top',
        endJoin: 'top',
        lineType: 'ELBOWED',
        points: [
          [60, 0],
          [60, 0],
        ],
      },
    });
    const { follow, models } = makeFollow([loop('LA'), loop('LB')], geom);
    follow.reattach('N1', geom);
    const spanOf = (pts: Array<[number, number]>) =>
      Math.max(...pts.map((p) => p[0])) - Math.min(...pts.map((p) => p[0]));
    const pa = models.get('LA')!.calls.at(-1)!.points as Array<[number, number]>;
    const pb = models.get('LB')!.calls.at(-1)!.points as Array<[number, number]>;
    // LA（spanScale 1）：跨度 80（局部 20..100）、车道 y = -30
    expect(spanOf(pa)).toBeCloseTo(80, 0);
    expect(Math.min(...pa.map((p) => p[1]))).toBeCloseTo(-30, 0);
    // LB（spanScale 2）：跨度 min(160, 120) = 120（钳边长）、车道 y = -60——
    // 内环嵌外环，横段不同层不重叠（此前两条同边自环完全重叠除非用户手挪）
    expect(spanOf(pb)).toBeCloseTo(120, 0);
    expect(Math.min(...pb.map((p) => p[1]))).toBeCloseTo(-60, 0);
    // 全段正交
    for (const pts of [pa, pb]) {
      for (let i = 0; i + 1 < pts.length; i++) {
        expect(
          Math.abs(pts[i]![0] - pts[i + 1]![0]) < 0.5 ||
            Math.abs(pts[i]![1] - pts[i + 1]![1]) < 0.5,
        ).toBe(true);
      }
    }
  });
});

describe('LineAnchorFollow 加删线全量重排（settle/unbind 触发）', () => {
  const GEOM = { rect: { x: 0, y: 0, width: 10, height: 10 }, rotation: 0 };

  function makeFollow(lines: Array<{ id: string; data: Record<string, unknown> }>) {
    const models = new Map(
      lines.map((l) => [
        l.id,
        statefulLineModel({ id: l.id, lineType: 'STRAIGHT', startJoin: 'right', ...l.data }),
      ]),
    );
    const lineVms = lines.map((l) => ({ id: l.id, type: 'LINE', previewRoute: vi.fn() }));
    const follow = new LineAnchorFollow(
      { getModelById: (id: string) => models.get(id)?.model } as never,
      {
        getAllVms: () => lineVms,
        getVmById: (id: string) =>
          id === 'N1'
            ? {
                getHostGeom: () => GEOM,
                getAnchorPoint: (join: 'top' | 'right' | 'bottom' | 'left', t = 0.5) =>
                  join === 'right' ? { x: 10, y: t * 10 } : { x: 0, y: t * 10 },
              }
            : null,
      } as never,
      { selected$: new BehaviorSubject<string[]>([]) } as never,
    );
    return { follow, models, lineVms };
  }

  const anchored = (id: string) => ({
    id,
    data: {
      startNodeId: 'N1',
      endNodeId: null,
      endJoin: null,
      points: [
        [10, 5],
        [100, 5],
      ],
    },
  });

  it('reattachAll（拉线落定）：三条同边线都在 0.5 中点 → 全部 samePoints 零写', () => {
    const { follow, models } = makeFollow([anchored('LA'), anchored('LB'), anchored('LC')]);
    follow.reattachAll();
    for (const id of ['LA', 'LB', 'LC']) {
      expect(models.get(id)!.model.update).not.toHaveBeenCalled();
    }
  });

  it('删线（unbindFrom）：余线仍 0.5 中点 → 零写（不再重均分）', () => {
    const built = makeFollow([anchored('LA'), anchored('LB'), anchored('LC')]);
    // LC 已删：vm 枚举不再含它（unbindFrom 收到的 ids 里有它）
    built.lineVms.splice(2, 1);
    built.follow.unbindFrom(['LC']);
    expect(built.models.get('LA')!.model.update).not.toHaveBeenCalled();
    expect(built.models.get('LB')!.model.update).not.toHaveBeenCalled();
  });

  it('删形状（解绑线）：patched 线零 points 写（保持原位），组未变的同边线零写', () => {
    const { follow, models } = makeFollow([
      // LA/LB 预置在中点（B 单点口径）——组未变 → 零写
      {
        id: 'LA',
        data: {
          startNodeId: 'N1',
          endNodeId: null,
          endJoin: null,
          points: [
            [10, 5],
            [100, 5],
          ],
        },
      },
      {
        id: 'LB',
        data: {
          startNodeId: 'N1',
          endNodeId: null,
          endJoin: null,
          points: [
            [10, 5],
            [100, 5],
          ],
        },
      },
      {
        id: 'LD',
        data: {
          startNodeId: 'NX',
          startJoin: 'right',
          endNodeId: 'NZ',
          endJoin: 'left',
          points: [
            [0, 5],
            [50, 5],
          ],
        },
      },
    ]);
    follow.unbindFrom(['NX']);
    const ld = models.get('LD')!;
    expect(ld.model.update).toHaveBeenCalledTimes(1);
    expect(ld.calls[0]).toEqual({ startNodeId: null, startJoin: null }); // 无 points
    // LA/LB 都在 0.5 中点 → samePoints 跳过零写入
    expect(models.get('LA')!.model.update).not.toHaveBeenCalled();
    expect(models.get('LB')!.model.update).not.toHaveBeenCalled();
  });
});

describe('LineAnchorFollow.rerouteLine 切回 ELBOWED（与锚定跟随同一路由单源）', () => {
  // 节点 120×80，锚点数学 = bbox 边插值（t 沿边滑动）。自环旧实现直接调 routeElbow：
  // 同边两端锚点重合 → 返回两个重合点，环被毁；嵌套跨度与 pinned 语义也与之脱节
  const geomOf = (x: number) => ({ rect: { x, y: 0, width: 120, height: 80 }, rotation: 0 });
  const N1 = geomOf(0);
  const N2 = geomOf(300);
  const anchorOfGeom = (g: typeof N1, join: string, t = 0.5) => {
    const { x, y, width: w, height: h } = g.rect;
    return join === 'right'
      ? { x: x + w, y: y + t * h }
      : join === 'left'
        ? { x, y: y + t * h }
        : join === 'top'
          ? { x: x + t * w, y }
          : { x: x + t * w, y: y + h };
  };

  function makeFollow(lines: Array<{ id: string; data: Record<string, unknown> }>) {
    const models = new Map(
      lines.map((l) => [
        l.id,
        statefulLineModel({ id: l.id, lineType: 'ELBOWED', pinned: false, ...l.data }),
      ]),
    );
    const nodes = [
      {
        id: 'N1',
        type: 'SHAPE',
        getHostGeom: () => N1,
        getAnchorPoint: (j: string, t = 0.5) => anchorOfGeom(N1, j, t),
      },
      {
        id: 'N2',
        type: 'SHAPE',
        getHostGeom: () => N2,
        getAnchorPoint: (j: string, t = 0.5) => anchorOfGeom(N2, j, t),
      },
    ];
    const lineVms = lines.map((l) => ({ id: l.id, type: 'LINE', previewRoute: vi.fn() }));
    const follow = new LineAnchorFollow(
      { getModelById: (id: string) => models.get(id)?.model } as never,
      {
        getAllVms: () => [...nodes, ...lineVms],
        // rerouteLine 的守卫按 id 取线 vm；节点 vm 供锚点求值
        getVmById: (id: string) =>
          nodes.find((n) => n.id === id) ?? lineVms.find((v) => v.id === id) ?? null,
        // 避障收集走空间索引；两端节点本就被排除——留空即无第三方障碍
        getVmsInRect: () => [],
      } as never,
      { selected$: new BehaviorSubject<string[]>([]) } as never,
    );
    const lastPatch = (id: string) => models.get(id)!.calls.at(-1) as Record<string, unknown>;
    return { follow, models, lastPatch };
  }
  const pointsOf = (patch: Record<string, unknown>) => patch.points as Array<[number, number]>;
  const spanX = (pts: Array<[number, number]>) =>
    Math.max(...pts.map((p) => p[0])) - Math.min(...pts.map((p) => p[0]));
  /** 两端恒 0.5 的同边自环被旧实现毁掉后的落库形态：两个重合点 */
  const collapsed = {
    startNodeId: 'N1',
    endNodeId: 'N1',
    startJoin: 'top',
    endJoin: 'top',
    points: [
      [60, 0],
      [60, 0],
    ],
  };

  it('同边自环：重路由回 4 点正交环（跨度 80、车道在边外侧），不再落两个重合点', () => {
    const { follow, lastPatch } = makeFollow([{ id: 'LA', data: collapsed }]);
    follow.rerouteLine('LA');
    const pts = pointsOf(lastPatch('LA'));
    expect(pts).toHaveLength(4);
    expect(spanX(pts)).toBeCloseTo(80, 5); // min(max(80, 120×0.5), 120)
    expect(Math.min(...pts.map((p) => p[1]))).toBeCloseTo(-30, 5); // 车道深度 NODE_MARGIN
    // 全段轴对齐
    for (let i = 0; i + 1 < pts.length; i++) {
      expect(
        Math.abs(pts[i]![0] - pts[i + 1]![0]) < 1e-6 ||
          Math.abs(pts[i]![1] - pts[i + 1]![1]) < 1e-6,
      ).toBe(true);
    }
  });

  it('同边双自环嵌套：外环跨度 120、车道 −60（spanScale 与锚定跟随同源）', () => {
    const { follow, lastPatch } = makeFollow([
      { id: 'LA', data: collapsed },
      { id: 'LB', data: collapsed },
    ]);
    follow.rerouteLine('LB');
    const pts = pointsOf(lastPatch('LB'));
    expect(pts).toHaveLength(4);
    expect(spanX(pts)).toBeCloseTo(120, 5); // 80×2 钳到边长 120
    expect(Math.min(...pts.map((p) => p[1]))).toBeCloseTo(-60, 5);
  });

  it('pinned 自环：切回 ELBOWED = 自动路由接管——环恢复且 pinned 复位', () => {
    const { follow, lastPatch } = makeFollow([{ id: 'LA', data: { ...collapsed, pinned: true } }]);
    follow.rerouteLine('LA');
    expect(pointsOf(lastPatch('LA'))).toHaveLength(4);
    expect(lastPatch('LA').pinned).toBe(false);
  });

  it('普通两节点线：与既有行为一致——锚定端点按当前宿主几何重贴', () => {
    const { follow, lastPatch } = makeFollow([
      {
        id: 'L1',
        data: {
          startNodeId: 'N1',
          startJoin: 'right',
          endNodeId: 'N2',
          endJoin: 'left',
          points: [
            [100, 40], // STRAIGHT 期间漂移的旧起点
            [300, 40],
          ],
        },
      },
    ]);
    follow.rerouteLine('L1');
    expect(pointsOf(lastPatch('L1'))).toEqual([
      [120, 40],
      [300, 40],
    ]);
  });

  it('同值守卫：路由与现有 points 一致、pinned 已是 false → 零写（两端没漂移时切回折线不产空撤销项）', () => {
    const loop = [
      [20, 0],
      [20, -30],
      [100, -30],
      [100, 0],
    ];
    const { follow, models } = makeFollow([{ id: 'LA', data: { ...collapsed, points: loop } }]);
    follow.rerouteLine('LA');
    expect(models.get('LA')!.model.update).not.toHaveBeenCalled();
  });

  it('非 ELBOWED 与自由线不重路由（既有早退）', () => {
    const { follow, models } = makeFollow([
      { id: 'LS', data: { ...collapsed, lineType: 'STRAIGHT' } },
      {
        id: 'LF',
        data: {
          lineType: 'ELBOWED',
          points: [
            [0, 0],
            [50, 50],
          ],
        },
      },
    ]);
    follow.rerouteLine('LS');
    follow.rerouteLine('LF');
    expect(models.get('LS')!.model.update).not.toHaveBeenCalled();
    expect(models.get('LF')!.model.update).not.toHaveBeenCalled();
  });
});

describe('LineAnchorFollow 条边让位（specs/sequence-diagram §3.2 / §4.5，批次 3）', () => {
  /** 轴宿主桩：锚点走连线层的同一纯函数，条半宽按「纵向覆盖该高度的条」取最大 */
  function axisHost(id: string, axis: IAxisAnchor, bars: () => IRect[]) {
    const geom = { rect: { x: axis.x - 60, y: 100, width: 120, height: 600 }, rotation: 0 };
    return {
      id,
      type: 'LIFELINE',
      getAxisAnchor: () => axis,
      getHostGeom: () => geom,
      getAnchorPoint: (join: JoinDir, t: number) => {
        const port = axisPortFor(axis, axisAnchorPoint(axis, t).y);
        const y = axisAnchorPoint(axis, port).y;
        let half = 0;
        for (const b of bars()) {
          if (y >= b.y && y <= b.y + b.height) half = Math.max(half, b.width / 2);
        }
        return axisAnchorWithInset(axis, join, port, half);
      },
    };
  }
  /** 夹具：消息 M 从 A（轴 300）right 到 B（轴 640）left，高度 418（两端 port 0.5） */
  function make() {
    let bars: IRect[] = [{ x: 295, y: 400, width: 10, height: 36 }]; // 覆盖 418
    const A = axisHost('A', { x: 300, top: 136, bottom: 700 }, () => bars);
    const B = axisHost('B', { x: 640, top: 136, bottom: 700 }, () => []);
    const bar = {
      id: 'bar',
      type: 'ACTIVATION',
      anchorFollowHosts: () => ['A'],
      getHostGeom: () => ({ rect: { x: 295, y: 400, width: 10, height: 36 }, rotation: 0 }),
    };
    const msg = statefulLineModel({
      lineType: 'STRAIGHT',
      startNodeId: 'A',
      endNodeId: 'B',
      startJoin: 'right',
      endJoin: 'left',
      points: [
        [295, 418],
        [645, 418],
      ],
    });
    const lineVm = { id: 'M', type: 'LINE', previewRoute: vi.fn() };
    const selected$ = new BehaviorSubject<string[]>(['bar']);
    const plain = {
      id: 's1',
      type: 'SHAPE',
      getHostGeom: () => ({ rect: { x: 800, y: 100, width: 50, height: 50 }, rotation: 0 }),
    };
    const byId: Record<string, object> = { A, B, bar, s1: plain };
    const follow = new LineAnchorFollow(
      { getModelById: (id: string) => (id === 'M' ? msg.model : undefined) } as never,
      {
        getAllVms: () => [lineVm, A, B, bar, plain],
        getVmById: (id: string) => byId[id],
      } as never,
      { selected$ } as never,
    );
    return { follow, msg, lineVm, selected$, setBars: (b: IRect[]) => (bars = b) };
  }

  it('拖激活条：其生命线并入「移动宿主集」——消息端点按条边预览（视觉通道，零模型写）', () => {
    const h = make();
    h.follow.previewFollow();
    // 起点让到条边：锚点 x = 轴 + (5 − 5) = 300（无条是 295）；终点不动
    expect(h.lineVm.previewRoute).toHaveBeenCalledWith([
      { x: 300, y: 418 },
      { x: 645, y: 418 },
    ]);
    expect(h.msg.model.update).not.toHaveBeenCalled();
    // 条纵向拖走（不再覆盖消息高度）→ 端点复位到轴 − 5
    h.setBars([{ x: 295, y: 500, width: 10, height: 36 }]);
    h.follow.previewFollow();
    expect(h.lineVm.previewRoute).toHaveBeenLastCalledWith([
      { x: 295, y: 418 },
      { x: 645, y: 418 },
    ]);
  });

  it('未实现宿主探针的件不扩宿主集（既有行为不变）：选普通形状拖动，锚定在别处的消息不预览', () => {
    const h = make();
    h.selected$.next(['s1']);
    h.follow.previewFollow();
    expect(h.lineVm.previewRoute).not.toHaveBeenCalled();
    // 空选区照旧早退
    h.selected$.next([]);
    expect(() => h.follow.previewFollow()).not.toThrow();
  });

  it('删激活条后端点让位复位：条不再覆盖该高度 → reattach 把端点写回轴 − 5', () => {
    const h = make();
    // 条在：端点已在条边（300）→ 同值零写
    h.msg.store.data = {
      ...h.msg.store.data,
      points: [
        [300, 418],
        [645, 418],
      ],
    };
    h.follow.reattach('A', { rect: { x: 240, y: 100, width: 120, height: 600 }, rotation: 0 });
    expect(h.msg.model.update).not.toHaveBeenCalled();
    // 条被删：宿主重路由 → 写回
    h.setBars([]);
    h.follow.reattach('A', { rect: { x: 240, y: 100, width: 120, height: 600 }, rotation: 0 });
    expect(h.msg.model.update).toHaveBeenCalledTimes(1);
    expect(h.msg.calls[0]).toEqual({
      points: [
        [295, 418],
        [645, 418],
      ],
    });
  });
});
