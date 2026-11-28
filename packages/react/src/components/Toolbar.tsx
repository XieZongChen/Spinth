import { useLayoutEffect, useRef, useState } from 'react';
import { useSpinthStore } from '../store/spinthStore';
import { spinthCommands } from '../store/commands';
import { useRovingFocus } from '../a11y/useRovingFocus';
import { Icon, type IconName } from './Icon';
import { ToolFlyout } from './ToolFlyout';
import {
  SHAPE_TYPE_OPTIONS,
  SYMBOL_OPTIONS,
  LINE_TYPE_OPTIONS,
  LINE_WIDTH_OPTIONS,
  PEN_COLOR_OPTIONS,
  PEN_WIDTH_OPTIONS,
  STICKY_COLOR_OPTIONS,
  FONT_SIZE_OPTIONS,
  ERASER_SIZE_OPTIONS,
  TREE_KIND_OPTIONS,
  SEQUENCE_ELEMENT_OPTIONS,
  SEQUENCE_MESSAGE_OPTIONS,
  SEQUENCE_FRAGMENT_OPTIONS,
  type CursorMode,
  type IActionBarOption,
} from '@spinth/core';

/** 工具主题色：激活态点亮的颜色（记号笔托盘隐喻，tokens.css 工具色板） */
type ToolTone = 'ink' | 'hand' | 'shape' | 'text' | 'line' | 'pen' | 'sticky' | 'mind';

interface ToolSubMenuGroup {
  /** 聚合表内层键（docs/04 §2 嵌套结构：mode → 参数名 → 选项 id） */
  key: string;
  options: IActionBarOption[];
}

/** ToolFlyout 的组数据形状（静态组映射与动态组（树形图类型菜单）同构） */
interface ToolFlyoutGroupInput {
  options: IActionBarOption[];
  current: string;
  activeClass: string;
  onPick: (id: string) => void;
}

interface ToolDef {
  /** 稳定 id（审查返工 P1-10：React key 用它——树形图切 kind 时 mode 变化
   *  不再 remount 按钮/flyout，roving 焦点与锚点不丢） */
  id: string;
  mode: CursorMode;
  icon: IconName;
  title: string;
  tone: ToolTone;
  /** 常驻二级菜单（可选，docs/12 §4）：分组变体选项（线宽笔宽批起一工具可多组，
   *  current = 聚合表 [mode][key] 查表，onPick = setDefaultToolOption(mode, key, id)） */
  subMenuGroups?: ToolSubMenuGroup[];
  /** 动态组（specs/tree-diagrams §10.1：树形图类型菜单不走工具默认参数聚合） */
  buildSubMenuGroups?: () => ToolFlyoutGroupInput[];
  /** 自定义激活（树形图入口 = setCursorMode(记忆 kind)；缺省 setCursorMode(mode)） */
  activate?: () => void;
}

/** 静态八件（shape 槽位由默认型动态生成，见下方 SHAPE_SLOT） */
const BASE_TOOLS: ToolDef[] = [
  { id: 'cursor', mode: 'cursor', icon: 'select', title: '选择 (V)', tone: 'ink' },
  { id: 'hand', mode: 'hand', icon: 'hand', title: '抓手 (H / 空格)', tone: 'hand' },
  {
    id: 'text',
    mode: 'text',
    icon: 'text',
    title: '文本 (T)',
    tone: 'text',
    subMenuGroups: [{ key: 'fontSize', options: FONT_SIZE_OPTIONS }],
  },
  {
    id: 'line',
    mode: 'line',
    icon: 'connector',
    title: '连线 (L)',
    tone: 'line',
    subMenuGroups: [
      { key: 'type', options: LINE_TYPE_OPTIONS },
      { key: 'width', options: LINE_WIDTH_OPTIONS },
    ],
  },
  {
    id: 'pen',
    mode: 'pen',
    icon: 'pen',
    title: '画笔 (P)',
    tone: 'pen',
    subMenuGroups: [
      { key: 'color', options: PEN_COLOR_OPTIONS },
      { key: 'width', options: PEN_WIDTH_OPTIONS },
    ],
  },
  {
    id: 'eraser',
    mode: 'eraser',
    icon: 'eraser',
    title: '橡皮 (E)',
    tone: 'pen',
    subMenuGroups: [{ key: 'size', options: ERASER_SIZE_OPTIONS }],
  },
  {
    id: 'sticky',
    mode: 'sticky',
    icon: 'sticky',
    title: '便签 (S)',
    tone: 'sticky',
    subMenuGroups: [{ key: 'color', options: STICKY_COLOR_OPTIONS }],
  },
];

