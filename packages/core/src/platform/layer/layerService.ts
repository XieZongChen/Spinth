import { Disposable } from '../../base/disposable';
import type {
  IDataEngineService,
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
    // 一个事务 = 一次撤销（docs/02 §3）
    this.engine.transact(() => {
      for (const c of changes) {
        this.engine.getModelById(c.id)?.update({ zOrder: c.zOrder } as never);
      }
    });
    this.history.stopCapturing();
  }
}
