import { BehaviorSubject } from 'rxjs';
import { Texture } from 'pixi.js';
import * as Y from 'yjs';
import { MindService } from '../../widgets/mind/mindService';
import { EditingService } from '../../platform/textEngine/editingService';
import { MindMapModel, buildYTree, type IMindNodeSpec } from '../../widgets/mind/mindMapModel';
import { DataProcessor } from '../../platform/dataEngine/dataProcessor';
import { mindViewportStub } from './mindViewportStub';

/** mindDrag 系单测共享 fixture（specs/split-large-files §5.3）：
 *  固定 rect VM 桩 + 真树服务。桩顺序与原 mindDragDescendant.test.ts 逐字一致；
 *  不得在 module 顶层执行 Pixi 构造（Texture 于 makeService 函数体内创建）。
 */

interface FixedRectVm {
  type: string;
  id: string;
  root: { x: number; y: number };
  /** 每节点独立 rect（让热区可控），未注册返回 null */
  rects: Map<string, { x: number; y: number; width: number; height: number }>;
  getNodeRect(id: string): { x: number; y: number; width: number; height: number } | null;
  getNodeVm(id: string): { depth: number; fontSize: number } | null;
  setFocusedNode(id: string | null): void;
  setNodeAlpha(id: string, alpha: number): void;
  hitNode(p: { x: number; y: number }): { model: { id: string } } | null;
}

export function makeService(
  specTree: IMindNodeSpec,
  opts: { fallbackRect?: { x: number; y: number; width: number; height: number } } = {},
) {
  const doc = new Y.Doc();
  const processor = new DataProcessor(doc);
  const model = new MindMapModel(processor);
  const yMap = doc.getMap<unknown>('mm');
  doc.transact(() => {
    yMap.set('id', 'mm-1');
    yMap.set('type', 'MIND_MAP');
    yMap.set('zOrder', 'a0');
    yMap.set('root', buildYTree(processor, specTree));
  });
  model.initializeY(yMap);

  const rects = new Map<string, { x: number; y: number; width: number; height: number }>();
  const layerChildren: unknown[] = [];
  const alphaCalls: Array<{ id: string; alpha: number }> = [];
  const vm: FixedRectVm = {
    type: 'MIND_MAP',
    id: 'mm-1',
    root: { x: 0, y: 0 },
    rects,
    getNodeRect(id: string) {
      return rects.get(id) ?? (opts.fallbackRect ? { ...opts.fallbackRect } : null);
    },
    getNodeVm: (id: string) =>
      rects.has(id) || opts.fallbackRect ? { depth: 1, fontSize: 18 } : null,
    setFocusedNode: () => {},
    setNodeAlpha: (id: string, alpha: number) => alphaCalls.push({ id, alpha }),
    // 命中：按 rects 表判定（enterNodeEditAt 用；world = local，桩 root 在原点）
    hitNode: (p: { x: number; y: number }) => {
      for (const [id, r] of rects) {
        if (p.x >= r.x && p.x <= r.x + r.width && p.y >= r.y && p.y <= r.y + r.height) {
          return { model: { id } } as never;
        }
      }
      return null;
    },
  };
  const viewport = {
    registerGlobalEventListener: () => {},
    setCursorMode: () => {},
    cursorMode$: new BehaviorSubject('cursor'),
    curPos$: new BehaviorSubject<null>(null),
    optionLayer: { addChild: (c: unknown) => layerChildren.push(c) },
    vpScale$: new BehaviorSubject(1),
    ...mindViewportStub(),
    vpBounds$: new BehaviorSubject({ x: 0, y: 0, width: 2000, height: 2000 }),
    toScreen: (p: { x: number; y: number }) => ({ x: p.x, y: p.y }),
    renderer: { generateTexture: () => new Texture() },
  };
  const engine = {
    add: () => 'mm-2',
    removeByIds: () => {},
    genInitialOrder: () => 'a1',
    getModelById: (id: string) => (id === 'mm-1' ? model : null),
    transact: (fn: () => void) => fn(),
  };
  const vmEngine = {
    getAllVms: () => [vm as never],
    getVmById: (id: string) => (id === 'mm-1' ? vm : null),
    getVmByPoint: () => [],
  };
  const selector = { selected$: new BehaviorSubject<string[]>(['mm-1']), setSelected: () => {} };
  const history = { stopCapturing: () => {} };
  const svc = new MindService(
    viewport as never,
    engine as never,
    vmEngine as never,
    selector as never,
    history as never,
    new EditingService(
      viewport as never,
      engine as never,
      selector as never,
      history as never,
    ) as never,
  );
  return { svc, model, rects, engine, layerChildren, alphaCalls, viewport };
}

export function spec(
  text: string,
  kids?: IMindNodeSpec[],
  direction?: 'left' | 'right',
): IMindNodeSpec {
  return { text, children: kids, direction };
}
