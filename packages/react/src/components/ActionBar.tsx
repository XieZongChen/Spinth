import { useLayoutEffect, useRef, useState } from 'react';
import { useSpinthStore } from '../store/spinthStore';
import { spinthCommands } from '../store/commands';
import { Icon } from './Icon';
import type { IconName } from './Icon';
import { PopoverControl } from './PopoverControl';
import { Tooltip } from './Tooltip';
import type { IActionBarSchema } from '@spinth/core';

/**
 * 选中浮动操作栏（docs/12 §4/§5）：schema 驱动动态渲染——一级 bar 只放
 * 「当前值图标 + ▾」单按钮位（popover 字段）与 toggle，选项收进二级面板，
 * 文字说明收进 tooltip（2026-10-03 参考视频对齐；各元素类型只维护
 * core 侧 schema，样式与交互全部由本组件体系统一承载）。
 * 定位用纯算术（选区屏幕外接矩形上方居中 + 视口钳制）——单锚点场景
 * 不引入 floating-ui（决策差异记录于 docs/12 §5）。
 *
 * 坐标系（2026-09 遮挡 bug 修正）：bridge 给的 bounds 是 canvas 局部坐标，
 * 而本组件挂在 <main>（relative，画布区域）内、style.top 参照 main——两者同系，
 * 直接使用即可，禁止再 +TOPBAR_HEIGHT（否则顶栏偏移双计，栏压在图形上）。
 */

/** 操作栏出现在选区上方的间距（视觉规格） */
const OFFSET_Y = 12;
/** 操作栏预估高度（上方放不下时翻到下方；实际由内容撑开 ≈38px） */
const BAR_HEIGHT_EST = 40;
/** 实测宽度就绪前的渲染帧宽度兜底（useLayoutEffect 校正发生在绘制前） */
const BAR_WIDTH_FALLBACK = 320;

function ToggleControl({
  item,
  onToggle,
}: {
  item: IActionBarSchema['items'][number];
  onToggle: (id: string, value: boolean) => void;
}) {
  const active = item.value === true;
  return (
    <Tooltip label={item.label}>
      <button
        type="button"
        aria-label={item.label}
        aria-pressed={active}
        aria-disabled={item.disabled === true}
        disabled={item.disabled === true}
        onClick={() => onToggle(item.id, !active)}
        className={`flex h-7 w-7 items-center justify-center rounded-md transition-colors duration-100 ${
          active
            ? 'bg-surface-hover text-ink'
            : 'text-ink-2 hover:bg-surface-hover/60 hover:text-ink'
        } disabled:pointer-events-none disabled:opacity-40`}
      >
        <Icon name={(item.icon ?? '') as IconName} size={15} strokeWidth={2} />
      </button>
    </Tooltip>
  );
}

/** 多选动作命令表（docs/05 §7 几何八键 + docs/18 编组两键）：schema action id → 命令分发（id 契约单源在 core schema） */
const ALIGN_ACTIONS: Record<string, () => void> = {
  'align-left': (): void => spinthCommands.alignSelection('left'),
  'align-hcenter': (): void => spinthCommands.alignSelection('hcenter'),
  'align-right': (): void => spinthCommands.alignSelection('right'),
  'align-top': (): void => spinthCommands.alignSelection('top'),
  'align-vcenter': (): void => spinthCommands.alignSelection('vcenter'),
  'align-bottom': (): void => spinthCommands.alignSelection('bottom'),
  'dist-h': (): void => spinthCommands.distributeSelection('h'),
  'dist-v': (): void => spinthCommands.distributeSelection('v'),
  group: (): void => spinthCommands.groupSelection(),
  ungroup: (): void => spinthCommands.ungroupSelection(),
};

/** 纯动作按钮（kind 'action'）：点击即执行、无状态无面板；disabled 出禁用态（tooltip 仍可达——wrapper span 承接 hover） */
function ActionControl({ item }: { item: IActionBarSchema['items'][number] }) {
  const run = ALIGN_ACTIONS[item.id];
  return (
    <Tooltip label={item.label}>
      <button
        type="button"
        aria-label={item.label}
        aria-disabled={item.disabled === true}
        disabled={item.disabled === true}
        onClick={() => run?.()}
        className="flex h-7 w-7 items-center justify-center rounded-md text-ink-2 transition-colors duration-100 hover:bg-surface-hover/60 hover:text-ink disabled:pointer-events-none disabled:opacity-40"
      >
        <Icon name={(item.icon ?? '') as IconName} size={15} strokeWidth={2} />
      </button>
    </Tooltip>
  );
}

