import { z } from 'zod';

/** 标签角色（docs/21 §2）：pending=申请锁中；leader=持锁写者；
 *  follower=锁被占，排队等待接管；solo=无 Web Locks 降级（单标签假设） */
export const TabRoleSchema = z.enum(['pending', 'leader', 'follower', 'solo']);
export type TabRole = z.infer<typeof TabRoleSchema>;

export interface ITabSessionState {
  role: TabRole;
  /** leader | solo = 本标签是该 docId 当前唯一写者 */
  writable: boolean;
}
export const INITIAL_TAB_SESSION_STATE: ITabSessionState = { role: 'pending', writable: false };

export interface ITabLockHandle {
  release(): void;
}

/** 注入端口：生产 = Web Locks（browserLockPort）；单测 = 内存实现；null = 浏览器不支持 */
export interface ITabLockPort {
  tryAcquire(name: string): Promise<ITabLockHandle | null>;
  wait(name: string): Promise<ITabLockHandle>;
}