/** shape 在工具序中的槽位（cursor/hand 之后——图标与 title 随默认型动态变化） */
const SHAPE_SLOT = 2;

/** 激活态按工具主题色染色；完整类名字符串保证被 Tailwind 扫描到。
 *  前景用 -ink（soft 底 4.5:1，批次 B W2——flyout 选中项含纯文本，图标与
 *  文字统一按文字对比度定值）；本体色留给画布图形/色点/幽灵预览 */
const TONE_ACTIVE: Record<ToolTone, string> = {
  ink: 'bg-surface-active text-ink',
  hand: 'bg-tool-hand-soft text-tool-hand-ink',
  shape: 'bg-tool-shape-soft text-tool-shape-ink',
  text: 'bg-tool-text-soft text-tool-text-ink',
  line: 'bg-tool-line-soft text-tool-line-ink',
  pen: 'bg-tool-pen-soft text-tool-pen-ink',
  sticky: 'bg-tool-sticky-soft text-tool-sticky-ink',
  mind: 'bg-tool-mind-soft text-tool-mind-ink',
};

/**
 * 底部中央工具坞（docs/12 §4）：画布是主角，铬件悬浮且安静——
 * 白色胶囊 + 细边 + 停靠投影；选中哪个工具就点亮哪种颜色（选中即点亮，工具坞的活力来源）。
 * 常驻二级菜单：带 subMenuGroups 的工具激活时按钮正上方显示变体面板（ToolFlyout）。
 */
