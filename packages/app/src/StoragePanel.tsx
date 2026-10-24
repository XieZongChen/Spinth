import type { CSSProperties, Ref } from 'react';
import { formatBytes, formatPercent, type IStorageStatus } from '@spinth/react';

/**
 * 本地存储面板（docs/02 §6.1 / docs/12 顶栏）：纯展示组件——状态来自
 * zustand 镜像，命令经回调上抛（StorageStatusButton 持有定位/关闭/刷新）。
 * 两种状态严格分行（D2）：文档保存（persistState）≠ 浏览器持久化（IStorageStatus）。
 */

interface StoragePanelProps {
  status: IStorageStatus;
  persistState: 'saved' | 'saving' | 'failed';
  onRetryPersist: () => void;
  onRequestPersist: () => void;
  onOpenProjectMenu: () => void;
  onClose: () => void;
  panelRef: Ref<HTMLDivElement>;
  style: CSSProperties | null;
}

const SECTION_CLASS = 'mt-2 border-t border-edge pt-2 first:mt-0 first:border-t-0 first:pt-0';
const TITLE_CLASS = 'text-xs font-semibold text-ink-2';
const BODY_CLASS = 'mt-1 text-xs leading-5 text-ink-3';
const ACTION_CLASS =
  'mt-1.5 rounded-md bg-accent-fill px-3 py-1 text-xs font-semibold text-on-accent transition-colors duration-100 hover:bg-accent-fill-hover disabled:cursor-not-allowed disabled:opacity-50';

/** 持久化授权文案（D8：只说「降低被清理的风险」，不承诺不丢） */
function persistenceText(status: IStorageStatus): string {
  if (!status.supported || status.persistence === 'unsupported') return '不支持';
  if (status.persistence === 'unknown') return status.persistedQueryFailed ? '无法读取' : '检测中';
  if (status.persistence === 'persisted') return '已开启（降低被浏览器清理的风险）';
  return '未开启（空间不足时可能被浏览器清理）';
}

