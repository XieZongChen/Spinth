import { isEditableTarget } from '../../../platform/keyboard/shortcuts';
import type { IViewportService } from '../../../types';

/**
 * 选中态键入 → 进编辑（自 treeService 拆出，审查返工 P0-6 保 400 行铁律；
 * docs/11 §8 语义逐字迁移）：window keydown/compositionstart 捕获阶段拦下，
 * IME 三重判定防首键竞态。
 */

/** 宿主边界：焦点查询与编辑入口留在服务侧 */
export interface ITypeToEditHost {
  getFocused(): { mapModel: { id: string }; node: { id: string } } | null;
  enterNodeEdit(
    mapId: string,
    nodeId: string,
    opts: { replaceWith?: string; selectAll?: boolean } | undefined,
  ): void;
}

/** 纯处理器工厂（node 测试环境直接消费；IME 三重判定防首键竞态） */
export function createTypeToEditHandlers(
  viewport: IViewportService,
  host: ITypeToEditHost,
): {
  onTypeToEdit(e: KeyboardEvent): void;
  onCompositionStart(e: CompositionEvent): void;
} {
  /**
   * 选中态键入字符 → 进编辑并用该字符替换原文本（既有设计：选中态键入任意
   * 单字符触发 setEditor + selectAll，随后输入即全量替换）。空格与带修饰键
   * 的组合不触发。
   */
  const onTypeToEdit = (e: KeyboardEvent): void => {
    if (e.metaKey || e.ctrlKey || e.altKey || e.shiftKey) return;
    // IME 合成首键：Windows keydown 是 Process；macOS/Chrome 的合成首键
    // keydown 携带真实字符但 keyCode=229 且 isComposing 仍 false（先于
    // compositionstart 到达）。两条路都不能走 replaceWith——拼音首字母会
    // 立即落库并同步给协同用户、取消合成后原文案被毁（首键竞态）。统一走
    // 「进编辑 + 全选」等 IME 落字
    const isProcess = e.key === 'Process';
    const isIme = isProcess || e.isComposing || e.keyCode === 229;
    if (!isIme && (e.key === ' ' || e.key.length !== 1)) return;
    if (isEditableTarget(e.target)) return; // 已在自己的编辑器/输入框里
    if (viewport.cursorMode$.value !== 'cursor') return;
    const f = host.getFocused();
    if (!f) return;
    e.preventDefault();
    e.stopPropagation();
    host.enterNodeEdit(
      f.mapModel.id,
      f.node.id,
      isIme ? { selectAll: true } : { replaceWith: e.key },
    );
  };

  /** 输入法开始合成：进编辑并全选（既有设计同款，Safari 事件顺序兼容） */
  const onCompositionStart = (e: CompositionEvent): void => {
    if (isEditableTarget(e.target)) return;
    if (viewport.cursorMode$.value !== 'cursor') return;
    const f = host.getFocused();
    if (!f) return;
    host.enterNodeEdit(f.mapModel.id, f.node.id, { selectAll: true });
  };

  return { onTypeToEdit, onCompositionStart };
}

/** 挂载捕获监听（node/无 DOM 环境守卫在调用方）；返回卸载函数 */
export function installTypeToEdit(viewport: IViewportService, host: ITypeToEditHost): () => void {
  const { onTypeToEdit, onCompositionStart } = createTypeToEditHandlers(viewport, host);
  window.addEventListener('keydown', onTypeToEdit, { capture: true });
  window.addEventListener('compositionstart', onCompositionStart, { capture: true });
  return () => {
    window.removeEventListener('keydown', onTypeToEdit, { capture: true });
    window.removeEventListener('compositionstart', onCompositionStart, { capture: true });
  };
}
