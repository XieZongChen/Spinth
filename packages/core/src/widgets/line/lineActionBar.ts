/**
 * 连线 ActionBar schema 项（自 boardActionBar 拆出——容器 frameActionBar 同款）：
 * 线型 / 线宽 / 虚线 / 双箭头 / 颜色 + 线上文字两项排版。id 全部与 schema 字段同名
 * ——走 updateSelectedStyle 通用通道；选项与工具坞二级菜单同源（LINE_TYPE_OPTIONS /
 * LINE_WIDTH_OPTIONS 单源）。
 */

import type { IActionBarItem, IActionBarOption } from '../../types';
import { ARROW_BAR_OPTIONS, LINE_PALETTE, swatches, typoItems } from '../../actionBarOptions';
import { LINE_TYPE_OPTIONS, LINE_WIDTH_OPTIONS } from './lineService';

/** 线上文字位置三态：线上（骑线镂空，缺省）/ 上方 / 下方 */
export const LINE_TEXT_SIDE_OPTIONS: IActionBarOption[] = [
  { id: 'on', label: '线上', icon: 'obj-align-vcenter' },
  { id: 'above', label: '上方', icon: 'obj-align-top' },
  { id: 'below', label: '下方', icon: 'obj-align-bottom' },
];

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
    {
      // 线上文字位置（specs/sequence-diagram §4.9）：「线上」的选项 id `on` 不是合法
      // 枚举值——styleCommands 转写为 textSide: undefined（读回即缺省）
      id: 'textSide',
      kind: 'popover',
      label: '文字位置',
      value: data.textSide === 'above' || data.textSide === 'below' ? data.textSide : 'on',
      options: LINE_TEXT_SIDE_OPTIONS,
    },
  ];
}