export function StoragePanel(props: StoragePanelProps) {
  const { status, persistState } = props;
  const ratio =
    status.usage !== null && status.quota !== null && status.quota > 0
      ? Math.min(1, status.usage / status.quota)
      : null;
  const percent = ratio === null ? null : Math.round(ratio * 100);
  const percentText = formatPercent(status.usage, status.quota);
  // 用量/配额任一可读即显示数字（缺边 — ）；百分比与进度条需要双边可算
  const hasAnyUsage = status.usage !== null || status.quota !== null;
  const barColor =
    status.pressure === 'critical'
      ? 'bg-danger'
      : status.pressure === 'warn'
        ? 'bg-warning'
        : status.pressure === 'ok'
          ? 'bg-tool-pen'
          : 'bg-surface-active';

  return (
    <div
      ref={props.panelRef}
      id="spinth-storage-panel"
      role="dialog"
      aria-modal={false}
      aria-labelledby="spinth-storage-panel-title"
      tabIndex={-1}
      data-spinth-storage-panel=""
      className="z-30 rounded-xl border border-edge bg-surface px-3 py-2.5 text-left shadow-pop outline-none"
      style={props.style ?? undefined}
    >
      <div className="flex items-center justify-between gap-2">
        <h2 id="spinth-storage-panel-title" className="text-[13px] font-bold text-ink">
          本地存储
        </h2>
        <button
          type="button"
          onClick={props.onClose}
          className="rounded-md px-2 py-0.5 text-xs font-semibold text-ink-2 transition-colors duration-100 hover:bg-surface-hover hover:text-ink"
        >
          关闭
        </button>
      </div>

      {/* 1. 文档保存（persistState：与浏览器持久化分行显示） */}
      <div className={SECTION_CLASS}>
        <p className={TITLE_CLASS}>文档保存</p>
        {persistState === 'failed' ? (
          <p
            role="alert"
            className="mt-1 flex items-center gap-2 text-xs font-semibold text-danger-ink"
          >
            保存失败
            <button
              type="button"
              data-spinth-storage-retry=""
              onClick={props.onRetryPersist}
              className="rounded-md bg-danger-soft px-2 py-0.5 text-xs font-semibold text-danger-ink transition-colors duration-100 hover:text-danger-ink"
            >
              重试保存
            </button>
          </p>
        ) : (
          <p className={BODY_CLASS}>{persistState === 'saving' ? '保存中…' : '已保存'}</p>
        )}
      </div>

      {/* 2. 浏览器持久化（navigator.storage 授权） */}
      <div className={SECTION_CLASS}>
        <p className={TITLE_CLASS}>浏览器持久化</p>
        <p className={BODY_CLASS}>{persistenceText(status)}</p>
        {status.canPersist && status.persistence !== 'persisted' && (
          <button
            type="button"
            data-spinth-storage-persist=""
            disabled={status.requestingPersist}
            onClick={props.onRequestPersist}
            className={ACTION_CLASS}
          >
            {status.requestingPersist ? '申请中…' : '申请持久化'}
          </button>
        )}
        {/* 已开启后不再显示历史申请结果（复审低优 #1：「已开启 + 未授予」矛盾） */}
        {status.persistOutcome === 'denied' && status.persistence !== 'persisted' && (
          <p role="status" className={BODY_CLASS}>
            浏览器未授予持久化；可稍后重试。
          </p>
        )}
        {status.persistOutcome === 'failed' && status.persistence !== 'persisted' && (
          <p role="status" className={BODY_CLASS}>
            申请失败；可重试。
          </p>
        )}
      </div>

      {/* 3. 站点用量 / 配额（estimate 是站点总量估算） */}
      <div className={SECTION_CLASS}>
        <p className={TITLE_CLASS}>用量</p>
        {hasAnyUsage ? (
          <>
            <p className={BODY_CLASS}>
              {formatBytes(status.usage)} / {formatBytes(status.quota)}
              {percent !== null ? `（${percentText}）` : ''}
            </p>
            {percent !== null && (
              <div
                role="progressbar"
                aria-label="站点存储用量"
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={percent}
                aria-valuetext={percentText}
                data-spinth-storage-bar=""
                className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-surface-hover"
              >
                <div
                  className={`h-full rounded-full ${barColor}`}
                  style={{ width: `${percent}%` }}
                />
              </div>
            )}
            {status.pressure === 'warn' && (
              <p
                role="status"
                className="mt-1.5 rounded-md bg-warning-soft px-2 py-1 text-xs font-semibold text-warning"
              >
                空间接近上限，建议导出备份。
              </p>
            )}
            {status.pressure === 'critical' && (
              <p
                role="alert"
                className="mt-1.5 rounded-md bg-danger-soft px-2 py-1 text-xs font-semibold text-danger-ink"
              >
                空间不足，请尽快导出备份。
              </p>
            )}
          </>
        ) : (
          <p className={BODY_CLASS}>无法读取用量</p>
        )}
        {status.estimateFailed && (
          <p className="mt-1 text-[11px] leading-4 text-ink-3">
            无法读取最新用量，显示的值可能不是最新。
          </p>
        )}
      </div>

      {/* 4. 备份与恢复（复用项目菜单，不复制导出/导入流程） */}
      <div className={SECTION_CLASS}>
        <p className={TITLE_CLASS}>备份与恢复</p>
        <p className={BODY_CLASS}>导出项目文件可作为本地备份；导入会创建新画布，不覆盖当前文档。</p>
        <button
          type="button"
          data-spinth-storage-backup=""
          onClick={props.onOpenProjectMenu}
          className="mt-1.5 rounded-md px-3 py-1 text-xs font-semibold text-ink-2 transition-colors duration-100 hover:bg-surface-hover hover:text-ink"
        >
          打开项目菜单
        </button>
      </div>

      <p className="mt-2.5 border-t border-edge pt-2 text-[11px] leading-4 text-ink-3">
        本地数据只保存在此浏览器；清理站点数据会删除画布。配额为当前站点总用量（含图片资产）。
        持久化不是备份——导出项目文件才是备份。
      </p>
    </div>
  );
}
