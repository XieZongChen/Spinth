import type { IActionBarOption } from '../../types';

/** 时序图工具的图元种类（specs/sequence-diagram §7.1）：一个 CursorMode 对应多种
 *  图元。批次 1 只有生命线；批次 2 追加消息、批次 4 追加片段——加种类 = 本表加
 *  一项 + SequenceService 的转发分支。选项表与种类表的覆盖由 sequenceService.test 锁 */
export const SEQUENCE_ELEMENT_KINDS = ['lifeline'] as const;
export type SequenceKind = (typeof SEQUENCE_ELEMENT_KINDS)[number];
/** 新会话的缺省图元（工具坞二级菜单首项） */
export const SEQUENCE_DEFAULT_KIND: SequenceKind = 'lifeline';

/** 工具坞二级菜单选项（顺序即菜单顺序；icon = @spinth/react Icon 语义名） */
export const SEQUENCE_ELEMENT_OPTIONS: IActionBarOption[] = [
  { id: 'lifeline', label: '生命线', icon: 'sequence' },
];

export function isSequenceKind(id: string): id is SequenceKind {
  return (SEQUENCE_ELEMENT_KINDS as readonly string[]).includes(id);
}
