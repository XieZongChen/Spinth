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

/** 槽位动作：child 槽带逻辑侧（vertical 时 left=上、right=下——命令名恒 mind*） */
function slotAction(slot: { key: 'child' | 'sibling'; side?: 'left' | 'right' }): {
  title: string;
  onClick: () => void;
} {
  if (slot.key === 'sibling') {
    return { title: '添加同级主题', onClick: () => spinthCommands.mindAddSibling() };
  }
  return {
    title: slot.side === 'left' ? '添加子主题（左/上）' : '添加子主题（右/下）',
    onClick: () => spinthCommands.mindAddChild(slot.side),
  };
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
  return (
    <>
      {slots.map((s) => {
        // data 属性沿用 mind-add（mobile E2E 选择器依赖；key 含逻辑侧：
        // child-left/child-right/sibling——竖向时 left=上、right=下）
        const dataKey = s.key === 'child' ? s.side : 'sibling';
        return (
          <button
            key={s.key === 'child' ? `child-${s.side ?? 'x'}` : 'sibling'}
            type="button"
            title={slotAction(s).title}
            aria-label={slotAction(s).title}
            data-spinth-mind-add={dataKey}
            onClick={() => slotAction(s).onClick()}
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
