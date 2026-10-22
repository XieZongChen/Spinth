import { useEffect, useState, useSyncExternalStore } from 'react';
import {
  INITIAL_TAB_SESSION_STATE,
  TabSessionService,
  createBrowserLockPort,
  type ITabSessionState,
} from '@spinth/react';

/** 页面级单例（docs/21 §3）：session 生命周期 = 本标签页，不是 SDK 实例——
 *  StrictMode 双挂载复用同一 session，start() 幂等；不随 Board 卸载销毁 */
const sessions = new Map<string, TabSessionService>();

export function tabSessionFor(docId: string): TabSessionService {
  let session = sessions.get(docId);
  if (session) return session;
  session = new TabSessionService({
    docId,
    locks: createBrowserLockPort(),
    onPromoted: () => window.location.reload(),
  });
  sessions.set(docId, session);
  // pagehide 主动让锁（docs/21 §5）：跳到新文档后旧页面进 bfcache 仍持旧
  // doc 的锁，另一标签会永久只读；pageshow(persisted) 内存状态必然过期，整页刷新
  window.addEventListener('pagehide', () => session!.release());
  window.addEventListener('pageshow', (e) => {
    if ((e as PageTransitionEvent).persisted) window.location.reload();
  });
  return session;
}

/** 当前标签角色（docs/21 §3）：pending 期间不挂画布——editable 从第一帧起是终值 */
export function useTabRole(docId: string): ITabSessionState {
  // useState 惰性初始化：render 期间不建 session / 不挂 window 监听（render 纯度）。
  // docId 来自 URL，是页面级常量——初始化一次即可，不随重渲染换 session
  const [session] = useState(() => tabSessionFor(docId));
  useEffect(() => {
    void session.start();
  }, [session]);
  return useSyncExternalStore(
    (onChange) => {
      const sub = session.state$.subscribe(onChange);
      // 必须返回箭头函数：直接交 sub.unsubscribe 是 unbound 方法引用，
      // rx 内部读 this.closed → TypeError（StrictMode 首次 cleanup 即触发）
      return () => sub.unsubscribe();
    },
    () => session.state$.getValue(),
    () => INITIAL_TAB_SESSION_STATE,
  );
}
