import { useRef } from 'react';
import { useSpinthStore } from '../store/spinthStore';
import { spinthCommands } from '../store/commands';
import { Icon, type IconName } from './Icon';
import { ToolFlyout } from './ToolFlyout';
import {
  SHAPE_TYPE_OPTIONS,
  LINE_TYPE_OPTIONS,
  LINE_WIDTH_OPTIONS,
  PEN_COLOR_OPTIONS,
  PEN_WIDTH_OPTIONS,
  STICKY_COLOR_OPTIONS,
  FONT_SIZE_OPTIONS,
  ERASER_SIZE_OPTIONS,
  type CursorMode,
  type IActionBarOption,
} from '@spinth/core';

/** 工具音色：激活态点亮的颜色（记号笔托盘隐喻，tokens.css 工具色板） */
type ToolTone = 'ink' | 'hand' | 'shape' | 'text' | 'line' | 'pen' | 'sticky' | 'mind';

interface ToolSubMenuGroup {
  /** 聚合表内层键（docs/04 §2 嵌套结构：mode → 参数名 → 选项 id） */
  key: string;
  options: IActionBarOption[];
}

interface ToolDef {
  mode: CursorMode;
  icon: IconName;
  title: string;
  tone: ToolTone;
  /** 常驻二级菜单（可选，docs/12 §4）：分组变体选项（线宽笔宽批起一工具可多组，
   *  current = 聚合表 [mode][key] 查表，onPick = setDefaultToolOption(mode, key, id)） */
  subMenuGroups?: ToolSubMenuGroup[];
}

/** 静态八件（shape 槽位由默认型动态生成，见下方 SHAPE_SLOT） */
const BASE_TOOLS: ToolDef[] = [
  { mode: 'cursor', icon: 'select', title: '选择 (V)', tone: 'ink' },
  { mode: 'hand', icon: 'hand', title: '抓手 (H / 空格)', tone: 'hand' },
  {
    mode: 'text',
    icon: 'text',
    title: '文本 (T)',
    tone: 'text',
    subMenuGroups: [{ key: 'fontSize', options: FONT_SIZE_OPTIONS }],
  },
  {
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
    mode: 'eraser',
    icon: 'eraser',
    title: '橡皮 (E)',
    tone: 'pen',
    subMenuGroups: [{ key: 'size', options: ERASER_SIZE_OPTIONS }],
  },
  {
    mode: 'sticky',
    icon: 'sticky',
    title: '便签 (S)',
    tone: 'sticky',
    subMenuGroups: [{ key: 'color', options: STICKY_COLOR_OPTIONS }],
  },
  { mode: 'mind', icon: 'mindmap', title: '脑图 (M)', tone: 'mind' },
];

/** shape 在工具序中的槽位（cursor/hand 之后——图标与 title 随默认型动态变化） */
const SHAPE_SLOT = 2;

/** 激活态按音色染色；完整类名字符串保证被 Tailwind 扫描到 */
const TONE_ACTIVE: Record<ToolTone, string> = {
  ink: 'bg-surface-active text-ink',
  hand: 'bg-tool-hand-soft text-tool-hand',
  shape: 'bg-tool-shape-soft text-tool-shape',
  text: 'bg-tool-text-soft text-tool-text',
  line: 'bg-tool-line-soft text-tool-line',
  pen: 'bg-tool-pen-soft text-tool-pen',
  sticky: 'bg-tool-sticky-soft text-tool-sticky',
  mind: 'bg-tool-mind-soft text-tool-mind',
};

/**
 * 底部中央工具坞（docs/12 §4）：画布是主角，铬件悬浮且安静——
 * 白色胶囊 + 细边 + 停靠投影；选中哪个工具就点亮哪种颜色（选中即点亮，工具坞的活力来源）。
 * 常驻二级菜单：带 subMenuOptions 的工具激活时按钮正上方显示变体面板（ToolFlyout）。
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

  // 形状条目动态生成：图标/标题随当前默认型（SHAPE_TYPE_OPTIONS 单源；current 读聚合表）
  const shapeCur = toolOptions['shape']?.type ?? 'rect';
  const shapeOpt = SHAPE_TYPE_OPTIONS.find((o) => o.id === shapeCur) ?? SHAPE_TYPE_OPTIONS[0]!;
  const shapeDef: ToolDef = {
    mode: 'shape',
    icon: (shapeOpt.icon ?? 'shape') as IconName,
    title: `${shapeOpt.label} (R)`,
    tone: 'shape',
    subMenuGroups: [{ key: 'type', options: SHAPE_TYPE_OPTIONS }],
  };
  const tools = [...BASE_TOOLS.slice(0, SHAPE_SLOT), shapeDef, ...BASE_TOOLS.slice(SHAPE_SLOT)];

  return (
    <div
      role="toolbar"
      aria-label="画板工具"
      data-spinth-toolbar=""
      className="absolute bottom-5 left-1/2 z-10 flex max-w-[calc(100vw-16px)] -translate-x-1/2 items-center gap-0.5 overflow-x-visible rounded-full border border-edge bg-surface p-1.5 shadow-dock max-md:bottom-20 max-md:overflow-x-auto md:bottom-5 md:max-w-none"
    >
      {tools.map((t, i) => {
        const active = cursorMode === t.mode;
        return (
          <div key={t.mode} className="relative" ref={active ? activeBtnRef : undefined}>
            <button
              type="button"
              title={t.title}
              aria-pressed={active}
              disabled={!editable && t.mode !== 'cursor' && t.mode !== 'hand'}
              onClick={() => spinthCommands.setCursorMode(t.mode)}
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
            {active && t.subMenuGroups && (
              <ToolFlyout
                anchorRect={() => activeBtnRef.current?.getBoundingClientRect() ?? null}
                groups={t.subMenuGroups.map((g) => ({
                  options: g.options,
                  current: toolOptions[t.mode]?.[g.key] ?? '',
                  activeClass: TONE_ACTIVE[t.tone],
                  onPick: (id: string) => spinthCommands.setDefaultToolOption(t.mode, g.key, id),
                }))}
              />
            )}
          </div>
        );
      })}

      <div className="mx-1.5 h-6 w-px bg-edge" aria-hidden />

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
          disabled={a.disabled}
          onClick={a.onClick}
          style={{ '--i': tools.length + i } as React.CSSProperties}
          className="dock-in flex h-10 w-10 items-center justify-center rounded-[14px] text-ink-2 transition-colors duration-150 hover:bg-surface-hover hover:text-ink disabled:pointer-events-none disabled:opacity-40"
        >
          <Icon name={a.icon} size={18} strokeWidth={1.9} />
        </button>
      ))}
    </div>
  );
}
