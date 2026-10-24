// @vitest-environment jsdom
/**
 * 单机断网不变量（批次 A · A4，specs/a11y-mobile §8）：组合根按
 * `!!config.wsUrl` 决定 blockOnOffline——单机不传 wsUrl → 恒 false →
 * editBlocked 恒 false，断网仍可编辑。这些测试把语义锁死：wsUrl 一旦
 * 进入启动路径，这里先红，提醒补 editBlocked 交互矩阵（docs/10 §4）。
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { NetworkService } from '../platform/network/networkService';

// jsdom 的 navigator.onLine 默认 true 且 dispatchEvent 不会改它——
// defineProperty 直写 + 手动派发 window 事件驱动 update 回调
function setOnline(v: boolean): void {
  Object.defineProperty(navigator, 'onLine', { value: v, configurable: true });
}
function fire(type: 'online' | 'offline'): void {
  window.dispatchEvent(new Event(type));
}

let originalDescriptor: PropertyDescriptor;

beforeEach(() => {
  originalDescriptor = Object.getOwnPropertyDescriptor(navigator, 'onLine')!;
  setOnline(true);
});

afterEach(() => {
  // jsdom 的 onLine 是原型 getter（无 own property）：删掉测试写入的
  // own property 即回落原型；有 own property 时（其他环境）还原描述符
  if (originalDescriptor) {
    Object.defineProperty(navigator, 'onLine', originalDescriptor);
  } else {
    delete (navigator as { onLine?: boolean }).onLine;
  }
});

describe('NetworkService（单机断网不变量）', () => {
  it('默认构造（单机：无 wsUrl → blockOnOffline=false）：离线也不阻断', () => {
    setOnline(false);
    const svc = new NetworkService();
    svc.initialize();
    expect(svc.editBlocked$.value).toBe(false); // 单机恒放行
    fire('offline');
    expect(svc.editBlocked$.value).toBe(false);
    svc.dispose();
  });

  it('blockOnOffline=true（协同宿主）：随 offline/online 三态翻转', () => {
    const svc = new NetworkService({ blockOnOffline: true });
    svc.initialize();
    expect(svc.editBlocked$.value).toBe(false); // 初始在线

    setOnline(false);
    fire('offline');
    expect(svc.editBlocked$.value).toBe(true);

    setOnline(true);
    fire('online');
    expect(svc.editBlocked$.value).toBe(false);

    setOnline(false);
    fire('offline');
    expect(svc.editBlocked$.value).toBe(true);
    svc.dispose();
  });

  it('构造时已离线 + blockOnOffline=true：初值即 true（构造器同步求值）', () => {
    setOnline(false);
    const svc = new NetworkService({ blockOnOffline: true });
    expect(svc.editBlocked$.value).toBe(true);
    svc.dispose();
  });

  it('dispose 后事件不再改值（监听已摘）', () => {
    const svc = new NetworkService({ blockOnOffline: true });
    svc.initialize();
    svc.dispose();
    setOnline(false);
    fire('offline');
    expect(svc.editBlocked$.value).toBe(false); // 离线前最后值，不被更新
  });
});
