import { BehaviorSubject } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';
import { ClipboardService } from '../platform/clipboard/clipboardService';
import { composeCascadeLookup } from '../widgets/sequence/sequenceCascade';
import type { IActivationLookup, IFrameLookup } from '../types';

/**
 * 激活条的复制粘贴（specs/sequence-diagram §5.4）：复制生命线经级联复合查找带上
 * 其绑定的条；粘贴时 lifelineId 同批 → 新生命线 id、批外 → 删键，随后由
 * adoptByLanding（复合）给无绑定的副本做落点重绑。ClipboardService 级桩测
 * （clipboardFrame 同款；JS 环境——内部 buffer 路径）。
 */

interface Widget {
  id: string;
  type: string;
  x: number;
  y: number;
  width: number;
  height: number;
  lifelineId?: string;
  [k: string]: unknown;
}

function makeHarness(widgets: Widget[], selected: string[]) {
  const byId = new Map(widgets.map((w) => [w.id, { ...w }]));
  const added: Array<Record<string, unknown>> = [];
  const log: string[] = [];
  /** 激活条钩子桩：展开按绑定；落点重绑只记日志（判定本身在 sequenceBinding 测试） */
  const seq: IActivationLookup = {
    expandActivations: (ids) =>
      widgets
        .filter((w) => w.type === 'ACTIVATION' && ids.includes(w.lifelineId!))
        .map((w) => w.id),
    reconcileActivations: vi.fn(),
    adoptActivationsByLanding: vi.fn((ids: string[]) => {
      log.push(`adoptSeq:${ids.join(',')}`);
    }),
  };
  const frame: IFrameLookup = {
    isFrame: () => false,
    childIds: () => [],
    expandForCascade: (ids) => ids,
    reconcileParents: () => {},
    adoptByLanding: vi.fn(() => {
      log.push('adoptFrame');
    }),
    computeLayerClamps: () => [],
    createMarqueeFrameFilter: () => null,
  };
  let zSeq = 0;
  const svc = new ClipboardService(
    {
      getModelById: (id: string) => ({ toJSON: () => ({ ...byId.get(id) }) }),
      add: (w: Record<string, unknown>) => {
        added.push({ ...w });
        zSeq++;
      },
      removeByIds: vi.fn(),
      genInitialOrder: () => `z${zSeq}`,
      transact: (fn: () => void) => {
        log.push('tx:begin');
        fn();
        log.push('tx:end');
      },
    } as never,
    {
      getVmById: (id: string) => {
        const d = byId.get(id)!;
        return { getBounds: () => ({ x: d.x, y: d.y, width: d.width, height: d.height }) };
      },
    } as never,
    {
      selected$: new BehaviorSubject(selected),
      setSelected: () => {},
    } as never,
    {
      editable$: new BehaviorSubject(true),
      vpBounds$: new BehaviorSubject({ x: 0, y: 0, width: 1000, height: 600 }),
    } as never,
    {
      stopCapturing: vi.fn(() => {
        log.push('stopCapturing');
      }),
    } as never,
    () => composeCascadeLookup(frame, seq),
  );
  return { svc, added, log, seq };
}

const FIXTURE = (): Widget[] => [
  { id: 'l1', type: 'LIFELINE', x: 240, y: 100, width: 120, height: 600 },
  { id: 'b1', type: 'ACTIVATION', x: 295, y: 300, width: 10, height: 80, lifelineId: 'l1' },
  { id: 'l2', type: 'LIFELINE', x: 640, y: 100, width: 120, height: 600 },
];

describe('激活条复制粘贴（specs/sequence-diagram §5.4）', () => {
  it('复制生命线：快照经复合查找带上其绑定的条；粘贴后 lifelineId 指向副本生命线，生命线排在条之前', async () => {
    const h = makeHarness(FIXTURE(), ['l1']);
    await h.svc.copySelected();
    h.svc.pasteAt({ x: 600, y: 400 });
    expect(h.added.map((w) => w.type)).toEqual(['LIFELINE', 'ACTIVATION']);
    const copyLifeline = h.added[0]!;
    const copyBar = h.added[1]!;
    expect(copyLifeline.id).not.toBe('l1');
    expect(copyBar.lifelineId).toBe(copyLifeline.id);
    expect(String(copyLifeline.zOrder) < String(copyBar.zOrder)).toBe(true);
  });

  it('单独复制条（宿主不在批）：粘贴后无 lifelineId 键——落点重绑交给 adoptByLanding', async () => {
    const h = makeHarness(FIXTURE(), ['b1']);
    await h.svc.copySelected();
    h.svc.pasteAt({ x: 600, y: 400 });
    const pasted = h.added[0]!;
    expect(pasted.type).toBe('ACTIVATION');
    expect(pasted).not.toHaveProperty('lifelineId');
  });

  it('容器先入批的顺序不受条影响：同一批里 FRAME 仍最先', async () => {
    const h = makeHarness(
      [...FIXTURE(), { id: 'f1', type: 'FRAME', x: 0, y: 0, width: 300, height: 200 }],
      ['b1', 'f1', 'l1'],
    );
    await h.svc.copySelected();
    h.svc.pasteAt({ x: 600, y: 400 });
    expect(h.added.map((w) => w.type)).toEqual(['FRAME', 'LIFELINE', 'ACTIVATION']);
  });

  it('粘贴收尾：复合查找的 adoptByLanding 拿到全部新 id——容器先、激活条后，在第二个事务里、stopCapturing 之前', async () => {
    const h = makeHarness(FIXTURE(), ['b1']);
    await h.svc.copySelected();
    h.svc.pasteAt({ x: 600, y: 400 });
    expect(h.seq.adoptActivationsByLanding).toHaveBeenCalledTimes(1);
    expect(vi.mocked(h.seq.adoptActivationsByLanding).mock.calls[0]![0]).toEqual(
      h.added.map((w) => w.id),
    );
    expect(h.log).toEqual([
      'tx:begin',
      'tx:end',
      'tx:begin',
      'adoptFrame',
      `adoptSeq:${h.added[0]!.id}`,
      'tx:end',
      'stopCapturing',
    ]);
  });

  it('消息不在级联内：只复制生命线时不随行（与「复制形状不复制连线」一致）', async () => {
    const line = {
      id: 'm1',
      type: 'LINE',
      x: 0,
      y: 0,
      width: 0,
      height: 0,
      points: [
        [305, 300],
        [645, 300],
      ],
      startNodeId: 'l1',
      endNodeId: 'l2',
    };
    const h = makeHarness([...FIXTURE(), line], ['l1']);
    await h.svc.copySelected();
    h.svc.pasteAt({ x: 600, y: 400 });
    expect(h.added.some((w) => w.type === 'LINE')).toBe(false);
  });
});
