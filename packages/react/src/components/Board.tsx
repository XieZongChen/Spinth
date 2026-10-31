import { useEffect, useRef } from 'react';
import { createBoard, type BoardPublicApi, type IBoardConfig } from '@spinth/core';
import { bindBoard, unbindBoard } from '../store/commands';
import { connectBoard } from '../store/bridge';
import { useSpinthStore } from '../store/spinthStore';
import { DotGrid } from './DotGrid';

/** sr-only 快捷键帮助的 id（stage aria-describedby 指向） */
const STAGE_HELP_ID = 'spinth-stage-help';

/**
 * 画板容器（docs/12 §4）：挂载点 + 生命周期。
 * StrictMode 双挂载防御：异步 initialize 完成前被卸载则立即 dispose。
 * 经 createBoard() 拿冻结公共投影（specs/runtime-narrowing §3.6）：DEV 下
 * `window.__spinth` = 公开投影、`window.__spinthDebug.__debug` = 调试面，
 * 两者原子曝光、生产构建剥离。
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
  const boardRef = useRef<BoardPublicApi | null>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    // StrictMode 双挂载：用 AbortController 让第一个实例在 await 间隙自毁，
    // 保证任何时刻只有一个实例写 IndexedDB / 绑定快捷键
    const controller = new AbortController();
    let disconnect: (() => void) | undefined;
    let detachDebug: (() => void) | undefined;
    let cleanedUp = false;
    const board = createBoard();
    boardRef.current = board;
    const ready = board.initialize(config, el, controller.signal);
    if (theme) board.setTheme(theme); // 就绪前的主题态在 initialize 后立即注入
    void ready
      .then(async () => {
        if (controller.signal.aborted) {
          board.dispose();
          return;
        }
        bindBoard(board);
        disconnect = connectBoard(board);
        // 纯渲染面对屏读隐藏（specs/a11y-closeout §8.1）：画布语义在宿主 div
        //（role=application + 帮助文本），canvas 本体不可达
        ref.current
          ?.querySelectorAll('canvas')
          .forEach((c) => c.setAttribute('aria-hidden', 'true'));
        if ((import.meta as { env?: { DEV?: boolean } }).env?.DEV) {
          // 先等调试入口就绪，再同一同步块曝光两个全局（原子曝光）：
          // E2E 的 waitForSynced 只等 __spinth，不能让它看到「有公开面、
          // 没调试面」的中间态；加载失败不挂 __spinth（E2E 明确红）
          try {
            const { attachBoardDebug } = await import('@spinth/core/dev');
            if (controller.signal.aborted || cleanedUp) return;
            detachDebug = attachBoardDebug(board, window);
            (window as unknown as Record<string, unknown>).__spinth = board;
          } catch (err) {
            console.warn('[spinth] 调试探针加载失败', err);
          }
        }
        onReady?.();
      })
      .catch((err) => {
        if ((err as DOMException)?.name === 'AbortError') {
          board.dispose();
          return;
        }
        console.error('[spinth] Board 初始化失败', err);
        // 失败上抛 UI（Batch 1 · 1.14）：此前只 console——loading 永远 true，
        // 用户卡「正在恢复画布…」（IndexedDB 禁用/配额满等场景无出口）
        useSpinthStore.setState({ initError: String((err as Error)?.message ?? err) });
      });
    return () => {
      cleanedUp = true;
      controller.abort();
      disconnect?.();
      detachDebug?.();
      unbindBoard();
      // 句柄清理同样收进 DEV 常量分支：生产构建整体 DCE，产物零 `__spinth`
      // 字符串（scripts/check-debug-bundle 的收紧断言据此判定）
      if ((import.meta as { env?: { DEV?: boolean } }).env?.DEV) {
        // 按对象身份删除：StrictMode 第二次挂载后不误删新实例的句柄
        if ((window as unknown as { __spinth?: unknown }).__spinth === board) {
          delete (window as unknown as { __spinth?: unknown }).__spinth;
        }
      }
      if (boardRef.current === board) boardRef.current = null;
      void ready.then(
        () => board.dispose(),
        () => board.dispose(),
      );
    };
    // config 变化不重装画板（docId 等由外层路由控制）
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 主题注入（docs/17 C2）：board 就绪后跟随 app 壳主题态（含首载与切换）
  useEffect(() => {
    if (theme) boardRef.current?.setTheme(theme);
  }, [theme]);

  return (
    // 层序用显式 z-index 而非 DOM 顺序：core 命令式追加的 canvas 与 React 子节点
    // （DotGrid）的相对顺序在重渲染后不可保证（实测 React 会把重渲染的子节点插到
    // canvas 之后）。canvas z-[1]：高于点阵（z-auto），低于 App 层浮层（z-10+）。
    // 屏读语义（specs/a11y-closeout §8.2，W4/D8）：role=application——单字母键/
    // 方向键/Esc 需透传给应用（group 会被浏览模式吞）；代价是必须给出说明与
    // 退出路径：tabIndex=0 Tab 进出 + aria-describedby 快捷键摘要（人工清单
    // 不通过则回退 role=group，决策 D8）
    <div
      id="stage-container"
      data-spinth-stage=""
      ref={ref}
      tabIndex={0}
      role="application"
      aria-roledescription="白板"
      aria-label="白板画布"
      aria-describedby={STAGE_HELP_ID}
      className="absolute inset-0 overflow-hidden [&>canvas]:absolute [&>canvas]:top-0 [&>canvas]:left-0 [&>canvas]:z-[1]"
    >
      <DotGrid />
      <p id={STAGE_HELP_ID} className="sr-only">
        方向键微移选中元素，Shift 加速；V H R T L P E S M 切换工具；Cmd 或 Ctrl 加 Z 撤销；Delete
        删除选中；Esc 取消；Shift 加 F10 打开右键菜单；按 Tab 离开画布。
      </p>
    </div>
  );
}
