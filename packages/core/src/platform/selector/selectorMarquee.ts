import { Point, Rectangle } from 'pixi.js';
import type { IRect } from '../../common/geometry';
import type { IMindDragDelegate, IVmEngineService } from '../../types';
import { marqueeRectOf, type MarqueeState } from './selectorVm';
import type { GroupService } from './groupService';

/**
 * 框选会话（specs/edge-auto-scroll §11.1-2 自 selectorService 抽取，只移动不改
 * 行为）：down 建 / move 逐帧 / up·cancel 收。状态封装在本类，SelectorService
 * 只持可空引用（isDragging 判定）——抽取动机：selector 行数回缓冲 + 框选滚屏
 * 挂账（1.0 后）届时只需在本会话加上报，不再受 400 行钳制。
 */

/** 会话上下文：ops 依赖经 ctx 注入（服务在 initialize 构造一次） */
export interface IMarqueeContext {
  vmEngine: Pick<IVmEngineService, 'getVmByRect' | 'getVmById'>;
  /** 选中集写入（过程即结果——拖框每帧 setSelected） */
  setSelected(ids: string[]): void;
  /** 脑图节点级框选委托（组合根晚绑定，惰性读取） */
  mindDragDelegate(): IMindDragDelegate | null;
  /** 框选蓝框视觉 */
  selectorVm: { show(rect: IRect): void; update(rect: IRect): void; hide(): void };
}

export class MarqueeSession {
  private readonly state: MarqueeState;
  private readonly groupFilter: ((hitIds: string[], rect: IRect) => string[]) | null;

  constructor(
    private readonly ctx: IMarqueeContext,
    start: Point,
    groups: GroupService | null,
  ) {
    this.state = { start: start.clone(), cur: start.clone() };
    // 组索引快照按手势建一次（docs/18 §4.3：拖框期间组籍/成员不变）
    this.groupFilter = groups?.createMarqueeFilter() ?? null;
    ctx.selectorVm.show(marqueeRectOf(this.state));
  }

  /** 逐帧：矩形更新 + 空间命中 + 组口径 + 写入选中集 */
  move(world: Point): void {
    this.state.cur = world.clone();
    const rect = marqueeRectOf(this.state);
    this.ctx.selectorVm.update(rect);
    const hits = this.ctx.vmEngine.getVmByRect(
      new Rectangle(rect.x, rect.y, rect.width, rect.height),
    );
    let hitIds = hits.map((vm) => vm.id);
    if (this.groupFilter) {
      // 整组全入框口径（docs/18 §4.3）：过程即最终结果，不闪变
      hitIds = this.groupFilter(hitIds, rect);
    }
    this.ctx.setSelected(hitIds);
  }

  /** 松手收尾：隐藏蓝框 + 脑图节点级命中委托（框中根本体 = 整图焦点回根、
   *  框中子节点 bbox = 节点级选中，docs/11 §0 修订——选中集仍归 selector） */
  finish(selectedIds: string[]): void {
    const rect = marqueeRectOf(this.state);
    this.ctx.selectorVm.hide();
    for (const id of selectedIds) {
      const vm = this.ctx.vmEngine.getVmById(id);
      if (vm?.type === 'MIND_MAP') this.ctx.mindDragDelegate()?.focusFromMarquee?.(rect, id);
    }
  }

  /** 手势取消：仅隐藏蓝框（选中集保持取消前的过程结果——既有语义） */
  cancel(): void {
    this.ctx.selectorVm.hide();
  }
}
