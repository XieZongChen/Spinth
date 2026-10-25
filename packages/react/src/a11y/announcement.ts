/**
 * 状态播报差分纯函数（specs/a11y-closeout §8.3）：store 六字段快照 prev→next，
 * 只对「有意义的跃迁」出一条文案；返回 null = 不播报。跃迁表与优先级（一次
 * 快照多项同变时只播最高优先级一条，防过噪）：加载 > 只读切换 > 保存失败/
 * 恢复 > 工具切换 > 选中变化。文案是组件 Announcer 的唯一数据源（可单测）。
 */
import type { CursorMode, DocState } from '@spinth/core';

export interface IAnnouncementSnapshot {
  docState: DocState;
  modelCount: number;
  selectedCount: number;
  cursorMode: CursorMode;
  persistState: 'saved' | 'saving' | 'failed';
  editable: boolean;
}

/** 工具名（播报用中文，docs/09 §2 同名口径；cursor 不在播报里出现——切换到
 *  cursor 常是建件后的自动回归，播报会是噪音） */
const TOOL_NAMES: Partial<Record<CursorMode, string>> = {
  hand: '抓手',
  shape: '形状',
  text: '文本',
  line: '连线',
  pen: '画笔',
  eraser: '橡皮',
  sticky: '便签',
  mind: '脑图',
};

export function announcementFor(
  prev: IAnnouncementSnapshot | null,
  next: IAnnouncementSnapshot,
): string | null {
  // 首帧（挂载即有快照）：进入 synced 播加载完成——live region 必须先于
  // 内容存在才能播报（Announcer 常驻），首个快照到达即触发
  if (prev === null) {
    return next.docState === 'synced' ? `画布已加载，${next.modelCount} 个元素` : null;
  }
  if (next.docState === 'synced' && prev.docState !== 'synced') {
    return `画布已加载，${next.modelCount} 个元素`;
  }
  if (prev.editable !== next.editable) {
    return next.editable ? '此画布已恢复可编辑' : '此画布已切换为只读';
  }
  if (prev.persistState !== 'failed' && next.persistState === 'failed') {
    return '保存失败，可在顶栏重试';
  }
  if (prev.persistState === 'failed' && next.persistState === 'saved') {
    return '已恢复保存';
  }
  // cursorMode 先于 selectedCount：换工具必伴随清选区（工具语义切换丢弃选中
  // 上下文），双跃迁时播工具名——「已取消选择」是它的子信息
  if (prev.cursorMode !== next.cursorMode) {
    const name = TOOL_NAMES[next.cursorMode];
    if (name) return `当前工具：${name}`;
  }
  if (prev.selectedCount !== next.selectedCount) {
    return next.selectedCount > 0 ? `已选中 ${next.selectedCount} 个元素` : '已取消选择';
  }
  return null;
}
