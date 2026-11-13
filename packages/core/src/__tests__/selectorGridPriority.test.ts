import { beforeAll, describe, expect, it } from 'vitest';
import { BehaviorSubject, Subject } from 'rxjs';
import {
  applyDragMove,
  type DragState,
  type ISelectorDragContext,
} from '../platform/selector/selectorDragOps';
import { RefLineService } from '../platform/refLine/refLineService';
import { stubPixiCanvasDocument } from './helpers/pixiNodeEnv';
import type { IBaseModel, IBaseWidgetVm, IPointerEventInfo } from '../types';

/**
 * 拖拽移动的「参考线先、网格后」三态契约（specs/flowchart-closeout §9.2 G-08）：
 * 等间距命中（matchedV/H 空但 spacingV/H 真）→ 网格不量化；无任何命中 → 量化；
 * 网格关 → 一律不量化。量化判定在 applyDragMove（lastDx/lastDy = 松手落库值）。
 */

function makeCtx(
  refs: Array<{ x: number; y: number; width: number; height: number }>,
  gridOn: boolean,
) {
  const refVms = refs.map((r, i) => ({
    id: `ref${i}`,
    type: 'SHAPE',
    getBounds: () => ({ ...r }),
    getRotation: () => 0,
  })) as unknown as IBaseWidgetVm[];
  const dragVm = {
    id: 'drag',
    type: 'SHAPE',
    applyDragPreview: () => {},
    getBounds: () => ({ x: 60, y: 100, width: 50, height: 50 }),
    getRotation: () => 0,
  } as unknown as IBaseWidgetVm;
  const viewport = {
    optionLayer: { addChild: () => {}, removeChild: () => {} },
    vpScale$: new BehaviorSubject(1),
    vpBounds$: new BehaviorSubject({ x: 0, y: 0, width: 2000, height: 2000 }),
  };
  const selector = { selected$: new BehaviorSubject<string[]>(['drag']) };
  const engine = {
    onModelCreated$: new Subject<IBaseModel>(),
    onModelRemoved$: new Subject<string[]>(),
    onModelUpdated$: new Subject<void>(),
  };
  const vmEngine = {
    getAllVms: () => [dragVm, ...refVms],
    getVmsInRect: (r: { x: number; y: number; width: number; height: number }) =>
      [dragVm, ...refVms].filter((vm) => {
        const b = vm.getBounds();
        return (
          b.x + b.width >= r.x &&
          b.x <= r.x + r.width &&
          b.y + b.height >= r.y &&
          b.y <= r.y + r.height
        );
      }),
    getVmById: (id: string) => (id === 'drag' ? dragVm : undefined),
  };
  const refLine = new RefLineService(
    viewport as never,
    vmEngine as never,
    () => selector as never,
    engine as never,
  );
  refLine.initialize();
  const ctx: ISelectorDragContext = {
    viewport: viewport as never,
    vmEngine: vmEngine as never,
    engine: { transact: (fn: () => void) => fn() } as never,
    history: { stopCapturing: () => {} } as never,
    selectionVm: { moveTo: () => {} } as never,
    dragMove$: new Subject<void>(),
    getRefLine: () => refLine,
    onDragCommitted: () => {},
    syncSelectionVm: () => {},
    gridSnapOn: () => gridOn,
  };
  return { ctx, refLine };
}

/** 拖拽矩形 (60,100,50,50)，指针移 dx=15（位移过起拖阈值） */
function runMove(ctx: ISelectorDragContext): { dx: number; dy: number } {
  const state: DragState = {
    startWorld: { x: 0, y: 0 } as never, // applyDragMove 只读 x/y
    ids: ['drag'],
    wasSelected: true,
    initial: new Map([['drag', { x: 60, y: 100, width: 50, height: 50 }]]),
    initialUnion: { x: 60, y: 100, width: 50, height: 50 },
    moved: true,
    lastDx: 0,
    lastDy: 0,
  };
  applyDragMove(ctx, state, { world: { x: 15, y: 0 } } as IPointerEventInfo);
  return { dx: state.lastDx, dy: state.lastDy };
}

describe('applyDragMove 网格让位契约（specs/flowchart-closeout §9.2）', () => {
  beforeAll(stubPixiCanvasDocument); // 等距命中画徽标（PIXI Text 测量）
  it('等间距命中：网格开也不量化（spacingV 让位——量化会把 dx=15 劫持成 20）', () => {
    const refs = [
      { x: 0, y: 100, width: 50, height: 50 },
      { x: 150, y: 100, width: 50, height: 50 },
    ];
    const { ctx, refLine } = makeCtx(refs, true);
    // x=75 两侧间隙 25 等距：spacingV=true、matchedV 空
    const snap = ctx.getRefLine().snapForDrag({ x: 60, y: 100, width: 50, height: 50 }, 15, 0);
    expect(snap.spacingV).toBe(true);
    const out = runMove(ctx);
    expect(out.dx).toBe(15); // 等距解保持，不被量化成 quantize(75)−60 = 20
    refLine.dispose();
  });

  it('无命中：网格开 → 量化（60+15=75 → 80，dx=20）', () => {
    // 参照物远离拖拽走廊（y=100 参照在旁边但 x 距离超阈值）：无对齐无等距
    const { ctx, refLine } = makeCtx([{ x: 500, y: 100, width: 50, height: 50 }], true);
    const out = runMove(ctx);
    expect(out.dx).toBe(20);
    refLine.dispose();
  });

  it('网格关 → 位移原样（含等间距命中场景）', () => {
    const refs = [
      { x: 0, y: 100, width: 50, height: 50 },
      { x: 150, y: 100, width: 50, height: 50 },
    ];
    const { ctx, refLine } = makeCtx(refs, false);
    const out = runMove(ctx);
    expect(out.dx).toBe(15);
    refLine.dispose();
  });
});
