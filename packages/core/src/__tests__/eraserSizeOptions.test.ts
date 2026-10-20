import { describe, expect, it, vi } from 'vitest';
import { EraserService } from '../widgets/eraser/eraserService';

/** 橡皮大小档位（docs/04 §2 工具默认参数节，2026-10-11——唯一「调参即刻生效」项） */

function makeService(mode = 'eraser'): EraserService {
  return new EraserService(
    { cursorMode$: { value: mode } } as never,
    {} as never,
    {} as never,
    {} as never,
  );
}

describe('EraserService 大小档位（会话级工具参数，面板/方括号同源）', () => {
  it('默认 10；setRadius 直设 + 流发射；EraserCursor 视觉由调用方接线（服务内 cursor 为 null 安全）', () => {
    const svc = makeService();
    expect(svc.currentRadiusPx).toBe(10);
    const next = vi.fn();
    const sub = svc.radiusPx$.subscribe(next);
    expect(next).toHaveBeenCalledTimes(1); // 订阅即发初值
    svc.setRadius(24);
    expect(next).toHaveBeenCalledTimes(2);
    expect(next).toHaveBeenLastCalledWith(24);
    expect(svc.currentRadiusPx).toBe(24);
    sub.unsubscribe();
  });

  it('钳制与同值早退：超出 [4,40] 钳到边界；同值不重发', () => {
    const svc = makeService();
    const next = vi.fn();
    const sub = svc.radiusPx$.subscribe(next);
    svc.setRadius(100);
    expect(svc.currentRadiusPx).toBe(40);
    svc.setRadius(40); // 同值
    expect(next).toHaveBeenCalledTimes(2); // 初值 + 钳到 40 一次
    svc.setRadius(1);
    expect(svc.currentRadiusPx).toBe(4);
    sub.unsubscribe();
  });

  it('adjustRadius 模式自查：非 eraser 模式下方括号不生效（setRadius 无此限制——面板仅激活时可见）', () => {
    const svc = makeService('cursor');
    svc.adjustRadius(4); // 模式不符 → no-op
    expect(svc.currentRadiusPx).toBe(10);
    svc.setRadius(16); // 面板通道不受限
    expect(svc.currentRadiusPx).toBe(16);
  });
});