export function Toolbar() {
  const cursorMode = useSpinthStore((s) => s.cursorMode);
  const editable = useSpinthStore((s) => s.editable); // 1.22：只读态写工具禁用
  const toolOptions = useSpinthStore((s) => s.defaultToolOptions);
  const canUndo = useSpinthStore((s) => s.canUndo);
  const canRedo = useSpinthStore((s) => s.canRedo);
  const selectedCount = useSpinthStore((s) => s.selectedCount);
  /** 激活工具按钮（ToolFlyout 的 portal 定位锚点） */
  const activeBtnRef = useRef<HTMLDivElement>(null);
  /** 锚点元素受控镜像：React 挂宿主 ref 晚于子树 layout effect，ToolFlyout
   *  首挂载直接读 ref 必为 null（dev StrictMode 双跑掩盖、生产闩死隐藏——
   *  修复：本组件 layout effect 晚于 ref 挂载执行，绘制前把已挂好的 ref
   *  提升为 state 触发一次同步补渲染，ToolFlyout 拿到非空锚点） */
  const [anchorEl, setAnchorEl] = useState<HTMLDivElement | null>(null);
  useLayoutEffect(() => {
    setAnchorEl(activeBtnRef.current);
  }, [cursorMode]);
  const dockRef = useRef<HTMLDivElement>(null);
  // roving（specs/a11y-closeout §5.7，W1/2.4.3）：工具坞单 Tab 停靠，
  // 方向键在按钮间移动；wrap=false——工具序两端即语义尽头。ToolFlyout 是
  // portal 到 body 的，不在本容器内，不被选择器命中
  const { onKeyDown, onFocus } = useRovingFocus({
    containerRef: dockRef,
    orientation: 'horizontal',
    wrap: false,
  });

  // 形状条目动态生成：图标/标题随当前默认型（SHAPE_TYPE_OPTIONS 单源；current 读聚合表）
  const shapeCur = toolOptions['shape']?.type ?? 'rect';
  const shapeOpt = SHAPE_TYPE_OPTIONS.find((o) => o.id === shapeCur) ?? SHAPE_TYPE_OPTIONS[0]!;
  const shapeDef: ToolDef = {
    id: 'shape',
    mode: 'shape',
    icon: (shapeOpt.icon ?? 'shape') as IconName,
    title: `${shapeOpt.label} (R)`,
    tone: 'shape',
    subMenuGroups: [{ key: 'type', options: SHAPE_TYPE_OPTIONS }],
  };
  // 符号条目（specs/symbol-widget §6.4）：图标随当前默认种类（shape 同款体验），
  // 标题固定「符号 (N)」（spec 文案）；主题色沿用 shape 槽位（不新增 tool-symbol-*
  // 安全类与对比度护栏）；二级菜单 13 项平铺（>8 自动两行 grid，与形状同款）
  const symbolCur = toolOptions['symbol']?.kind ?? 'net-server';
  const symbolOpt = SYMBOL_OPTIONS.find((o) => o.id === symbolCur) ?? SYMBOL_OPTIONS[0]!;
  const symbolDef: ToolDef = {
    id: 'symbol',
    mode: 'symbol',
    icon: (symbolOpt.icon ?? 'symbol') as IconName,
    title: '符号 (N)',
    tone: 'shape',
    subMenuGroups: [{ key: 'kind', options: SYMBOL_OPTIONS }],
  };
  // 容器条目（specs/container-frame §5.1）：单一按钮、无二级菜单；主题色
  // shape 槽位（symbol 同款——不新增 tool-frame-* 安全类，避免对比度护栏扩散）
  const frameDef: ToolDef = {
    id: 'frame',
    mode: 'frame',
    icon: 'frame',
    title: '容器 (C)',
    tone: 'shape',
  };
  // 树形图单入口（specs/tree-diagrams §10.1，Phase 3c）：不再有独立 org 按钮——
  // 图标/标题/aria 随当前 kind；二级菜单 = 类型组（切换保持激活）；kind 记忆
  // 随 M/O 直达更新（bridge 镜像）。标题含当前 kind 名，脑图态保留「脑图」字样
  // （既有 E2E 的 /脑图/ 选择器零迁移）
  const treeKind = useSpinthStore((tk) => tk.treeKind);
  const treeLabel = treeKind === 'org' ? '树形图 · 组织架构 (O)' : '树形图 · 脑图 (M)';
  const treeDef: ToolDef = {
    id: 'tree',
    mode: treeKind,
    icon: 'tree',
    title: treeLabel,
    tone: 'mind',
    activate: () => spinthCommands.setCursorMode(treeKind),
    buildSubMenuGroups: () => [
      {
        options: TREE_KIND_OPTIONS as unknown as IActionBarOption[],
        current: treeKind,
        activeClass: TONE_ACTIVE.mind,
        onPick: (id) => spinthCommands.setCursorMode(id as 'mind' | 'org'),
      },
    ],
  };
  // 时序图单入口（specs/sequence-diagram §8.1，第 12 钮）：一个 CursorMode 对应多种
  // 图元——二级菜单 = 图元组 + 消息组，走动态组让各组**共用一个当前值**（静态组每组
  // 各算一次 current）；种类记忆走工具默认参数聚合表（符号同款，经 kind 参数分发）；
  // 主题色沿用 shape 槽位（D11——不新增安全类）
  const sequenceKind = toolOptions['sequence']?.kind ?? '';
  const pickSequenceKind = (id: string): void =>
    spinthCommands.setDefaultToolOption('sequence', 'kind', id);
  const sequenceDef: ToolDef = {
    id: 'sequence',
    mode: 'sequence',
    icon: 'sequence',
    title: '时序图 (Q)',
    tone: 'shape',
    buildSubMenuGroups: () => [
      {
        options: SEQUENCE_ELEMENT_OPTIONS,
        current: sequenceKind,
        activeClass: TONE_ACTIVE.shape,
        onPick: pickSequenceKind,
      },
      {
        options: SEQUENCE_MESSAGE_OPTIONS,
        current: sequenceKind,
        activeClass: TONE_ACTIVE.shape,
        onPick: pickSequenceKind,
      },
      {
        // 组合片段（specs/sequence-diagram §8.1）：alt / opt / loop / par，文字项
        options: SEQUENCE_FRAGMENT_OPTIONS,
        current: sequenceKind,
        activeClass: TONE_ACTIVE.shape,
        onPick: pickSequenceKind,
      },
    ],
  };
  const tools = [
    ...BASE_TOOLS.slice(0, SHAPE_SLOT),
    shapeDef,
    symbolDef,
    frameDef,
    ...BASE_TOOLS.slice(SHAPE_SLOT),
    treeDef,
    sequenceDef,
  ];

  return (
    <div
      role="toolbar"
      aria-label="画板工具"
      data-spinth-toolbar=""
      ref={dockRef}
      onKeyDown={onKeyDown}
      onFocus={onFocus}
      className="absolute bottom-[calc(1.25rem+var(--spinth-safe-bottom))] left-1/2 z-10 flex w-max max-w-[calc(100vw-16px)] -translate-x-1/2 items-center gap-0.5 overflow-x-visible rounded-full border border-edge bg-surface p-1.5 shadow-dock max-md:bottom-[calc(5rem+var(--spinth-safe-bottom))] max-md:overflow-x-auto md:bottom-[calc(1.25rem+var(--spinth-safe-bottom))] md:max-w-none"
    >
      {tools.map((t, i) => {
        const active = cursorMode === t.mode;
        // aria-label 逐字保留 title（specs/a11y-closeout §8.4——可访问名不依赖
        // title 回退，toolbar.spec 的名称断言不变）；带二级菜单的工具声明
        // haspopup/expanded/controls（flyout 容器固定 id，同一时刻仅一工具激活）
        const hasFlyout = !!(t.subMenuGroups || t.buildSubMenuGroups);
        return (
          <div key={t.id} className="relative shrink-0" ref={active ? activeBtnRef : undefined}>
            <button
              type="button"
              title={t.title}
              aria-label={t.title}
              aria-pressed={active}
              aria-haspopup={hasFlyout ? 'menu' : undefined}
              aria-expanded={hasFlyout ? active : undefined}
              aria-controls={hasFlyout && active ? 'spinth-tool-flyout' : undefined}
              data-roving-item=""
              tabIndex={-1}
              disabled={!editable && t.mode !== 'cursor' && t.mode !== 'hand'}
              onClick={() => t.activate?.() ?? spinthCommands.setCursorMode(t.mode)}
              style={{ '--i': i } as React.CSSProperties}
              className={`dock-in flex h-10 w-10 items-center justify-center rounded-[14px] transition-colors duration-150 disabled:pointer-events-none disabled:opacity-40 ${
                active ? TONE_ACTIVE[t.tone] : 'text-ink-2 hover:bg-surface-hover hover:text-ink'
              }`}
            >
              <Icon name={t.icon} size={19} />
            </button>
            {/* 常驻二级菜单：激活即显示（纯派生，切走自动卸载）；分组经聚合嵌套表
                mode→key 查 current，onPick 带 key 分发（线宽笔宽批结构）。
                anchorRect 传按钮矩形——portal/fixed 定位（第三轮审查 390px 修复） */}
            {active && (t.subMenuGroups || t.buildSubMenuGroups) && (
              <ToolFlyout
                anchorRect={() => anchorEl?.getBoundingClientRect() ?? null}
                groups={
                  t.buildSubMenuGroups?.() ??
                  (t.subMenuGroups ?? []).map((g) => ({
                    options: g.options,
                    current: toolOptions[t.mode]?.[g.key] ?? '',
                    activeClass: TONE_ACTIVE[t.tone],
                    onPick: (id: string) => spinthCommands.setDefaultToolOption(t.mode, g.key, id),
                  }))
                }
              />
            )}
          </div>
        );
      })}

      <div className="mx-1.5 h-6 w-px shrink-0 bg-edge" aria-hidden />

      {(
        [
          {
            icon: 'undo' as IconName,
            title: '撤销 (Cmd+Z)',
            // 只读态三键禁用（docs/21 §4 矩阵）：命令层已有守卫，这里是呈现
            // 层门禁——不留"可点但静默 no-op"的假激活
            disabled: !editable || !canUndo,
            onClick: () => spinthCommands.undo(),
          },
          {
            icon: 'redo' as IconName,
            title: '重做 (Shift+Cmd+Z)',
            disabled: !editable || !canRedo,
            onClick: () => spinthCommands.redo(),
          },
          {
            icon: 'trash' as IconName,
            title: '删除选中 (Delete)',
            disabled: !editable || selectedCount === 0,
            onClick: () => spinthCommands.removeSelected(),
          },
        ] satisfies Array<{ icon: IconName; title: string; disabled: boolean; onClick: () => void }>
      ).map((a, i) => (
        <button
          key={a.icon}
          type="button"
          title={a.title}
          aria-label={a.title}
          data-roving-item=""
          tabIndex={-1}
          disabled={a.disabled}
          onClick={a.onClick}
          style={{ '--i': tools.length + i } as React.CSSProperties}
          className="dock-in flex h-10 w-10 shrink-0 items-center justify-center rounded-[14px] text-ink-2 transition-colors duration-150 hover:bg-surface-hover hover:text-ink disabled:pointer-events-none disabled:opacity-40"
        >
          <Icon name={a.icon} size={18} strokeWidth={1.9} />
        </button>
      ))}
    </div>
  );
}
