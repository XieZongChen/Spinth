import { Disposable } from '../../base/disposable';
import type {
  IDataEngineService,
  IFrameLookup,
  IHistoryService,
  ISelectorService,
  IVmEngineService,
} from '../../types';
import { computeLayerChanges, type LayerOp } from './layerOps';

/**
 * 图层业务服务（docs/02 §2）：zOrder 走 model 更新（Yjs 事务），
 * 渲染排序由 vmEngine 监听 onStateChanged$ 的 zOrder diff 驱动。
 */
export class LayerService extends Disposable {
  constructor(
    private engine: IDataEngineService,
    private vmEngine: IVmEngineService,
    private selector: ISelectorService,
    private history: IHistoryService,
    /** 容器归属惰性获取（specs/container-frame §6.4）：null = 无容器钳制
     *  （单测桩环境老行为）。delta 用 vm.root.zOrder 算（事务外，语义不变），
     *  容器钳制经 IFrameLookup——platform 不 import widgets/frame */
    private getFrames: () => IFrameLookup | null = () => null,
  ) {
    super();
  }

  apply(op: LayerOp): void {
    const items = this.vmEngine.getAllVms().map((vm) => ({
      id: vm.id,
      zOrder: vm.root.zOrder ?? '',
      bounds: vm.getBounds(),
    }));
    const changes = computeLayerChanges(items, this.selector.selected$.value, op);
    if (changes.length === 0) return;
    // 容器钳制（specs/container-frame §4.8）：「变更后 zOrder 表」= items 算术
    // 叠加 changes（事务外，vm.root 语义不变）；语义 = 容器置顶也置到「子元素
    // 之下最高处」（I3 容器恒在子之下，否则容器盖住子后点击全被容器吃掉）
    const frames = this.getFrames();
    let clampChanges: Array<{ id: string; zOrder: string }> = [];
    if (frames) {
      const post = new Map(items.map((i) => [i.id, i.zOrder] as const));
      for (const c of changes) post.set(c.id, c.zOrder);
      clampChanges = frames.computeLayerClamps([...post].map(([id, zOrder]) => ({ id, zOrder })));
    }
    // 一个事务 = 一次撤销（docs/02 §3）；钳制写与本次变更同事务
    this.engine.transact(() => {
      for (const c of [...changes, ...clampChanges]) {
        this.engine.getModelById(c.id)?.update({ zOrder: c.zOrder } as never);
      }
    });
    this.history.stopCapturing();
  }
}
