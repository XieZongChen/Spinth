import * as Y from 'yjs';
import type { WebsocketProvider } from 'y-websocket';
import { generateKeyBetween } from 'fractional-indexing';
import { BehaviorSubject, Subject } from 'rxjs';

/** replay 回放的 origin 标记（不进 undo 栈、不回写 db——docs/10 §2 纪律表） */
const REPLAY_ORIGIN = Symbol('spinth-replay');
import { Disposable } from '../../base/disposable';
import type { ServiceRegistry, Token } from '../registry/serviceRegistry';
import type { IBaseModel, IDataEngineService, DocState, IWidgetData, WsState } from '../../types';
import { DataProcessor } from './dataProcessor';
import { DbProvider } from './dbProvider';

/**
 * 数据引擎（docs/02 §3）：Y.Doc 单一数据源；Model/VM 的创建销毁统一走
 * onModelCreated$/onModelRemoved$；本地 add 与远端同步同一条渲染路径。
 */
export class DataEngineService extends Disposable implements IDataEngineService {
  private _yDoc!: Y.Doc;
  private modelMapping = new Map<string, IBaseModel<IWidgetData>>();
  /** 存活件数（1.23 空态引导——隔离区不计：不可见即不占画布） */
  get modelCount(): number {
    return this.modelMapping.size;
  }
  /** 隔离区（Batch 1 · 1.2）：未知类型/建模失败被跳过的 id——升级后重开自动恢复 */
  readonly quarantinedIds = new Set<string>();
  private db = new DbProvider();
  private processorRef!: DataProcessor;

  /** Model 工厂 token 由组合根注册（晚绑定：processor 在 initialize 后才存在） */
  constructor(
    private registry: ServiceRegistry,
    private modelTokens: Map<string, Token<IBaseModel<IWidgetData>>>,
  ) {
    super();
  }

  readonly onModelCreated$ = new Subject<IBaseModel<IWidgetData>>();
  readonly onModelRemoved$ = new Subject<string[]>();
  /** 文档任意 update（本地写/undo/redo/远端/replay）——几何变化通知面
   *  （docs/06 §3 参考线置脏）。比事件语义更粗，消费方只做 markDirty 类轻响应 */
  readonly onModelUpdated$ = new Subject<void>();
  readonly docState$ = new BehaviorSubject<DocState>('idle');
  /** ws 连接态（docs/10 §2）：off = 本地模式；docState$ 保持「可渲染」语义不变 */
  readonly wsState$ = new BehaviorSubject<WsState>('off');
  /** 本地落盘态（Batch 1 · 1.15）：failed 时 UI 须提示「保存失败」——wsState 只反映
   *  协同链路，与 IndexedDB 落盘无关（此前顶栏「已同步」两义混同） */
  readonly persistState$ = this.db.persistState$;

  /** 手动重试落盘（与自动退避共存，幂等——缓冲空则 no-op） */
  retryPersist(): void {
    void this.db.flushPendingWrites();
  }

  /** 导航前收口（docs/20 §5.5）：显式等待当前文档写缓冲落盘。项目导入在
   *  创建新文档成功后调用——把当前画布的未落盘窗口压到最小（best-effort）。 */
  flushLocalWrites(): Promise<void> {
    return this.db.flushPendingWrites();
  }

  /** 运行时切换写授权（updateEditable 联动，docs/21 §4）：只读宿主不落盘，
   *  切回可写恢复写入路径 */
  setWriteEnabled(v: boolean): void {
    this.db.setReadOnly(!v);
  }

  private ws: WebsocketProvider | null = null;

  private _yWidgets!: Y.Array<unknown>;

