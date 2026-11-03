import { Point, Rectangle } from 'pixi.js';
import type { IPoint, IRect } from '../../common/geometry';
import type { IMindDragDelegate, IVmEngineService } from '../../types';
import { marqueeRectOf, type MarqueeState } from './selectorVm';
import { DRAG_TRACTION_SCREEN } from './selectorDragOps';
import type { GroupService } from './groupService';

/**
 * 框选会话（specs/marquee-auto-scroll §5）：down 建 / move 逐帧 / up·cancel 收。
 * 状态封装在本类，SelectorService 只持可空引用（isDragging 判定）。
 * 起拖判据（屏幕 px 锁存）只门控滚屏——矩形与选中从 pointerdown 起「过程即
 * 结果」，不受阈值影响；选中集按帧去重，滚屏稳态零 setSelected。
 */

/** 起拖判据（屏幕 px）：与元素拖拽阻尼同口径，单一来源避免漂移（D2）。
 *  必须是屏幕距离——滚屏自身持续改变指针世界坐标，世界阈值会自激越过 */
export const MARQUEE_TRACTION_SCREEN = DRAG_TRACTION_SCREEN;

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
  /** 按下时的屏幕坐标（判据基准，永不更新——滚动改变世界坐标但不改变它） */
  private readonly startScreen: IPoint;
  private movedFlag = false;
  /** 上次写入的 id 序列。null = 尚未写过：首帧命中为空也要写一次 setSelected([])，
   *  否则 shift+框选/点击后首帧的「清空既有选中」会丢失（specs §13.1-R3） */
  private lastIds: string[] | null = null;

  constructor(
    private readonly ctx: IMarqueeContext,
    start: Point,
    startScreen: IPoint,
    groups: GroupService | null,
  ) {
    this.state = { start: start.clone(), cur: start.clone() };
    this.startScreen = { x: startScreen.x, y: startScreen.y };
    // 组索引快照按手势建一次（docs/18 §4.3：拖框期间组籍/成员不变）
    this.groupFilter = groups?.createMarqueeFilter() ?? null;
    ctx.selectorVm.show(marqueeRectOf(this.state));
  }

  /** 是否已越过起拖判据（锁存，回移不复位；滚屏唯一开关） */
  get moved(): boolean {
    return this.movedFlag;
  }

  /** 逐帧：矩形更新 + 空间命中 + 组口径 + 写入选中集（去重） */
  move(world: Point, screen: IPoint): void {
    if (
      !this.movedFlag &&
      Math.hypot(screen.x - this.startScreen.x, screen.y - this.startScreen.y) >=
        MARQUEE_TRACTION_SCREEN
    ) {
      this.movedFlag = true;
    }
    this.state.cur = world.clone();
    const rect = marqueeRectOf(this.state);
    this.ctx.selectorVm.update(rect); // 矩形每帧重绘，不受选中去重影响
    const hits = this.ctx.vmEngine.getVmByRect(
      new Rectangle(rect.x, rect.y, rect.width, rect.height),
    );
    let hitIds = hits.map((vm) => vm.id);
    if (this.groupFilter) {
      // 整组全入框口径（docs/18 §4.3）：过程即最终结果，不闪变
      hitIds = this.groupFilter(hitIds, rect);
    }
    // setSelected 是 O(全部 vm) + 重订阅（specs §2.3-④）：滚屏稳态命中集不变，
    // 逐帧照调 = 与输入无关的固定 fan-out——与上次写入序列相同则跳过。
    // getVmByRect 已按 zOrder 稳定排序，序列比较即集合等价
    if (this.lastIds && sameIds(this.lastIds, hitIds)) return;
    this.lastIds = hitIds;
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

/** 序列逐项相等（空/单/多元素短路；调用方保证两者均非 null） */
function sameIds(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}
