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

  it('近形禁拖（距锚定端 30 屏显 px 内）：无高亮、无拖向光标；远端照常', () => {
    // hover 段 0（首段，90 长）：距起点 25（近形带内）且 start 锚定 → 全空
    const near = { x: 25, y: 1 };
    const blocked = resolveLineHover(U_PTS, 'ELBOWED', null, near, 1, {
      start: true,
      end: false,
    });
    expect(blocked.hoverSegIndex).toBe(-1);
    expect(blocked.segmentActive).toBeNull();
    expect(blocked.hoverCursor).toBeNull();
    // 同段远端（距起点 45 > 30）→ 照常高亮（2026-11 二次拍板）
    const far = resolveLineHover(U_PTS, 'ELBOWED', null, { x: 45, y: 3 }, 1, {
      start: true,
      end: false,
    });
    expect(far.hoverSegIndex).toBe(0);
    // end 锚定不影响首段
    expect(
      resolveLineHover(U_PTS, 'ELBOWED', null, { x: 25, y: 1 }, 1, { start: false, end: true })
        .hoverSegIndex,
    ).toBe(0);
  });

  it('唯一段（两点直线）中点：两端锚定也照常 hover（2026-11 用户截图场景）', () => {
    const L = [
      { x: 0, y: 0 },
      { x: 140, y: 0 },
    ];
    const mid = resolveLineHover(L, 'ELBOWED', null, { x: 70, y: 2 }, 1, {
      start: true,
      end: true,
    });
    expect(mid.hoverSegIndex).toBe(0);
    expect(mid.hoverCursor).toBe('ns-resize');
    const nearEnd = resolveLineHover(L, 'ELBOWED', null, { x: 20, y: 2 }, 1, {
      start: true,
      end: true,
    });
    expect(nearEnd.hoverSegIndex).toBe(-1); // 近形带内无反馈
  });

  it('过滤后索引空间回归锁：60 边际首段被过滤时 hover 中段 → segmentActive = 过滤数组首位', () => {
    // 首段 60（中点恰 30 ≤30 近形带内 → 胶囊被滤），段 1/2 长 100/110；
    // 过滤后胶囊数组 = [段1, 段2]，hover 段 1 → segmentActive = 0
    const M = [
      { x: 0, y: 0 },
      { x: 60, y: 0 },
      { x: 60, y: 100 },
      { x: 170, y: 100 },
    ];
    const hit = resolveLineHover(M, 'ELBOWED', null, { x: 63, y: 50 }, 1, {
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
