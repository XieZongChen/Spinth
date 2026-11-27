import { describe, expect, it } from 'vitest';
import { rewirePortsAfterResize, rewiredPorts } from '../widgets/line/lineAxisResize';
import type { ILineAnchorData } from '../widgets/line/lineQuickAdd';
import type { IHostGeom, IRect } from '../common/geometry';

/**
 * 加长保高度（specs/sequence-diagram §4.7，G-06）：轴宿主缩放后对其上的锚定端
 * 重写端口——旧锚点高度不变，新 port = 新轴上同高度的比例。夹具：生命线
 * (200,100,120,520)，轴 x = 260、轴段 y 136…620（长 484）。
 */

const OLD_AXIS = { x: 260, top: 136, bottom: 620 };
const OLD_RECT: IRect = { x: 200, y: 100, width: 120, height: 520 };

function line(over: Partial<ILineAnchorData>): ILineAnchorData {
  return {
    id: 'ln0',
    startNodeId: 'l1',
    endNodeId: 'l2',
    startJoin: 'right',
    endJoin: 'left',
    points: [
      [265, 378],
      [515, 378],
    ],
    lineType: 'STRAIGHT',
    pinned: false,
    ...over,
  };
}

describe('rewiredPorts（纯函数）', () => {
  it('向下加长 200：锚定端高度不变 → 端口按新轴长重算（4 位小数），另一端不写', () => {
    const out = rewiredPorts('l1', OLD_AXIS, { x: 260, top: 136, bottom: 820 }, [
      line({ startPort: 0.5 }),
    ]);
    expect(out).toEqual([{ id: 'ln0', startPort: 0.3538 }]); // (378 − 136) / 684
    expect('endPort' in out[0]!).toBe(false);
  });

  it('没有显式端口的线（缺省 0.5）同样重算并写成显式端口', () => {
    const out = rewiredPorts('l1', OLD_AXIS, { x: 260, top: 136, bottom: 820 }, [line({})]);
    expect(out).toEqual([{ id: 'ln0', startPort: 0.3538 }]);
  });

  it('轴段不变（只改宽度）：端口不变，零写入——不写多余的显式端口', () => {
    const out = rewiredPorts('l1', OLD_AXIS, OLD_AXIS, [line({ startPort: 0.37 }), line({})]);
    expect(out).toEqual([]);
  });

  it('不动的端口不写：只有变化的那一端进补丁', () => {
    const out = rewiredPorts('l1', OLD_AXIS, { x: 260, top: 136, bottom: 820 }, [
      line({ startPort: 0 }),
    ]);
    expect(out).toEqual([]); // 顶端高度不变
  });

  it('缩短后落到轴外：钳到底（t = 1）', () => {
    const out = rewiredPorts('l1', OLD_AXIS, { x: 260, top: 136, bottom: 300 }, [
      line({ startPort: 0.5 }),
    ]);
    expect(out).toEqual([{ id: 'ln0', startPort: 1 }]);
  });

  it('顶边下移：轴顶以下的高度钳到顶（t = 0）', () => {
    const out = rewiredPorts('l1', OLD_AXIS, { x: 260, top: 200, bottom: 620 }, [
      line({ startPort: 0.1 }), // y = 184.4，在新轴顶之上
    ]);
    expect(out).toEqual([{ id: 'ln0', startPort: 0 }]);
  });

  it('只处理锚定在本宿主上的端；自消息两端都重写', () => {
    const out = rewiredPorts('l1', OLD_AXIS, { x: 260, top: 136, bottom: 820 }, [
      line({ id: 'other', startNodeId: 'l9' }), // 不锚定在 l1：不动
      line({ id: 'endOnly', startNodeId: 'l9', endNodeId: 'l1', endPort: 0.25 }),
      line({ id: 'self', endNodeId: 'l1', startPort: 0.2, endPort: 0.6 }), // 自消息
    ]);
    expect(out).toEqual([
      { id: 'endOnly', endPort: 0.1769 }, // (136 + 484 × 0.25 − 136) / 684
      { id: 'self', startPort: 0.1415, endPort: 0.4246 },
    ]);
  });

  it('空清单返回空', () => {
    expect(rewiredPorts('l1', OLD_AXIS, { x: 260, top: 136, bottom: 820 }, [])).toEqual([]);
  });
});

