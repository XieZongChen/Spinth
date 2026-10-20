import { BehaviorSubject } from 'rxjs';
import { Disposable } from '../../base/disposable';
import { genId } from '../../utils/id';
import type {
  IDataEngineService,
  IHistoryService,
  IPointerEventInfo,
  ISelectorService,
  IViewportService,
  IVmEngineService,
} from '../../types';
import type { MindMapVm } from './mindMapVm';
import type { MindMapModel, IMindNodeSpec } from './mindMapModel';
import { MIND_ROOT_LABEL } from './mindNodeVm';

/**
 * 脑图工具域协作者（自 mindService 拆出，2026-10-06 批刀 4）：docs/11 §8——
 * mind 工具的建图交互（按下命中已有图 → 选中+聚焦；空白 → 在按下点建图）与
 * 幽灵抑制发布（指针悬停已有脑图时隐藏幽灵示意，视觉由 react 层 ToolGhost
 * 消费，core 只发布语义）。工具事件注册接线与 cursorMode$ 复位订阅留宿主；
 * 焦点写入经 host 回调交还宿主。
 */

/** MindService ↔ 工具域的边界：焦点写入留在服务侧 */
export interface IMindToolHost {
  setFocusedNode(id: string | null): void;
}

export class MindToolController extends Disposable {
  /** mind 幽灵抑制（指针悬停已有脑图——此处点击=选中已有图，幽灵示意隐藏；
   *  视觉由 react 层 ToolGhost 消费，core 只发布语义，2026-09-22 架构调整） */
  readonly ghostSuppressed$ = new BehaviorSubject<boolean>(false);

  constructor(
    private readonly viewport: IViewportService,
    private readonly engine: IDataEngineService,
    private readonly vmEngine: IVmEngineService,
    private readonly selector: ISelectorService,
    private readonly history: IHistoryService,
    private readonly host: IMindToolHost,
  ) {
    super();
  }

  /**
   * mind 工具按下：命中已有脑图 → 选中该图 + 焦点落命中节点；空白 → **在按下点**建图。
   *
   * 创建时机是**按下**而不是抬起（既有设计 mindToolbar.handlePointerDown）：一是"选中工具"
   * 本身不会建任何东西，二是工具栏/浮层漏进画布的 pointerup 不再会误建节点
   * （点工具坞时曾出现"鼠标处多出一个根节点"的观感问题）。
   */
  onMindDown(e: IPointerEventInfo): void {
    const hits = this.vmEngine.getVmByPoint({ x: e.world.x, y: e.world.y } as never);
    const hitMind = hits.find((vm) => vm.type === 'MIND_MAP');
    if (hitMind) {
      const hitNode = (hitMind as MindMapVm).hitNode(e.world);
      const model = this.engine.getModelById(hitMind.id) as MindMapModel | undefined;
      this.host.setFocusedNode(hitNode?.model.id ?? model?.root.id ?? null);
      this.selector.setSelected([hitMind.id]);
      this.viewport.setCursorMode('cursor');
      return;
    }
    this.createMindMap(e.world.x, e.world.y);
  }

  /** mind 模式指针移动：只做「悬停已有脑图」抑制判定（幽灵视觉/位置由 react 层
   *  ToolGhost 自监听 pointermove 实现——core 不再持有任何幽灵对象）。
   *  走未节流的工具事件流：curPos$ 是 80ms awareness 采集流，抑制切换会迟滞 */
  onMindMove(e: IPointerEventInfo): void {
    const overMind = this.vmEngine
      .getVmByPoint({ x: e.world.x, y: e.world.y } as never)
      .some((vm) => vm.type === 'MIND_MAP');
    if (this.ghostSuppressed$.value !== overMind) this.ghostSuppressed$.next(overMind);
  }

  createMindMap(x: number, y: number, rootSpec?: IMindNodeSpec): string {
    const id = genId();
    this.engine.add({
      id,
      type: 'MIND_MAP',
      zOrder: this.engine.genInitialOrder(),
      root: rootSpec ?? { text: MIND_ROOT_LABEL },
      x: Math.round(x),
      y: Math.round(y),
      width: 0,
      height: 0,
    } as never);
    this.history.stopCapturing();
    this.selector.setSelected([id]);
    this.viewport.setCursorMode('cursor');
    // 聚焦根节点
    const vm = this.vmEngine.getVmById(id) as MindMapVm | undefined;
    const model = this.engine.getModelById(id) as MindMapModel | undefined;
    if (vm && model?.hasRoot()) {
      this.host.setFocusedNode(model.root.id);
    }
    return id;
  }
}
