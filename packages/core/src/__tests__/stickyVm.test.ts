import { describe, expect, it } from 'vitest';
import { Graphics } from 'pixi.js';
import { StickyVm } from '../widgets/sticky/stickyVm';

/** 便签编辑期节能早退（docs/17——编辑器 DOM 独占视觉，与 SHAPE 同模式） */

const state = {
  id: 'k1',
  type: 'STICKY' as const,
  zOrder: 'a0',
  color: '#fff3b0',
  text: '<p>便签文字</p>',
  x: 0,
  y: 0,
  width: 180,
  height: 180,
};
const state2 = { ...state, text: '<p>便签文字加长</p>', x: 10 };

/** docDisplay 是 root 上唯一非 Graphics 子节点（bg 常驻首位） */
const docOf = (vm: StickyVm): { visible: boolean } | undefined =>
  vm.root.children.find((c) => !(c instanceof Graphics)) as { visible: boolean } | undefined;

describe('stickyVm setTextEditing 编辑期节能早退', () => {
  it('进编辑即清出画布文字；编辑期 render 不重建、只挪位置', () => {
    const vm = new StickyVm(null);
    vm.setState({ ...state });
    vm.flushUpdate();
    expect(docOf(vm)).toBeDefined();
    vm.setTextEditing(true);
    expect(docOf(vm)).toBeUndefined();
    vm.setState({ ...state2 });
    vm.flushUpdate(); // 编辑期落库重绘 → 早退
    expect(docOf(vm)).toBeUndefined();
    expect(vm.root.x - vm.root.pivot.x).toBe(10);
  });

  it('退出编辑：refresh 强制全量恢复', () => {
    const vm = new StickyVm(null);
    vm.setState({ ...state });
    vm.flushUpdate();
    vm.setTextEditing(true);
    vm.setState({ ...state2 });
    vm.flushUpdate();
    vm.setTextEditing(false);
    const doc = docOf(vm);
    expect(doc).toBeDefined();
    expect(doc!.visible).toBe(true);
  });
});

describe('stickyVm 纯平移快速路径（docs/16——此前便签连拖动都全量重画）', () => {
  it('纯平移：docDisplay 引用不变（复用不重建）+ 位置更新', () => {
    const vm = new StickyVm(null);
    vm.setState({ ...state });
    vm.flushUpdate();
    const doc = docOf(vm);
    expect(doc).toBeDefined();
    vm.setState({ x: 77, y: 5 }); // 仅几何平移
    vm.flushUpdate();
    expect(docOf(vm)).toBe(doc); // 同一引用
    expect(vm.root.x - vm.root.pivot.x).toBe(77);
  });

  it('改底色/改字号必触发重建（守卫键防漏双向锁）', () => {
    const vm = new StickyVm(null);
    vm.setState({ ...state });
    vm.flushUpdate();
    const doc = docOf(vm);
    vm.setState({ color: '#c8ecd0' }); // 换便签色
    vm.flushUpdate();
    expect(docOf(vm)).not.toBe(doc);
    const doc2 = docOf(vm);
    vm.setState({ fontSize: 24 }); // 排版 override
    vm.flushUpdate();
    expect(docOf(vm)).not.toBe(doc2);
  });
});
