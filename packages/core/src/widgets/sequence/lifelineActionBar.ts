/**
 * 生命线 ActionBar schema 项（specs/sequence-diagram §8.2，自 boardActionBar 拆出——
 * 容器 frameActionBar / 连线 lineActionBar 同款）：头部样式一项。id 与 schema 字段同名
 * （head）——走 updateSelectedStyle 通用通道；切换时的锚定消息重算由 styleCommands
 * 在同一事务内分流到 SequenceService.onHeadChanged（§7.2）。
 */

import type { IActionBarItem, IActionBarOption } from '../../types';

/** 头部样式两态：box = 矩形头框（缺省）/ actor = 小人 */
export const LIFELINE_HEAD_OPTIONS: IActionBarOption[] = [
  { id: 'box', label: '矩形', icon: 'shape-rect' },
  { id: 'actor', label: '小人', icon: 'sequence-actor' },
];

export function lifelineActionBarItems(data: Record<string, unknown>): IActionBarItem[] {
  return [
    {
      id: 'head',
      kind: 'popover',
      label: '头部样式',
      // 数据缺省（未写过）= box
      value: data.head === 'actor' ? 'actor' : 'box',
      options: LIFELINE_HEAD_OPTIONS,
    },
  ];
}
