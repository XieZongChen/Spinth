/**
 * DEV 调试入口的快照适配器（specs/runtime-narrowing §3.5）——debugSnapshot.ts
 * 保持纯聚合（不 import 具体服务），本文件做「服务实例 → 结构化窄类型」的
 * 适配。消费方是 boardDevTools（@spinth/core/dev，挂 window.__spinthDebug.__debug，
 * 生产构建不进产物）；E2E 探针引用是形状硬断言，逐字段语义不变。
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
      __rotateHandle?: { x: number; y: number; visible: boolean } | null;
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
