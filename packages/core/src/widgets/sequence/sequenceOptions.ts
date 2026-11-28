import type { IActionBarOption } from '../../types';
import {
  MESSAGE_ASYNC_POLICY,
  MESSAGE_RETURN_POLICY,
  MESSAGE_SYNC_POLICY,
  type ILineDrawPolicy,
} from '../line/lineAxisAnchor';

/** 时序图工具的图元种类（specs/sequence-diagram §7.1）：一个 CursorMode 对应多种
 *  图元。加种类 = 本表加一项 + SequenceService 的转发分支。选项表与种类表的覆盖由
 *  sequenceService.test 锁 */
export const SEQUENCE_ELEMENT_KINDS = [
  'lifeline',
  'activation',
  'message-sync',
  'message-async',
  'message-return',
] as const;
export type SequenceKind = (typeof SEQUENCE_ELEMENT_KINDS)[number];
/** 新会话的缺省图元（工具坞二级菜单首项） */
export const SEQUENCE_DEFAULT_KIND: SequenceKind = 'lifeline';

/** 工具坞二级菜单「图元」组（顺序即菜单顺序；icon = @spinth/react Icon 语义名） */
export const SEQUENCE_ELEMENT_OPTIONS: IActionBarOption[] = [
  { id: 'lifeline', label: '生命线', icon: 'sequence' },
  { id: 'activation', label: '激活条', icon: 'sequence-activation' },
];

/** 工具坞二级菜单「消息」组（specs/sequence-diagram §4.3 / §8.1）：图标区分箭头
 *  形态——实心 / 开放 / 虚线 */
export const SEQUENCE_MESSAGE_OPTIONS: IActionBarOption[] = [
  { id: 'message-sync', label: '同步消息', icon: 'sequence-message-sync' },
  { id: 'message-async', label: '异步消息', icon: 'sequence-message-async' },
  { id: 'message-return', label: '返回消息', icon: 'sequence-message-return' },
];

/** 种类 → 拉线策略（§4.3 预设）；生命线不在表内 = 无策略 */
export const SEQUENCE_DRAW_POLICIES: Readonly<Partial<Record<SequenceKind, ILineDrawPolicy>>> = {
  'message-sync': MESSAGE_SYNC_POLICY,
  'message-async': MESSAGE_ASYNC_POLICY,
  'message-return': MESSAGE_RETURN_POLICY,
};

export function isSequenceKind(id: string): id is SequenceKind {
  return (SEQUENCE_ELEMENT_KINDS as readonly string[]).includes(id);
}
