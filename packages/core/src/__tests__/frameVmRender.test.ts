// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { Graphics, Text } from 'pixi.js';
import { FrameVm, resolveFrameTitleColor } from '../widgets/frame/frameVm';

/** FrameVm 渲染行为（specs/container-frame §3.2/§3.4/§4.10 编辑早退） */

const state = {
  id: 'f1',
  type: 'FRAME' as const,
  zOrder: 'a0',
  title: '审批泳道',
  color: '#ffffff',
  borderStyle: 'solid' as const,
  x: 100,
  y: 50,
  width: 320,
  height: 220,
};

/** titleText 是 root 上唯一非 Graphics 子节点（symbolVmRender.labelOf 同款口径） */
const titleOf = (vm: FrameVm): Text | undefined =>
  vm.root.children.find((c) => !(c instanceof Graphics)) as Text | undefined;

describe('标题渲染（§3.2/§3.4）', () => {
  it('有标题：root 上挂 Text；空标题不挂', () => {
    const vm = new FrameVm();
    vm.setState({ ...state });
    vm.flushUpdate();
    expect(titleOf(vm)).toBeDefined();
    expect(titleOf(vm)!.text).toBe('审批泳道');
    vm.setState({ ...state, title: '' });
    vm.flushUpdate();
    expect(titleOf(vm)).toBeUndefined();
  });

  it('退化尺寸（w/h < 24）不画标题、渲染不抛错（§3.2 退化守卫）', () => {
    const vm = new FrameVm();
    expect(() => {
      vm.setState({ ...state, width: 20, height: 220 });
      vm.flushUpdate();
      vm.setState({ ...state, width: 320, height: 18 });
      vm.flushUpdate();
    }).not.toThrow();
    expect(titleOf(vm)).toBeUndefined();
  });

  it('纯平移快速路径：只挪 root，不重建标题节点', () => {
    const vm = new FrameVm();
    vm.setState({ ...state });
    vm.flushUpdate();
    const before = titleOf(vm);
    vm.setState({ ...state, x: 140 });
    vm.flushUpdate();
    expect(titleOf(vm)).toBe(before); // 同一 Text 实例（未销毁重建）
    expect(vm.root.x - vm.root.pivot.x).toBe(140);
  });

  it('headerSide 切换走全量重绘（分隔线换向）不抛错', () => {
    const vm = new FrameVm();
    vm.setState({ ...state });
    vm.flushUpdate();
    expect(() => {
      vm.setState({ ...state, headerSide: 'left' });
      vm.flushUpdate();
    }).not.toThrow();
    expect(titleOf(vm)).toBeDefined();
  });
});

describe('setTitleEditing 编辑期节能早退（§4.10，SYMBOL 同模式）', () => {
  it('进编辑清出画布标题；编辑期 render 不重建、只挪位置', () => {
    const vm = new FrameVm();
    vm.setState({ ...state });
    vm.flushUpdate();
    expect(titleOf(vm)).toBeDefined();
    vm.setTitleEditing(true);
    expect(titleOf(vm)).toBeUndefined();
    vm.setState({ ...state, x: 110 });
    vm.flushUpdate();
    expect(titleOf(vm)).toBeUndefined();
    expect(vm.root.x - vm.root.pivot.x).toBe(110);
  });

  it('退出编辑：refresh 强制全量恢复（错过 state 重建出标题）', () => {
    const vm = new FrameVm();
    vm.setState({ ...state });
    vm.flushUpdate();
    vm.setTitleEditing(true);
    vm.setState({ ...state, title: '新标题' });
    vm.flushUpdate();
    vm.setTitleEditing(false);
    expect(titleOf(vm)).toBeDefined();
    expect(titleOf(vm)!.text).toBe('新标题');
  });
});

describe('resolveFrameTitleColor（§5.4 双态护栏单源）', () => {
  it('per-实例 titleColor 优先；坏值兜底走自适应', () => {
    expect(resolveFrameTitleColor({ titleColor: '#123456', color: '#ffffff' })).toBe('#123456');
    expect(resolveFrameTitleColor({ titleColor: 'red', color: '#ffffff' })).toBe('#333333');
  });

  it('白底深字 / 深底浅字双态；无填充对画布走主题墨色', () => {
    expect(resolveFrameTitleColor({ color: '#ffffff' })).toBe('#333333');
    expect(resolveFrameTitleColor({ color: '#0f172a' })).toBe('#ffffff');
    expect(resolveFrameTitleColor({ fill: 'none', color: '#ffffff' })).toBe('#333333'); // light 主题
  });
});
