import { Disposable } from '../../base/disposable';
import { genId } from '../../utils/id';
import { unionRects, type IRect } from '../../common/geometry';
import type {
  IDataEngineService,
  IFrameLookup,
  IHistoryService,
  ISelectorService,
  IViewportService,
  IVmEngineService,
  IWidgetData,
} from '../../types';
import { parsePastePayload, serializeToHtml, type IWidgetSnapshot } from './clipboardData';
import { isEditableTarget } from '../keyboard/shortcuts';

/**
 * 剪贴板服务（docs/09 §1）：document 级 copy/cut/paste 原生事件通道（无需权限）。
 * 结构化数据写 text/html 的 data-spinth 标签 + text/plain JSON 兜底；
 * 粘贴落点 = 视口中心（鼠标世界坐标跟踪在 Phase 2.12 操作栏完善时接入）。
 */
export class ClipboardService extends Disposable {
  /** 同文档内部缓冲（避免序列化损失）。仅当系统剪贴板仍持本页所写内容时生效
   *  （Batch 1 · 1.12）——此前绝对优先：复制 A → 外部复制 B → 回画布粘贴出 A */
  private buffer: IWidgetSnapshot[] | null = null;
  /** buffer 写入时同步进系统剪贴板的 text/plain（指纹比对用：不一致 = 剪贴板
   *  已被外部来源覆盖 → 弃 buffer 走系统解析） */
  private bufferPlainFingerprint: string | null = null;

  constructor(
    private engine: IDataEngineService,
    private vmEngine: IVmEngineService,
    private selector: ISelectorService,
    private viewport: IViewportService,
    private history: IHistoryService,
    /** 容器归属惰性获取（specs/container-frame §4.7）：null = 无容器语义
     *  （复制不展开、粘贴不重映射——既有单测桩零改动） */
    private getFrames: () => IFrameLookup | null = () => null,
  ) {
    super();
  }

  /** 复制/剪切展开（§4.7）：选中集里的容器并入全部存活子元素（带子复制；
   *  剪切按展开集删除 = 连子删同款口径） */
  private expandForCopy(ids: string[]): string[] {
    const frames = this.getFrames();
    return frames ? frames.expandForCascade(ids) : ids;
  }

  initialize(): void {
    const onCopy = (e: ClipboardEvent): void => this.handleCopy(e, false);
    const onCut = (e: ClipboardEvent): void => this.handleCopy(e, true);
    const onPaste = (e: ClipboardEvent): void => this.handlePaste(e);
    document.addEventListener('copy', onCopy);
    document.addEventListener('cut', onCut);
    document.addEventListener('paste', onPaste);
    this.addDisposable(
      () => document.removeEventListener('copy', onCopy),
      () => document.removeEventListener('cut', onCut),
      () => document.removeEventListener('paste', onPaste),
    );
  }

  private handleCopy(e: ClipboardEvent, isCut: boolean): void {
    if (!this.viewport.editable$.value) return;
    // 输入态守卫（2026-10-17 外部审查 P0-1）：富文本编辑器/INPUT 内的 Cmd+C/X
    // 是文字操作——不劫持、不污染内部 buffer；cut 分支若漏此守卫会把被编辑
    // 控件整个 removeByIds（键盘层 hotkeys.filter 早有同款闸门，document 级
    // 剪贴板通道漏配即本缺口）
    if (isEditableTarget(e.target)) return;
    const ids = this.expandForCopy(this.selector.selected$.value);
    if (ids.length === 0) return;
    e.preventDefault();
    const snapshots: IWidgetSnapshot[] = [];
    for (const id of ids) {
      const vm = this.vmEngine.getVmById(id);
      const model = this.engine.getModelById(id);
      if (vm && model) {
        snapshots.push({ data: model.toJSON(), bounds: vm.getBounds() });
      }
    }
    this.buffer = snapshots;
    const html = serializeToHtml(snapshots);
    const plain = JSON.stringify(snapshots);
    this.bufferPlainFingerprint = plain;
    e.clipboardData?.setData('text/html', html);
    e.clipboardData?.setData('text/plain', plain);
    if (isCut) {
      this.engine.removeByIds(ids);
      this.selector.setSelected([]);
      this.history.stopCapturing();
    }
  }

