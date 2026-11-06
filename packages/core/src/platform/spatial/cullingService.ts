import { Disposable } from '../../base/disposable';
import { rectsIntersect } from '../../common/geometry';
import type { IViewportService, IVmEngineService } from '../../types';
import { SpatialIndex } from './spatialIndex';

/**
 * 视口 culling（docs/16 §1，4.8 P0）：vpBounds$ 变化 → 索引查可视格 →
 * diff 翻转 vm.root.renderable（不动 visible——保留事件语义；renderable=false
 * 跳过渲染提交）。格级 margin 半格防抖（pan 微动不反复翻转边界控件）。
 *
 * 拖拽预览例外（specs/edge-auto-scroll 修订）：预览只改 root、不改数据，
 * 拖拽期间索引停在旧几何——边缘滚屏推远视口后会把仍在指针下的被拖元素误剔
 * （松手落库才恢复）。因此对预览中的 id 用实时 getBounds（视觉几何）复核，
 * 索引仍只反映数据几何。
 *
 * MIND_MAP 不裁：树内增长不触发 widget 级几何 diff（rect 锚定根不动），
 * 索引会过期；且整图一个渲染单元没有渐进裁剪语义（决策记录 docs/13）。
 */

/** 可视区外扩（世界坐标；≥ 半格防 pan 抖动翻转） */
const CULL_MARGIN = 256;

/** 可复用的最小流形状（widgetsChanged$ / onVmCreated$ 等） */
interface ISubscribable {
  subscribe(fn: () => void): { unsubscribe(): void };
}

export class CullingService extends Disposable {
  private culled = new Set<string>();

  constructor(
    private viewport: IViewportService,
    private vmEngine: IVmEngineService,
    private index: SpatialIndex,
    /** 重评触发流（数据几何变化 / 新 vm 创建 / 恢复） */
    private onChange: ISubscribable[],
    /** 元素拖拽预览 id 提供者（组合根闭包晚绑定 selector；缺省空——旧桩零改动） */
    private getPreviewIds: () => readonly string[] = () => [],
  ) {
    super();
  }

  initialize(): void {
    const unsubs: Array<() => void> = [];
    for (const s of this.onChange) {
      const sub = s.subscribe(() => this.apply());
      unsubs.push(() => sub.unsubscribe());
    }
    const vpSub = this.viewport.vpBounds$.subscribe(() => this.apply());
    unsubs.push(() => vpSub.unsubscribe());
    this.addDisposable(() => {
      for (const u of unsubs) u();
    });
    // 装配晚于 IndexedDB 恢复（第 2 步）——立即全量一次覆盖已存在控件
    this.apply();
  }

  /** 已删件出册（Batch 1 · 1.26）：culled 集合滞留死 id——culledCount 虚高
   *  （探针失真）且 suspendForExport 全量恢复时对不存在 vm 空转 */
  forget(ids: string[]): void {
    for (const id of ids) this.culled.delete(id);
  }

  /** 一次全量 diff：可视（含 margin）集合外的 vm 置 renderable=false */
  apply(): void {
    const b = this.viewport.vpBounds$.value;
    const expanded = {
      x: b.x - CULL_MARGIN,
      y: b.y - CULL_MARGIN,
      width: b.width + CULL_MARGIN * 2,
      height: b.height + CULL_MARGIN * 2,
    };
    const visibleIds = this.index.queryIds(expanded);
    const previewIds = new Set(this.getPreviewIds());
    for (const vm of this.vmEngine.getAllVms()) {
      if (vm.type === 'MIND_MAP') continue;
      let shouldHide = !visibleIds.has(vm.id);
      // 预览中的 root 位置才是用户看到的几何（getBounds 读 root，含拖拽位移）；
      // 只复核「索引判不可见」的预览项，命中扩展视口则保留
      if (shouldHide && previewIds.size > 0 && previewIds.has(vm.id)) {
        shouldHide = !rectsIntersect(vm.getBounds(), expanded);
      }
      const isHidden = this.culled.has(vm.id);
      if (shouldHide !== isHidden) {
        vm.root.renderable = !shouldHide;
        if (shouldHide) this.culled.add(vm.id);
        else this.culled.delete(vm.id);
      }
    }
  }

  get culledCount(): number {
    return this.culled.size;
  }

  /** 导出/离屏渲染前挂起剔除：全量置回 renderable（extract 重渲染同样跳过
   *  renderable=false 的子树——不挂起则视窗外控件在导出产物中缺失），
   *  返回恢复闭包（重跑 apply() 复原）。dispose 的恢复循环同款。 */
  suspendForExport(): () => void {
    for (const id of this.culled) {
      const vm = this.vmEngine.getVmById(id);
      if (vm) vm.root.renderable = true;
    }
    this.culled.clear();
    return () => this.apply();
  }

  override dispose(): void {
    // 恢复全部（避免复用容器时残留不可见）
    for (const id of this.culled) {
      const vm = this.vmEngine.getVmById(id);
      if (vm) vm.root.renderable = true;
    }
    this.culled.clear();
    super.dispose();
  }
}
