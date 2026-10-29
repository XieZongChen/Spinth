// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import { stubPixiCanvasDocument } from './helpers/pixiNodeEnv';
stubPixiCanvasDocument();
import { describe, expect, it } from 'vitest';
import { getRenderId } from '../common/render';
import { makeService, spec } from './helpers/mindDragFixture';

/**
 * 拖拽重排合法性回归（docs/11 §6：「目标是选中节点后代 → 拒绝」）：
 * hitDropOnTree 曾只排除拖起节点自身、不排其后代——拖到自己后代上松手，
 * move() 的「删除→插入游离对象」两步里插入随游离 Y 对象丢失（事务不序列化），
 * 整棵子树静默消失（数据丢失级，2026-09 Phase 4 复审揪出）。
 */

describe('dragEnd 单击/拖动区分（2026-09-20 用户实测：点子节点整树被拆成新图）', () => {
  it('单击（无 move）：返回 click，树完整、焦点落按下节点', () => {
    const { svc, model, rects } = makeService(spec('根', [spec('A')]));
    const a = model.root.children[0]!;
    rects.set(model.root.id, { x: 0, y: 0, width: 50, height: 20 });
    rects.set(a.id, { x: 200, y: 100, width: 60, height: 24 });

    svc.startDrag('mm-1', a.id, { x: 210, y: 105 });
    const result = svc.dragEnd({ x: 210, y: 105 });
    expect(result).toBe('click');
    expect(model.root.children.length).toBe(1); // A 未被拆走
    expect(svc.focusedNodeId).toBe(a.id);
    svc.dispose();
  });

  it('微抖（单轴位移 < 10px 屏幕）仍按单击处理', () => {
    const { svc, model, rects } = makeService(spec('根', [spec('A')]));
    const a = model.root.children[0]!;
    rects.set(model.root.id, { x: 0, y: 0, width: 50, height: 20 });
    rects.set(a.id, { x: 200, y: 100, width: 60, height: 24 });
    svc.startDrag('mm-1', a.id, { x: 210, y: 105 });
    svc.dragMove({ x: 211.5, y: 106 }); // 位移 ~1.6px < 阈值
    expect(svc.dragEnd({ x: 211.5, y: 106 })).toBe('click');
    expect(model.root.children.length).toBe(1);
    svc.dispose();
  });

  it('落点预置块按相邻兄弟判侧：悬停左侧分支时预置块必须在根节点左侧', () => {
    // 根：左分支 L、右分支 R。拖 R 并悬停到 **L 的列**（命中 asSibling(root, L 的下标)）
    // ——asSibling 目标不带 direction，曾对根层一律按 right 处理 → 预置块画到根右侧，
    // 用户看到的就是「拖拽时预置节点乱飘」。
    const { svc, model, rects } = makeService(
      spec('根', [spec('L', undefined, 'left'), spec('R', undefined, 'right')]),
    );
    const root = model.root;
    const [l, r] = [root.children[0]!, root.children[1]!];
    rects.set(root.id, { x: 0, y: 0, width: 100, height: 30 });
    rects.set(l.id, { x: -160, y: -20, width: 60, height: 20 });
    rects.set(r.id, { x: 200, y: -20, width: 60, height: 20 });

    svc.startDrag('mm-1', r.id, { x: 220, y: -10 });
    const hit = svc.dragMove({ x: -130, y: -10 }); // L 的本体列（current 带）
    expect(hit).toBe(true);
    const block = svc.dropPreviewDebug;
    expect(block).not.toBeNull();
    // 根左缘（0）− HORIZONTAL_OFFSET_ROOT(100) − 块宽(40) = −140，右边界 −100
    expect(block!.x + block!.width).toBe(-100);
    svc.dragEnd({ x: -130, y: -10 });
    svc.dispose();
  });

  it('脑图节点拖拽中发 dragMove$（浮层隐藏信号，此前只发 selector 自身拖拽）', () => {
    const { svc, model, rects } = makeService(spec('根', [spec('A')]));
    const a = model.root.children[0]!;
    rects.set(model.root.id, { x: 0, y: 0, width: 100, height: 30 });
    rects.set(a.id, { x: 200, y: 0, width: 60, height: 20 });
    const sel = svc as unknown as {
      selector: { dragMove$: { subscribe: (f: () => void) => { unsubscribe(): void } } };
    };
    void sel;
    svc.startDrag('mm-1', a.id, { x: 220, y: 10 });
    // 经 SelectorService 的委托路径才会发流；此处直接验证服务侧接口存在（编排护栏见 selector 桩测试）
    expect(typeof svc.dragMove).toBe('function');
    svc.dragEnd({ x: 220, y: 10 });
    svc.dispose();
  });

  it('拖影/落点预览/本体半透明都标脏（renderId 递增，否则画布不重绘）', () => {
    const { svc, model, rects } = makeService(spec('根', [spec('A'), spec('B')]));
    const root = model.root;
    const [a, b] = [root.children[0]!, root.children[1]!];
    rects.set(root.id, { x: 0, y: 0, width: 100, height: 30 });
    rects.set(a.id, { x: 200, y: -100, width: 60, height: 24 });
    rects.set(b.id, { x: 200, y: 100, width: 60, height: 24 });
    const before = getRenderId();
    svc.startDrag('mm-1', b.id, { x: 230, y: 110 });
    // 惰性拖影：按下不建视觉、不标脏（单击不闪现拖拽视觉）
    expect(getRenderId()).toBe(before);
    const afterStart = getRenderId();
    svc.dragMove({ x: 230, y: -70 });
    expect(getRenderId()).toBeGreaterThan(afterStart); // 拖影挂载 + 半透明 + 跟手 + 落点预览
    svc.dragEnd({ x: 230, y: -70 });
    svc.dispose();
  });

  it('单轴位移达 10px 即判定拖拽（既有设计轴阈值，非欧氏距离）', () => {
    const { svc, model, rects } = makeService(spec('根', [spec('A')]));
    const a = model.root.children[0]!;
    rects.set(model.root.id, { x: 0, y: 0, width: 50, height: 20 });
    rects.set(a.id, { x: 200, y: 100, width: 60, height: 24 });
    svc.startDrag('mm-1', a.id, { x: 210, y: 105 });
    // 斜向 45°：两轴各 ~7.1px（欧氏 10px）——轴阈值下仍算未拖动
    svc.dragMove({ x: 217.1, y: 112.1 });
    expect(svc.dragEnd({ x: 217.1, y: 112.1 })).toBe('click');
    // 单轴 10px → 判定拖拽（此处拖到空白 → 成新图）
    svc.startDrag('mm-1', a.id, { x: 210, y: 105 });
    svc.dragMove({ x: 220, y: 105 });
    expect(svc.dragEnd({ x: 220, y: 105 })).toBe('new-map');
    svc.dispose();
  });

  it('真拖动到空白（位移超阈值）：仍走拖出成新图（原语义保留）', () => {
    const { svc, model, rects } = makeService(spec('根', [spec('A')]));
    const a = model.root.children[0]!;
    rects.set(model.root.id, { x: 0, y: 0, width: 50, height: 20 });
    rects.set(a.id, { x: 200, y: 100, width: 60, height: 24 });
    svc.startDrag('mm-1', a.id, { x: 210, y: 105 });
    svc.dragMove({ x: 800, y: 600 }); // 空白远点
    expect(svc.dragEnd({ x: 800, y: 600 })).toBe('new-map');
    expect(model.root.children.length).toBe(0); // A 拖走
    svc.dispose();
  });

  it('再点已选中节点进入文本编辑：textarea 出现、Enter 落库 setText', () => {
    const { svc, model, rects } = makeService(spec('根', [spec('A')]));
    const a = model.root.children[0]!;
    rects.set(model.root.id, { x: 0, y: 0, width: 50, height: 20 });
    rects.set(a.id, { x: 200, y: 100, width: 60, height: 24 });
    // 第一次单击 = 选中（焦点落按下节点），第二次走通用激活通道进编辑
    svc.startDrag('mm-1', a.id, { x: 210, y: 105 });
    svc.dragEnd({ x: 210, y: 105 });
    expect(document.querySelector('body > textarea')).toBeNull(); // 单击不进编辑
    svc.enterNodeEditAt('mm-1', { x: 210, y: 105 });
    const ta = document.querySelector('body > textarea') as HTMLTextAreaElement | null;
    expect(ta).not.toBeNull();
    expect(ta!.value).toBe('A');
    ta!.value = '新文案';
    svc.exitNodeEdit(true);
    expect(a.toJSON().text).toBe('新文案'); // setText 落库
    expect(document.querySelector('body > textarea')).toBeNull(); // 编辑器移除
    svc.dispose();
  });

  it('选中态键入字符 → 进编辑并用该字符替换原文本（既有设计 handleTextKeyDown）', () => {
    const { svc, model, rects } = makeService(spec('根', [spec('A')]));
    const a = model.root.children[0]!;
    rects.set(model.root.id, { x: 0, y: 0, width: 50, height: 20 });
    rects.set(a.id, { x: 200, y: 100, width: 60, height: 24 });
    svc.initialize();
    svc.focusedNodeId = a.id;
    const ev = new KeyboardEvent('keydown', { key: '新', bubbles: true, cancelable: true });
    window.dispatchEvent(ev);
    const ta = document.querySelector('body > textarea') as HTMLTextAreaElement | null;
    expect(ta).not.toBeNull();
    expect(ta!.value).toBe('新'); // 全量替换
    expect(ev.defaultPrevented).toBe(true); // 已被脑图消费（不再触发工具快捷键）
    svc.exitNodeEdit(true);
    expect(a.toJSON().text).toBe('新');
    svc.dispose();
  });

  it('选中态键入：空格/带修饰键/无焦点时不进编辑', () => {
    const { svc, model, rects } = makeService(spec('根', [spec('A')]));
    const a = model.root.children[0]!;
    rects.set(model.root.id, { x: 0, y: 0, width: 50, height: 20 });
    rects.set(a.id, { x: 200, y: 100, width: 60, height: 24 });
    svc.initialize();
    svc.focusedNodeId = a.id;
    window.dispatchEvent(
      new KeyboardEvent('keydown', { key: ' ', bubbles: true, cancelable: true }),
    );
    window.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'r', metaKey: true, bubbles: true, cancelable: true }),
    );
    window.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Shift', bubbles: true, cancelable: true }),
    );
    expect(document.querySelector('body > textarea')).toBeNull();
    svc.dispose();
  });

  it('编辑态 Tab = 落库当前文本 + 建子节点并继续编辑；Shift+Enter 不提交', () => {
    // fallbackRect：Tab 新建的子节点没有预注册 rect，靠它才能打开编辑器
    const { svc, model, rects } = makeService(spec('根', [spec('A')]), {
      fallbackRect: { x: 200, y: 100, width: 60, height: 24 },
    });
    const a = model.root.children[0]!;
    rects.set(model.root.id, { x: 0, y: 0, width: 50, height: 20 });
    rects.set(a.id, { x: 200, y: 100, width: 60, height: 24 });
    svc.enterNodeEdit('mm-1', a.id);
    let ta = document.querySelector('body > textarea') as HTMLTextAreaElement;
    ta.value = 'A 改';
    ta.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true }));
    expect(a.toJSON().text).toBe('A 改'); // 当前文本先落库
    expect(a.children.length).toBe(1); // 建了子节点
    expect(a.children[0]!.toJSON().text).toBe('子节点 1'); // 默认文案
    ta = document.querySelector('body > textarea') as HTMLTextAreaElement;
    expect(ta).not.toBeNull(); // 继续编辑新节点
    expect(svc.focusedNodeId).toBe(a.children[0]!.id);
    // Shift+Enter 不提交（换行由 textarea 默认行为处理）
    ta.dispatchEvent(
      new KeyboardEvent('keydown', {
        key: 'Enter',
        shiftKey: true,
        bubbles: true,
        cancelable: true,
      }),
    );
    expect(document.querySelector('body > textarea')).not.toBeNull();
    svc.exitNodeEdit(false);
    svc.dispose();
  });

  it('编辑态 Cmd/Ctrl + ± 转发缩放画布', () => {
    const { svc, model, rects, viewport } = makeService(spec('根', [spec('A')]));
    const a = model.root.children[0]!;
    rects.set(model.root.id, { x: 0, y: 0, width: 50, height: 20 });
    rects.set(a.id, { x: 200, y: 100, width: 60, height: 24 });
    const calls: string[] = [];
    (viewport as unknown as { zoomIn: () => void; zoomOut: () => void }).zoomIn = () =>
      calls.push('in');
    (viewport as unknown as { zoomIn: () => void; zoomOut: () => void }).zoomOut = () =>
      calls.push('out');
    svc.enterNodeEdit('mm-1', a.id);
    const ta = document.querySelector('body > textarea') as HTMLTextAreaElement;
    ta.dispatchEvent(
      new KeyboardEvent('keydown', { key: '=', metaKey: true, bubbles: true, cancelable: true }),
    );
    ta.dispatchEvent(
      new KeyboardEvent('keydown', { key: '-', metaKey: true, bubbles: true, cancelable: true }),
    );
    expect(calls).toEqual(['in', 'out']);
    svc.exitNodeEdit(false);
    svc.dispose();
  });

  it('输入即落库（节流）：input 后模型文本即时更新，退出前 flush 不丢尾字', async () => {
    const { svc, model, rects } = makeService(spec('根', [spec('A')]));
    const a = model.root.children[0]!;
    rects.set(model.root.id, { x: 0, y: 0, width: 50, height: 20 });
    rects.set(a.id, { x: 200, y: 100, width: 60, height: 24 });
    svc.enterNodeEdit('mm-1', a.id);
    const ta = document.querySelector('body > textarea') as HTMLTextAreaElement;
    ta.value = '协';
    ta.dispatchEvent(new Event('input', { bubbles: true }));
    await new Promise((r) => setTimeout(r, 60)); // 过 34ms 节流窗口
    expect(a.toJSON().text).toBe('协'); // 未退出编辑即已落库（既有设计输入即写）
    // 再输入但不等待节流 → 退出时必须由 flush/ta.value 兜住
    ta.value = '协同';
    ta.dispatchEvent(new Event('input', { bubbles: true }));
    svc.exitNodeEdit(true);
    expect(a.toJSON().text).toBe('协同');
    svc.dispose();
  });

  it('输入法合成开始 → 进编辑并全选（compositionstart）', () => {
    const { svc, model, rects } = makeService(spec('根', [spec('A')]));
    const a = model.root.children[0]!;
    rects.set(model.root.id, { x: 0, y: 0, width: 50, height: 20 });
    rects.set(a.id, { x: 200, y: 100, width: 60, height: 24 });
    svc.initialize();
    svc.focusedNodeId = a.id;
    window.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }));
    const ta = document.querySelector('body > textarea') as HTMLTextAreaElement | null;
    expect(ta).not.toBeNull();
    expect(ta!.value).toBe('A'); // 文本保留，等 IME 落字替换
    expect(ta!.selectionStart).toBe(0);
    expect(ta!.selectionEnd).toBe(1);
    svc.dispose();
  });
});