function renderSchema(schema: IActionBarSchema): React.ReactNode {
  const pick = (id: string, value: string): void =>
    spinthCommands.updateSelectedStyle({ [id]: value });
  const toggle = (id: string, value: boolean): void =>
    spinthCommands.updateSelectedStyle({ [id]: value });
  return schema.items.map((item) => (
    <div key={item.id} className="flex items-center gap-1">
      {item.kind === 'popover' && <PopoverControl item={item} onPick={pick} />}
      {item.kind === 'toggle' && <ToggleControl item={item} onToggle={toggle} />}
      {item.kind === 'action' && <ActionControl item={item} />}
    </div>
  ));
}

export function ActionBar() {
  const actionBar = useSpinthStore((s) => s.actionBar);
  const editable = useSpinthStore((s) => s.editable); // 只读态整条不渲染（docs/21 §4）
  const { schema, bounds } = actionBar;

  // 实测宽度参与居中/钳制计算：栏宽随 schema 内容变化，预估定值会导致
  // 视觉不居中（2026-09 用户实测反馈）。useLayoutEffect 在绘制前完成校正
  // （同步 setState → 重渲染），用户看不到中间帧。
  const barRef = useRef<HTMLDivElement | null>(null);
  const [measured, setMeasured] = useState<{ barW: number; areaW: number } | null>(null);
  useLayoutEffect(() => {
    const el = barRef.current;
    if (!el) return;
    const barW = el.offsetWidth;
    const areaW = el.parentElement?.clientWidth ?? window.innerWidth;
    setMeasured((prev) =>
      prev && Math.abs(prev.barW - barW) < 0.5 && prev.areaW === areaW ? prev : { barW, areaW },
    );
    // 依赖 schema/bounds：栏内容或选区几何变化时重量（相等短路保证不循环）
  }, [schema, bounds]);

  // 只读早退（hooks 之后，顺序稳定）：选区在只读态本就不存在（右键不建选区、
  // 降级即清），操作栏附着于选区——隐藏是语义结果而非特判，六个写控件不出现
  if (!editable || !schema || !bounds) return null;

  const barW = measured?.barW ?? BAR_WIDTH_FALLBACK;
  const areaW = measured?.areaW ?? window.innerWidth;
  // 以选区水平中心居中，画布区域内钳制（两侧最小留白 8px）
  const left = Math.min(
    Math.max(bounds.x + bounds.width / 2 - barW / 2, 8),
    Math.max(areaW - barW - 8, 8),
  );
  // 上方放得下则悬于选区上方；否则翻到下方（main 区域内最小留白 4px）。
  // 可快速创建的类型（选中态有外置连接点 + 快捷按钮，形状外 ~24px）→
  // 操作栏额外上移让位，避免盖住顶部连接点（用户实测反馈 #2）
  const QUICK_CAPABLE = new Set(['SHAPE', 'STICKY', 'TEXT', 'IMAGE']);
  const quickClear = QUICK_CAPABLE.has(schema.type) ? 34 : 0;
  const aboveY = bounds.y - OFFSET_Y - BAR_HEIGHT_EST - quickClear;
  const top = aboveY >= 4 ? aboveY : bounds.y + bounds.height + OFFSET_Y;

  return (
    <div
      ref={barRef}
      data-spinth-action-bar=""
      className="pointer-events-auto absolute z-10 flex items-center gap-1 rounded-xl border border-edge bg-surface px-2 py-1 shadow-dock"
      style={{ left, top }}
      onPointerDown={(e) => e.stopPropagation()}
    >
      {renderSchema(schema)}
      {schema.items.length > 0 && <span className="mx-0.5 h-4 w-px bg-edge" aria-hidden />}
      <Tooltip label="导出 PNG">
        <button
          type="button"
          aria-label="导出 PNG"
          onClick={() => spinthCommands.exportPNG('selection')}
          className="flex h-7 w-7 items-center justify-center rounded-md text-ink-2 transition-colors duration-100 hover:bg-surface-hover hover:text-ink"
        >
          <Icon name="image-down" size={15} strokeWidth={2} />
        </button>
      </Tooltip>
      <Tooltip label="删除">
        <button
          type="button"
          aria-label="删除"
          onClick={() => spinthCommands.removeSelected()}
          className="flex h-7 w-7 items-center justify-center rounded-md text-ink-2 transition-colors duration-100 hover:bg-danger-soft hover:text-danger"
        >
          <Icon name="trash" size={15} strokeWidth={2} />
        </button>
      </Tooltip>
    </div>
  );
}
