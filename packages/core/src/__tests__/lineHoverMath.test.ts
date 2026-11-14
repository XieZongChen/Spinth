import { describe, expect, it } from 'vitest';
import { resolveLineHover } from '../widgets/line/lineHoverMath';

/**
 * 连线端点/段身 hover 判定单测（2026-11 审查返工补——此前该纯函数零单测，
 * 胶囊高亮索引空间错位因此漏网）：端点 grab / 段身方向光标 / 近形禁拖
 * （锚定相邻段无高亮无光标）/ 过滤后索引空间回归锁。
 */

const U_PTS = [
  { x: 0, y: 0 },
  { x: 90, y: 0 },
  { x: 90, y: 100 },
  { x: 200, y: 100 },
];

describe('resolveLineHover 端点/段身判定', () => {
  it('距起点 ≤12/scale → 起点端点高亮 + grab 光标（段判定被端点优先压制）', () => {
    const hit = resolveLineHover(U_PTS, 'ELBOWED', null, { x: 3, y: 2 }, 1);
    expect(hit.endpointActive).toBe(0);
    expect(hit.hoverCursor).toBe('grab');
    expect(hit.hoverSegIndex).toBe(-1);
  });

  it('hover 中段 → 段身命中 + 拖向光标（水平段 ns / 垂直段 ew）', () => {
    const horiz = resolveLineHover(U_PTS, 'ELBOWED', null, { x: 45, y: 3 }, 1); // 段 0 水平
    expect(horiz.hoverSegIndex).toBe(0);
    expect(horiz.hoverCursor).toBe('ns-resize');
    const vert = resolveLineHover(U_PTS, 'ELBOWED', null, { x: 93, y: 50 }, 1); // 段 1 垂直
    expect(vert.hoverSegIndex).toBe(1);
    expect(vert.hoverCursor).toBe('ew-resize');
  });

  it('近形禁拖：锚定端相邻段 hover → 无高亮、无拖向光标（端点不贴边不 grab）', () => {
    // hover 段 0（首段）且 start 锚定 → 全空；同点位无 anchored（缺省）不受限
    const world = { x: 45, y: 3 };
    const blocked = resolveLineHover(U_PTS, 'ELBOWED', null, world, 1, {
      start: true,
      end: false,
    });
    expect(blocked.hoverSegIndex).toBe(-1);
    expect(blocked.segmentActive).toBeNull();
    expect(blocked.hoverCursor).toBeNull();
    const free = resolveLineHover(U_PTS, 'ELBOWED', null, world, 1, {
      start: false,
      end: true,
    });
    expect(free.hoverSegIndex).toBe(0); // end 锚定只禁末段，首段照常
  });

  it('过滤后索引空间回归锁：长首末段被过滤时 hover 中段 → segmentActive = 过滤数组首位', () => {
    // U_PTS 四段？三段各 ≥60（90/100/110）均为主段；两端锚定 → 过滤后只剩
    // 段 1 一个胶囊（渲染数组 [0]）——findIndex 必须在过滤数组上进行
    const hit = resolveLineHover(U_PTS, 'ELBOWED', null, { x: 93, y: 50 }, 1, {
      start: true,
      end: true,
    });
    expect(hit.hoverSegIndex).toBe(1);
    expect(hit.segmentActive).toBe(0); // 过滤数组下标，而非原始段号 1
  });

  it('无 anchored（缺省）不过滤 = 纯数学口径兼容：三主段全可高亮', () => {
    const hit = resolveLineHover(U_PTS, 'ELBOWED', null, { x: 45, y: 3 }, 1);
    expect(hit.hoverSegIndex).toBe(0);
    expect(hit.segmentActive).toBe(0); // 未过滤数组首位即段 0
  });
});
