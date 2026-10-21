import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import { Icon, useSpinthStore } from '@spinth/react';
import { spinthCommands } from '@spinth/react';
import {
  ProjectFileError,
  type ProjectFileErrorCode,
  type IProjectImportResult,
  type IProjectWarning,
} from '@spinth/react';

/**
 * 项目菜单（docs/20 §9）：顶栏「导出项目 / 导入项目」入口。
 * busy/error 是组件本地状态（§5.3：不新增 zustand 状态）；core 错误只消费
 * code 映射中文提示，不解析 message；详情 console.error 记录。
 * warning 消费（评审 P1-2）：导出/导入结果的 warning 必须到达用户——导出有
 * warning 时保持菜单打开展示；导入有 warning 时不自动导航，用户确认后再打开。
 */

/** §10 错误码 → 用户提示（PROJECT_ABORTED 静默不展示） */
const ERROR_MESSAGES: Record<ProjectFileErrorCode, string> = {
  PROJECT_NOT_READY: '画布尚未就绪，请稍后重试',
  PROJECT_ABORTED: '',
  PROJECT_CRYPTO_UNAVAILABLE: '浏览器不支持安全校验，无法导出/导入',
  PROJECT_ARCHIVE_INVALID: '项目文件已损坏或不是 spinth 项目，请重选文件',
  PROJECT_ARCHIVE_LIMIT: '项目文件超过大小限制',
  PROJECT_MANIFEST_INVALID: '项目文件清单无效，请重选文件',
  PROJECT_VERSION_UNSUPPORTED: '项目文件版本过新，请升级 spinth',
  PROJECT_DOCUMENT_INVALID: '项目文档数据损坏，无法导入',
  PROJECT_DOCUMENT_LIMIT: '项目文档超过大小限制',
  PROJECT_ASSET_MISSING: '项目缺少图片资产，导入已取消',
  PROJECT_ASSET_INVALID: '项目图片校验失败，导入已取消',
  PROJECT_ASSET_LIMIT: '项目图片超过大小限制',
  PROJECT_DOC_ID_COLLISION: '无法创建新画布，请重试',
  PROJECT_STORAGE_WRITE_FAILED: '本地存储空间不足或不可用，导入未完成',
};

/** 导出侧的资产缺失/损坏专用文案（§10：与导入侧区分） */
const EXPORT_ASSET_ERROR = '有图片资产缺失或损坏，无法完整导出；请删除坏图后重试';

/** §5.1 warning → 用户文案（导出/导入共用，外链/dataURL 是 D3 的用户可见面） */
function warningText(w: IProjectWarning): string {
  const n = w.count ?? 1;
  switch (w.code) {
    case 'EXTERNAL_IMAGES_SKIPPED':
      return `有 ${n} 张外链图片未打包进项目文件（仅保留原链接，导入后需联网加载）`;
    case 'DATA_URL_IMAGES_INCLUDED':
      return `有 ${n} 张内嵌（data URL）图片保留在文档内，未单独打包`;
    case 'EMPTY_PROJECT':
      return '空画布：项目文件不含任何控件';
    case 'UNKNOWN_ARCHIVE_ENTRIES_IGNORED':
      return `项目文件含 ${n} 个未知条目，已忽略`;
    case 'UNREFERENCED_ASSETS_IGNORED':
      return `${n} 个未被文档引用的资产未写入本地资产库`;
    case 'CURRENT_DOC_FLUSH_FAILED':
      return '当前画布保存未完成，请确认保存后再关闭页面';
  }
}

function messageOf(err: unknown, phase: 'export' | 'import'): string | null {
  if (!(err instanceof ProjectFileError)) {
    console.error('[spinth:project] 未预期错误', err);
    return '操作失败，请重试';
  }
  console.error('[spinth:project] 项目文件操作失败', err.code, err.details ?? '');
  if (err.code === 'PROJECT_ABORTED') return null; // 静默
  if (
    phase === 'export' &&
    (err.code === 'PROJECT_ASSET_MISSING' || err.code === 'PROJECT_ASSET_INVALID')
  ) {
    return EXPORT_ASSET_ERROR;
  }
  return ERROR_MESSAGES[err.code];
}

