/**
 * 连线 ActionBar schema 项（自 boardActionBar 拆出——容器 frameActionBar 同款）：
 * 线型 / 线宽 / 虚线 / 双箭头 / 颜色 + 线上文字两项排版。id 全部与 schema 字段同名
 * ——走 updateSelectedStyle 通用通道；选项与工具坞二级菜单同源（LINE_TYPE_OPTIONS /
 * LINE_WIDTH_OPTIONS 单源）。
 */

import type { IActionBarItem } from '../../types';
import { ARROW_BAR_OPTIONS, LINE_PALETTE, swatches, typoItems } from '../../actionBarOptions';
import { LINE_TYPE_OPTIONS, LINE_WIDTH_OPTIONS } from './lineService';

export function lineActionBarItems(data: Record<string, unknown>): IActionBarItem[] {
  return [
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
  ];
}
