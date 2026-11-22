import { describe, expect, it } from 'vitest';
import { FrameService } from '../widgets/frame/frameService';
import { FRAME_DEFAULT_SIZE } from '../widgets/frame/frameGeometry';

/** FrameService 创建工具骨架（specs/container-frame §4.1）；归属/级联后续批次 */

function makeService() {
  const added: Array<Record<string, unknown>> = [];
  const engine = {
    add: (w: Record<string, unknown>) => {
      added.push(w);
      return { id: String(w.id) };
    },
    genInitialOrder: () => 'a0',
  };
  const svc = new FrameService(
    {} as never, // viewport（构造期未用）
    engine as never,
    {} as never, // vmEngine（归属批次前未用）
    {} as never, // selector
    {} as never, // history
    null, // editingService（标题编辑批次前未用）
  );
  return { svc, added };
}

describe('FrameService 创建工具（§4.1）', () => {
  it('createWidget：写 {type:FRAME, zOrder, color, rect}，缺省样式走 schema', () => {
    const { svc, added } = makeService();
    (
      svc as unknown as { createWidget: (x: number, y: number, w: number, h: number) => string }
    ).createWidget(100, 50, 320, 220);
    expect(added).toHaveLength(1);
    expect(added[0]).toMatchObject({
      type: 'FRAME',
      zOrder: 'a0',
      color: '#ffffff',
      x: 100,
      y: 50,
      width: 320,
      height: 220,
    });
    // title/borderStyle 不写——parse 缺省兜底（旧文档零迁移口径）
    expect('title' in added[0]!).toBe(false);
    expect('borderStyle' in added[0]!).toBe(false);
  });

  it('默认尺寸 = FRAME_DEFAULT_SIZE（单击创建 320×220）', () => {
    expect(FRAME_DEFAULT_SIZE).toEqual({ width: 320, height: 220 });
  });
});
