import { describe, expect, it, vi } from 'vitest';
import {
  EdgeAutoScrollService,
  type IEdgeScrollClock,
} from '../platform/viewport/edgeAutoScrollService';
import { EDGE_SCROLL_TIERS_PX_PER_S } from '../platform/viewport/edgeScrollMath';
import type { IViewportService } from '../types';

/**
 * 帧循环/状态机/回滚（specs/edge-auto-scroll §7.2 T11-T20）：注入假时钟
 * 确定性驱动，不依赖全局 fake timers。视口 1000×800；右热区 x=995 距右缘
 * 5px → 快档 −1080 px/s（符号：露出右侧世界 = panBy 负值）。
 */

/** 假时钟：advance 逐帧推进并执行到期回调（rAF 语义） */
class FakeClock implements IEdgeScrollClock {
  time = 0;
  readonly pending = new Map<number, () => void>();
  private seq = 0;
  now(): number {
    return this.time;
  }
  requestFrame(cb: () => void): number {
    const id = ++this.seq;
    this.pending.set(id, cb);
    return id;
  }
  cancelFrame(id: number): void {
    this.pending.delete(id);
  }
  /** 推进 ms 毫秒（每 frameMs 一帧），返回执行的帧数 */
  advance(ms: number, frameMs = 16.7): number {
    let frames = 0;
    for (let t = 0; t < ms; t += frameMs) {
      this.time += frameMs;
      const cbs = [...this.pending.values()];
      this.pending.clear();
      for (const cb of cbs) {
        cb();
        frames += 1;
      }
    }
    return frames;
  }
  /** 执行到期回调但不推进时间（构造 dt=0 的同毫秒帧——§13.2-② 路径） */
  runFrameWithoutAdvancing(): void {
    const cbs = [...this.pending.values()];
    this.pending.clear();
    for (const cb of cbs) cb();
  }
}

interface ViewportStub {
  viewport: IViewportService;
  panBy: ReturnType<typeof vi.fn>;
  replay: ReturnType<typeof vi.fn>;
  listeners: Map<string, () => void>;
}

function createViewportStub(replayResult = true): ViewportStub {
  const panBy = vi.fn();
  const replay = vi.fn(() => replayResult);
  const listeners = new Map<string, () => void>();
  const container = {
    addEventListener: (event: string, cb: () => void) => void listeners.set(event, cb),
    removeEventListener: (event: string) => void listeners.delete(event),
  };
  const viewport = {
    panBy,
    replayLastPointerMove: replay,
    getClientSize: () => ({ width: 1000, height: 800 }),
    container,
  } as unknown as IViewportService;
  return { viewport, panBy, replay, listeners };
}

const HOT_RIGHT = { x: 995, y: 400 };
const CENTER = { x: 500, y: 400 };