describe('rewirePortsAfterResize（接线）', () => {
  function makeCtx(host: unknown, lines: Array<Record<string, unknown>>) {
    const updates: Array<[string, Record<string, unknown>]> = [];
    const models = new Map<string, { toJSON: () => unknown; update: (p: never) => void }>();
    for (const data of lines) {
      const id = data.id as string;
      models.set(id, {
        toJSON: () => data,
        update: (patch: object) => updates.push([id, patch as Record<string, unknown>]),
      });
    }
    const ctx = {
      engine: { getModelById: (id: string) => models.get(id) },
      vmEngine: {
        getVmById: ((id: string) => (id === 'l1' ? host : null)) as never,
        getAllVms: () => [...lines.map((d) => ({ id: d.id as string, type: 'LINE' }))],
      },
    };
    return { ctx, updates };
  }

  const geom = (rect: IRect): IHostGeom => ({ rect, rotation: 0 });

  it('轴宿主：对有变化的线写端口补丁（以传入的前后几何求轴，不读 vm 当前几何）', () => {
    const seen: unknown[] = [];
    const host = {
      getAxisAnchor: (g?: IHostGeom) => {
        seen.push(g);
        return g && g.rect.height === 520 ? OLD_AXIS : { x: 260, top: 136, bottom: 820 };
      },
    };
    const { ctx, updates } = makeCtx(host, [
      { ...line({ startPort: 0.5 }), id: 'a' },
      { ...line({ startNodeId: 'l9' }), id: 'b' },
    ]);
    rewirePortsAfterResize(
      'l1',
      geom(OLD_RECT),
      geom({ x: 200, y: 100, width: 120, height: 720 }),
      ctx,
    );
    expect(updates).toEqual([['a', { startPort: 0.3538 }]]);
    // 前后几何各求一次轴
    expect(seen).toEqual([geom(OLD_RECT), geom({ x: 200, y: 100, width: 120, height: 720 })]);
  });

  it('非轴宿主（无探针）：零写入', () => {
    const { ctx, updates } = makeCtx({ getHostGeom: () => null }, [
      { ...line({ startPort: 0.5 }), id: 'a' },
    ]);
    rewirePortsAfterResize(
      's1',
      geom(OLD_RECT),
      geom({ x: 200, y: 100, width: 120, height: 720 }),
      ctx,
    );
    expect(updates).toEqual([]);
  });

  it('旧轴退化（prev 探针返回 null）或新轴退化：零写入', () => {
    const oldDegenerate = {
      getAxisAnchor: (g?: IHostGeom) => (g?.rect.height === 520 ? null : OLD_AXIS),
    };
    const a = makeCtx(oldDegenerate, [{ ...line({ startPort: 0.5 }), id: 'a' }]);
    rewirePortsAfterResize('l1', geom(OLD_RECT), geom(OLD_RECT), a.ctx);
    expect(a.updates).toEqual([]);

    const newDegenerate = {
      getAxisAnchor: (g?: IHostGeom) => (g?.rect.height === 520 ? OLD_AXIS : null),
    };
    const b = makeCtx(newDegenerate, [{ ...line({ startPort: 0.5 }), id: 'a' }]);
    rewirePortsAfterResize(
      'l1',
      geom(OLD_RECT),
      geom({ x: 200, y: 100, width: 120, height: 720 }),
      b.ctx,
    );
    expect(b.updates).toEqual([]);
  });

  it('宿主 vm 缺失：零写入不抛错', () => {
    const { ctx, updates } = makeCtx(null, [{ ...line({ startPort: 0.5 }), id: 'a' }]);
    rewirePortsAfterResize('l1', geom(OLD_RECT), geom(OLD_RECT), ctx);
    expect(updates).toEqual([]);
  });
});
