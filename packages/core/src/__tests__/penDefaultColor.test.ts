import { describe, expect, it, vi } from 'vitest';
import { PenService } from '../widgets/pen/penService';

/** 画笔默认色（docs/04 §2 工具默认参数节，2026-10-11 二级菜单扩展） */

describe('PenService 默认色（会话级工具参数）', () => {
  it('默认 #1f2937（原创建硬编码值不变——默认像素零变化）；选项六色与色板同源', () => {
    const svc = new PenService({} as never, {} as never, {} as never);
    expect(svc.defaultPenColor).toBe('#1f2937');
    expect(svc.defaultColor$.value).toBe('#1f2937');
  });

  it('setDefaultPenColor：字段 + 流；同值早退不重发', () => {
    const svc = new PenService({} as never, {} as never, {} as never);
    const next = vi.fn();
    const sub = svc.defaultColor$.subscribe(next);
    expect(next).toHaveBeenCalledTimes(1); // 订阅即发初值
    svc.setDefaultPenColor('#1f2937'); // 同值
    expect(next).toHaveBeenCalledTimes(1);
    svc.setDefaultPenColor('#dc2626');
    expect(next).toHaveBeenCalledTimes(2);
    expect(next).toHaveBeenLastCalledWith('#dc2626');
    expect(svc.defaultPenColor).toBe('#dc2626');
    sub.unsubscribe();
  });

  it('非法值静默拒绝（非 hex 不污染状态）', () => {
    const svc = new PenService({} as never, {} as never, {} as never);
    svc.setDefaultPenColor('red');
    svc.setDefaultPenColor('#12345');
    expect(svc.defaultPenColor).toBe('#1f2937');
  });
});

describe('PenService 默认笔宽（会话级，线宽笔宽批）', () => {
  it('默认 4（schema default 同源）；四档 2/4/8/12 档位制静默拒绝', () => {
    const svc = new PenService({} as never, {} as never, {} as never);
    expect(svc.defaultStrokeWidth).toBe(4);
    const next = vi.fn();
    const sub = svc.defaultStrokeWidth$.subscribe(next);
    svc.setDefaultStrokeWidth(12);
    expect(svc.defaultStrokeWidth).toBe(12);
    svc.setDefaultStrokeWidth(4); // 同值早退
    svc.setDefaultStrokeWidth(3 as never); // 非档位拒绝
    svc.setDefaultStrokeWidth(Infinity as never);
    expect(svc.defaultStrokeWidth).toBe(4);
    sub.unsubscribe();
  });
});
