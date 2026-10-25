import { useEffect, useState } from 'react';
import {
  Announcer,
  Board,
  Toolbar,
  ZoomControl,
  ContextMenu,
  ActionBar,
  MindAddButtons,
  ToolGhost,
  OfflineBar,
  ErrorState,
  Icon,
  useSpinthStore,
} from '@spinth/react';
import { initTheme, toggleTheme, THEME_CHANGE_EVENT, type Theme } from './theme';
import { ProjectMenu } from './ProjectMenu';
import { StorageStatusButton } from './StorageStatusButton';
import { ReadOnlyNotice } from './ReadOnlyNotice';
import { useTabRole } from './tabSession';
import { docUrl, publicAsset } from './siteBase';

/** 品牌图标（packages/app/public/spinth-mark.png）——顶栏/加载态共用；
 *  mark 已裁掉原图透明留白；favicon 用同源 32/180 派生图（index.html） */
function BrandMark({ className }: { className?: string }) {
  return (
    <img
      src={publicAsset('spinth-mark.png')}
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
  // 项目菜单受控（docs/02 §6.1 D7）：存储面板「打开项目菜单」与顶栏按钮共用一个开合源
  const [projectMenuOpen, setProjectMenuOpen] = useState(false);
  const docState = useSpinthStore((s) => s.docState);
  const initError = useSpinthStore((s) => s.initError);
  const editable = useSpinthStore((s) => s.editable);
  const modelCount = useSpinthStore((s) => s.modelCount);

  // 本地文档路由：?doc=xxx 选择文档；默认 docId 随机并稳定在 sessionStorage。
  // 单机版不读取远端地址或协同参数。
  const params = new URLSearchParams(window.location.search);
  const docId = params.get('doc') ?? getDefaultDocId();
  // 资产维护链：生产默认开（启动 idle 迁移+GC）；DEV 默认关
  // ——GC 全库扫描是并行页面下的 IO 压力源（E2E 偶红源），专项用例 ?assetMaint=1
  const isProd = (import.meta as unknown as { env?: { PROD?: boolean } }).env?.PROD;
  const assetMaintenanceBase = isProd !== false || params.get('assetMaint') === '1';

  // 多标签角色（docs/21 §3）：锁 → 角色 → 画布。pending 不挂 Board——
  // editable 从第一帧起就是终值，不存在「先可写、后降级」的窗口
  const tab = useTabRole(docId);
  const writable = tab.role === 'leader' || tab.role === 'solo';
  const loading = tab.role === 'pending' || !boardReady || docState !== 'synced';

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
    <div
      className="flex h-dvh w-screen flex-col bg-canvas text-ink"
      data-spinth-tab-role={tab.role}
    >
      {/* 页面标题（specs/a11y-closeout §8.1，W4）：视觉标识在顶栏品牌，
          h1 sr-only 供屏读页面级定位 */}
      <h1 className="sr-only">spinth 白板</h1>
      <Announcer />
      {/* 安全区（批次 B W3）：pt 垫高 safe-top（内容区仍 44，M1 不回归）、
          左右内边距计 safe-left/right；<380 紧凑变体（max-[379px]，不用 419——
          390 的 M1 依赖胶囊截断，断点覆盖 390 基线即漂，specs/a11y-closeout §7.3） */}
      <header className="z-20 flex h-[calc(2.75rem+var(--spinth-safe-top))] shrink-0 items-center justify-between border-b border-edge bg-surface pt-[var(--spinth-safe-top)] pl-[calc(1rem+var(--spinth-safe-left))] pr-[calc(1rem+var(--spinth-safe-right))] max-[379px]:pl-[calc(0.5rem+var(--spinth-safe-left))] max-[379px]:pr-[calc(0.5rem+var(--spinth-safe-right))]">
        {/* min-w-0 + truncate：390px 下长 docId 截断（docs/12 移动端），顶栏不换行不横滚 */}
        <div className="flex min-w-0 items-center gap-2.5 max-[379px]:gap-1.5">
          <BrandMark className="h-7 w-auto" />
          <span className="text-[15px] font-extrabold tracking-tight max-[379px]:hidden">
            spinth
          </span>
          <span
            data-spinth-doc-id=""
            title={docId}
            aria-label={`文档 ${docId}`}
            className="ml-1 min-w-0 truncate rounded-full bg-surface-hover px-2.5 py-0.5 text-xs font-bold text-ink-3 max-[379px]:ml-0"
          >
            {docId}
          </span>
        </div>
        <div className="flex items-center gap-2 max-[379px]:gap-1">
          {!editable && (
            <span
              className="rounded-md bg-surface-hover px-2 py-0.5 text-xs font-semibold text-ink-2"
              data-spinth-readonly-pill=""
              title={
                tab.role === 'follower'
                  ? '此画布为只读——另一标签正在编辑'
                  : '此画布为只读——编辑命令已禁用'
              }
              aria-label={
                tab.role === 'follower'
                  ? '此画布为只读——另一标签正在编辑'
                  : '此画布为只读——编辑命令已禁用'
              }
            >
              只读
            </span>
          )}
          {!loading && <StorageStatusButton onOpenProjectMenu={() => setProjectMenuOpen(true)} />}
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
              window.location.href = docUrl(crypto.randomUUID().slice(0, 8));
            }}
            className="flex h-8 w-8 items-center justify-center rounded-full text-ink-2 transition-colors duration-150 hover:bg-surface-hover hover:text-ink"
          >
            <Icon name="add" size={16} strokeWidth={2} />
          </button>
          <ProjectMenu open={projectMenuOpen} onOpenChange={setProjectMenuOpen} />
          <button
            type="button"
            title={theme === 'light' ? '切换到深色' : '切换到浅色'}
            aria-label={theme === 'light' ? '切换到深色' : '切换到浅色'}
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

      <main className="relative flex-1 overflow-hidden" aria-label="画布区域">
        {/* 角色未定（pending）不挂画布（docs/21 §3）——loading 覆盖层在场 */}
        {tab.role !== 'pending' && (
          <Board
            config={{
              docId,
              editable: writable,
              assetMaintenance: assetMaintenanceBase && writable,
            }}
            onReady={handleBoardReady}
            theme={theme}
          />
        )}
        {tab.role === 'follower' && <ReadOnlyNotice />}
        {/* 空画布引导（Batch 1 · 1.23）：零件时轻提示，建首件即隐（modelCount 镜像驱动）；
            只读不显示——引导的全是写指令，follower 空文档不该读到无法执行的提示 */}
        {!loading && editable && modelCount === 0 && (
          <div
            className="pointer-events-none absolute inset-0 z-[5] flex items-center justify-center"
            aria-hidden
          >
            <div
              data-spinth-empty-hint=""
              className="flex max-w-[calc(100vw-32px)] flex-col items-center gap-2 rounded-2xl bg-surface/80 px-6 py-4 text-center backdrop-blur-sm"
            >
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
          // 此前永远停在「正在恢复画布…」无提示无重试。
          // 呈现收敛到共享 ErrorState（批次 A · A2）：role=alert + 标题聚焦 +
          // 详情可滚；文案顺序「标题→建议→详情」
          <div className="absolute inset-0 z-10 bg-canvas">
            <ErrorState
              kind="init"
              title="画布初始化失败"
              description="浏览器存储不可用（私密模式 / 配额满）时无法恢复本地画布，可清理站点数据后重试"
              detail={initError}
              actionLabel="重试"
              onAction={() => window.location.reload()}
            />
          </div>
        ) : (
          loading && (
            <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-4 bg-canvas">
              <BrandMark className="spark-pulse h-10 w-10" />
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
