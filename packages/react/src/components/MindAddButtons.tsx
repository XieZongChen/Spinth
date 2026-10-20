import { useSpinthStore } from '../store/spinthStore';
import { spinthCommands } from '../store/commands';
import { Icon } from './Icon';

/**
 * 脑图焦点节点 + 按钮（docs/12 §4，对齐既有设计 mindAddBtn 思路）：
 * 左/右 = 建子（根双侧、非根所在侧），下 = 建同级。
 * 删除走上方 ActionBar 的删除按钮（2026-09-22 用户实测：上方删除圆按钮
 * 与 ActionBar 叠压冲突，只保留操作栏）——不再有上方槽位。
 *
 * bounds 是 canvas 局部坐标（同 ActionBar 语义——挂 <main> 内直接用，
 * 禁止再 +TOPBAR_HEIGHT）。定位纯算术：焦点节点外接矩形四向偏移。
 */

/** 按钮直径（视觉规格：比 ActionBar 控件大一圈，远目标易点） */
const BTN = 28;
/** 按钮与节点边缘的间距 */
const GAP = 8;

interface Slot {
  key: string;
  title: string;
  left: number;
  top: number;
  onClick: () => void;
}

export function MindAddButtons() {
  const state = useSpinthStore((s) => s.mindAddButtons);
  if (!state) return null;
  const { bounds, isRoot, direction, slotLeft, slotRight } = state;
  const midX = bounds.x + bounds.width / 2 - BTN / 2;
  const midY = bounds.y + bounds.height / 2 - BTN / 2;

  const slots: Slot[] = [];
  // 左右：建子（根双侧可建，非根只建所在侧——方向由槽位决定）
  if (isRoot || direction === 'left') {
    slots.push({
      key: 'left',
      title: '添加左侧子主题',
      left: slotLeft - BTN - GAP,
      top: midY,
      onClick: () => spinthCommands.mindAddChild('left'),
    });
  }
  if (isRoot || direction === 'right') {
    slots.push({
      key: 'right',
      title: '添加右侧子主题',
      left: slotRight + GAP,
      top: midY,
      onClick: () => spinthCommands.mindAddChild('right'),
    });
  }
  // 下：建同级（根无同级）。删除无槽位——走 ActionBar 删除按钮
  // （removeSelected 对焦点子节点的删节点特判既有）
  if (!isRoot) {
    slots.push({
      key: 'sibling',
      title: '添加同级主题',
      left: midX,
      top: bounds.y + bounds.height + GAP,
      onClick: () => spinthCommands.mindAddSibling(),
    });
  }

  return (
    <>
      {slots.map((s) => (
        <button
          key={s.key}
          type="button"
          title={s.title}
          aria-label={s.title}
          onClick={s.onClick}
          onPointerDown={(e) => e.stopPropagation()}
          style={{ left: s.left, top: s.top, width: BTN, height: BTN }}
          className="pointer-events-auto absolute z-10 flex items-center justify-center rounded-full border border-edge bg-surface text-tool-mind shadow-dock transition-transform duration-100 hover:scale-110 hover:border-tool-mind"
        >
          <Icon name="add" size={16} strokeWidth={2.2} />
        </button>
      ))}
    </>
  );
}
