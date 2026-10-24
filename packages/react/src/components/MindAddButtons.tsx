import { useLayoutEffect, useState } from 'react';
import { useSpinthStore } from '../store/spinthStore';
import { spinthCommands } from '../store/commands';
import { Icon } from './Icon';
import { MIND_ADD_BTN, buildMindAddSlots } from '../mindAddLayout';

/**
 * 脑图焦点节点 + 按钮（docs/12 §4，对齐既有设计 mindAddBtn 思路）：
 * 左/右 = 建子（根双侧、非根所在侧），下 = 建同级。
 * 删除走上方 ActionBar 的删除按钮（2026-09-22 用户实测：上方删除圆按钮
 * 与 ActionBar 叠压冲突，只保留操作栏）——不再有上方槽位。
 *
 * bounds 是 canvas 局部坐标（同 ActionBar 语义——挂 <main> 内直接用，
 * 禁止再 +TOPBAR_HEIGHT）。定位数学在 mindAddLayout.ts（批次 A · D8
 * 抽纯函数：靠边节点钳制进容器，390 下按钮不再冲出视口）。
 */

/** 槽位标题（与 buildMindAddSlots 的 key 对应） */
const SLOT_META: Record<'left' | 'right' | 'sibling', { title: string; onClick: () => void }> = {
  left: { title: '添加左侧子主题', onClick: () => spinthCommands.mindAddChild('left') },
  right: { title: '添加右侧子主题', onClick: () => spinthCommands.mindAddChild('right') },
  sibling: { title: '添加同级主题', onClick: () => spinthCommands.mindAddSibling() },
};

export function MindAddButtons() {
  const state = useSpinthStore((s) => s.mindAddButtons);
  const editable = useSpinthStore((s) => s.editable); // 只读态不渲染（docs/21 §4）
  // 焦点对象在只读态不存在（降级即清、右键不建选区）——隐藏是语义结果
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
  const { bounds, isRoot, direction, slotLeft, slotRight } = state;
  const slots = buildMindAddSlots({
    bounds,
    isRoot,
    direction,
    slotLeft,
    slotRight,
    area: area.width > 0 ? area : { width: window.innerWidth, height: window.innerHeight },
  });

  return (
    <>
      {slots.map((s) => (
        <button
          key={s.key}
          type="button"
          title={SLOT_META[s.key].title}
          aria-label={SLOT_META[s.key].title}
          data-spinth-mind-add={s.key}
          onClick={SLOT_META[s.key].onClick}
          onPointerDown={(e) => e.stopPropagation()}
          style={{ left: s.left, top: s.top, width: MIND_ADD_BTN, height: MIND_ADD_BTN }}
          className="pointer-events-auto absolute z-10 flex items-center justify-center rounded-full border border-edge bg-surface text-tool-mind shadow-dock transition-transform duration-100 hover:scale-110 hover:border-tool-mind"
        >
          <Icon name="add" size={16} strokeWidth={2.2} />
        </button>
      ))}
    </>
  );
}
