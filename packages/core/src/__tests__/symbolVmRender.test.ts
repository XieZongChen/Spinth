// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { Graphics } from 'pixi.js';
import { SymbolVm } from '../widgets/symbol/symbolVm';

/** SymbolVm 渲染行为（specs/symbol-widget §4.7 占位 / §5.4 空标签 / §7.1 编辑早退） */

const state = {
  id: 'y1',
  type: 'SYMBOL' as const,
  zOrder: 'a0',
  symbol: 'net-router',
  label: '核心路由',
  x: 0,
  y: 0,
  width: 96,
  height: 126,
};
const state2 = { ...state, label: '核心路由器', x: 10 };

/** labelDisplay 是 root 上唯一非 Graphics 子节点（glyphLayer/placeholderLayer
 *  常驻前两位且都是 Graphics——shapeVmRender 的 docOf 同款口径） */
const labelOf = (vm: SymbolVm): { visible: boolean } | undefined =>
  vm.root.children.find((c) => !(c instanceof Graphics)) as { visible: boolean } | undefined;

const hiddenOf = (vm: SymbolVm, idx: number): { visible: boolean } | undefined =>
  vm.root.children[idx] as { visible: boolean } | undefined;

describe('未知 kind 降级占位（§4.7：不抛错、不阻断、标签照常）', () => {
  it('未知 symbol id：图形层隐藏、占位层可见、标签正常渲染', () => {
    const vm = new SymbolVm(null);
    vm.setState({ ...state, symbol: 'net-future-gateway' });
    vm.flushUpdate();
    // root.children[0] = glyphLayer（共享 context 的 Graphics）、[1] = placeholderLayer
    expect(hiddenOf(vm, 0)!.visible).toBe(false);
    expect(hiddenOf(vm, 1)!.visible).toBe(true);
    expect(labelOf(vm)).toBeDefined();
    expect(labelOf(vm)!.visible).toBe(true);
  });

  it('已知 kind：图形层可见、占位层隐藏', () => {
    const vm = new SymbolVm(null);
    vm.setState({ ...state });
    vm.flushUpdate();
    expect(hiddenOf(vm, 0)!.visible).toBe(true);
    expect(hiddenOf(vm, 1)!.visible).toBe(false);
  });
});

describe('空标签只画图标（§5.4：空串 = 不渲染 labelDisplay）', () => {
  it('label 空串：root 上无非 Graphics 子节点', () => {
    const vm = new SymbolVm(null);
    vm.setState({ ...state, label: '' });
    vm.flushUpdate();
    expect(labelOf(vm)).toBeUndefined();
    // 有标签时存在——同 vm 写入 label 后全量重建出 labelDisplay
    vm.setState({ ...state, label: '命名' });
    vm.flushUpdate();
    expect(labelOf(vm)).toBeDefined();
  });
});

describe('setTextEditing 编辑期节能早退（§7.1，SHAPE 同模式）', () => {
  it('进编辑清出画布标签；编辑期 render 不重建、只挪位置', () => {
    const vm = new SymbolVm(null);
    vm.setState({ ...state });
    vm.flushUpdate();
    expect(labelOf(vm)).toBeDefined();
    vm.setTextEditing(true);
    expect(labelOf(vm)).toBeUndefined();
    vm.setState({ ...state2 });
    vm.flushUpdate();
    expect(labelOf(vm)).toBeUndefined();
    expect(vm.root.x - vm.root.pivot.x).toBe(10);
  });

  it('退出编辑：refresh 强制全量恢复（错过 state 重建出 labelDisplay）', () => {
    const vm = new SymbolVm(null);
    vm.setState({ ...state });
    vm.flushUpdate();
    vm.setTextEditing(true);
    vm.setState({ ...state2 });
    vm.flushUpdate();
    vm.setTextEditing(false);
    expect(labelOf(vm)).toBeDefined();
    expect(labelOf(vm)!.visible).toBe(true);
  });
});
