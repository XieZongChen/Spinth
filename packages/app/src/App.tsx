import { useEffect, useState } from 'react';
import {
  Board,
  Toolbar,
  ZoomControl,
  ContextMenu,
  ActionBar,
  MindAddButtons,
  ToolGhost,
  OfflineBar,
  Icon,
  useSpinthStore,
} from '@spinth/react';
import { spinthCommands } from '@spinth/react';
import { initTheme, toggleTheme, THEME_CHANGE_EVENT, type Theme } from './theme';

/** 品牌图标（packages/app/public/spinth-mark.png）——顶栏/加载态共用；
 *  mark 已裁掉原图透明留白；favicon 用同源 32/180 派生图（index.html） */
function BrandMark({ className }: { className?: string }) {
  return (
    <img
      src="/spinth-mark.png"
      alt=""
      aria-hidden="true"
      draggable={false}
      className={`select-none object-contain ${className ?? ''}`}
    />
  );
}

/** 应用壳（docs/12 §3）：44px 顶栏 + 画布；工具坞/缩放胶囊悬浮在画布上。 */
export function App() {
  const [boardReady, setBoardReady] = useState(false);
  const [theme, setTheme] = useState<Theme>('light');
  const docState = useSpinthStore((s) => s.docState);
  const persistState = useSpinthStore((s) => s.persistState);
  const initError = useSpinthStore((s) => s.initError);
  const editable = useSpinthStore((s) => s.editable);
  const modelCount = useSpinthStore((s) => s.modelCount);
  const loading = !boardReady || docState !== 'synced';
  const saving = persistState === 'saving';

  // 本地文档路由：?doc=xxx 选择文档；默认 docId 随机并稳定在 sessionStorage。
  // 单机版不读取远端地址或协同参数。
  const params = new URLSearchParams(window.location.search);
  const docId = params.get('doc') ?? getDefaultDocId();
  // 资产维护链：生产默认开（启动 idle 迁移+GC）；DEV 默认关
  // ——GC 全库扫描是并行页面下的 IO 压力源（E2E 偶红源），专项用例 ?assetMaint=1
  const isProd = (import.meta as unknown as { env?: { PROD?: boolean } }).env?.PROD;
  const assetMaintenance = isProd !== false || params.get('assetMaint') === '1';

  useEffect(() => {
    setTheme(initTheme());
    // 无保存偏好时跟随系统主题（initTheme 注册的监听在此广播）
    const onSystemChange = (e: Event) => setTheme((e as CustomEvent<Theme>).detail);
    window.addEventListener(THEME_CHANGE_EVENT, onSystemChange);
    return () => window.removeEventListener(THEME_CHANGE_EVENT, onSystemChange);
  }, []);

  const handleBoardReady = () => {
    setBoardReady(true);
  };

  return (
    <div className="flex h-dvh w-screen flex-col bg-canvas text-ink">
      <header className="z-20 flex h-11 shrink-0 items-center justify-between border-b border-edge bg-surface px-4">
        <div className="flex items-center gap-2.5">
          <BrandMark className="h-7 w-auto" />
          <span className="text-[15px] font-extrabold tracking-tight">spinth</span>
          <span className="ml-1 rounded-full bg-surface-hover px-2.5 py-0.5 text-xs font-bold text-ink-3">
            {docId}
          </span>
        </div>
        <div className="flex items-center gap-2">
          {!editable && (
            <span
              className="rounded-md bg-surface-hover px-2 py-0.5 text-xs font-semibold text-ink-2"
              title="此画布为只读——编辑命令已禁用"
            >
              只读
            </span>
          )}
          {!loading && persistState === 'failed' ? (
            // 本地落盘失败：IndexedDB 写入退避中（配额满/私密模式）。
            <button
              type="button"
              onClick={() => spinthCommands.retryPersist()}
              className="flex items-center gap-1.5 rounded-md bg-danger-soft px-2 py-0.5 text-xs font-semibold text-danger"
              aria-live="polite"
            >
              <span className="h-1.5 w-1.5 rounded-full bg-danger animate-pulse" aria-hidden />
              本地保存失败 · 点击重试
            </button>
          ) : (
            !loading && (
              <span className="flex items-center gap-1.5 text-xs font-semibold text-ink-2">
                <span
                  className={`h-1.5 w-1.5 rounded-full ${saving ? 'bg-tool-shape animate-pulse' : 'bg-tool-pen'}`}
                  aria-hidden
                />
                {saving ? '保存中…' : '已保存'}
              </span>
            )
          )}
          <button
            type="button"
            title="复制本文档链接"
            aria-label="复制本文档链接"
            onClick={() => {
              void navigator.clipboard?.writeText(window.location.href).catch(() => {});
            }}
            className="flex h-8 w-8 items-center justify-center rounded-full text-ink-2 transition-colors duration-150 hover:bg-surface-hover hover:text-ink"
          >
            <Icon name="link" size={16} strokeWidth={2} />
          </button>
          <button
            type="button"
            title="新建画布"
            aria-label="新建画布"
            onClick={() => {
              window.location.href = `/?doc=${crypto.randomUUID().slice(0, 8)}`;
            }}
            className="flex h-8 w-8 items-center justify-center rounded-full text-ink-2 transition-colors duration-150 hover:bg-surface-hover hover:text-ink"
          >
            <Icon name="add" size={16} strokeWidth={2} />
          </button>
          <button
            type="button"
            title={theme === 'light' ? '切换到深色' : '切换到浅色'}
            onClick={() => {
              const next = toggleTheme(theme);
              setTheme(next);
            }}
            className="flex h-8 w-8 items-center justify-center rounded-full text-ink-2 transition-colors duration-150 hover:bg-surface-hover hover:text-ink"
          >
            <Icon name={theme === 'light' ? 'moon' : 'sun'} size={16} strokeWidth={2} />
          </button>
        </div>
      </header>

      <main className="relative flex-1 overflow-hidden">
        <Board config={{ docId, assetMaintenance }} onReady={handleBoardReady} theme={theme} />
        {/* 空画布引导（Batch 1 · 1.23）：零件时轻提示，建首件即隐（modelCount 镜像驱动） */}
        {!loading && modelCount === 0 && (
          <div
            className="pointer-events-none absolute inset-0 z-[5] flex items-center justify-center"
            aria-hidden
          >
            <div className="flex flex-col items-center gap-2 rounded-2xl bg-surface/80 px-6 py-4 text-center backdrop-blur-sm">
              <p className="text-sm font-semibold text-ink-2">空画布</p>
              <p className="text-xs text-ink-3">R 拖出矩形 · S 便签 · M 脑图 · L 连线 · P 画笔</p>
            </div>
          </div>
        )}
        <Toolbar />
        <ZoomControl />
        <ContextMenu />
        <ActionBar />
        <MindAddButtons />
        <ToolGhost />
        <OfflineBar />
        {loading && initError ? (
          // 初始化失败出口（Batch 1 · 1.14）：IndexedDB 禁用/配额满等——
          // 此前永远停在「正在恢复画布…」无提示无重试
          <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-3 bg-canvas p-6 text-center">
            <p className="text-sm font-semibold text-danger">画布初始化失败</p>
            <p className="max-w-md text-xs text-ink-3">{initError}</p>
            <p className="max-w-md text-xs text-ink-3">
              浏览器存储不可用（私密模式 / 配额满）时无法恢复本地画布，可清理站点数据后重试
            </p>
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="rounded-md bg-accent px-4 py-1.5 text-xs font-semibold text-white"
            >
              重试
            </button>
          </div>
        ) : (
          loading && (
            <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-4 bg-canvas">
              <div className="ribbon-stage" aria-hidden="true">
                <BrandMark className="ribbon-mark" />
              </div>
              <p className="text-[13px] font-semibold text-ink-3">正在恢复画布…</p>
            </div>
          )
        )}
      </main>
    </div>
  );
}

/** 默认文档 id（Batch 1 · 1.20）：随机 8 位 + sessionStorage 稳定——无 ?doc 访客
 *  各自独立文档（此前全部署共享 'spinth-doc' 一个房间/一个 IndexedDB 库） */
function getDefaultDocId(): string {
  const KEY = 'spinth-default-doc';
  try {
    const cached = sessionStorage.getItem(KEY);
    if (cached) return cached;
    const id = crypto.randomUUID().slice(0, 8);
    sessionStorage.setItem(KEY, id);
    return id;
  } catch {
    // sessionStorage 不可用（隐私模式极端配置）——每次随机，仅丢失默认文档连续性
    return crypto.randomUUID().slice(0, 8);
  }
}
