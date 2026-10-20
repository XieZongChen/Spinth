import { describe, expect, it, vi } from 'vitest';
import { LineService } from '../widgets/line/lineService';

/** 连线工具默认线型/线宽（docs/04 §2 工具默认参数节，2026-10-11 / 线宽笔宽批 2026-10-14） */

function makeService(): LineService {
  // 构造期未触依赖（initialize 才接线）；四件套字段/流不依赖注入件
  return new LineService(
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
  );
}

describe('LineService 默认线型（会话级工具参数）', () => {
  it('默认 ELBOWED（2026-09 拍板——新线一律正交折线）', () => {
    const svc = makeService();
    expect(svc.defaultLineType).toBe('ELBOWED');
    expect(svc.defaultLineType$.value).toBe('ELBOWED');
  });

  it('setDefaultLineType：字段 + 流；同值早退不重发', () => {
    const svc = makeService();
    const next = vi.fn();
    const sub = svc.defaultLineType$.subscribe(next);
    expect(next).toHaveBeenCalledTimes(1); // BehaviorSubject 订阅即发初值
    svc.setDefaultLineType('ELBOWED'); // 同值
    expect(next).toHaveBeenCalledTimes(1);
    svc.setDefaultLineType('CURVE');
    expect(next).toHaveBeenCalledTimes(2);
    expect(next).toHaveBeenLastCalledWith('CURVE');
    expect(svc.defaultLineType).toBe('CURVE');
    sub.unsubscribe();
  });

  it('非法值：zod 校验抛错且不污染状态', () => {
    const svc = makeService();
    expect(() => svc.setDefaultLineType('zigzag' as never)).toThrow();
    expect(svc.defaultLineType).toBe('ELBOWED');
  });
});

describe('LineService 默认线宽（会话级工具参数，线宽笔宽批）', () => {
  it('默认 2；四档 1/2/4/8 档位制（sticky 色板外拒绝先例——非法值静默拒绝）', () => {
    const svc = makeService();
    expect(svc.defaultStrokeWidth).toBe(2);
    expect(svc.defaultStrokeWidth$.value).toBe(2);
    const next = vi.fn();
    const sub = svc.defaultStrokeWidth$.subscribe(next);
    svc.setDefaultStrokeWidth(8);
    expect(svc.defaultStrokeWidth).toBe(8);
    expect(next).toHaveBeenLastCalledWith(8);
    svc.setDefaultStrokeWidth(2); // 同值早退
    svc.setDefaultStrokeWidth(3 as never); // 非档位——静默拒绝不污染
    svc.setDefaultStrokeWidth(NaN as never);
    expect(svc.defaultStrokeWidth).toBe(2);
    sub.unsubscribe();
  });
});
