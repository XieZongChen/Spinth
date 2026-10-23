import type * as Y from 'yjs';
import type { AssetStore } from './assetStore';
import { MIGRATE_ORIGIN } from './dataProcessor';
import type { IDataEngineService } from '../../types';
import type { BoardSDK } from '../../app';
import { collectLiveAssetRefs, defaultYieldToMain, runAssetGc, withAssetGcLock } from './assetGc';

/** 启动后延迟（ms）：让出启动关键路径 + 等协同连接态稳定（GC 只在单机态跑） */
export const ASSET_MAINTENANCE_DELAY_MS = 3000;

export interface IAssetMigrationResult {
  /** data URL → 资产引用改写数 */
  migrated: number;
  /** 单张失败跳过数（损坏 data URL 等，下轮重试） */
  failed: number;
  /** 中断（页面销毁/切页）。迁移幂等——已迁移项不重做，下轮续余量 */
  cancelled: boolean;
}

export interface IAssetMigrationOptions {
  /** false = 立即停止迁移（页面销毁/切页） */
  shouldContinue?: () => boolean;
  /** 每迁移 batchSize 张后协作让出（默认 8） */
  yieldToMain?: () => Promise<void>;
  batchSize?: number;
}

/** data URL → Blob（atob 手解——fetch('data:') 全库零使用，不引入环境差异） */
export function dataUrlToBlob(dataUrl: string): Blob {
  const comma = dataUrl.indexOf(',');
  if (!dataUrl.startsWith('data:') || comma < 0) throw new Error('非 data URL');
  const [rawMime, ...params] = dataUrl.slice(5, comma).split(';');
  if (!params.includes('base64')) throw new Error('仅支持 base64 data URL');
  const bin = atob(dataUrl.slice(comma + 1));
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type: rawMime || 'image/png' });
}

/**
 * 存量 dataURL 迁移（Batch 2 二期，单机版）：旧文档 IMAGE.src 是 data URL
 * （base64 直在 Yjs 文档内——同步帧/compaction 快照/持久化 MB 级膨胀）→
 * blob 入 AssetStore + src 改写 `spinth-asset:<sha256>` 引用（文档塌缩到几十字节）。
 *
 * - 写走 MIGRATE_ORIGIN：不进 undo 栈（维护写纪律，同 REPAIR_ORIGIN）；
 * - 幂等：已是引用格式的跳过；同内容图内容寻址去重（他文档贴过同图直接命中）；
 * - 单张失败 catch 跳过不中断整体（损坏 data URL 不阻塞其余迁移）；
 * - 每 batchSize 张协作让出主线程；shouldContinue=false 立即安全返回；
 * - 无条件执行（协同中也迁）：内容寻址使多端收敛同 hash——旧版本协同端收到
 *   引用渲染灰框，与新贴图路径同语义（滚动升级窗口，server 端点二期统筹）。
 */
export async function migrateDataUrls(
  engine: IDataEngineService,
  assetStore: AssetStore,
  opts: IAssetMigrationOptions = {},
): Promise<IAssetMigrationResult> {
  const shouldContinue = opts.shouldContinue ?? (() => true);
  const yieldToMain = opts.yieldToMain ?? defaultYieldToMain;
  const batchSize = opts.batchSize ?? 8;
  let migrated = 0;
  let failed = 0;
  let handled = 0; // 已迁移张数（让出节奏按迁移量计，跳过项不占）
  for (const item of engine.yWidgets.toArray()) {
    const m = item as Y.Map<unknown>;
    if (m.get('type') !== 'IMAGE') continue;
    const src = m.get('src');
    if (typeof src !== 'string' || !src.startsWith('data:')) continue;
    if (!shouldContinue()) return { migrated, failed, cancelled: true };
    try {
      const ref = await assetStore.put(dataUrlToBlob(src));
      engine.transact(() => {
        m.set('src', ref.src);
      }, MIGRATE_ORIGIN);
      migrated++;
    } catch (err) {
      failed++;
      console.warn('[spinth:asset-migrate] 单张迁移失败（跳过，下轮重试）', err);
    }
    if (++handled % batchSize === 0) await yieldToMain();
  }
  if (migrated > 0) {
    console.info(
      `[spinth:asset-migrate] 存量 dataURL 迁移 ${migrated} 张${failed ? `，失败 ${failed} 张` : ''}`,
    );
  }
  return { migrated, failed, cancelled: false };
}

/**
 * 启动资产维护链（组合根 idle 接线）：迁移（无条件）→ 若有迁移 compactNow
 * （旧 dataURL 从盘上 updates 历史真正消失——append-only 日志里它仍在）→
 * GC（仅单机态，见 assetGc）。迁移中断（页面销毁）时跳过 GC——GC 的
 * shouldContinue 同源，跑了也只是空转。
 */
export async function runAssetMaintenance(
  sdk: BoardSDK,
  engine: IDataEngineService,
  docId: string,
): Promise<void> {
  const assetStore = sdk.assetStore;
  if (!assetStore) return;
  const shouldContinue = (): boolean => !sdk.disposed;
  // 迁移仅单机态（P0 修复）：协同文档迁移后原 data URL 会随 compact 从共享
  // 历史里消失——他端无 blob 永久灰框（内容丢失而非兼容窗口）。server 资产
  // 端点（二期）落地后再放开
  const skipMigrate = engine.wsState$.value !== 'off';
  const mig = skipMigrate
    ? { migrated: 0, failed: 0, cancelled: false }
    : await migrateDataUrls(engine, assetStore, { shouldContinue });
  // 探针分阶段更新：迁移完成即可观测（compact/GC 在并行负载下可能秒级，
  // E2E/调试不应等整链走完才看到 migrated）
  sdk.lastAssetMaintenance = { migrated: mig.migrated, removed: 0, when: Date.now() };
  if (mig.migrated > 0) await engine.compactNow();

  let removed = 0;
  const gcStats: Pick<
    NonNullable<BoardSDK['lastAssetMaintenance']>,
    'docs' | 'assets' | 'partial' | 'ms'
  > = {};
  if (!mig.cancelled && engine.wsState$.value === 'off') {
    // 单写者锁（第三轮审查）：多标签同时启动时只有一个跑 GC——他标签未落盘
    // 的引用对本标签不可见，双跑扩大误删窗口。锁覆盖整轮（含协作让出）
    await withAssetGcLock(async () => {
      const r = await runAssetGc({
        assetStore,
        currentDocId: docId,
        currentDocRefs: collectLiveAssetRefs(engine.yWidgets),
        collectCurrentRefs: () => collectLiveAssetRefs(engine.yWidgets), // 删行前重采
        canUndo: sdk.canUndo$.value, // undo 栈非空整轮跳过（栈内待恢复引用）
        shouldContinue, // 页面销毁中断：mark 打断零删除、sweep 部分保留
      });
      if (!r.skipped) {
        removed = r.removed;
        Object.assign(gcStats, { docs: r.docs, assets: r.assets, partial: r.partial, ms: r.ms });
      }
    });
  }
  sdk.lastAssetMaintenance = { migrated: mig.migrated, removed, when: Date.now(), ...gcStats };
}
