import { describe, expect, it, vi } from 'vitest';
import { TextService } from '../widgets/text/textService';

/** 文本工具默认字号（docs/04 §2 工具默认参数节，2026-10-11 二级菜单扩展） */

function makeService(): TextService {
  const editing = {
    begin: () => {},
    exitActive: () => {},
    editingWidgetId: null,
    activeKernel: null,
    session$: { subscribe: () => ({ unsubscribe: () => {} }) },
  };
  return new TextService(
    {
      registerGlobalEventListener: () => {},
      setCursorMode: () => {},
      vpBounds$: { subscribe: () => ({ unsubscribe: () => {} }) },
    } as never,
    { getModelById: () => undefined } as never,
    { getVmById: () => undefined } as never,
    {
      selected$: { getValue: () => [], subscribe: () => ({ unsubscribe: () => {} }) },
      setSelected: () => {},
    } as never,
    { stopCapturing: () => {} } as never,
    editing as never,
  );
}

describe('TextService 默认字号（会话级工具参数）', () => {
  it('默认 16（= TEXT_FONT_SIZE，默认像素零变化）；档位表六档', () => {
    const svc = makeService();
    expect(svc.defaultTextFontSize).toBe(16);
    expect(svc.defaultFontSize$.value).toBe(16);
  });

  it('setDefaultFontSize：字段 + 流；同值早退；档位外取值静默拒绝', () => {
    const svc = makeService();
    const next = vi.fn();
    const sub = svc.defaultFontSize$.subscribe(next);
    expect(next).toHaveBeenCalledTimes(1);
    svc.setDefaultFontSize(16); // 同值
    expect(next).toHaveBeenCalledTimes(1);
    svc.setDefaultFontSize(24);
    expect(next).toHaveBeenCalledTimes(2);
    expect(next).toHaveBeenLastCalledWith(24);
    expect(svc.defaultTextFontSize).toBe(24);
    svc.setDefaultFontSize(18); // 档位外
    svc.setDefaultFontSize(NaN);
    expect(svc.defaultTextFontSize).toBe(24);
    expect(next).toHaveBeenCalledTimes(2);
    sub.unsubscribe();
  });
});
