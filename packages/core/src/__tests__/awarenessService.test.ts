import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { Awareness } from 'y-protocols/awareness';
import { BehaviorSubject } from 'rxjs';
import {
  AwarenessService,
  PEER_COLORS,
  type IAwarenessState,
} from '../platform/awareness/awarenessService';
import type { CursorMode } from '../types';

/**
 * AwarenessService（docs/10 §3）：本地聚合 / 选色 / peers diff / 离线即焚。
 * 用裸 Awareness 实例（协议层语义由 server/集成测试覆盖）。
 */

function makeService(opts?: { states?: Map<number, unknown>; userName?: string }) {
  const doc = new Y.Doc();
  const awareness = new Awareness(doc);
  for (const [id, st] of opts?.states ?? new Map()) {
    awareness.states.set(id, st as never);
  }
  const curPos$ = new BehaviorSubject<{ x: number; y: number } | null>(null);
  const cursorMode$ = new BehaviorSubject<CursorMode>('cursor');
  const selected$ = new BehaviorSubject<string[]>([]);
  const vpScale$ = new BehaviorSubject(1);
  const service = new AwarenessService(
    awareness,
    { curPos$, cursorMode$, vpScale$ },
    { selected$ },
    opts?.userName ?? '测试者',
  );
  return { awareness, curPos$, cursorMode$, selected$, service, doc };
}

describe('AwarenessService（docs/10 §3）', () => {
  it('本地聚合：curPos/cursorMode/selected 变化合并写 setLocalState', () => {
    const { awareness, curPos$, cursorMode$, selected$ } = makeService();
    curPos$.next({ x: 100, y: 200 });
    cursorMode$.next('pen');
    selected$.next(['w1', 'w2']);

    const local = awareness.getLocalState() as IAwarenessState;
    expect(local.cursorPos).toEqual({ x: 100, y: 200 });
    expect(local.cursorMode).toBe('pen');
    expect(local.selectedWidgetIds).toEqual(['w1', 'w2']);
    expect(local.userName).toBe('测试者');
    expect(PEER_COLORS).toContain(local.userColor);
  });

  it('选色：随机起点且避开已占用色', () => {
    const taken = PEER_COLORS[0]!;
    const { awareness } = makeService({
      states: new Map([[999, { userColor: taken }]]),
    });
    expect(awareness.getLocalState()?.userColor).not.toBe(taken);
  });

  it('peers diff：远端增/改/删三队列', () => {
    const { awareness, service } = makeService();
    const peerId = 42;
    // 远端加入
    awareness.states.set(peerId, {
      userId: 'u9',
      userName: '远端',
      userColor: '#f5484d',
      cursorMode: 'cursor',
      cursorPos: null,
      selectedWidgetIds: [],
    });
    awareness.setLocalState(awareness.getLocalState()); // 触发 change 事件（本地写入）
    awareness.emit('change', [{ added: [peerId], updated: [], removed: [] }, 'remote']);
    expect(service.peers$.value.get(peerId)?.userName).toBe('远端');
    // 远端更新
    awareness.states.set(peerId, {
      userId: 'u9',
      userName: '远端2',
      userColor: '#f5484d',
      cursorMode: 'pen',
      cursorPos: { x: 1, y: 2 },
      selectedWidgetIds: ['a'],
    });
    awareness.emit('change', [{ added: [], updated: [peerId], removed: [] }, 'remote']);
    expect(service.peers$.value.get(peerId)?.userName).toBe('远端2');
    expect(service.peers$.value.get(peerId)?.cursorPos).toEqual({ x: 1, y: 2 });
    // 远端离开
    awareness.states.delete(peerId);
    awareness.emit('change', [{ added: [], updated: [], removed: [peerId] }, 'remote']);
    expect(service.peers$.value.has(peerId)).toBe(false);
    // 本地 clientID 永不进 peers
    expect(service.peers$.value.has(awareness.clientID)).toBe(false);
  });

  it('离线即焚：dispose 后 localState 置 null', () => {
    const { awareness, service } = makeService();
    expect(awareness.getLocalState()).not.toBeNull();
    service.dispose();
    expect(awareness.getLocalState()).toBeNull();
  });

  it('构造时种子快照：连接先于订阅建立时不漏已在线 peer（2026-09 已知遗留修复）', () => {
    const { awareness, service } = makeService({
      states: new Map<number, unknown>([
        [111, { userId: 'u-a', userName: 'A', userColor: '#f5484d', cursorPos: { x: 1, y: 2 } }],
        [222, { userName: '无userId 的噪音状态' }],
      ]),
    });
    // 再补一个「自身 clientID」状态：必须被排除
    awareness.states.set(awareness.clientID, { userId: 'u-self' });

    const peers = service.peers$.value;
    expect(peers.size).toBe(1);
    expect(peers.get(111)?.userId).toBe('u-a');
    expect(peers.has(awareness.clientID)).toBe(false);
    expect(peers.has(222)).toBe(false);
  });
});