  async initialize(config: {
    docId: string;
    wsUrl?: string;
    userName?: string;
    writeEnabled?: boolean;
  }): Promise<void> {
    this.docState$.next('loading');
    this._yDoc = new Y.Doc({ guid: config.docId });
    this.processorRef = new DataProcessor(this._yDoc);
    this._yWidgets = this._yDoc.getArray('widgets');

    this._yWidgets.observe(this.handleWidgetsChange);
    this.addDisposable(() => this._yWidgets.unobserve(this.handleWidgetsChange));

    // 文档级 update 旁路（docs/06 §3）：拖拽/缩放进行中的远端移动等不换
    // 选中集/视窗/增删的几何变化——依赖「当前几何」的消费方经此置脏
    this._yDoc.on('update', this.handleDocUpdate);
    this.addDisposable(() => this._yDoc.off('update', this.handleDocUpdate));

    // replay 时间机器（docs/10 §6）：localStorage 开关，从审计日志逐条回放，
    // 不连 ws；origin = replayOrigin（不进 undo 栈、不回写 db——origin 纪律）
    const replayOn =
      typeof localStorage !== 'undefined' && localStorage.getItem('spinth.replay') === '1';
    this.db.ignoreOrigin(REPLAY_ORIGIN); // 回放不回写 db（外部审查揪出：曾致审计日志重复叠加）
    // 只读标签（docs/21 §4）：writeEnabled === false → db 拒绝一切文档写入
    await this.db.attach(config.docId, this._yDoc, {
      replay: replayOn,
      readOnly: config.writeEnabled === false,
    });
    if (replayOn) {
      await this.replayFromAudit();
      this.docState$.next('synced');
      return;
    }

    // 本地持久化（db 同步完成即视为数据就绪——秒开，不等待 ws）
    this.docState$.next('synced');

    // 协同连接（docs/10 §2）：断线重连用 y-websocket 内建 + 指数退避；
    // 远端 update 的 origin = provider 实例（不进 undo 栈、db 照常落盘——origin 纪律表）
    // **动态 import**（2026-09-27）：协同传输是可选能力——单机版（无 wsUrl）产物
    // 不打包 y-websocket 栈，协作模式按需加载
    if (config.wsUrl) {
      this.wsState$.next('connecting');
      try {
        const { WebsocketProvider } = await import('y-websocket');
        this.ws = new WebsocketProvider(config.wsUrl, `spinth/${config.docId}`, this._yDoc, {
          connect: true,
        });
        this.ws.on('status', (event: { status: string }) => {
          // connected（尚未完成首同步）并入 connecting；断线重连的中间态也并入
          const status = event.status;
          if (status === 'connecting' || status === 'connected') {
            if (this.wsState$.value !== 'synced') this.wsState$.next('connecting');
          } else if (status === 'disconnected') {
            this.wsState$.next('disconnected');
          }
        });
        this.ws.on('sync', () => this.wsState$.next('synced'));
      } catch (err) {
        // 协同 chunk 加载失败（如离线启用 ?ws 且协同 chunk 未被缓存）：本地编辑
        // 不受影响——落 disconnected（ws 断连可编辑口径），不卡死在 connecting
        console.error('[spinth:ws] 协同传输加载失败，降级单机可编辑', err);
        this.wsState$.next('disconnected');
      }
    }
  }

  get wsProvider(): WebsocketProvider | null {
    return this.ws;
  }

  private handleDocUpdate = (): void => {
    if (!this.adding) this.maxZOrderCache = undefined; // 1.25：非 add 写入保守失效
    this.onModelUpdated$.next();
  };

  /** 审计日志逐条回放（spinth.replay.speed=<ms/op> 步进；until=<t> 截止时间戳） */
  private async replayFromAudit(): Promise<void> {
    const audit = await this.db.readAuditLog();
    const speed = Number(localStorage.getItem('spinth.replay.speed') ?? 0);
    const until = Number(localStorage.getItem('spinth.replay.until') ?? Number.MAX_SAFE_INTEGER);
    const verbose = localStorage.getItem('spinth.replay.verbose') === '1';
    for (const entry of audit) {
      if (entry.t > until) break;
      if (verbose && typeof Y.logUpdate === 'function') Y.logUpdate(entry.u);
      Y.applyUpdate(this._yDoc, entry.u, REPLAY_ORIGIN);
      if (speed > 0) await new Promise((r) => setTimeout(r, speed));
    }
    console.info(`[spinth:replay] 回放完成：${audit.length} 条 update`);
  }

  get yDoc(): Y.Doc {
    return this._yDoc;
  }

  get yWidgets(): Y.Array<unknown> {
    return this._yWidgets;
  }

  /** 组合根注册 Model 工厂时需要（initialize 之后才存在） */
  get processor(): DataProcessor {
    return this.processorRef;
  }

  getModelById(id: string): IBaseModel<IWidgetData> | undefined {
    return this.modelMapping.get(id);
  }

  transact<T>(fn: () => T, origin?: unknown): T {
    return this._yDoc.transact(fn, origin);
  }

  /** 维护写（迁移等）后的立即 compaction（磁盘塌缩）——同 dbProvider 测试/运维入口 */
  compactNow(): Promise<void> {
    return this.db.compactNow();
  }

  add(data: IWidgetData): IBaseModel<IWidgetData> {
    const model = this.buildModel(data.type);
    this.adding = true; // 1.25：抑制本地 add 触发的 update 失效（连发 O(1)）
    try {
      const yMap = model.initialize(data);
      // 先登记再 push：observe 回调发现已有映射即跳过（防止双重发射）
      this.modelMapping.set(data.id, model);
      this.yDoc.transact(() => {
        this._yWidgets.push([yMap]);
      });
      // 外部传入的 zOrder（quickAdd 等）也纳入缓存上界
      const z = (data as { zOrder?: string }).zOrder;
      if (
        z &&
        (this.maxZOrderCache === undefined ||
          this.maxZOrderCache === null ||
          z > this.maxZOrderCache)
      ) {
        this.maxZOrderCache = z;
      }
    } finally {
      this.adding = false;
    }
    // 本地新增也必须走 onModelCreated$ —— 本地与远端同一条渲染路径（docs/02 §3 铁律）。
    // 曾经缺失此发射：单实例下本地创建不渲染（Phase 1 验收被双实例 bug 掩盖）。
    this.onModelCreated$.next(model);
    return model;
  }

