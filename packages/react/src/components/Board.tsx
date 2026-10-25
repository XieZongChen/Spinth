import { useEffect, useRef } from 'react';
import { BoardSDK, type IBoardConfig } from '@spinth/core';
import { bindBoard, unbindBoard } from '../store/commands';
import { connectBoard } from '../store/bridge';
import { useSpinthStore } from '../store/spinthStore';
import { DotGrid } from './DotGrid';

/**
 * 画板容器（docs/12 §4）：挂载点 + 生命周期。
 * StrictMode 双挂载防御：异步 initialize 完成前被卸载则立即 dispose。
 */
export function Board({
  config,
  onReady,
  theme,
}: {
  config: IBoardConfig;
  onReady?: () => void;
  /** app 壳主题态（docs/17 C2：注入 core 默认文字色并强制重画；undefined = 首载前） */
  theme?: 'light' | 'dark';
}) {
  const ref = useRef<HTMLDivElement>(null);
  const sdkRef = useRef<BoardSDK | null>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    // StrictMode 双挂载：用 AbortController 让第一个实例在 await 间隙自毁，
    // 保证任何时刻只有一个实例写 IndexedDB / 绑定快捷键
    const controller = new AbortController();
    let disconnect: (() => void) | undefined;
    const sdk = new BoardSDK();
    sdkRef.current = sdk;
    const ready = sdk.initialize(config, el, controller.signal);
    if (theme) sdk.setTheme(theme); // 就绪前的主题态在 initialize 后立即注入
    ready
      .then(() => {
        if (controller.signal.aborted) {
          sdk.dispose();
          return;
        }
        bindBoard(sdk);
        disconnect = connectBoard(sdk);
        // dev 调试句柄（对齐既有设计 window.app 约定；生产构建剥离）
        if ((import.meta as { env?: { DEV?: boolean } }).env?.DEV) {
          (window as unknown as Record<string, unknown>).__spinth = sdk;
        }
        onReady?.();
      })
      .catch((err) => {
        if ((err as DOMException)?.name === 'AbortError') {
          sdk.dispose();
          return;
        }
        console.error('[spinth] Board 初始化失败', err);
        // 失败上抛 UI（Batch 1 · 1.14）：此前只 console——loading 永远 true，
        // 用户卡「正在恢复画布…」（IndexedDB 禁用/配额满等场景无出口）
        useSpinthStore.setState({ initError: String((err as Error)?.message ?? err) });
      });
    return () => {
      controller.abort();
      disconnect?.();
      unbindBoard();
      void ready.then(
        () => sdk.dispose(),
        () => sdk.dispose(),
      );
    };
    // config 变化不重装画板（docId 等由外层路由控制）
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 主题注入（docs/17 C2）：sdk 就绪后跟随 app 壳主题态（含首载与切换）
  useEffect(() => {
    if (theme) sdkRef.current?.setTheme(theme);
  }, [theme]);

  return (
    // 层序用显式 z-index 而非 DOM 顺序：core 命令式追加的 canvas 与 React 子节点
    // （DotGrid）的相对顺序在重渲染后不可保证（实测 React 会把重渲染的子节点插到
    // canvas 之后）。canvas z-[1]：高于点阵（z-auto），低于 App 层浮层（z-10+）。
    // tabIndex=0（specs/a11y-closeout §5.9，批次 B W1 先行）：右键菜单的焦点
    // 归还目标 + 键盘可达画布入口；role/可访问名/帮助文本在 W4 补
    <div
      id="stage-container"
      ref={ref}
      tabIndex={0}
      className="absolute inset-0 overflow-hidden [&>canvas]:absolute [&>canvas]:top-0 [&>canvas]:left-0 [&>canvas]:z-[1]"
    >
      <DotGrid />
    </div>
  );
}
