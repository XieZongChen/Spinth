import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useSpinthStore } from '../store/spinthStore';
import { spinthCommands } from '../store/commands';
import { readSafeInsets, type ISafeInsets } from '../a11y/safeArea';
import {
  BAR_HEIGHT_EST,
  BAR_WIDTH_FALLBACK,
  computeBarLayout,
  ZERO_INSETS,
} from './actionBarLayout';
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
 * 定位几何在 actionBarLayout.ts 纯函数；宽度/容器宽/安全区全部在
 * useLayoutEffect 内测量（渲染期零 DOM 读取），resize/orientationchange 失效重算。
 */

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

function renderSchema(
  schema: IActionBarSchema,
  openPopoverId: string | null,
  setOpenPopoverId: (id: string | null) => void,
): React.ReactNode {
  const pick = (id: string, value: string): void =>
    spinthCommands.updateSelectedStyle({ [id]: value });
  const toggle = (id: string, value: boolean): void =>
    spinthCommands.updateSelectedStyle({ [id]: value });
  return schema.items.map((item) => (
    <div key={item.id} className="flex items-center gap-1">
      {item.kind === 'popover' && (
        <PopoverControl
          item={item}
          onPick={pick}
          open={openPopoverId === item.id}
          onOpenChange={(next) => setOpenPopoverId(next ? item.id : null)}
        />
      )}
      {item.kind === 'toggle' && <ToggleControl item={item} onToggle={toggle} />}
      {item.kind === 'action' && <ActionControl item={item} />}
    </div>
  ));
}

export function ActionBar() {
  const actionBar = useSpinthStore((s) => s.actionBar);
  const editable = useSpinthStore((s) => s.editable); // 只读态整条不渲染（docs/21 §4）
  const { schema, bounds } = actionBar;

  // popover 互斥单源：开合状态只在 ActionBar 层持有一份（Toolbar cursorMode 同款
  // 单源模式）——任一触发钮展开即顶掉旧面板；schema 重建（换选区/样式回填）
  // 即收起，面板语义属于旧 schema。只读/接管往返（editable 翻 false）也收起：
  // schema 引用未变、useEffect([schema]) 不触发，旧面板会在恢复可写时自动弹回
  // （2026-11 审查返工；bounds 不进依赖——拖拽每帧变会把面板关掉）
  const [openPopoverId, setOpenPopoverId] = useState<string | null>(null);
  useEffect(() => {
    setOpenPopoverId(null);
  }, [schema]);
  useEffect(() => {
    if (!editable) setOpenPopoverId(null);
  }, [editable]);

  // 实测宽度参与居中/钳制计算：栏宽随 schema 内容变化，预估定值会导致
  // 视觉不居中（2026-09 用户实测反馈）。useLayoutEffect 在绘制前完成校正
  // （同步 setState → 重渲染），用户看不到中间帧。
  // 实测高度参与上下翻转判定（specs/rem-typography §4.6）：栏高随根字号的 rem 缩放，
  // 只用估算高会让放大后的栏压住选区。
  // 安全区与几何同窗测量（specs/a11y-closeout §13.5-8）：渲染期读
  // getComputedStyle 是纯度+性能债，且没有失效路径——真机旋转/软键盘/
  // 地址栏收缩都会改 inset，靠 resize/orientationchange 失效重算。
  const barRef = useRef<HTMLDivElement | null>(null);
  const [measured, setMeasured] = useState<{
    barW: number;
    barH: number;
    areaW: number;
    safe: ISafeInsets;
  } | null>(null);
  const [rev, setRev] = useState(0);
  useEffect(() => {
    const bump = (): void => setRev((v) => v + 1);
    window.addEventListener('resize', bump);
    window.addEventListener('orientationchange', bump);
    return () => {
      window.removeEventListener('resize', bump);
      window.removeEventListener('orientationchange', bump);
    };
  }, []);
  useLayoutEffect(() => {
    const el = barRef.current;
    if (!el) return;
    const barW = el.offsetWidth;
    const barH = el.offsetHeight;
    const areaW = el.parentElement?.clientWidth ?? window.innerWidth;
    const safe = readSafeInsets();
    setMeasured((prev) =>
      prev &&
      Math.abs(prev.barW - barW) < 0.5 &&
      Math.abs(prev.barH - barH) < 0.5 &&
      prev.areaW === areaW &&
      prev.safe.top === safe.top &&
      prev.safe.right === safe.right &&
      prev.safe.bottom === safe.bottom &&
      prev.safe.left === safe.left
        ? prev
        : { barW, barH, areaW, safe },
    );
    // 依赖 schema/bounds/rev：栏内容/选区几何变化或视口失效时重量
    //（相等短路保证不循环）
  }, [schema, bounds, rev]);

  // 只读早退（hooks 之后，顺序稳定）：选区在只读态本就不存在（右键不建选区、
  // 降级即清），操作栏附着于选区——隐藏是语义结果而非特判，六个写控件不出现
  if (!editable || !schema || !bounds) return null;

  // 渲染期兜底零 DOM 读取：areaW=0 的钳制结果由 computeBarLayout 的
  // Math.max(..., padL) 兜住；layout effect 在绘制前以真实测量校正
  const { left, top } = computeBarLayout({
    bounds,
    barW: measured?.barW ?? BAR_WIDTH_FALLBACK,
    // 取 max：根字号 16px 下实测 38–39 < 40，位置与只用估算时一致；放大后用实测
    barH: Math.max(measured?.barH ?? 0, BAR_HEIGHT_EST),
    areaW: measured?.areaW ?? 0,
    safe: measured?.safe ?? ZERO_INSETS,
    type: schema.type,
  });

  return (
    <div
      ref={barRef}
      data-spinth-action-bar=""
      className="pointer-events-auto absolute z-10 flex max-w-[calc(100%-16px)] flex-wrap items-center gap-1 rounded-xl border border-edge bg-surface px-2 py-1 shadow-dock"
      style={{ left, top }}
      onPointerDown={(e) => {
        // 防画布 pointerdown 语义（原样）。bar 内点击被此遮蔽、到不了各控件
        // 挂在 window 的 outside-click——点当前面板之外（其他触发钮/toggle/
        // 动作钮/栏空白）时在此统一收起；收起时回焦面板触发钮——面板卸载
        // 焦点不落地（specs/a11y-closeout §5.7 同款意图；点其他按钮时浏览器
        // 随后的 mousedown 聚焦会覆盖，不冲突）
        e.stopPropagation();
        if (
          openPopoverId !== null &&
          !(e.target as Element).closest?.(`[data-spinth-popover="${openPopoverId}"]`)
        ) {
          barRef.current
            ?.querySelector<HTMLButtonElement>(
              `[data-spinth-popover="${openPopoverId}"] button[aria-haspopup="menu"]`,
            )
            ?.focus();
          setOpenPopoverId(null);
        }
      }}
    >
      {renderSchema(schema, openPopoverId, setOpenPopoverId)}
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
          className="flex h-7 w-7 items-center justify-center rounded-md text-ink-2 transition-colors duration-100 hover:bg-danger-soft hover:text-danger-ink"
        >
          <Icon name="trash" size={15} strokeWidth={2} />
        </button>
      </Tooltip>
    </div>
  );
}
