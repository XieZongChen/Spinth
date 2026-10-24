/**
 * __debug 调试探针适配器（specs/api-surface §3.6）——debugSnapshot.ts 保持
 * 纯聚合（不 import 具体服务），本文件做「服务实例 → 结构化窄类型」的适配，
 * 自 app.ts 800-834 行逐字段照搬。E2E 162 处 __debug 引用是形状硬断言。
 */
import { buildDebugSnapshot } from './debugSnapshot';
import { BoardApplication } from './platform/viewport/boardApplication';
import { SHAPE_TYPE_OPTIONS } from './widgets/shape/shapeService';
import type { IBaseWidgetVm } from './types';
import type { IBoardDebugHost } from './boardHost';

export function buildBoardDebugSnapshot(host: IBoardDebugHost) {
  return buildDebugSnapshot({
    engine: host.engine as unknown as { modelMapping?: Map<string, unknown> } | null,
    vmMapping:
      (host.vmEngine as unknown as { vmMapping?: Map<string, IBaseWidgetVm> })?.vmMapping ??
      new Map(),
    selector: host.selector as unknown as {
      __selectionFrame?: { x: number; y: number; width: number; height: number } | null;
      selected$: { value: string[] };
    } | null,
    rectEditor: host.rectEditor as unknown as {
      __editorFrame?: { x: number; y: number; width: number; height: number } | null;
      __rotateHandle?: { x: number; y: number } | null;
    } | null,
    widgetChildrenCount: host.viewport
      ? (host.viewport as unknown as { widgetLayer: { children: unknown[] } }).widgetLayer.children
          .length
      : 0,
    renderCount: BoardApplication.renderCount,
    textRender: host.textRender as unknown as {
      stats: { registered: number; snapshot: number; text: number };
    } | null,
    culling: host.culling,
    shapeService: host.shapeService,
    defaultToolOptions: { ...host.defaultToolOptions$.value },
    eraserService: host.eraserService,
    lineService: host.lineService as unknown as Record<string, unknown> | null,
    refLine: host.refLine,
    shapeTypeOptionIds: SHAPE_TYPE_OPTIONS.map((o) => o.id),
    mindService: host.mindService,
    awareness: host.awareness,
    imageTextures: host.imageTextures,
    assetStore: host.assetStore,
  });
}
