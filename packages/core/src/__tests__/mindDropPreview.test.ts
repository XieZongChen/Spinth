import { describe, expect, it } from 'vitest';
import {
  FAKE_NODE_HEIGHT,
  FAKE_NODE_WIDTH,
  FAKE_VERTICAL_MARGIN,
  fakeBlockRect,
} from '../widgets/mind/mindDropPreview';

const R = (x: number, y: number, w: number, h: number) => ({ x, y, width: w, height: h });

describe('拖拽预置块位置（docs/11 §6，既有设计 calculateFakeBounds 逐分支）', () => {
  const dest = R(100, 100, 80, 30);

  it('右树：块在父右侧 + offset，尺寸 40×16', () => {
    const r = fakeBlockRect({ dest, before: null, after: null, direction: 'right', offset: 48 });
    expect(r).toEqual({
      x: 100 + 80 + 48,
      y: 100 + (30 - FAKE_NODE_HEIGHT) / 2,
      width: FAKE_NODE_WIDTH,
      height: FAKE_NODE_HEIGHT,
    });
  });

  it('左树：块在父左侧 − offset − 块宽', () => {
    const r = fakeBlockRect({ dest, before: null, after: null, direction: 'left', offset: 100 });
    expect(r.x).toBe(100 - 100 - FAKE_NODE_WIDTH);
  });

  it('两侧都有兄弟 → 居中于间隙', () => {
    const r = fakeBlockRect({
      dest,
      before: R(300, 40, 60, 20),
      after: R(300, 120, 60, 20),
      direction: 'right',
      offset: 48,
    });
    // 60 ~ 120 之间居中：40+20=60 → 60 + (120-60-16)/2 = 82
    expect(r.y).toBe(60 + (120 - 60 - FAKE_NODE_HEIGHT) / 2);
  });

  it('只有前兄弟 → 其下方 +16；只有后兄弟 → 其上方 −16', () => {
    const after = R(300, 120, 60, 20);
    expect(
      fakeBlockRect({
        dest,
        before: R(300, 40, 60, 20),
        after: null,
        direction: 'right',
        offset: 48,
      }).y,
    ).toBe(40 + 20 + FAKE_VERTICAL_MARGIN);
    expect(fakeBlockRect({ dest, before: null, after, direction: 'right', offset: 48 }).y).toBe(
      120 - FAKE_NODE_HEIGHT - FAKE_VERTICAL_MARGIN,
    );
  });
});
