/** 图片加载自动重试策略（纯函数，docs/19 §4）：只有 http(s) 外链的解码
 *  失败值得自动重试（断网/服务抖动是暂态）；本地 blob/data URL 内容损坏、
 *  建纹失败、资产行缺失都不是重试可恢复的——入口只剩手动。 */

/** 自动重试延迟序列；次数 = 序列长度（600ms / 1800ms 两次） */
export const IMAGE_AUTO_RETRY_DELAYS_MS = [600, 1800] as const;

export function isHttpSrc(src: string): boolean {
  return /^https?:/i.test(src);
}

/**
 * 计算下一次自动重试延迟。返回 null = 不自动重试（终态失败，等手动）。
 *
 * @param src       当前加载的 src（按 scheme 分流重试价值）
 * @param kind      失败分类：decode = 解码/建纹失败；missing = 资产行不存在
 * @param retryable 失败阶段判定（解码失败 true；建纹/存储层故障 false）
 * @param attempts  已安排过的自动重试次数（手动 retry() 会清零，手动不限次）
 */
export function autoRetryDelay(
  src: string,
  kind: 'decode' | 'missing',
  retryable: boolean,
  attempts: number,
): number | null {
  if (kind === 'missing') return null; // 他端/异步稍后可能写入——等手动，不自动轮询
  if (!retryable) return null; // 建纹/IDB 故障：重试易放大，终态
  if (!isHttpSrc(src)) return null; // data:/blob:/spinth-asset: 内容本地确定，重试无意义
  const delay = IMAGE_AUTO_RETRY_DELAYS_MS[attempts];
  return delay === undefined ? null : delay;
}
