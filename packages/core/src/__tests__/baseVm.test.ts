import { describe, expect, it, vi } from 'vitest';
import { BaseVm } from '../base/baseVm';

interface TestState {
  n: number;
  label: string;
}

class TestVm extends BaseVm<TestState> {
  renderCalls = 0;
  constructor() {
    super({ n: 0, label: '' });
  }
  override render(_prev: TestState, next: TestState): void {
    this.renderCalls++;
    void next;
  }
}

describe('BaseVm 微任务合批（docs/04 §4，验收 1.12）', () => {
  it('一个 tick 内多次 setState 只触发一次 render', async () => {
    const vm = new TestVm();
    vm.setState({ n: 1 });
    vm.setState({ n: 2 });
    vm.setState({ label: 'a' });
    expect(vm.renderCalls).toBe(0); // 同步阶段不渲染
    await Promise.resolve(); // 微任务刷新
    expect(vm.renderCalls).toBe(1);
    expect(vm.state.n).toBe(2);
    expect(vm.state.label).toBe('a');
  });

  it('shouldUpdate 拦截后状态仍合并但不渲染', async () => {
    class GuardedVm extends TestVm {
      protected override shouldUpdate(next: TestState): boolean {
        return next.n < 10;
      }
    }
    const vm = new GuardedVm();
    vm.setState({ n: 5 });
    await Promise.resolve();
    expect(vm.renderCalls).toBe(1);
    vm.setState({ n: 50 });
    await Promise.resolve();
    expect(vm.renderCalls).toBe(1); // 被拦截
    expect(vm.state.n).toBe(50); // 状态仍更新
  });

  it('dispose 后 setState 无效', async () => {
    const vm = new TestVm();
    vm.dispose();
    vm.setState({ n: 1 });
    await Promise.resolve();
    expect(vm.renderCalls).toBe(0);
  });

  it('render 收到 prev/next', async () => {
    const vm = new TestVm();
    const spy = vi.spyOn(vm, 'render');
    vm.setState({ n: 7 });
    await Promise.resolve();
    expect(spy).toHaveBeenCalledWith({ n: 0, label: '' }, { n: 7, label: '' });
  });
});
