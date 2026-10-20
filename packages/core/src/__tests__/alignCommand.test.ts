import { BehaviorSubject } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';
import { BoardSDK } from '../app';

/**
 * 对齐/分布命令层守卫（docs/05 §7；2026-10-10 审计补测——此前仅 E2E 护栏）：
 * resolveAlignParticipant 单源（锚定线剔除 / 自由线 points 平移通道）、参与数
 * 不足 no-op、零 delta 省写、transact → 位移 → reattach → stopCapturing 时序
 * （急切重路由并入同一撤销项——undo 裂项家族）。纯函数数学由 alignOps.test
 * 覆盖，这里锁编排。桩法照 boardSdkCursorMode 先例（私有字段注入）。
 */

type Rect = { x: number; y: number; width: number; height: number };

function harness(sel: string[]) {
  const order: string[] = [];
  const vms: Record<string, unknown> = {};
  const models: Record<string, unknown> = {};
  const commitDrag = new Map<string, ReturnType<typeof vi.fn>>();
  const update = new Map<string, ReturnType<typeof vi.fn>>();

  const addShape = (id: string, b: Rect): void => {
    commitDrag.set(
      id,
      vi.fn(() => order.push(`commitDrag:${id}`)),
    );
    vms[id] = {
      id,
      type: 'SHAPE',
      getBounds: () => ({ ...b }),
      getLocalRect: () => ({ ...b }),
      getRotation: () => 0,
      commitDrag: commitDrag.get(id),
    };
  };
  /** anchored：任一端绑定 → resolver 应剔除；free：两端皆空 → points 平移通道 */
  const addLine = (
    id: string,
    opts: { anchoredTo?: string; points?: Array<[number, number]> },
  ): void => {
    const pts = opts.points ?? [
      [0, 0],
      [10, 0],
    ];
    const data = opts.anchoredTo
      ? { startNodeId: opts.anchoredTo, endNodeId: null, points: pts }
      : { startNodeId: null, endNodeId: null, points: pts };
    const xs = pts.map((p) => p[0]!);
    const ys = pts.map((p) => p[1]!);
    const bounds = {
      x: Math.min(...xs),
      y: Math.min(...ys),
      width: Math.max(...xs) - Math.min(...xs),
      height: Math.max(...ys) - Math.min(...ys),
    };
    update.set(
      id,
      vi.fn((patch: Record<string, unknown>) =>
        order.push(`update:${id}:${JSON.stringify(patch)}`),
      ),
    );
    models[id] = { toJSON: () => ({ ...data }), update: update.get(id) };
    vms[id] = {
      id,
      type: 'LINE',
      getBounds: () => ({ ...bounds }),
      getLocalRect: () => ({ ...bounds }),
      getRotation: () => 0,
    };
  };

  const transact = vi.fn((fn: () => void) => {
    order.push('transact:enter');
    fn();
    order.push('transact:exit');
  });
  const stopCapturing = vi.fn(() => order.push('stopCapturing'));
  const reattach = vi.fn((id: string) => order.push(`reattach:${id}`));

  const sdk = new BoardSDK();
  const w = sdk as unknown as Record<string, unknown>;
  w.viewport = { editable$: new BehaviorSubject(true) };
  w.selector = { selected$: new BehaviorSubject(sel) };
  w.vmEngine = { getVmById: (id: string) => vms[id] };
  w.engine = { transact, getModelById: (id: string) => models[id] };
  w.history = { stopCapturing };
  w.lineService = { reattach };

  return { sdk, order, transact, addShape, addLine, commitDrag, update, reattach };
}

