import { describe, expect, it } from 'vitest';
import { announcementFor, type IAnnouncementSnapshot } from './announcement';

/** 差分矩阵（specs/a11y-closeout §8.3 跃迁表 + 优先级 + 静默面） */
const snap = (over: Partial<IAnnouncementSnapshot>): IAnnouncementSnapshot => ({
  docState: 'synced',
  modelCount: 3,
  selectedCount: 0,
  cursorMode: 'cursor',
  persistState: 'saved',
  editable: true,
  ...over,
});

describe('announcementFor 差分矩阵', () => {
  it('首帧 synced → 播加载完成（带件数）；首帧非 synced 静默', () => {
    expect(announcementFor(null, snap({}))).toBe('画布已加载，3 个元素');
    expect(announcementFor(null, snap({ docState: 'loading' }))).toBeNull();
  });

  it('docState 跃迁到 synced → 播加载完成；离开 synced 静默', () => {
    expect(announcementFor(snap({ docState: 'loading' }), snap({}))).toBe('画布已加载，3 个元素');
    expect(announcementFor(snap({}), snap({ docState: 'loading' }))).toBeNull();
  });

  it('selectedCount 变化：选中播数量、归零播取消', () => {
    expect(announcementFor(snap({}), snap({ selectedCount: 2 }))).toBe('已选中 2 个元素');
    expect(announcementFor(snap({ selectedCount: 2 }), snap({ selectedCount: 1 }))).toBe(
      '已选中 1 个元素',
    );
    expect(announcementFor(snap({ selectedCount: 2 }), snap({}))).toBe('已取消选择');
  });

  it('cursorMode 变化播工具名；切到 cursor 静默（建件后自动回归，非用户意图）', () => {
    expect(announcementFor(snap({}), snap({ cursorMode: 'pen' }))).toBe('当前工具：画笔');
    expect(announcementFor(snap({ cursorMode: 'pen' }), snap({}))).toBeNull();
  });

  it('persistState：进入 failed 播重试提示；failed→saved 播恢复；saved↔saving 静默', () => {
    expect(announcementFor(snap({}), snap({ persistState: 'failed' }))).toBe(
      '保存失败，可在顶栏重试',
    );
    expect(announcementFor(snap({ persistState: 'failed' }), snap({}))).toBe('已恢复保存');
    expect(announcementFor(snap({}), snap({ persistState: 'saving' }))).toBeNull();
    expect(announcementFor(snap({ persistState: 'saving' }), snap({}))).toBeNull();
  });

  it('editable 双向跃迁各播一句', () => {
    expect(announcementFor(snap({}), snap({ editable: false }))).toBe('此画布已切换为只读');
    expect(announcementFor(snap({ editable: false }), snap({}))).toBe('此画布已恢复可编辑');
  });

  it('优先级：多项同变只播最高一条（加载 > 只读 > 失败 > 工具 > 选中）', () => {
    expect(
      announcementFor(snap({ docState: 'loading', editable: false, selectedCount: 1 }), snap({})),
    ).toBe('画布已加载，3 个元素');
    expect(
      announcementFor(
        snap({ selectedCount: 1, cursorMode: 'pen' }),
        snap({ editable: false, cursorMode: 'line' }),
      ),
    ).toBe('此画布已切换为只读');
    // 换工具伴随清选区（工具语义丢弃选中上下文）→ 播工具名
    expect(
      announcementFor(snap({ selectedCount: 1 }), snap({ selectedCount: 0, cursorMode: 'pen' })),
    ).toBe('当前工具：画笔');
  });

  it('无跃迁返回 null', () => {
    expect(announcementFor(snap({}), snap({}))).toBeNull();
    // modelCount 单独变化（建件）不播——选中播报已覆盖用户可感知面
    expect(announcementFor(snap({}), snap({ modelCount: 5 }))).toBeNull();
  });
});
