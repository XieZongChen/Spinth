import { describe, expect, it } from 'vitest';
import { TextVm } from '../widgets/text/textVm';

/** TEXT 编辑期节能早退 + docDisplay-null 不变量与纯平移快速路径（docs/17 编辑体系统一） */

const state = {
  id: 't1',
  type: 'TEXT' as const,
  zOrder: 'a0',
  text: '<p>文本内容</p>',
  x: 0,
  y: 0,
  width: 240,
  height: 40,
};
const state2 = { ...state, text: '<p>文本内容加长</p>', x: 10 };

describe('textVm setTextEditing 编辑期节能早退', () => {
  it('进编辑即清出画布文字；编辑期 render 不重建、只挪位置', () => {
    const vm = new TextVm(null);
    vm.setState({ ...state });
    vm.flushUpdate();
    expect(vm.root.children.length).toBeGreaterThan(0);
    vm.setTextEditing(true);
    expect(vm.root.children.length).toBe(0); // docDisplay 清出场景图
    vm.setState({ ...state2 });
    vm.flushUpdate(); // 编辑期落库重绘 → 早退
    expect(vm.root.children.length).toBe(0);
    expect(vm.root.x - vm.root.pivot.x).toBe(10);
  });

  it('退出 refresh 全量恢复：docDisplay===null 使快速路径不命中（画布不停旧内容）', () => {
    const vm = new TextVm(null);
    vm.setState({ ...state });
    vm.flushUpdate();
    vm.setTextEditing(true);
    vm.setState({ ...state2 });
    vm.flushUpdate(); // 早退（docDisplay 保持清出）
    vm.setTextEditing(false); // 退出：refresh(state,state)——快速路径首条件不命中
    // 全量重建恢复：docDisplay 回归（不变量：进编辑清出 + 编辑期不重建）
    expect(vm.root.children.length).toBeGreaterThan(0);
  });

  it('退出后恢复正常快速路径：纯平移不重建', () => {
    const vm = new TextVm(null);
    vm.setState({ ...state });
    vm.flushUpdate();
    vm.setTextEditing(true);
    vm.setTextEditing(false);
    const doc = vm.root.children[0]!;
    vm.setState({ x: 99, y: 1 }); // 纯平移
    vm.flushUpdate();
    expect(vm.root.children[0]).toBe(doc); // 同一引用——快速路径复用
    expect(vm.root.x - vm.root.pivot.x).toBe(99);
  });
});