  removeByIds(ids: string[]): void {
    // 批量删除一个事务 = 一次撤销（docs/02 §3）
    this.yDoc.transact(() => {
      for (const id of ids) {
        const i = this._yWidgets.toArray().findIndex((m) => (m as Y.Map<unknown>).get('id') === id);
        if (i >= 0) this._yWidgets.delete(i, 1);
      }
    });
    // 删除经由 observe → onModelRemoved$ 统一发出（数据驱动，本地远端同路径）
  }

  /** max zOrder 缓存（Batch 1 · 1.25）：genInitialOrder 曾每次 O(N) 全扫
   *  （恢复/批量创建 1000 件 = 1000 次全扫）。失效面：
   *  - 本地 add：不失效（adding flag 抑制——新 key 由本缓存生成必为最大，O(1) 连发）
   *  - 其余任何 update（远端/undo/图层操作/zOrder 改写）：失效重扫
   *  - 删除（onModelRemoved）：失效（保守——删 max 项后重扫精确） */
  private maxZOrderCache: string | null | undefined = undefined; // undefined = 未算
  private adding = false; // 本地 add 事务内标记（update 事件同步发，flag 可靠）
  genInitialOrder(): string {
    if (this.maxZOrderCache === undefined) {
      let max: string | null = null;
      for (const m of this._yWidgets.toArray() as Y.Map<unknown>[]) {
        const z = m.get('zOrder') as string;
        if (z && (max === null || z > max)) max = z;
      }
      this.maxZOrderCache = max;
    }
    const key = generateKeyBetween(this.maxZOrderCache, null);
    this.maxZOrderCache = key; // 新生成的必是最大（add 链高频场景 O(1) 连发）
    return key;
  }

  private buildModel(type: string): IBaseModel<IWidgetData> {
    const t = this.modelTokens.get(type);
    if (!t) throw new Error(`[DataEngine] 未知 widget 类型: ${type}`);
    return this.registry.resolve(t);
  }

  private handleWidgetsChange = (event: Y.YArrayEvent<unknown>): void => {
    // 新增：本地 add 已登记（跳过），远端插入在这里建 Model。
    // 隔离不抛穿（Batch 1 · 1.2，2026-10-17 审查：滚动升级硬要求）：旧客户端
    // 遇到新版本控件类型/非法结构——跳过并计数，文档其余部分照常打开（此前
    // throw 观察者链打穿，整文档白屏）；升级后重新打开自动恢复
    for (const delta of event.delta) {
      if (delta.insert) {
        const items = Array.isArray(delta.insert) ? delta.insert : [delta.insert];
        for (const item of items) {
          if (!(item instanceof Y.Map)) continue;
          const id = item.get('id') as string;
          const type = item.get('type') as string;
          if (!id || this.modelMapping.has(id)) continue;
          if (!this.modelTokens.has(type)) {
            this.quarantinedIds.add(id);
            console.warn(`[DataEngine] 未知 widget 类型已隔离: ${type} (id=${id})`);
            continue;
          }
          try {
            const model = this.buildModel(type);
            model.initializeY(item);
            this.modelMapping.set(id, model);
            this.onModelCreated$.next(model);
          } catch (err) {
            this.quarantinedIds.add(id);
            console.warn(`[DataEngine] 建模失败已隔离 (id=${id})`, err);
          }
        }
      }
    }
    // 删除检测不能用 changes.deleted 里的 Y.Map 读 id —— undo（ignoreRemoteMapChanges）
    // 会先剥离嵌套内容，deleted map 的 get('id') 为 undefined（实测踩坑）。
    // 对齐既有设计：现存 ids 与本地映射求差集。
    if (event.changes.deleted.size > 0) {
      this.syncRemovedModels();
    }
  };

  private syncRemovedModels(): void {
    const alive = new Set<string>();
    for (const m of this._yWidgets.toArray() as Y.Map<unknown>[]) {
      const id = m.get('id') as string;
      if (id) alive.add(id);
    }
    const removedIds: string[] = [];
    for (const id of this.modelMapping.keys()) {
      if (!alive.has(id)) {
        this.modelMapping.delete(id);
        removedIds.push(id);
      }
    }
    if (removedIds.length > 0) {
      this.maxZOrderCache = undefined; // 1.25：删除保守失效（删 max 项后重扫精确）
      this.onModelRemoved$.next(removedIds);
    }
  }

  override dispose(): void {
    this.ws?.destroy();
    this.ws = null;
    this.db.dispose();
    this._yDoc?.destroy();
    super.dispose();
  }
}
