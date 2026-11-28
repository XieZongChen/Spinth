import type { FrameData, IActionBarOption } from '../../types';
import {
  DIVIDER_POLICY,
  MESSAGE_ASYNC_POLICY,
  MESSAGE_RETURN_POLICY,
  MESSAGE_SYNC_POLICY,
  type ILineDrawPolicy,
} from '../line/lineAxisAnchor';

/** 时序图工具的图元种类（specs/sequence-diagram §7.1）：一个 CursorMode 对应多种
 *  图元。加种类 = 本表加一项 + 对应组的选项 + SequenceService 的转发分支。选项表与
 *  种类表的覆盖由 sequenceService.test 锁 */
export const SEQUENCE_ELEMENT_KINDS = [
  'lifeline',
  'activation',
  'divider',
  'message-sync',
  'message-async',
  'message-return',
  'fragment-alt',
  'fragment-opt',
  'fragment-loop',
  'fragment-par',
] as const;
export type SequenceKind = (typeof SEQUENCE_ELEMENT_KINDS)[number];
/** 新会话的缺省图元（工具坞二级菜单首项） */
export const SEQUENCE_DEFAULT_KIND: SequenceKind = 'lifeline';

/** 工具坞二级菜单「图元」组（顺序即菜单顺序；icon = @spinth/react Icon 语义名） */
export const SEQUENCE_ELEMENT_OPTIONS: IActionBarOption[] = [
  { id: 'lifeline', label: '生命线', icon: 'sequence' },
  { id: 'activation', label: '激活条', icon: 'sequence-activation' },
  // 分隔线 = 两端自由的虚线直线（§6.2，else 分隔；需要标签时另放一个 TEXT）
  { id: 'divider', label: '分隔线', icon: 'sequence-divider' },
];

/** 工具坞二级菜单「消息」组（specs/sequence-diagram §4.3 / §8.1）：图标区分箭头
 *  形态——实心 / 开放 / 虚线 */
export const SEQUENCE_MESSAGE_OPTIONS: IActionBarOption[] = [
  { id: 'message-sync', label: '同步消息', icon: 'sequence-message-sync' },
  { id: 'message-async', label: '异步消息', icon: 'sequence-message-async' },
  { id: 'message-return', label: '返回消息', icon: 'sequence-message-return' },
];

/** 片段四类（§6.1）：组合片段 = FRAME 预设，关键字 alt / opt / loop / par */
export const SEQUENCE_FRAGMENT_KINDS = [
  'fragment-alt',
  'fragment-opt',
  'fragment-loop',
  'fragment-par',
] as const satisfies ReadonlyArray<SequenceKind>;

/** 工具坞二级菜单「片段」组：以**文字**呈现关键字——菜单是图标位，四个同形的框图标
 *  区分不出关键字（关键字本身就是 UML 的记法） */
export const SEQUENCE_FRAGMENT_OPTIONS: IActionBarOption[] = [
  { id: 'fragment-alt', label: 'alt', text: 'alt' },
  { id: 'fragment-opt', label: 'opt', text: 'opt' },
  { id: 'fragment-loop', label: 'loop', text: 'loop' },
  { id: 'fragment-par', label: 'par', text: 'par' },
];

/** 片段种类 → 容器创建预设（§6.1）：每次创建重新求值；`{ title: 关键字, fill: 'none' }`
 *  ——无填充只有边框与标题压在图上，守卫文本经既有的标题 plain 编辑修改 */
export const SEQUENCE_FRAGMENT_PRESETS: Readonly<
  Partial<Record<SequenceKind, () => Partial<FrameData>>>
> = {
  'fragment-alt': () => ({ title: 'alt', fill: 'none' }),
  'fragment-opt': () => ({ title: 'opt', fill: 'none' }),
  'fragment-loop': () => ({ title: 'loop', fill: 'none' }),
  'fragment-par': () => ({ title: 'par', fill: 'none' }),
};

export function isFragmentKind(kind: SequenceKind): boolean {
  return (SEQUENCE_FRAGMENT_KINDS as readonly string[]).includes(kind);
}

/** 种类 → 拉线策略（§4.3 预设）；生命线与片段不在表内（片段走容器手势，无拉线） */
export const SEQUENCE_DRAW_POLICIES: Readonly<Partial<Record<SequenceKind, ILineDrawPolicy>>> = {
  'message-sync': MESSAGE_SYNC_POLICY,
  'message-async': MESSAGE_ASYNC_POLICY,
  'message-return': MESSAGE_RETURN_POLICY,
  divider: DIVIDER_POLICY,
};

export function isSequenceKind(id: string): id is SequenceKind {
  return (SEQUENCE_ELEMENT_KINDS as readonly string[]).includes(id);
}
