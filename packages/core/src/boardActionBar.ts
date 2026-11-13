/**
 * ActionBar schema v2 构建器（specs/api-surface §3.5）——自 app.ts 510-753 行
 * 逐字迁入（仅多选参与数改为回调注入）。不 import app.ts / boardCommands.ts：
 * 多选参与数 `() => number` 回调传入，避免为一行计数引入值环。
 */
import type { IActionBarOption, IActionBarSchema } from './types';
import type { IActionBarHost } from './boardHost';
import { SHAPE_TYPE_OPTIONS } from './widgets/shape/shapeService';
import { LINE_TYPE_OPTIONS, LINE_WIDTH_OPTIONS } from './widgets/line/lineService';
import { PEN_WIDTH_OPTIONS } from './widgets/pen/penService';
import { STICKY_COLOR_OPTIONS } from './widgets/sticky/stickyVm';
import { BRANCH_COLORS } from './widgets/mind/mindMapModel';
import {
  ARROW_BAR_OPTIONS,
  LINE_PALETTE,
  SHAPE_PALETTE,
  SHAPE_BORDER_PALETTE,
  SHAPE_BORDER_WIDTH_OPTIONS,
  typoItems,
} from './actionBarOptions';
import { darkenHex, numToHex } from './common/color';

/**
 * ActionBar schema v2（docs/12 §4/§5，2026-10-03 参考视频对齐）：单选按
 * 控件类型出样式项，多选仅通用动作。schema 是纯数据（字段名 + 中文文案 +
 * 选项图标/色块 + 当前值），@spinth/react 按 kind 渲染——多级形态：popover
 * 字段一级只占「当前值图标 + ▾」一个按钮位，选项收进二级面板；文字说明
 * 收进 tooltip（label）。**各类型只维护本函数内的 schema，样式与交互全部
 * 由 @spinth/react 统一承载**。collapsedParticipantCount 只在多选分支调用
 * （与原实现调用时机一致：单选分支不计算参与集）。
 */
