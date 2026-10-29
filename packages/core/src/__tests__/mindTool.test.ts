import 'fake-indexeddb/auto';
import { stubPixiCanvasDocument } from './helpers/pixiNodeEnv';
stubPixiCanvasDocument();
import { describe, expect, it } from 'vitest';
import { makeTreeService, spec } from './helpers/mindServiceFixture';

describe('mind 工具：按下才建图（既有设计 mindToolbar.handlePointerDown）', () => {
  it('空白处按下 → 在按下点建图 + 回 cursor 模式（不依赖抬起）', () => {
    const { svc, viewport, handlers, adds } = makeTreeService(spec('根'));
    const modes: string[] = [];
    viewport.setCursorMode = ((m: string) => modes.push(m)) as unknown as () => void;
    svc.initialize();
    handlers.onPointerDown!({ world: { x: 320, y: 180 } });
    expect(adds.length).toBe(1);
    expect(adds[0]!.type).toBe('MIND_MAP');
    expect(adds[0]!.x).toBe(320);
    expect(adds[0]!.y).toBe(180);
    expect(modes).toContain('cursor');
    svc.dispose();
  });

  it('只有 onPointerDown（已移除抬起创建）：不存在「工具栏/浮层漏进的 up 建图」通道', () => {
    const { svc, handlers } = makeTreeService(spec('根'));
    svc.initialize();
    expect(handlers.onPointerUp).toBeUndefined();
    svc.dispose();
  });
});

describe('MindService 幽灵抑制流（2026-09-22 幽灵 DOM 化：core 只发语义）', () => {
  it('mind 模式指针移动：悬停脑图 suppressed=true、离开复位；切走工具复位', () => {
    const { svc, handlers, viewport, vmEngine } = makeTreeService(spec('根', [spec('a')]));
    svc.initialize();
    const vals: boolean[] = [];
    const sub = svc.ghostSuppressed$.subscribe((v) => vals.push(v));
    const vme = vmEngine as unknown as { getVmByPoint: () => Array<{ type: string }> };
    vme.getVmByPoint = () => [{ type: 'MIND_MAP' }];
    viewport.cursorMode$.next('mind');
    handlers.onPointerMove!({ world: { x: 1, y: 1 } } as never);
    expect(svc.ghostSuppressed$.value).toBe(true);
    // 离开（getVmByPoint 返回空）
    vme.getVmByPoint = () => [];
    handlers.onPointerMove!({ world: { x: 999, y: 999 } } as never);
    expect(svc.ghostSuppressed$.value).toBe(false);
    // 切走工具复位
    vme.getVmByPoint = () => [{ type: 'MIND_MAP' }];
    handlers.onPointerMove!({ world: { x: 1, y: 1 } } as never);
    viewport.cursorMode$.next('cursor');
    expect(svc.ghostSuppressed$.value).toBe(false);
    void vals;
    sub.unsubscribe();
    svc.dispose();
  });
});
