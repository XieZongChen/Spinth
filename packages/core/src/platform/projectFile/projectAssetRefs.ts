/**
 * 从 Yjs widgets 收集项目文件关心的资产引用与外链统计（docs/20 §4.4/§6）。
 * 引用集复用资产 GC 的内存态收集（权威口径，含隔离区 widget——隔离件仍是
 * 文档数据，导出必须带上其引用的资产）。
 */

import type * as Y from 'yjs';
import { collectLiveAssetRefs } from '../dataEngine/assetGc';

export interface IProjectAssetRefScan {
  /** IMAGE.src 为 `spinth-asset:<sha256>` 的 id 集（去重） */
  assetIds: Set<string>;
  /** `data:` 图片数（保留在 Yjs 内，不打包——旧文档兼容） */
  dataUrlCount: number;
  /** `http(s):` 外链图片数（保留 URL，不下载） */
  externalCount: number;
}

export function collectProjectAssetRefs(yWidgets: Y.Array<unknown>): IProjectAssetRefScan {
  const assetIds = collectLiveAssetRefs(yWidgets);
  let dataUrlCount = 0;
  let externalCount = 0;
  for (const item of yWidgets.toArray()) {
    const m = item as Y.Map<unknown>;
    if (m.get('type') !== 'IMAGE') continue;
    const src = m.get('src');
    if (typeof src !== 'string' || src.length === 0) continue;
    if (src.startsWith('data:')) dataUrlCount++;
    else if (/^https?:/i.test(src)) externalCount++;
  }
  return { assetIds, dataUrlCount, externalCount };
}
