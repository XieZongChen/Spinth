// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { BehaviorSubject } from 'rxjs';
import { EditingService } from '../platform/textEngine/editingService';
import type { IEditSessionDescriptor } from '../types';

/**
 * 统一编辑会话编排桩测试（docs/17 §5 批 4 护栏）：全局互斥抢占 / 退出序列
 * 时序（flush → 空文本策略 → onExit → detach）/ discard 语义 / 同目标重入
 * （IME）/ dispose 兜底。修过一次的编排 bug 必须留下桩测试（docs/15 §3）。
 */

function makeHarness() {
  const removed: string[] = [];
  const selected: string[][] = [];
  const viewport = {
    vpScale$: new BehaviorSubject(1),
    vpBounds$: new BehaviorSubject({ x: 0, y: 0, width: 800, height: 600 }),
    toScreen: (p: { x: number; y: number }) => ({ ...p }),
    worldToClient: (p: { x: number; y: number }) => ({ ...p }),
  };
  const engine = { removeByIds: (ids: string[]) => removed.push(...ids) };
  const selector = { setSelected: (ids: string[]) => selected.push(ids) };
  const history = { undo: vi.fn(), redo: vi.fn(), stopCapturing: vi.fn() };
  const svc = new EditingService(
    viewport as never,
    engine as never,
    selector as never,
    history as never,
  );
  const desc = (
    over: Partial<IEditSessionDescriptor> & { onExit?: IEditSessionDescriptor['onExit'] } = {},
  ): IEditSessionDescriptor => ({
    widgetId: 'w1',
    kernel: 'html',
    getRect: () => ({ x: 0, y: 0, width: 100, height: 40 }),
    getContent: () => '<p>hello</p>',
    style: { fontSize: 16, color: '#333333', lineHeight: 1.5 },
    onCommit: vi.fn(),
    emptyTextPolicy: 'keep',
    ...over,
  });
  return { svc, removed, selected, desc, history };
}

