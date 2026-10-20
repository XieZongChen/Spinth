import type { Point, Rectangle } from 'pixi.js';
import { Subject } from 'rxjs';
import { Disposable } from '../../base/disposable';
import { markRender } from '../../common/render';
import type { SpatialIndex } from '../spatial/spatialIndex';
import type { ServiceRegistry, Token } from '../registry/serviceRegistry';
import type {
  IBaseModel,
  IBaseWidgetVm,
  IDataEngineService,
  IViewportService,
  IVmEngineService,
  IWidgetData,
} from '../../types';

/** onStateChanged$ diff 中标志几何变化的键（rect 四键 + points 型几何）。
 *  rotation 在列：世界 AABB 随 θ 变化（docs/05 §8）——索引须重算 */
const GEOMETRY_KEYS = ['x', 'y', 'width', 'height', 'points', 'rotation'];

/**
 * VM 引擎（docs/04 §5）：订阅 onModelCreated$/onModelRemoved$，
 * 工厂建 VM → setModel → 挂 widgetLayer。本地与远端同一条路径。
 * 空间索引（docs/16 §1，4.8）：增删/几何变化增量维护，命中与框选走格查询。
 */
export class VmEngineService extends Disposable implements IVmEngineService {
  private vmMapping = new Map<string, IBaseWidgetVm>();
  /** 脑图 vm 集：查询豁免索引用（树增长不走 widget 几何 diff，索引恒过期——
   *  与 culling 的 MIND_MAP 豁免同因，docs/13 决策记录；数量级小，粗筛并入代价可忽略） */
  private readonly mindVmIds = new Set<string>();
  /** VM 创建完成（含恢复）事件流——连线跟随等横切订阅入口 */
  readonly onVmCreated$ = new Subject<IBaseWidgetVm>();

  constructor(
    private engine: IDataEngineService,
    private registry: ServiceRegistry,
    private vmTokens: Map<string, Token<IBaseWidgetVm>>,
    private viewport: Pick<IViewportService, 'addWidget' | 'removeWidget' | 'setZOrder'>,
    private spatial: SpatialIndex,
  ) {
    super();
  }

  initialize(): void {
    this.addDisposable(
      this.engine.onModelCreated$.subscribe((model) => this.onModelCreated(model)),
      this.engine.onModelRemoved$.subscribe((ids) => this.onModelRemoved(ids)),
    );
  }

  private onModelCreated(model: IBaseModel<IWidgetData>): void {
    try {
      const data = model.toJSON();
      const cached = this.vmMapping.get(data.id);
      if (cached) {
        return; // 本地已建（Phase 1 无此场景，防御）
      }
      const t = this.vmTokens.get(data.type);
      if (!t) throw new Error(`[VmEngine] 未注册 VM 类型: ${data.type}`);
      const vm = this.registry.resolve(t);
      vm.setModel(model);
      this.vmMapping.set(data.id, vm);
      if (vm.type === 'MIND_MAP') this.mindVmIds.add(data.id);
      this.viewport.addWidget(vm.root, data.zOrder);
      this.spatial.update(vm.id, vm.getBounds());
      // zOrder 数据变化（图层操作/远端）→ 重排序；几何变化 → 索引更新
      // （onStateChanged$ 在渲染完成后广播——getBounds 已是新帧）
      this.addDisposable(
        vm.onStateChanged$.subscribe(({ diff }) => {
          const z = diff['zOrder'];
          if (typeof z === 'string') {
            this.viewport.setZOrder(vm.root, z);
          }
          if (GEOMETRY_KEYS.some((k) => k in diff)) {
            this.spatial.update(vm.id, vm.getBounds());
          }
        }),
      );
      markRender();
      this.onVmCreated$.next(vm);
    } catch (err) {
      console.error('[VmEngine] onModelCreated 失败', err);
    }
  }

  private onModelRemoved(ids: string[]): void {
    for (const id of ids) {
      const vm = this.vmMapping.get(id);
      if (vm) {
        this.vmMapping.delete(id);
        this.mindVmIds.delete(id);
        this.viewport.removeWidget(vm.root);
        this.spatial.remove(id);
        vm.dispose();
      }
    }
    markRender();
  }

  getVmById(id: string): IBaseWidgetVm | undefined {
    return this.vmMapping.get(id);
  }

  getAllVms(): IBaseWidgetVm[] {
    return Array.from(this.vmMapping.values());
  }

  /** 主题切换等环境级变化的强制重画（docs/17 C2——各 Vm 以内部守卫自行判定，
   *  textVm 的主题版本守卫使「纯平移」判定失效从而全量重建） */
  refreshAll(): void {
    for (const vm of this.vmMapping.values()) {
      try {
        vm.refresh();
      } catch {
        // 单个 vm 重画失败不阻断其余（与 onModelCreated 的容错口径一致）
      }
    }
  }

  /** 候选 = 索引格内 + 全部脑图（脑图对索引豁免，见 mindVmIds 注释） */
  private queryCandidates(r: {
    x: number;
    y: number;
    width: number;
    height: number;
  }): Iterable<string> {
    const ids = this.spatial.queryIds(r);
    for (const id of this.mindVmIds) ids.add(id);
    return ids;
  }

  /** 顶层优先（zOrder 字典序降序）；候选来自格索引（O(格内)），
   *  仍逐个 hitTestPoint 精判——索引只过滤明显不相交者 */
  getVmByPoint(p: Point): IBaseWidgetVm[] {
    const candidates = this.queryCandidates({ x: p.x, y: p.y, width: 0, height: 0 });
    const vms: IBaseWidgetVm[] = [];
    for (const id of candidates) {
      const vm = this.vmMapping.get(id);
      if (vm && vm.hitTestPoint(p)) vms.push(vm);
    }
    return sortByZOrderDesc(vms);
  }

  getVmByRect(r: Rectangle): IBaseWidgetVm[] {
    const candidates = this.queryCandidates({ x: r.x, y: r.y, width: r.width, height: r.height });
    const vms: IBaseWidgetVm[] = [];
    for (const id of candidates) {
      const vm = this.vmMapping.get(id);
      if (vm && vm.hitTestRect(r)) vms.push(vm);
    }
    return sortByZOrderDesc(vms);
  }

  /** 矩形内候选（粗筛：索引候选 + getBounds 相交；吸附参照物收集用） */
  getVmsInRect(r: { x: number; y: number; width: number; height: number }): IBaseWidgetVm[] {
    const candidates = this.queryCandidates(r);
    const vms: IBaseWidgetVm[] = [];
    for (const id of candidates) {
      const vm = this.vmMapping.get(id);
      if (!vm) continue;
      const b = vm.getBounds();
      if (
        b.x + b.width >= r.x &&
        b.x <= r.x + r.width &&
        b.y + b.height >= r.y &&
        b.y <= r.y + r.height
      ) {
        vms.push(vm);
      }
    }
    return vms;
  }
}

function sortByZOrderDesc(vms: IBaseWidgetVm[]): IBaseWidgetVm[] {
  return vms.sort((a, b) => ((a.root.zOrder ?? '') < (b.root.zOrder ?? '') ? 1 : -1));
}
