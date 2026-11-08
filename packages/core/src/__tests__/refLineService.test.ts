import { beforeAll, describe, expect, it } from 'vitest';
import { BehaviorSubject, Subject } from 'rxjs';
import { RefLineService } from '../platform/refLine/refLineService';
import { stubPixiCanvasDocument } from './helpers/pixiNodeEnv';
import type { IBaseModel, IBaseWidgetVm } from '../types';

/**
 * 参照物类型矩阵回归（2026-09 用户实测揪出）：
 * 拖拽元素不限类型，但候选参照物曾只放行 SHAPE——便签吸得到形状、形状吸不到便签。
 * 规格（docs/06 §2）：SHAPE/STICKY/TEXT/IMAGE 参与，LINE/PEN 不参与（斜线 bbox 幻影边）。
 */

interface StubVm {
  id: string;
  type: string;
  rect: { x: number; y: number; width: number; height: number };
}

function createService(stubVms: StubVm[], selected: string[] = []) {
  const vms = stubVms.map((s) => ({
    id: s.id,
    type: s.type,
    getBounds: () => ({ ...s.rect }),
    getRotation: () => 0,
  })) as unknown as IBaseWidgetVm[];
  const vpScale$ = new BehaviorSubject(1);
  const vpBounds$ = new BehaviorSubject({ x: 0, y: 0, width: 2000, height: 2000 });
  const viewport = {
    optionLayer: { addChild: () => {}, removeChild: () => {} },
    vpScale$,
    vpBounds$,
  };
  const selector = { selected$: new BehaviorSubject<string[]>(selected) };
  const engine = {
    onModelCreated$: new Subject<IBaseModel>(),
    onModelRemoved$: new Subject<string[]>(),
    onModelUpdated$: new Subject<void>(),
  };
  const vmEngine = {
    getAllVms: () => vms,
    // 索引粗筛桩：直接按 bounds 相交过滤（与真实 getVmsInRect 语义一致）
    getVmsInRect: (r: { x: number; y: number; width: number; height: number }) =>
      vms.filter((vm) => {
        const b = vm.getBounds();
        return (
          b.x + b.width >= r.x &&
          b.x <= r.x + r.width &&
          b.y + b.height >= r.y &&
          b.y <= r.y + r.height
        );
      }),
  };
  const svc = new RefLineService(
    viewport as never,
    vmEngine as never,
    () => selector as never,
    engine as never,
  );
  svc.initialize();
  return svc;
}

/** 参照物在 (100,100) 50×50；拖拽矩形从 (0,0) 50×50 位移 dx=96 → 左边 96 vs 参照左边 100，阈值内应吸附到 100 */
function snappedDxFor(type: string): number | null {
  const svc = createService([{ id: 'ref', type, rect: { x: 100, y: 100, width: 50, height: 50 } }]);
  const r = svc.snapForDrag({ x: 0, y: 0, width: 50, height: 50 }, 96, 0);
  svc.dispose();
  return r.matchedV.length > 0 ? r.dx : null;
}

describe('refLineService 深缩放保护（A2，docs/06 §3）', () => {
  it('zoom 8x（阈值 0.75 < 1 世界单位）跳过吸附', () => {
    const svc = createService([
      { id: 'ref', type: 'SHAPE', rect: { x: 100, y: 100, width: 50, height: 50 } },
    ]);
    // stub vpScale$ 初始 1 → 先切 8
    (svc as unknown as { viewport: { vpScale$: BehaviorSubject<number> } }).viewport.vpScale$.next(
      8,
    );
    const r = svc.snapForDrag({ x: 0, y: 0, width: 50, height: 50 }, 96, 0);
    svc.dispose();
    expect(r.dx).toBe(96); // 不修正
    expect(r.matchedV).toHaveLength(0);
  });
});

describe('refLineService 粘滞生命周期（docs/06 §3）', () => {
  it('engage → 过线拉回 → 越阈释放；hideMatches 后新拖拽不回吸（A3 保持）', () => {
    const svc = createService([
      { id: 'ref', type: 'SHAPE', rect: { x: 300, y: 300, width: 100, height: 50 } },
    ]);
    const rect = { x: 0, y: 0, width: 50, height: 50 };
    const engage = svc.snapForDrag(rect, 296, 0); // 接近侧吸上 300
    expect(engage.dx).toBe(300);
    const overshoot = svc.snapForDrag(rect, 303, 0); // 过线 3px：粘滞拉回
    expect(overshoot.dx).toBe(300);
    expect(overshoot.matchedV).toEqual([300]);
    const escape = svc.snapForDrag(rect, 307, 0); // 越阈 7px：释放跟手
    expect(escape.dx).toBe(307);
    expect(escape.matchedV).toHaveLength(0);
    svc.hideMatches(); // 松手/取消清粘滞
    const fresh = svc.snapForDrag(rect, 303, 0); // 新拖拽：无粘滞不回吸
    expect(fresh.dx).toBe(303);
    expect(fresh.matchedV).toHaveLength(0);
    svc.dispose();
  });

  it('深缩放跳过吸附时清粘滞', () => {
    const svc = createService([
      { id: 'ref', type: 'SHAPE', rect: { x: 300, y: 300, width: 100, height: 50 } },
    ]);
    const rect = { x: 0, y: 0, width: 50, height: 50 };
    expect(svc.snapForDrag(rect, 296, 0).dx).toBe(300); // 吸上
    const vp = (svc as unknown as { viewport: { vpScale$: BehaviorSubject<number> } }).viewport;
    vp.vpScale$.next(8); // 深缩放跳过 → 清粘滞
    expect(svc.snapForDrag(rect, 303, 0).dx).toBe(303);
    vp.vpScale$.next(1);
    expect(svc.snapForDrag(rect, 303, 0).dx).toBe(303); // 粘滞已清，不拉回
    svc.dispose();
  });
});

