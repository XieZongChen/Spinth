import { useSpinthStore } from '../store/spinthStore';

/**
 * 单机模式提示条：仅在浏览器物理断网（editBlocked）时提示。
 * 本地文档不需要远端连接；保存状态由顶栏单独展示。
 */
export function OfflineBar() {
  const editBlocked = useSpinthStore((s) => s.editBlocked);
  if (!editBlocked) return null;

  return (
    <div
      role="status"
      className="pointer-events-none absolute left-1/2 top-3 z-20 -translate-x-1/2 rounded-full bg-danger px-4 py-1.5 text-[12px] font-bold text-white shadow-pop"
    >
      网络已断开，编辑暂不可用
    </div>
  );
}
