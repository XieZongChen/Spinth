import * as Y from 'yjs';
import { Subject } from 'rxjs';

/**
 * 脑图节点数据层（docs/11 §3 增量树同步 + §0 硬规定）：
 * - 递归为每个 child 建 Model（双向 parent 引用）；
 * - yChildren.observe 的 Yjs delta（retain/delete/insert）→ 内存数组 splice
 *   → childrenChange$（VM 据此增量 build/destroy，不重建整树）；
 * - toJSON 剥离 children（state 只含自身字段）——节点级 observeDeep 若序列化
 *   整棵子树，叶编辑 = 全部祖先 O(子树) 开销（外部审查揪出的乘积版陷阱）。
 */

export interface IMindNodeJson {
  id: string;
  text: string;
  /** 仅根的直接子节点有 */
  direction?: 'left' | 'right';
  /** 缺省沿父链继承（getLineColor） */
  lineColor?: string;
}

export type MindNodeDelta =
  | { kind: 'insert'; index: number; nodes: MindNodeModel[] }
  | { kind: 'delete'; index: number; nodes: MindNodeModel[] }
  | { kind: 'reorder'; from: number; to: number; node: MindNodeModel };

export class MindNodeModel {
  readonly id: string;
  readonly children: MindNodeModel[] = [];
  readonly childrenChange$ = new Subject<MindNodeDelta[]>();
  private readonly yNode: Y.Map<unknown>;
  private readonly yChildren: Y.Array<Y.Map<unknown>>;
  private parent: MindNodeModel | null = null;
  private disposed = false;

  /** 从 Y.Map 构建（根/子节点同构；不进 ServiceRegistry——树内生命周期自管理） */
  constructor(yNode: Y.Map<unknown>) {
    this.yNode = yNode;
    this.id = String(yNode.get('id'));
    this.yChildren = yNode.get('children') as Y.Array<Y.Map<unknown>>;
    // 递归建子 Model（初始化时全量；后续增量走 observe）
    for (const childY of this.yChildren.toArray()) {
      this.children.push(this.build(childY));
    }
    this.yChildren.observe(this.onChildrenDelta);
  }

  getParent(): MindNodeModel | null {
    return this.parent;
  }

  /** 底层 Y.Map（树写协作者落库用——lineColor 写入 / yTreeToSpec 序列化；
   *  2026-10-06 收口：替代散在服务层的 8 处 as-unknown 强转） */
  get yMap(): Y.Map<unknown> {
    return this.yNode;
  }

  /** 底层子节点数组（树写协作者插删用——类型自持，调用方免二次强转） */
  get yChildList(): Y.Array<Y.Map<unknown>> {
    return this.yChildren;
  }

  /** state 只含自身字段（硬规定：剥离 children/不含子树） */
  toJSON(): IMindNodeJson {
    const out: IMindNodeJson = { id: this.id, text: String(this.yNode.get('text') ?? '') };
    const dir = this.yNode.get('direction');
    if (dir === 'left' || dir === 'right') out.direction = dir;
    const color = this.yNode.get('lineColor');
    if (typeof color === 'string') out.lineColor = color;
    return out;
  }

  setText(text: string): void {
    this.yDoc.transact(() => this.yNode.set('text', text));
  }

  /** 观察自身字段（非 deep——硬规定：不触子树）；返回解绑函数 */
  observeSelf(fn: () => void): () => void {
    const handler = (): void => fn();
    this.yNode.observe(handler);
    return () => this.yNode.unobserve(handler);
  }

  /** 分支色：自身有值取自身，否则沿父链继承（docs/11 §2） */
  getLineColor(fallback: string): string {
    const own = this.yNode.get('lineColor');
    if (typeof own === 'string') return own;
    return this.parent ? this.parent.getLineColor(fallback) : fallback;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.yChildren.unobserve(this.onChildrenDelta);
    for (const c of [...this.children]) c.dispose();
    this.children.length = 0;
    this.childrenChange$.complete();
  }

  private build(childY: Y.Map<unknown>): MindNodeModel {
    const model = new MindNodeModel(childY);
    model.parent = this;
    return model;
  }

  /** Yjs delta（retain/delete/insert）→ 内存 splice + childrenChange$ */
  private onChildrenDelta = (event: Y.YArrayEvent<Y.Map<unknown>>): void => {
    const deltas: MindNodeDelta[] = [];
    let index = 0;
    for (const d of event.delta) {
      if (d.retain !== undefined) {
        index += d.retain;
      } else if (d.delete !== undefined) {
        const removed = this.children.splice(index, d.delete);
        for (const r of removed) {
          r.dispose();
          r.parent = null;
        }
        deltas.push({ kind: 'delete', index, nodes: removed });
      } else if (d.insert) {
        const items = (Array.isArray(d.insert) ? d.insert : [d.insert]) as Y.Map<unknown>[];
        const models = items.map((y) => this.build(y));
        this.children.splice(index, 0, ...models);
        deltas.push({ kind: 'insert', index, nodes: models });
        index += models.length;
      }
    }
    if (deltas.length > 0) this.childrenChange$.next(deltas);
  };

  private get yDoc(): Y.Doc {
    return this.yNode.doc!;
  }
}
