import { BehaviorSubject } from 'rxjs';
import { Disposable } from '../../base/disposable';

/**
 * 网格吸附开关（specs/flowchart-closeout §9.2，G-08）：**视图偏好**——会话态 +
 * localStorage 持久化，不进 Yjs、不进项目文件、不受只读态限制（只读可开关，
 * 不改文档）。默认关（关闭时全部量化路径零行为变化）。storage 访问注入
 * （测试桩/SSR 注入内存实现）。
 */

const STORAGE_KEY = 'spinth.gridSnap';

/** 最小 storage 面（localStorage 子集；测试注入内存实现） */
export interface IGridSnapStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export class GridSnapService extends Disposable {
  readonly gridSnap$ = new BehaviorSubject<boolean>(false);

  constructor(storage: IGridSnapStorage | null) {
    super();
    const saved = storage?.getItem(STORAGE_KEY);
    // 只认 '1'（开）；缺省/异常值 = 关——首次使用零惊讶
    if (saved === '1') this.gridSnap$.next(true);
  }

  get enabled(): boolean {
    return this.gridSnap$.value;
  }

  setEnabled(on: boolean): void {
    if (on === this.gridSnap$.value) return;
    this.gridSnap$.next(on);
  }

  /** 持久化由宿主在流上订阅调用（core 不直连 window.localStorage） */
  persist(storage: IGridSnapStorage): void {
    storage.setItem(STORAGE_KEY, this.gridSnap$.value ? '1' : '0');
  }
}
