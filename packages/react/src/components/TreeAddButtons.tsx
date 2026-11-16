import { useLayoutEffect, useState } from 'react';
import { useSpinthStore } from '../store/spinthStore';
import { spinthCommands } from '../store/commands';
import { Icon } from './Icon';
import { TREE_ADD_BTN, clampTreeAddSlots } from '../treeAddLayout';

/**
 * 树形图焦点节点 + 按钮（docs/12 §4 + specs/tree-diagrams §8.5）：
 * 槽位由 core getTreeAddButtons 按 kind/orientation 计算（mind 横向左/右+下、
 * 竖向上/下+右；org 下+右——Phase 3），本组件只钳制与渲染。
 * 删除走上方 ActionBar 的删除按钮（与 MindAddButtons 时期同决策）。
 * bounds/slots 是 canvas 局部坐标（挂 <main> 内直接用，禁止 +TOPBAR_HEIGHT）。
 */

/** 槽位动作：文案随 kind/物理轴（审查返工 P0-3）——org 无侧「添加子主题」；
 *  mind horizontal 左/右（沿用 MindAddButtons 旧文案，mindSelect.spec 等
 *  选择器零迁移）；vertical 上/下 */
function slotAction(
  slot: { key: 'child' | 'sibling'; side?: 'left' | 'right' },
  kind: 'MIND_MAP' | 'ORG_CHART',
  orientation: 'horizontal' | 'vertical',
): {
  title: string;
  onClick: () => void;
} {
  if (slot.key === 'sibling') {
    return { title: '添加同级主题', onClick: () => spinthCommands.mindAddSibling() };
  }
  const title =
    kind === 'ORG_CHART'
      ? '添加子主题'
      : orientation === 'vertical'
        ? slot.side === 'left'
          ? '添加上方子主题'
          : '添加下方子主题'
        : slot.side === 'left'
          ? '添加左侧子主题'
          : '添加右侧子主题';
  return { title, onClick: () => spinthCommands.mindAddChild(slot.side) };
}

export function TreeAddButtons() {
  const state = useSpinthStore((s) => s.treeAddButtons);
  const editable = useSpinthStore((s) => s.editable); // 只读态不渲染（docs/21 §4）
  // 钳制区域 = <main> 客户区；useLayoutEffect 同步量取（绘制前），
  // 首帧兜底 window 尺寸（Area 为 0 的极端下纯函数钳到下限 4）
  const [area, setArea] = useState({ width: 0, height: 0 });
  useLayoutEffect(() => {
    const measure = (): void =>
      setArea((prev) => {
        const el = document.querySelector('main');
        const next = el
          ? { width: el.clientWidth, height: el.clientHeight }
          : { width: window.innerWidth, height: window.innerHeight };
        return prev.width === next.width && prev.height === next.height ? prev : next;
      });
    measure();
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, []);
  if (!editable || !state) return null;
  const slots = clampTreeAddSlots(state.slots, area);
  const vertical = state.orientation === 'vertical';
  const act = (s: (typeof slots)[number]) =>
    slotAction(s, state.kind, vertical ? 'vertical' : 'horizontal');
  return (
    <>
      {slots.map((s) => {
        // data 属性沿用 mind-add（mobile E2E 选择器依赖）；org child 无侧
        // → 'child'（审查返工 P0-3：org 槽位唯一，选择器用 child）
        const dataKey = s.key === 'child' ? (s.side ?? 'child') : 'sibling';
        return (
          <button
            key={s.key === 'child' ? `child-${s.side ?? 'x'}` : 'sibling'}
            type="button"
            title={act(s).title}
            aria-label={act(s).title}
            data-spinth-mind-add={dataKey}
            onClick={() => act(s).onClick()}
            onPointerDown={(e) => e.stopPropagation()}
            style={{ left: s.left, top: s.top, width: TREE_ADD_BTN, height: TREE_ADD_BTN }}
            className="pointer-events-auto absolute z-10 flex items-center justify-center rounded-full border border-edge bg-surface text-tool-mind shadow-dock transition-transform duration-100 hover:scale-110 hover:border-tool-mind"
          >
            <Icon name="add" size={16} strokeWidth={2.2} />
          </button>
        );
      })}
    </>
  );
}
