import { useEffect, useRef, useState } from 'react';
import { useSpinthStore } from '../store/spinthStore';
import { announcementFor, type IAnnouncementSnapshot } from '../a11y/announcement';

/**
 * 状态播报器（specs/a11y-closeout §8.3，W4）：**唯一** polite live region
 * （sr-only 常驻——live region 必须先于内容存在才能播报）。订阅 store 六字段
 * → announcementFor 差分 → 200ms 防抖合并（连续选中变化只播末次）；同一文案
 * 重复时先清空再置入（部分 AT 对相同文本不重播）。唯一播报源（D9）：
 * OfflineBar/ErrorState 的静态 role 保留，其余交互态播报都在这里。
 */
export function Announcer() {
  const [msg, setMsg] = useState('');
  const prevRef = useRef<IAnnouncementSnapshot | null>(null);
  const timerRef = useRef(0);

  const docState = useSpinthStore((s) => s.docState);
  const modelCount = useSpinthStore((s) => s.modelCount);
  const selectedCount = useSpinthStore((s) => s.selectedCount);
  const cursorMode = useSpinthStore((s) => s.cursorMode);
  const persistState = useSpinthStore((s) => s.persistState);
  const editable = useSpinthStore((s) => s.editable);

  useEffect(() => {
    const next: IAnnouncementSnapshot = {
      docState,
      modelCount,
      selectedCount,
      cursorMode,
      persistState,
      editable,
    };
    const prev = prevRef.current;
    prevRef.current = next;
    const text = announcementFor(prev, next);
    // 静默跃迁不清 pending 播报：cleanup 只在卸载（否则建件后的 cursor 回归
    // 跃迁会把 200ms 防抖窗口内的选中播报吞掉——W4 E2E 实测揪出）
    if (!text) return;
    window.clearTimeout(timerRef.current);
    timerRef.current = window.setTimeout(() => {
      // 同文案清空重置：先置空再于下一宏任务置入，保证连续两次相同跃迁也重播
      setMsg((cur) => (cur === text ? '' : cur));
      window.setTimeout(() => setMsg(text), 0);
    }, 200);
    // eslint 放行说明：不按 deps cleanup——防抖合并语义要求静默跃迁保留定时器
  }, [docState, modelCount, selectedCount, cursorMode, persistState, editable]);

  useEffect(() => () => window.clearTimeout(timerRef.current), []);

  return (
    <div role="status" aria-atomic="true" data-spinth-announcer="" className="sr-only">
      {msg}
    </div>
  );
}