describe('BoardSDK 对齐/分布命令层（编排桩）', () => {
  it('左对齐：基准元素零 delta 省写；时序 = transact 内位移、transact 后 reattach、最后 stopCapturing', () => {
    const h = harness(['A', 'B', 'C']);
    h.addShape('A', { x: 100, y: 100, width: 50, height: 50 });
    h.addShape('B', { x: 200, y: 80, width: 50, height: 50 });
    h.addShape('C', { x: 300, y: 120, width: 50, height: 50 });
    h.sdk.alignSelection('left');

    expect(h.commitDrag.get('A')).not.toHaveBeenCalled(); // 已在目标位——省写
    expect(h.commitDrag.get('B')).toHaveBeenCalledWith(
      { x: 200, y: 80, width: 50, height: 50 },
      -100,
      0,
    );
    expect(h.commitDrag.get('C')).toHaveBeenCalledWith(
      { x: 300, y: 120, width: 50, height: 50 },
      -200,
      0,
    );
    expect(h.order).toEqual([
      'transact:enter',
      'commitDrag:B',
      'commitDrag:C',
      'transact:exit',
      'reattach:B',
      'reattach:C',
      'stopCapturing',
    ]);
  });

  it('reattach 收 bounds+delta 纯算术（对齐无预览、root 停旧值——不可读 getBounds）', () => {
    const h = harness(['A', 'B']);
    h.addShape('A', { x: 100, y: 100, width: 50, height: 50 });
    h.addShape('B', { x: 220, y: 60, width: 30, height: 40 });
    h.sdk.alignSelection('left');
    expect(h.reattach).toHaveBeenCalledWith('B', {
      rect: { x: 100, y: 60, width: 30, height: 40 },
      rotation: 0,
    });
  });

  it('横向分布：两端不动（零 delta 省写）、中间元素等距化', () => {
    const h = harness(['A', 'B', 'C']);
    // 中心 125 / 205 / 425 → 等距化后 B 中心 275 → dx = +70；两端 dx=0
    h.addShape('A', { x: 100, y: 100, width: 50, height: 50 });
    h.addShape('B', { x: 180, y: 140, width: 50, height: 50 });
    h.addShape('C', { x: 400, y: 60, width: 50, height: 50 });
    h.sdk.distributeSelection('h');

    expect(h.commitDrag.get('A')).not.toHaveBeenCalled();
    expect(h.commitDrag.get('C')).not.toHaveBeenCalled();
    expect(h.commitDrag.get('B')).toHaveBeenCalledWith(
      { x: 180, y: 140, width: 50, height: 50 },
      70,
      0,
    );
    expect(h.transact).toHaveBeenCalledTimes(1);
  });

  it('resolver 单源：锚定线剔除不移动；自由线走 points 平移通道（不 commitDrag、不 reattach）', () => {
    const h = harness(['A', 'anchoredL', 'freeL']);
    h.addShape('A', { x: 100, y: 100, width: 50, height: 50 });
    h.addLine('anchoredL', { anchoredTo: 'host' });
    h.addLine('freeL', {
      points: [
        [250, 10],
        [260, 20],
      ],
    });
    h.sdk.alignSelection('left');

    // 锚定线：resolver 返 null——模型零触碰
    expect(h.update.get('anchoredL')).not.toHaveBeenCalled();
    // 自由线：dx = 100 - 250 = -150 → update({points: 平移后})
    expect(h.update.get('freeL')).toHaveBeenCalledWith({
      points: [
        [100, 10],
        [110, 20],
      ],
    });
    // A 是基准（dx=0 省写）；自由线不 reattach（位置由 points 通道自持）
    expect(h.reattach).not.toHaveBeenCalled();
  });

  it('参与数不足整体 no-op：单选对齐 / 2 选分布 / 锚定线剔除后仅剩 1 参与者', () => {
    const h1 = harness(['A']);
    h1.addShape('A', { x: 100, y: 100, width: 50, height: 50 });
    h1.sdk.alignSelection('left');
    expect(h1.transact).not.toHaveBeenCalled();

    const h2 = harness(['A', 'B']);
    h2.addShape('A', { x: 100, y: 100, width: 50, height: 50 });
    h2.addShape('B', { x: 200, y: 80, width: 50, height: 50 });
    h2.sdk.distributeSelection('h');
    expect(h2.transact).not.toHaveBeenCalled();

    const h3 = harness(['A', 'anchoredL']);
    h3.addShape('A', { x: 100, y: 100, width: 50, height: 50 });
    h3.addLine('anchoredL', { anchoredTo: 'host' });
    h3.sdk.alignSelection('left');
    expect(h3.transact).not.toHaveBeenCalled();
  });

  it('组折叠（docs/18 §5）：整组在集并为单参与体——delta 同值摊回每成员，相对位置不变', () => {
    const h = harness(['A', 'B', 'C']);
    h.addShape('A', { x: 100, y: 100, width: 50, height: 50 });
    h.addShape('B', { x: 200, y: 80, width: 50, height: 50 });
    h.addShape('C', { x: 300, y: 120, width: 50, height: 50 });
    const w = h.sdk as unknown as Record<string, unknown>;
    w.group = {
      groupOf: (id: string) => (id === 'B' || id === 'C' ? 'G1' : undefined),
      membersOf: (g: string) => (g === 'G1' ? ['B', 'C'] : []),
    };
    h.sdk.alignSelection('left');

    // 参与体 = A 与 G1(union x=200..350)：G1 整体 dx = 100 - 200 = -100，
    // 摊回 B/C 同值——组内相对位置（B→C 间距 100）不变
    expect(h.commitDrag.get('B')).toHaveBeenCalledWith(
      { x: 200, y: 80, width: 50, height: 50 },
      -100,
      0,
    );
    expect(h.commitDrag.get('C')).toHaveBeenCalledWith(
      { x: 300, y: 120, width: 50, height: 50 },
      -100,
      0,
    );
    expect(h.reattach).toHaveBeenCalledWith('B', expect.anything());
    expect(h.reattach).toHaveBeenCalledWith('C', expect.anything());
  });

  it('Alt 部分在集：组员按单体参与（不折叠），delta 只动选中者', () => {
    const h = harness(['A', 'B']);
    h.addShape('A', { x: 100, y: 100, width: 50, height: 50 });
    h.addShape('B', { x: 200, y: 80, width: 50, height: 50 });
    h.addShape('C', { x: 300, y: 120, width: 50, height: 50 }); // G1 未选中的另一成员
    const w = h.sdk as unknown as Record<string, unknown>;
    w.group = {
      groupOf: (id: string) => (id === 'B' || id === 'C' ? 'G1' : undefined),
      membersOf: (g: string) => (g === 'G1' ? ['B', 'C'] : []),
    };
    h.sdk.alignSelection('left');

    expect(h.commitDrag.get('B')).toHaveBeenCalledWith(
      { x: 200, y: 80, width: 50, height: 50 },
      -100,
      0,
    );
    expect(h.commitDrag.get('C')).not.toHaveBeenCalled(); // 不在集不被带动
  });
});