  /** 系统剪贴板检出图片 blob 时的回调（组合根接 ImageService.pasteImage） */
  onPasteImage: ((blob: Blob) => void) | null = null;

  private handlePaste(e: ClipboardEvent): void {
    if (!this.viewport.editable$.value) return;
    // 输入态守卫（P0-1 同款）：编辑器/INPUT 内粘贴是文字操作，不建画布件
    if (isEditableTarget(e.target)) return;
    // 截图/复制图片：clipboardData.files 检出 image → 交 ImageService 落画布
    const imgFile = Array.from(e.clipboardData?.files ?? []).find((f) =>
      f.type.startsWith('image/'),
    );
    if (imgFile) {
      e.preventDefault();
      this.onPasteImage?.(imgFile);
      return;
    }
    e.preventDefault();
    const plain = e.clipboardData?.getData('text/plain') ?? '';
    // 内部缓冲仅在系统剪贴板仍是本页所写时生效（1.12 指纹比对）；否则解析系统
    // 剪贴板（跨 tab / 外部覆盖场景）
    const bufferValid =
      this.buffer !== null && plain !== '' && plain === this.bufferPlainFingerprint;
    const snapshots = bufferValid
      ? this.buffer
      : parsePastePayload(plain || undefined, e.clipboardData?.getData('text/html') || undefined);
    if (snapshots) {
      this.pasteSnapshots(snapshots, this.pasteTarget());
      return;
    }
    // 非 JSON 快照的纯文本 → 建 TEXT（docs/09 §1 留白销账，2026-10-09）。
    // 逻辑在 textService（TEXT 域知识；platform 层不得反向 import widgets），
    // 经回调注入——onPasteImage 同款先例
    if (plain.trim()) this.onPastePlainText?.(plain);
  }

  /** 纯文本粘贴建 TEXT 的回调（组合根接 textService.pasteText） */
  onPastePlainText: ((text: string) => void) | null = null;

  /** SDK 命令入口（右键菜单等 UI 调用；Phase 2.12 接鼠标落点） */
  pasteAt(target: { x: number; y: number }): void {
    if (!this.viewport.editable$.value) return;
    if (!this.buffer) return;
    this.pasteSnapshots(this.buffer, target);
  }

  /** 内部剪贴板是否有内容（右键菜单「粘贴」可用性） */
  get hasBuffer(): boolean {
    return this.buffer !== null;
  }

  private pasteTarget(): IRect {
    const bounds = this.viewport.vpBounds$.value;
    return { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2, width: 0, height: 0 };
  }