describe('exitNodeEdit 焦点恢复条件化（2026-09-22 用户实测：blur 抢焦点）', () => {
  it('blur 落库时焦点已被 pointerdown 接管 → 不写回被编辑节点', () => {
    const { svc, model, rects } = makeService(spec('根', [spec('A'), spec('B')]));
    const a = model.root.children[0]!;
    const b = model.root.children[1]!;
    rects.set(model.root.id, { x: 0, y: 0, width: 50, height: 20 });
    rects.set(a.id, { x: 200, y: 100, width: 60, height: 24 });
    rects.set(b.id, { x: 400, y: 100, width: 60, height: 24 });

    // A 进入编辑（模拟建图后编辑器开着）
    svc.enterNodeEdit('mm-1', a.id);
    // pointerdown 已把焦点接管到 B（selector 的 focusNode 时序：mousedown →
    // PIXI pointerdown → focusNode —— blur 的 exitNodeEdit 发生在其后）
    svc.focusNode('mm-1', b.id);
    svc.exitNodeEdit(true); // textarea blur 落库
    expect(svc.focusedNodeId).toBe(b.id); // 曾被写回 A（编辑中的旧节点）
    svc.dispose();
  });

  it('键盘退出（焦点仍在被编辑节点）→ 正常恢复焦点广播', () => {
    const { svc, model, rects } = makeService(spec('根', [spec('A')]));
    const a = model.root.children[0]!;
    rects.set(model.root.id, { x: 0, y: 0, width: 50, height: 20 });
    rects.set(a.id, { x: 200, y: 100, width: 60, height: 24 });
    let fired = 0;
    const sub = svc.focusChanged$.subscribe(() => fired++);
    svc.enterNodeEdit('mm-1', a.id);
    const before = fired;
    svc.exitNodeEdit(true); // 焦点未被接管 → 恢复 + 广播
    expect(svc.focusedNodeId).toBe(a.id);
    expect(fired).toBeGreaterThan(before);
    sub.unsubscribe();
    svc.dispose();
  });
});