describe('EditingService 统一编辑会话（docs/17）', () => {
  it('begin/exitActive 基本面：会话身份 + session$ 开始/结束各广播一次', () => {
    const { svc, desc } = makeHarness();
    const events: string[] = [];
    svc.session$.subscribe(() => events.push('session'));
    svc.begin(desc());
    expect(svc.editingWidgetId).toBe('w1');
    expect(svc.activeKernel).toBe('html');
    svc.exitActive();
    expect(svc.editingWidgetId).toBeNull();
    expect(svc.activeKernel).toBeNull();
    expect(events).toHaveLength(2);
    svc.dispose();
  });

  it('空文本 + delete-widget：退出时删除控件并清选区（docs/07 §7 TEXT 语义）', () => {
    const { svc, removed, selected, desc } = makeHarness();
    svc.begin(desc({ getContent: () => '<p></p>', emptyTextPolicy: 'delete-widget' }));
    svc.exitActive();
    expect(removed).toEqual(['w1']);
    expect(selected).toEqual([[]]);
    svc.dispose();
  });

  it('非空文本 + delete-widget：不删；空文本 + keep：不删（LINE/mind 语义）', () => {
    const { svc, removed, desc } = makeHarness();
    svc.begin(desc({ emptyTextPolicy: 'delete-widget' }));
    svc.exitActive();
    expect(removed).toEqual([]);
    svc.begin(desc({ getContent: () => '<p></p>', emptyTextPolicy: 'keep' }));
    svc.exitActive();
    expect(removed).toEqual([]);
    svc.dispose();
  });

  it('全局互斥抢占：begin 新会话先干净退出旧会话（onExit 收到旧会话收尾）', () => {
    const { svc, desc } = makeHarness();
    const exitA = vi.fn();
    svc.begin(desc({ onExit: exitA }));
    svc.begin(desc({ widgetId: 'w2' }));
    expect(exitA).toHaveBeenCalledTimes(1);
    expect(svc.editingWidgetId).toBe('w2');
    svc.dispose();
  });

  it('同内核同目标重入：不触发抢占退出（IME 合成会话保护，批 3 契约）', () => {
    const { svc, desc } = makeHarness();
    const exitA = vi.fn();
    svc.begin(desc({ nodeKey: 'n1', onExit: exitA }));
    svc.begin(desc({ nodeKey: 'n1' }));
    expect(exitA).not.toHaveBeenCalled();
    expect(svc.editingWidgetId).toBe('w1');
    svc.dispose();
  });

  it('plain 同节点重入不重建 DOM（appendChild 仅一次），异节点重建', () => {
    const { svc, desc } = makeHarness();
    const appendChild = vi.spyOn(document.body, 'appendChild');
    const plain = (nodeKey: string): IEditSessionDescriptor =>
      desc({
        kernel: 'plain',
        nodeKey,
        getContent: () => '文本',
        style: {
          fontSize: 18,
          lineHeightPx: 18,
          color: '#fff',
          background: '#1f2937',
          paddingX: 8,
          paddingY: 4,
        },
      });
    svc.begin(plain('n1'));
    svc.begin(plain('n1')); // IME 重入：不重建
    expect(appendChild).toHaveBeenCalledTimes(1);
    svc.begin(plain('n2')); // 换节点：重建
    expect(appendChild).toHaveBeenCalledTimes(2);
    svc.exitActive();
    svc.dispose();
  });

  it('discard 退出：不落库不删控件，onExit 携 discarded 元信息（mind Esc 语义）', () => {
    const { svc, removed, desc } = makeHarness();
    const onCommit = vi.fn();
    const onExit = vi.fn();
    svc.begin(
      desc({
        widgetId: 'wx',
        getContent: () => '<p></p>',
        emptyTextPolicy: 'delete-widget',
        onCommit,
        onExit,
      }),
    );
    svc.exitActive({ discard: true });
    expect(onCommit).not.toHaveBeenCalled();
    expect(removed).toEqual([]); // discard 不执行空文本删除
    expect(onExit).toHaveBeenCalledWith(true, { discarded: true });
    svc.dispose();
  });

  it('dispose 兜底：编辑中的 dispose 走统一退出序列（onExit 被调）', () => {
    const { svc, desc } = makeHarness();
    const onExit = vi.fn();
    svc.begin(desc({ onExit }));
    svc.dispose();
    expect(onExit).toHaveBeenCalledTimes(1);
  });

  it('P0-3 编辑中 Cmd+Z：先 flush pending 再 undo（次序锁），撤销后编辑器重同步 model 现值', () => {
    const { svc, history, desc } = makeHarness();
    const order: string[] = [];
    let modelText = '<p>hello</p>';
    const onCommit = vi.fn((html: string) => {
      modelText = html;
      order.push('commit');
    });
    history.undo.mockImplementation(() => {
      order.push('undo');
      modelText = '<p>xyz</p>'; // 模拟 Yjs 回滚后的 model 现值
    });
    svc.begin(desc({ getContent: () => modelText, onCommit }));
    // 造一个 34ms 节流窗内的 pending（私有通道直驱——私有成员访问是本仓测试既定契约）
    (svc as unknown as { scheduleCommit: (h: string) => void }).scheduleCommit('<p>ABC</p>');
    // jsdom 双垫片：① style 属性子串选择器不可靠（序列化带空格）——按容器取
    // 末位编辑器 div（共享容器内最新追加者）；② PM scrollToSelection 读
    // getClientRects（无布局环境缺该 API）
    const proto = Element.prototype as unknown as { getClientRects?: () => unknown[] };
    if (!proto.getClientRects) {
      proto.getClientRects = () => [{ left: 0, top: 0, right: 0, bottom: 0, width: 0, height: 0 }];
    }
    const editors = document.querySelectorAll('#spinth-text-layer > div');
    const dom = editors[editors.length - 1]!;
    dom.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', metaKey: true, bubbles: true }));
    expect(order).toEqual(['commit', 'undo']); // flush 先于 undo——修复前直接 undo、timer 到点复活
    expect(onCommit).toHaveBeenCalledWith('<p>ABC</p>');
    // 重同步：DOM 收到 undo 后的 model 现值（非撤销前显示）
    expect(dom.innerHTML).toContain('xyz');
    svc.exitActive();
    svc.dispose();
  });

  it('P0-3 exitActive 不 stopCapturing（微任务相重路由须靠开窗并入同一撤销项——落地即撤教训）', () => {
    const { svc, history, desc } = makeHarness();
    svc.begin(desc());
    svc.exitActive();
    // 撤：exit 时关窗会把 SHAPE 撑高的锚定线微任务重路由裂成第二 undo 项
    // （autoHeight E2E 实锤），锁「不关窗」防回归
    expect(history.stopCapturing).not.toHaveBeenCalled();
    svc.dispose();
  });
});