/** Blob URL + <a download> 触发浏览器下载（§6：不弹另存为对话框） */
function downloadBlob(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000); // 等下载真正启动后回收
}

export function ProjectMenu() {
  const docState = useSpinthStore((s) => s.docState);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState<'export' | 'import' | null>(null);
  const [error, setError] = useState<string | null>(null);
  /** 导出结果 warning（导出后留在菜单内展示，用户手动关闭） */
  const [exportWarnings, setExportWarnings] = useState<IProjectWarning[]>([]);
  /** 导入成功但需用户确认（任何 warning：外链/flush 等）——保留到导航或新导入 */
  const [pendingImport, setPendingImport] = useState<{
    docId: string;
    warnings: IProjectWarning[];
  } | null>(null);
  const [panelStyle, setPanelStyle] = useState<CSSProperties | null>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // §9.2：docState 未 synced / 初始化失败时禁用；忙碌中同样禁用
  const ready = docState === 'synced';
  const disabled = !ready || busy !== null;

  // 面板定位（§9.4）：fixed 右对齐锚点按钮、顶栏下方，钳制在视口内（390px 不溢出）
  useLayoutEffect(() => {
    if (!open) return;
    const rect = buttonRef.current?.getBoundingClientRect();
    if (!rect) return;
    setPanelStyle({
      position: 'fixed',
      top: rect.bottom + 6,
      right: Math.max(8, window.innerWidth - rect.right),
      width: 'min(320px, calc(100vw - 16px))',
    });
  }, [open]);

  // Escape 关闭并把焦点还给按钮（§9.3；capture 相独占——不冒泡到全局清选区）
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        setOpen(false);
        buttonRef.current?.focus();
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [open]);

  // 点击外部关闭
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent): void => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener('pointerdown', onDown);
    return () => window.removeEventListener('pointerdown', onDown);
  }, [open]);

  const openMenu = (): void => {
    setError(null);
    setOpen(true);
  };

  const handleExport = async (): Promise<void> => {
    setBusy('export');
    setError(null);
    setExportWarnings([]);
    try {
      const result = await spinthCommands.exportProject();
      if (!result) {
        setError(ERROR_MESSAGES.PROJECT_NOT_READY);
        return;
      }
      downloadBlob(result.blob, result.fileName);
      // 有 warning 保持菜单打开展示（评审 P1-2：外链未打包等必须到达用户）；
      //  无 warning 按设计 §9.2 关闭菜单，不写任何 store。setOpen(true) 兜底
      //  「菜单已被外部关闭」的窗口（如文件对话框期间的焦点切换）
      if (result.warnings.length > 0) {
        setExportWarnings(result.warnings);
        setOpen(true);
        return;
      }
      setOpen(false);
    } catch (err) {
      setError(messageOf(err, 'export'));
    } finally {
      setBusy(null);
    }
  };

  const handleImportFile = async (file: File | undefined): Promise<void> => {
    if (!file) return;
    setBusy('import');
    setError(null);
    setPendingImport(null);
    try {
      const result: IProjectImportResult | null = await spinthCommands.importProject(file);
      if (!result) {
        setError(ERROR_MESSAGES.PROJECT_NOT_READY);
        return;
      }
      if (result.warnings.length > 0) {
        // 任何 warning（外链/未引用资产/空项目/flush 未完成）都先展示，
        // 用户确认「打开新画布」后才导航（评审 P1-2/P2-5：pending 保留到确认）。
        // setOpen(true)：import 由隐藏 input 触发，菜单可能未开——强制打开保证
        // warning 面板必然渲染（用户永远看得到确认入口）
        setPendingImport({ docId: result.docId, warnings: result.warnings });
        setOpen(true);
        return;
      }
      window.location.assign(`/?doc=${encodeURIComponent(result.docId)}`);
    } catch (err) {
      // 失败时菜单同样保持/打开（§9.2：菜单保持打开显示错误，允许重试）
      setError(messageOf(err, 'import'));
      setOpen(true);
    } finally {
      setBusy(null);
    }
  };

  const openPendingDoc = (): void => {
    if (!pendingImport) return;
    window.location.assign(`/?doc=${encodeURIComponent(pendingImport.docId)}`);
  };

  const itemClass =
    'flex h-[34px] w-full items-center gap-2.5 rounded-lg px-2.5 text-[13px] font-semibold text-ink transition-colors duration-100 hover:bg-surface-hover disabled:cursor-not-allowed disabled:opacity-50';

  return (
    <div ref={rootRef} className="relative">
      <button
        ref={buttonRef}
        type="button"
        title="项目"
        aria-label="项目"
        aria-haspopup="menu"
        aria-expanded={open}
        disabled={disabled}
        onClick={() => (open ? setOpen(false) : openMenu())}
        data-spinth-project-menu=""
        className="flex h-8 w-8 items-center justify-center rounded-full text-ink-2 transition-colors duration-150 hover:bg-surface-hover hover:text-ink disabled:cursor-not-allowed disabled:opacity-50"
      >
        <Icon name="more" size={16} strokeWidth={2} />
      </button>

      {open && (
        <div
          role="menu"
          aria-label="项目"
          aria-busy={busy !== null}
          data-spinth-project-menu-panel=""
          className="z-30 rounded-xl border border-edge bg-surface px-2 py-1.5 shadow-pop"
          style={panelStyle ?? undefined}
        >
          <div className="flex flex-col gap-0.5">
            <button
              type="button"
              role="menuitem"
              disabled={disabled}
              onClick={() => void handleExport()}
              className={itemClass}
            >
              <Icon name="download" size={16} strokeWidth={2} />
              {busy === 'export' ? '正在导出…' : '导出项目（.spinth.zip）'}
            </button>
            <button
              type="button"
              role="menuitem"
              disabled={disabled}
              onClick={() => inputRef.current?.click()}
              className={itemClass}
            >
              <Icon name="upload" size={16} strokeWidth={2} />
              {busy === 'import' ? '正在导入…' : '导入项目…'}
            </button>
          </div>

          {exportWarnings.length > 0 && (
            <div role="status" className="mt-1.5 border-t border-edge px-2.5 py-2">
              <p className="text-xs font-semibold text-ink-2">项目已导出，请注意：</p>
              <ul className="mt-1 list-disc space-y-0.5 pl-4">
                {exportWarnings.map((w, i) => (
                  <li key={i} className="text-xs leading-5 text-ink-3">
                    {warningText(w)}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {pendingImport !== null && (
            <div role="status" className="mt-1.5 border-t border-edge px-2.5 py-2">
              <p className="text-xs font-semibold text-ink-2">项目已导入，请注意：</p>
              <ul className="mt-1 list-disc space-y-0.5 pl-4">
                {pendingImport.warnings.map((w, i) => (
                  <li key={i} className="text-xs leading-5 text-ink-3">
                    {warningText(w)}
                  </li>
                ))}
              </ul>
              <button
                type="button"
                onClick={openPendingDoc}
                className="mt-1.5 rounded-md bg-accent px-3 py-1 text-xs font-semibold text-white"
              >
                打开新画布
              </button>
            </div>
          )}

          {error !== null && (
            <p
              role="alert"
              className="mt-1.5 border-t border-edge px-2.5 py-2 text-xs leading-5 text-danger"
            >
              {error}
            </p>
          )}
        </div>
      )}

      <input
        ref={inputRef}
        type="file"
        accept=".zip,.spinth.zip,application/zip"
        data-spinth-project-import=""
        className="hidden"
        onChange={(e) => {
          void handleImportFile(e.target.files?.[0]);
          e.target.value = ''; // 同名文件可重复选择
        }}
      />
    </div>
  );
}
