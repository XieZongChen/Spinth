import { describe, expect, it, vi } from 'vitest';
import { ShapeService } from '../widgets/shape/shapeService';

/** 形状工具默认创建型（docs/04 §2 形状默认型小节，2026-10-11 工具坞二级菜单） */

function makeService() {
  const added: Array<Record<string, unknown>> = [];
  const engine = {
    add: (w: Record<string, unknown>) => {
      added.push(w);
      return { id: String(w.id) };
    },
    genInitialOrder: () => 'a0',
  };
  const svc = new ShapeService(
    {} as never, // viewport（构造期未用）
    engine as never,
    {} as never, // history
    {} as never, // selector
  );
  return { svc, added };
}

describe('ShapeService 默认型（会话级工具参数）', () => {
  it('默认 rect；流初值同步', () => {
    const { svc } = makeService();
    expect(svc.defaultShapeType).toBe('rect');
    expect(svc.defaultShapeType$.value).toBe('rect');
  });

  it('setDefaultShapeType：字段 + 流 + createWidget 落库全链生效', () => {
    const { svc, added } = makeService();
    svc.setDefaultShapeType('ellipse');
    expect(svc.defaultShapeType).toBe('ellipse');
    expect(svc.defaultShapeType$.value).toBe('ellipse');
    // createWidget 是 protected——经（基类同名的）落库路径直驱：调用受保护方法需 cast
    (
      svc as unknown as { createWidget: (x: number, y: number, w: number, h: number) => string }
    ).createWidget(0, 0, 100, 80);
    expect((added[0] as { shapeType: string }).shapeType).toBe('ellipse');
  });

  it('同值早退：流不重发（订阅即发的初值除外）', () => {
    const { svc } = makeService();
    const next = vi.fn();
    const sub = svc.defaultShapeType$.subscribe(next);
    expect(next).toHaveBeenCalledTimes(1); // BehaviorSubject 订阅即发初值 'rect'
    svc.setDefaultShapeType('rect'); // 同值
    expect(next).toHaveBeenCalledTimes(1); // 早退不重发
    svc.setDefaultShapeType('diamond'); // 真变更
    expect(next).toHaveBeenCalledTimes(2);
    expect(next).toHaveBeenLastCalledWith('diamond');
    sub.unsubscribe();
  });

  it('非法值：zod 校验抛错且不污染状态', () => {
    const { svc } = makeService();
    expect(() => svc.setDefaultShapeType('not-a-shape' as never)).toThrow();
    expect(svc.defaultShapeType).toBe('rect');
  });
});
