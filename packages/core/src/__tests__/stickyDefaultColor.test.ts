import { describe, expect, it, vi } from 'vitest';
import { StickyService } from '../widgets/sticky/stickyService';

/** 便签默认底色（docs/04 §2 工具默认参数节，2026-10-11 二级菜单扩展） */

function makeService(): StickyService {
  return new StickyService({} as never, {} as never, {} as never, {} as never);
}

describe('StickyService 默认底色（会话级工具参数）', () => {
  it('默认 #fff3b0（= STICKY_DEFAULT_COLOR，默认像素零变化）', () => {
    const svc = makeService();
    expect(svc.defaultStickyColor).toBe('#fff3b0');
    expect(svc.defaultColor$.value).toBe('#fff3b0');
  });

  it('setDefaultStickyColor：字段 + 流；同值早退；色板外取值静默拒绝', () => {
    const svc = makeService();
    const next = vi.fn();
    const sub = svc.defaultColor$.subscribe(next);
    expect(next).toHaveBeenCalledTimes(1);
    svc.setDefaultStickyColor('#fff3b0'); // 同值
    expect(next).toHaveBeenCalledTimes(1);
    svc.setDefaultStickyColor('#c8ecd0');
    expect(next).toHaveBeenCalledTimes(2);
    expect(next).toHaveBeenLastCalledWith('#c8ecd0');
    expect(svc.defaultStickyColor).toBe('#c8ecd0');
    svc.setDefaultStickyColor('#ff0000'); // 色板外
    expect(svc.defaultStickyColor).toBe('#c8ecd0');
    expect(next).toHaveBeenCalledTimes(2);
    sub.unsubscribe();
  });
});
