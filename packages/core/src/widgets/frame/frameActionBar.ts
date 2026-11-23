/**
 * 容器 ActionBar schema 项（specs/container-frame §5.2，自 boardActionBar 拆出
 * ——审查返工 400 行拆分）：背景/边框色/线型/宽/标题位置五项。id 全部与 schema
 * 字段同名——走 updateSelectedStyle 通用通道（color 'none' → fill:'none'
 * 分流在 styleCommands 前置，SHAPE 同款自动继承）。
 */
import type { IActionBarItem } from '../../types';
import {
  SHAPE_BORDER_WIDTH_OPTIONS,
  SHAPE_PALETTE,
  SHAPE_BORDER_PALETTE,
  swatches,
} from '../../actionBarOptions';
import { FRAME_DEFAULT_BORDER } from './frameGeometry';

export function frameActionBarItems(data: Record<string, unknown>): IActionBarItem[] {
  return [
    {
      id: 'color',
      kind: 'popover',
      label: '背景色',
      // 无填充时 value='none'（触发钮显示「无填充」图标、面板 aria-checked
      // 如实反映 fill 态——data.color 保留旧值只是渲染不读，UI 不得说谎）
      value: data.fill === 'none' ? 'none' : String(data.color ?? ''),
      options: [...swatches(SHAPE_PALETTE), { id: 'none', label: '无填充', icon: 'border-none' }],
    },
    {
      id: 'borderColor',
      kind: 'popover',
      label: '边框色',
      value: String(data.borderColor ?? ''),
      // 未写过 = 常量缺省（§2.1 写死不自适应——非 SHAPE 的填充派生口径）
      ...(data.borderColor ? {} : { displaySwatch: FRAME_DEFAULT_BORDER }),
      options: swatches(SHAPE_BORDER_PALETTE),
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
      id: 'borderWidth',
      kind: 'popover',
      label: '边框宽',
      value: String(data.borderWidth ?? 1),
      options: SHAPE_BORDER_WIDTH_OPTIONS,
    },
    {
      id: 'headerSide',
      kind: 'popover',
      label: '标题位置',
      value: String(data.headerSide ?? 'top'),
      options: [
        { id: 'top', label: '顶部' },
        { id: 'left', label: '左侧' },
      ],
    },
  ];
}