  /** 粘贴：相对布局保持 → 换 id（连线引用同批修正）→ 容器先入批 + 递增 zOrder
   *  → 一个事务 → 重新选中 */
  private pasteSnapshots(snapshots: IWidgetSnapshot[], target: { x: number; y: number }): void {
    const anchor = unionRects(snapshots.map((s) => s.bounds));
    if (!anchor) return;
    const dx = target.x - anchor.x;
    const dy = target.y - anchor.y;
    // 先为全部快照分配新 id（连线引用需要「同批 old→new」映射才能修正）
    const idMap = new Map<string, string>();
    // 组重映射（docs/18 §5）：同源组一桶一**新** groupId——一拷贝一组，源组
    // 与拷贝组互不联动；批外成员带进来的旧 groupId 一并重映射（半组快照也归桶）
    const groupIdMap = new Map<string, string>();
    const prepared = snapshots.map(({ data }) => {
      const id = genId();
      idMap.set(data.id, id);
      const srcGroup = (data as { groupId?: string }).groupId;
      if (srcGroup && !groupIdMap.has(srcGroup)) groupIdMap.set(srcGroup, genId());
      return { data, id };
    });
    const newIds: string[] = [];
    // 容器先入批（specs/container-frame §4.7/I3）：新件 zOrder 按入批序递增生成，
    // 容器副本的 key 必然低于批内全部子元素——层级在创建数据里即正确。不能改成
    // 「全部 add 后再 update 钳制」：外层事务内紧随创建的写入对刚挂上的 vm 观察者
    // 不可见（yjs 不为本事务新建的类型登记变更），结果是文档钳了、root.zOrder
    // 没动——白底容器盖住子副本直到刷新（E2E container C-16）
    const ordered = [
      ...prepared.filter((p) => p.data.type === 'FRAME'),
      ...prepared.filter((p) => p.data.type !== 'FRAME'),
    ];
    // 容器归属桶重映射（specs/container-frame §4.7，groupIdMap 同款内联）：
    // 批内父 → 该容器的新 id（一拷贝一容器）；批外父（复制了子没复制容器）
    // → undefined 落为顶层——否则粘贴体指向原容器，拖原件会带走副本。
    // idMap 此刻已全量（prepared 循环完成）
    const parentIdOf = new Map<string, string | undefined>();
    for (const { data } of snapshots) {
      const srcParent = (data as { parentId?: string }).parentId;
      if (srcParent === undefined) continue;
      parentIdOf.set(idMap.get(data.id)!, idMap.get(srcParent));
    }
    this.engine.transact(() => {
      for (const { data, id } of ordered) {
        const zOrder = this.engine.genInitialOrder();
        const moved: IWidgetData = {
          ...data,
          id,
          zOrder,
          x: data.x + dx,
          y: data.y + dy,
        } as IWidgetData;
        // points 世界坐标型（LINE/PEN）：几何在 points，必须平移（只动 x/y 无效，粘贴回原位的根因）
        if (Array.isArray((data as { points?: unknown }).points)) {
          (moved as { points: Array<[number, number]> }).points = (
            data as unknown as { points: Array<[number, number]> }
          ).points.map((p) => [p[0]! + dx, p[1]! + dy] as [number, number]);
        }
        // 连线引用修正：同批复制的节点 → 指向新 id；批外（已被剪切掉的）→ 解绑为 null
        if (data.type === 'LINE') {
          const line = moved as unknown as { startNodeId: string | null; endNodeId: string | null };
          line.startNodeId =
            data.startNodeId && idMap.has(data.startNodeId) ? idMap.get(data.startNodeId)! : null;
          line.endNodeId =
            data.endNodeId && idMap.has(data.endNodeId) ? idMap.get(data.endNodeId)! : null;
        }
        // 组标记重映射（docs/18 §5）：桶内新 groupId；无组快照显式清字段——
        // 源对象组籍不随复制扩散到无组粘贴件
        const movedRec = moved as unknown as { groupId?: string };
        const srcGroup = (data as { groupId?: string }).groupId;
        if (srcGroup) movedRec.groupId = groupIdMap.get(srcGroup);
        else delete movedRec.groupId;
        // 容器归属重映射（§4.7）：桶内父 → 新容器 id；批外父显式清键——
        // 快照 parentId 指向的是**原**容器，不清则副本被原容器级联带走
        const movedRecP = moved as unknown as { parentId?: string };
        const srcParent = (data as { parentId?: string }).parentId;
        if (srcParent !== undefined) movedRecP.parentId = parentIdOf.get(id);
        else delete movedRecP.parentId;
        this.engine.add(moved);
        newIds.push(id);
      }
    });
    this.history.stopCapturing();
    this.selector.setSelected(newIds);
  }

  /** 程序化复制（右键菜单用）：建内部缓冲 + 尽力写系统剪贴板 */
  async copySelected(isCut = false): Promise<void> {
    if (!this.viewport.editable$.value) return;
    const ids = this.expandForCopy(this.selector.selected$.value);
    if (ids.length === 0) return;
    const snapshots: IWidgetSnapshot[] = [];
    for (const id of ids) {
      const vm = this.vmEngine.getVmById(id);
      const model = this.engine.getModelById(id);
      if (vm && model) {
        snapshots.push({ data: model.toJSON(), bounds: vm.getBounds() });
      }
    }
    this.buffer = snapshots;
    this.bufferPlainFingerprint = JSON.stringify(snapshots); // 1.12 指纹（与 handleCopy 同源）
    try {
      const html = serializeToHtml(snapshots);
      const plain = JSON.stringify(snapshots);
      const item = new ClipboardItem({
        'text/html': new Blob([html], { type: 'text/html' }),
        'text/plain': new Blob([plain], { type: 'text/plain' }),
      });
      await navigator.clipboard.write([item]);
    } catch {
      // 权限不可用时内部缓冲仍可本页粘贴
    }
    if (isCut) {
      this.engine.removeByIds(ids);
      this.selector.setSelected([]);
      this.history.stopCapturing();
    }
  }

  override dispose(): void {
    super.dispose();
  }
}