describe('refLineService 对齐/等距同轴竞争（docs/06 §7 偏差最小者胜）', () => {
  // 等距命中会画徽标（PIXI Text 测量依赖 DOM canvas）——node 环境先桩掉
  beforeAll(stubPixiCanvasDocument);

  // L(100) M(355) R(500) 同排（y 投影重叠）；拖 A(292,50)：
  // 等距解（L,R 邻居）在 dx=8（间隙各 150）；M 左缘 355 与 A 右缘构成对齐候选
  function competingService() {
    return createService([
      { id: 'L', type: 'SHAPE', rect: { x: 100, y: 100, width: 50, height: 50 } },
      { id: 'M', type: 'SHAPE', rect: { x: 355, y: 100, width: 50, height: 50 } },
      { id: 'R', type: 'SHAPE', rect: { x: 500, y: 100, width: 50, height: 50 } },
    ]);
  }

  it('等距偏差更小：等距胜（对齐不再无条件截胡）', () => {
    const svc = competingService();
    // dx=7 → A 右缘 349 距 M 左缘 355 为 6（对齐偏差 6）；等距解偏差 1
    const r = svc.snapForDrag({ x: 292, y: 100, width: 50, height: 50 }, 7, 0);
    svc.dispose();
    expect(r.dx).toBe(8); // 等距解
    expect(r.matchedV).toHaveLength(0); // 红线让位
    expect(svc.__spacingGaps.map((g) => `${g.axis}:${g.value}`)).toEqual(['x:150', 'x:150']);
  });

  it('对齐偏差更小：对齐胜', () => {
    const svc = competingService();
    // dx=12.8 → A 右缘 354.8 距 M 左缘 355 为 0.2（对齐偏差 0.2）；等距解偏差 4.8
    const r = svc.snapForDrag({ x: 292, y: 100, width: 50, height: 50 }, 12.8, 0);
    svc.dispose();
    expect(r.dx).toBeCloseTo(13, 6);
    expect(r.matchedV).toEqual([355]);
    expect(svc.__spacingGaps).toHaveLength(0);
  });
});

describe('refLineService 端部链式等距（docs/06 §7）', () => {
  beforeAll(stubPixiCanvasDocument); // 链式命中画徽标（PIXI Text 测量）

  it('拖一排左端件：与最近邻间隙吸附到「最近邻与次邻间隙」，探针两段等值', () => {
    const svc = createService([
      { id: 'A', type: 'SHAPE', rect: { x: 100, y: 100, width: 100, height: 100 } },
      { id: 'B', type: 'SHAPE', rect: { x: 300, y: 100, width: 100, height: 100 } },
      { id: 'C', type: 'SHAPE', rect: { x: 500, y: 100, width: 100, height: 100 } },
    ]);
    // 拖 A（B、C 都在右侧——单侧邻居）：dx=-3 → gap(A,B)=103，链式解 gap=100 偏差 3
    const r = svc.snapForDrag({ x: 100, y: 100, width: 100, height: 100 }, -3, 0);
    svc.dispose();
    expect(r.dx).toBe(0); // 吸回等距位（A.x=100，gap 恰 100）
    expect(r.matchedV).toHaveLength(0); // 无对齐线竞争（B/C 线均远于阈值）
    expect(svc.__spacingGaps.map((g) => `${g.axis}:${g.value}`)).toEqual(['x:100', 'x:100']);
  });
});

describe('refLineService 参照物类型矩阵', () => {
  it.each(['SHAPE', 'STICKY', 'TEXT'])('%s 作为参照物参与吸附', (type) => {
    // 位移 96 → 吸附修正为 100（左边对齐参照左边）
    expect(snappedDxFor(type)).toBe(100);
  });

  it.each(['LINE', 'PEN'])('%s 不作为参照物（斜线 bbox 幻影边）', (type) => {
    expect(snappedDxFor(type)).toBeNull();
  });

  it('选中集从参照物中剔除', () => {
    const svc = createService(
      [{ id: 'ref', type: 'SHAPE', rect: { x: 100, y: 100, width: 50, height: 50 } }],
      ['ref'],
    );
    const r = svc.snapForDrag({ x: 0, y: 0, width: 50, height: 50 }, 96, 0);
    expect(r.matchedV).toHaveLength(0);
    expect(r.dx).toBe(96);
    svc.dispose();
  });

  it('视口外的参照物不参与', () => {
    const svc = createService([
      { id: 'far', type: 'STICKY', rect: { x: 5000, y: 5000, width: 50, height: 50 } },
    ]);
    const r = svc.snapForDrag({ x: 0, y: 0, width: 50, height: 50 }, 96, 0);
    expect(r.matchedV).toHaveLength(0);
    svc.dispose();
  });
});
