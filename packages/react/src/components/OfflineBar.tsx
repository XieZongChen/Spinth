import { useSpinthStore } from '../store/spinthStore';

/**
 * 物理断网提示条：仅在 editBlocked（协同宿主开启 blockOnOffline）时出现。
 * 单机模式组合根不传 wsUrl → blockOnOffline=false → editBlocked 恒 false，
 * 本条不可达（批次 A A4 固化的不变量）；保留是为了协同宿主复用同一套壳。
 * 呈现走 soft 底 + ink 字 + danger 描边（D1：不白字压红底）。
 */
export function OfflineBar() {
  const editBlocked = useSpinthStore((s) => s.editBlocked);
  if (!editBlocked) return null;

  return (
    <div
      role="status"
      data-spinth-offline-bar=""
      className="pointer-events-none absolute left-1/2 top-3 z-20 -translate-x-1/2 rounded-full border border-danger bg-danger-soft px-4 py-1.5 text-[12px] font-bold text-danger-ink shadow-pop"
    >
      网络已断开，编辑暂不可用
    </div>
  );
}