export function buildActionBarSchema(
  host: IActionBarHost,
  collapsedParticipantCount: () => number,
): IActionBarSchema | null {
  const ids = host.selector?.selected$.value ?? [];
  if (ids.length === 0) return null;
  if (ids.length > 1) {
    // 多选：几何命令八键（docs/05 §7）+ react 侧通用删除。禁用态按**可移动
    // 参与数**（与命令参与集同源 resolver——锚定线不计，2026-10-10 审查处置：
    // 按选中数会让「形状+锚定线」2 选时对齐键可点但 no-op 死点击）；分布键
    // <3 参与者显示但禁用（参考同款）。参与数按组折叠后计（docs/18 §5）：
    // 整组 = 1 个参与体
    const participants = collapsedParticipantCount();
    const alignDisabled = participants < 2;
    const distDisabled = participants < 3;
    // 组切换单钮（docs/18 §3.4）：恰一整组/兜底态显示「解组」，其余「编组」
    // （合并/收编/改籍）；schema 随 widgetsChanged$ 重算——编组落库后选区
    // 不变，按钮自动翻转
    const g = host.group?.getGroupActionState() ?? { id: 'group' as const, disabled: true };
    return {
      type: '*',
      items: [
        {
          id: 'align-left',
          kind: 'action',
          label: '左对齐',
          icon: 'obj-align-left',
          disabled: alignDisabled,
        },
        {
          id: 'align-hcenter',
          kind: 'action',
          label: '水平居中对齐',
          icon: 'obj-align-hcenter',
          disabled: alignDisabled,
        },
        {
          id: 'align-right',
          kind: 'action',
          label: '右对齐',
          icon: 'obj-align-right',
          disabled: alignDisabled,
        },
        {
          id: 'align-top',
          kind: 'action',
          label: '顶对齐',
          icon: 'obj-align-top',
          disabled: alignDisabled,
        },
        {
          id: 'align-vcenter',
          kind: 'action',
          label: '垂直居中对齐',
          icon: 'obj-align-vcenter',
          disabled: alignDisabled,
        },
        {
          id: 'align-bottom',
          kind: 'action',
          label: '底对齐',
          icon: 'obj-align-bottom',
          disabled: alignDisabled,
        },
        {
          id: 'dist-h',
          kind: 'action',
          label: '横向分布',
          icon: 'obj-dist-h',
          disabled: distDisabled,
        },
        {
          id: 'dist-v',
          kind: 'action',
          label: '纵向分布',
          icon: 'obj-dist-v',
          disabled: distDisabled,
        },
        {
          id: g.id,
          kind: 'action',
          label: g.id === 'group' ? '编组' : '解组',
          icon: g.id,
          disabled: g.disabled,
        },
      ],
    };
  }
  const vm = host.vmEngine?.getVmById(ids[0]!);
  const model = vm ? host.engine?.getModelById(vm.id) : undefined;
  if (!vm || !model) return null;
  const data = model.toJSON() as unknown as Record<string, unknown>;
  const swatches = (palette: readonly string[]): IActionBarOption[] =>
    palette.map((hex) => ({ id: hex, label: hex, swatch: hex }));
  switch (vm.type) {
    case 'SHAPE':
      return {
        type: vm.type,
        items: [
          // 图形类型四态（身份属性放首位；切换几何不变、文字内接随型自动重排
          // ——insetRectOf 渲染现成；解锁 ellipse/diamond 的 UI 入口）。
          // 选项与工具坞二级菜单同源（SHAPE_TYPE_OPTIONS 单源，2026-10-11）
          {
            id: 'shapeType',
            kind: 'popover',
            label: '图形类型',
            value: String(data.shapeType ?? 'rect'),
            options: SHAPE_TYPE_OPTIONS,
          },
          {
            id: 'color',
            kind: 'popover',
            label: '填充色',
            // 无填充时 value='none'（触发钮显示「无填充」图标、面板 aria-checked
            // 如实反映 fill 态——data.color 保留旧值只是渲染不读，UI 不得说谎）
            value: data.fill === 'none' ? 'none' : String(data.color ?? ''),
            options: [
              ...swatches(SHAPE_PALETTE),
              // 无填充（specs/flowchart-closeout §4.2）：只描边不填充的注释框。
              // 选项 id 'none' 与 fill 两态复用——写入分流在 styleCommands 前置
              // （color popover 的 none 写 fill:'none'，色板项写 color 并复位 fill）
              { id: 'none', label: '无填充', icon: 'border-none' },
            ],
          },
          {
            id: 'borderStyle',
            kind: 'popover',
            label: '边框线型',
            value: String(data.borderStyle ?? 'solid'),
            options: [
              { id: 'solid', label: '实线', icon: 'border-solid' },
              { id: 'dashed', label: '虚线', icon: 'border-dashed' },
              { id: 'none', label: '无边框', icon: 'border-none' },
            ],
          },
          {
            id: 'borderColor',
            kind: 'popover',
            label: '边框色',
            value: String(data.borderColor ?? ''),
            // 未写过 borderColor = 渲染派生色（darkenHex(color,0.25)，shapeStyle
            // 单源同式）——触发钮显示派生色点而非 fallback 灰点；面板仍无
            // 「自动」选项（§22.1 拍板不提供还原入口）
            ...(data.borderColor
              ? {}
              : {
                  displaySwatch: numToHex(
                    darkenHex(
                      typeof data.color === 'string' && data.color.startsWith('#')
                        ? data.color
                        : '#e8f0fb',
                      0.25,
                    ),
                  ),
                }),
            options: swatches(SHAPE_BORDER_PALETTE),
          },
          {
            id: 'borderWidth',
            kind: 'popover',
            label: '边框宽',
            value: String(data.borderWidth ?? 1),
            options: SHAPE_BORDER_WIDTH_OPTIONS,
          },
          // 图形内文字排版（docs/17 §6）：def.align 传 center——形状文字默认居中，
          // 触发钮显示正确档位；字号/行高档后 reflowHeight 经 autoHeight 重排
          ...typoItems(data, { fontSize: 16, align: 'center', lineHeight: 1.5 }, true, true),
        ],
      };
    case 'LINE':
      return {
        type: vm.type,
        items: [
          // 选项与工具坞二级菜单同源（LINE_TYPE_OPTIONS 单源，2026-10-11）
          {
            id: 'lineType',
            kind: 'popover',
            label: '线型',
            value: String(data.lineType ?? 'STRAIGHT'),
            options: LINE_TYPE_OPTIONS,
          },
          {
            id: 'strokeWidth',
            kind: 'popover',
            label: '线宽',
            value: String(data.strokeWidth ?? 2),
            options: LINE_WIDTH_OPTIONS,
          },
          {
            id: 'dashed',
            kind: 'toggle',
            label: '虚线',
            icon: 'select-all',
            value: Boolean(data.dashed),
          },
          {
            id: 'startArrow',
            kind: 'popover',
            label: '起点箭头',
            value: String(data.startArrow ?? 'none'),
            options: ARROW_BAR_OPTIONS,
          },
          {
            id: 'endArrow',
            kind: 'popover',
            label: '终点箭头',
            value: String(data.endArrow ?? 'arrow'),
            options: ARROW_BAR_OPTIONS,
          },
          {
            id: 'color',
            kind: 'popover',
            label: '颜色',
            value: String(data.color ?? ''),
            options: swatches(LINE_PALETTE),
          },
          ...typoItems(data, { fontSize: 12, align: 'left', lineHeight: 1.4 }, false, false),
        ],
      };
    case 'PEN':
      return {
        type: vm.type,
        items: [
          {
            id: 'strokeWidth',
            kind: 'popover',
            label: '笔宽',
            value: String(data.strokeWidth ?? 4),
            options: PEN_WIDTH_OPTIONS,
          },
          {
            id: 'color',
            kind: 'popover',
            label: '颜色',
            value: String(data.color ?? ''),
            options: swatches(LINE_PALETTE),
          },
        ],
      };
    case 'STICKY':
      return {
        type: vm.type,
        items: [
          {
            id: 'color',
            kind: 'popover',
            label: '便签色',
            value: String(data.color ?? '#fff3b0'),
            options: STICKY_COLOR_OPTIONS,
          },
          ...typoItems(data, { fontSize: 15, align: 'left', lineHeight: 1.45 }, true, true),
        ],
      };
    case 'TEXT':
      // 排版项（docs/17 §4：value 带控件常量默认——触发钮显示当前档位/态）
      return {
        type: vm.type,
        items: typoItems(data, { fontSize: 16, align: 'left', lineHeight: 1.5 }, true, true),
      };
    case 'IMAGE':
      return { type: vm.type, items: [] };
    case 'MIND_MAP': {
      // 4.9 节点级选中：焦点为子节点时按节点出操作集（分支色——自身落盘
      // 整棵子树继承）；根/无焦点走通用（删除 = 删整图）
      if (host.mindService?.isNodeFocused()) {
        return {
          type: vm.type,
          items: [
            {
              id: 'lineColor',
              kind: 'popover',
              label: '分支色',
              value: host.mindService.getFocusedLineColor() ?? '',
              options: swatches(BRANCH_COLORS),
            },
          ],
        };
      }
      return { type: vm.type, items: [] };
    }
    default:
      return { type: vm.type, items: [] };
  }
}
