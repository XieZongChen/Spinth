/** 短 id：控件/节点标识（非安全场景） */
export function genId(): string {
  return (
    globalThis.crypto?.randomUUID?.().replace(/-/g, '').slice(0, 12) ??
    Math.random().toString(36).slice(2, 14)
  );
}