describe('EdgeAutoScrollService 帧循环（specs/edge-auto-scroll T11-T20）', () => {
  it('T11 中心区域 + dragging=true → 不起帧、不 panBy', () => {
    const s = createViewportStub();
    const clock = new FakeClock();
    const svc = new EdgeAutoScrollService(s.viewport, clock);
    svc.update(CENTER, true);
    expect(svc.scrolling).toBe(false);
    clock.advance(100);
    expect(s.panBy).not.toHaveBeenCalled();
    svc.dispose();
  });

  it('T12 右热区起帧：一帧 panBy(dx=v·dt/1000)（负值）+ 重放一次', () => {
    const s = createViewportStub();
    const clock = new FakeClock();
    const svc = new EdgeAutoScrollService(s.viewport, clock);
    svc.update(HOT_RIGHT, true);
    expect(svc.scrolling).toBe(true);
    expect(clock.pending.size).toBe(1);
    clock.advance(16.7);
    expect(s.panBy).toHaveBeenCalledTimes(1);
    const [dx, dy] = s.panBy.mock.calls[0] as [number, number];
    const v = -EDGE_SCROLL_TIERS_PX_PER_S[2]!;
    expect(dx).toBeCloseTo((v * 16.7) / 1000, 6);
    expect(dy).toBe(0);
    expect(s.replay).toHaveBeenCalledTimes(1);
    expect(clock.pending.size).toBe(1); // 下一帧已预约
    svc.dispose();
  });

  it('T12b 首帧 dt=0（同毫秒帧）→ 不自杀停：scrolling 保持、panBy 0 次、预约下一帧（§13.2-② 回归：按位移判停会立即终止）', () => {
    const s = createViewportStub();
    const clock = new FakeClock();
    const svc = new EdgeAutoScrollService(s.viewport, clock);
    svc.update(HOT_RIGHT, true);
    clock.runFrameWithoutAdvancing(); // start 置 lastFrameAt=now，首帧 dt=0
    expect(svc.scrolling).toBe(true);
    expect(s.panBy).not.toHaveBeenCalled();
    expect(clock.pending.size).toBe(1);
    svc.dispose();
  });

  it('T13 连推 3 帧 → panBy 三次，累计位移 ≈ v × 总时长', () => {
    const s = createViewportStub();
    const clock = new FakeClock();
    const svc = new EdgeAutoScrollService(s.viewport, clock);
    svc.update(HOT_RIGHT, true);
    clock.advance(16.7 * 3);
    expect(s.panBy).toHaveBeenCalledTimes(3);
    const total = (s.panBy.mock.calls as [number, number][]).reduce((acc, [dx]) => acc + dx, 0);
    expect(total).toBeCloseTo((-EDGE_SCROLL_TIERS_PX_PER_S[2]! * 16.7 * 3) / 1000, 4);
    svc.dispose();
  });

  it('T14 指针回中心 → 停帧；后续帧不再 panBy', () => {
    const s = createViewportStub();
    const clock = new FakeClock();
    const svc = new EdgeAutoScrollService(s.viewport, clock);
    svc.update(HOT_RIGHT, true);
    clock.advance(16.7);
    expect(s.panBy).toHaveBeenCalledTimes(1);
    svc.update(CENTER, true);
    expect(svc.scrolling).toBe(false);
    expect(clock.pending.size).toBe(0);
    clock.advance(100);
    expect(s.panBy).toHaveBeenCalledTimes(1);
    svc.dispose();
  });

  it('T15 未过阻尼（dragging=false）→ 不起帧（D6 回归）', () => {
    const s = createViewportStub();
    const clock = new FakeClock();
    const svc = new EdgeAutoScrollService(s.viewport, clock);
    svc.update(HOT_RIGHT, false);
    expect(svc.scrolling).toBe(false);
    expect(clock.pending.size).toBe(0);
    clock.advance(100);
    expect(s.panBy).not.toHaveBeenCalled();
    svc.dispose();
  });

  it('T16 重复 update 同参数 → 不重复起帧（幂等，重放路径重入安全）', () => {
    const s = createViewportStub();
    const clock = new FakeClock();
    const svc = new EdgeAutoScrollService(s.viewport, clock);
    svc.update(HOT_RIGHT, true);
    svc.update(HOT_RIGHT, true);
    svc.update({ x: 990, y: 400 }, true); // 同侧更深（档位不变）
    expect(clock.pending.size).toBe(1);
    expect(s.listeners.get('pointerleave')).toBeTruthy(); // 监听器只挂一份
    clock.advance(16.7);
    expect(s.panBy).toHaveBeenCalledTimes(1);
    svc.dispose();
  });

  it('T16b 重放路径同步重入 update → 不双调度、监听器不重复（§13.2-① 回归：frameId 守卫会指数加倍）', () => {
    const s = createViewportStub();
    const clock = new FakeClock();
    const svc = new EdgeAutoScrollService(s.viewport, clock);
    // 复现真实重放路径：replay → onPointerMove → update 同参数重入
    s.replay.mockImplementation(() => {
      svc.update(HOT_RIGHT, true);
      return true;
    });
    svc.update(HOT_RIGHT, true);
    clock.advance(16.7); // 该帧内 replay 同步重入 update
    expect(clock.pending.size).toBe(1); // 不翻倍（旧守卫下 ≥2）
    expect(s.listeners.size).toBe(1); // pointerleave 不重复挂载
    clock.advance(16.7 * 3); // 后续帧稳定：panBy 线性不爆炸
    expect(s.panBy).toHaveBeenCalledTimes(4); // 1 + 3
    svc.dispose();
  });

  it('T17 管线拒发 → panBy(dx) 后紧跟 panBy(−dx) 并自动 stop', () => {
    const s = createViewportStub(false); // replay 恒返回 false
    const clock = new FakeClock();
    const svc = new EdgeAutoScrollService(s.viewport, clock);
    svc.update(HOT_RIGHT, true);
    clock.advance(16.7);
    expect(s.panBy).toHaveBeenCalledTimes(2);
    const [dx1] = s.panBy.mock.calls[0] as [number, number];
    const [dx2] = s.panBy.mock.calls[1] as [number, number];
    expect(dx2).toBeCloseTo(-dx1, 9);
    expect(svc.scrolling).toBe(false);
    expect(clock.pending.size).toBe(0);
    svc.dispose();
  });

  it('T18 stop() 取消已预约帧（pending=0）；重复 stop 幂等', () => {
    const s = createViewportStub();
    const clock = new FakeClock();
    const svc = new EdgeAutoScrollService(s.viewport, clock);
    svc.update(HOT_RIGHT, true);
    expect(clock.pending.size).toBe(1);
    svc.stop();
    expect(clock.pending.size).toBe(0);
    expect(svc.scrolling).toBe(false);
    expect(() => {
      svc.stop();
      svc.stop();
    }).not.toThrow();
    clock.advance(100);
    expect(s.panBy).not.toHaveBeenCalled();
    svc.dispose();
  });

  it('T19 dispose() 后 update 无效、无监听残留', () => {
    const s = createViewportStub();
    const clock = new FakeClock();
    const svc = new EdgeAutoScrollService(s.viewport, clock);
    svc.update(HOT_RIGHT, true);
    svc.dispose();
    expect(s.listeners.size).toBe(0);
    expect(clock.pending.size).toBe(0);
    svc.update(HOT_RIGHT, true); // dead：不得复活
    expect(svc.scrolling).toBe(false);
    expect(clock.pending.size).toBe(0);
    clock.advance(100);
    expect(s.panBy).not.toHaveBeenCalled();
  });

  it('T20 pointerleave → 停帧', () => {
    const s = createViewportStub();
    const clock = new FakeClock();
    const svc = new EdgeAutoScrollService(s.viewport, clock);
    svc.update(HOT_RIGHT, true);
    const leave = s.listeners.get('pointerleave')!;
    expect(leave).toBeTruthy();
    leave();
    expect(svc.scrolling).toBe(false);
    expect(clock.pending.size).toBe(0);
    expect(s.listeners.size).toBe(0); // 监听器已摘
    clock.advance(100);
    expect(s.panBy).not.toHaveBeenCalled();
    svc.dispose();
  });
});
