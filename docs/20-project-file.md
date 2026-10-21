# 20 — 项目文件（导出/导入）规格

> 本文件是项目文件格式、导出/导入与兼容性的当前规格；实现、评审与验收以本文为准。
> 实现不得自行改变 §4 的格式与 §7 的导入语义；变更先改本文。

## 1. 目标与非目标

### 1.1 目标

1. 把当前画布导出为**一个可离线保存、可再次导入**的项目文件：Yjs 文档全量快照 + 被引用的图片资产 + 清单。
2. 导入时完整校验文件，恢复文档与资产，打开为一个**新的本地画布**。
3. 导入失败不修改当前画布、不覆盖任何已有文档；用户可在原画布继续工作。
4. 文件格式有版本号、有文档、有 round-trip 测试（必须含图片资产）。
5. 导出/导入全程不依赖服务端、账号或网络。
6. 顶栏有入口，390px 下不挤压现有布局。

### 1.2 非目标（本期不做）

- 多文档/整个工作区打包；只导出当前文档。
- 覆盖、合并或替换当前文档。
- 协同、远端同步、跨设备资产传输。
- 导出 undo 历史、选区、视口、主题、工具默认参数。
- 缩略图、项目标题、封面。
- 拖放 `.spinth.zip` 到画布导入（后续可加）。
- ZIP 加密/密码。
- 超过 §11 限额的超大项目流式处理。

## 2. 硬约束

- 只改 `@spinth/core` 的数据/平台层与 `@spinth/app` 壳；`@spinth/core` 不 import React/zustand。
- 类型先行：`packages/core/src/types/projectFile.ts` 定义 zod schema 与 TS 类型；文件边界必须运行时校验。
- 导出是**纯读**：只读 `Y.Doc` 与 `AssetStore`，不写 Yjs、不产生 undo 条目。
- 导入写的是**新的** `Y.Doc` 快照与新的文档库；不得绕过 Yjs 直接改 VM/PIXI。
- 显式依赖：`ProjectFileService` 由 `boardComposition` 构造注入；禁止全局单例/装饰器 DI。
- 单文件单职责，目标 < 400 行；格式、归档、导出、导入、服务分层。
- 默认启动路径无网络；ZIP 库必须动态 import，不能进首屏同步 chunk。
- 资产仍走现有内容寻址 `spinth-asset:<sha256>`；不得把 base64 写回 Yjs。
- 提交前 `pnpm verify` 全绿；改交互补跑 `pnpm test:e2e`。

## 3. 决策摘要

| ID  | 决策     | 结论                                | 理由                                                                    |
| --- | -------- | ----------------------------------- | ----------------------------------------------------------------------- |
| S1  | 容器     | `.spinth.zip`（ZIP），使用 `fflate` | 标准工具可解包；图片保持二进制；fflate 小、无传递依赖、浏览器/Node 同源 |
| S2  | 导入身份 | 每次导入创建**新 docId**            | 不覆盖、不合并；失败/重复导入都安全                                     |
| S3  | 文档表示 | `Y.encodeStateAsUpdate` 全量快照    | 单文件自包含；不依赖增量日志                                            |
| S4  | 资产表示 | 内容寻址 + 原始二进制               | 复用现有 AssetStore；去重；Yjs 只存短引用                               |
| S5  | 失败语义 | 校验全部通过后才写库                | 当前画布零影响；不产生半成品文档                                        |
| S6  | 网络     | 全程本地                            | 单机优先；导入校验不 fetch 任何 URL                                     |
| S7  | 版本     | `format` + 整数 `version`，v1 固定  | 新格式字段/文件必须升版本；旧版导入给出明确提示                         |

以上为冻结决策，备选方案不再采用。若未来要更换容器或导入语义，必须重新走设计评审并升格式版本，不能只换实现不改格式。

## 4. 文件格式 v1

### 4.1 目录结构

```
spinth-<docId>-<YYYYMMDD-HHmmss>.spinth.zip
├── manifest.json       # UTF-8 JSON，格式见 4.2
├── document.yjs        # Y.encodeStateAsUpdate(yDoc)，原始二进制
└── assets/
    └── <sha256>        # 图片原始字节，文件名 = 资产 id
```

- 资产条目直接放在 `assets/` 下，不再按扩展名分层；MIME 由 manifest 记录。
- ZIP 条目名大小写敏感；不要求目录条目（`assets/` 目录项可有可无，导入方忽略）。
- 导出时资产按 id 升序、manifest 位于第一个条目；导入方不依赖顺序。
- 导出文件名中的 docId 需做安全化（仅保留 `[A-Za-z0-9_-]`，最长 32 字符）；manifest 中保留原始 `sourceDocId`。
- 建议压缩策略：`manifest.json` / `document.yjs` 用 deflate（level 6），图片资产 level 0（已压缩，避免无谓 CPU）。

### 4.2 manifest.json

```json
{
  "format": "spinth-project",
  "version": 1,
  "createdAt": "2026-10-21T08:00:00.000Z",
  "generator": { "name": "spinth", "version": "0.3.0" },
  "sourceDocId": "a1b2c3d4",
  "document": {
    "kind": "yjs-update",
    "path": "document.yjs",
    "bytes": 1234,
    "sha256": "9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08"
  },
  "assets": [
    {
      "id": "9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08",
      "path": "assets/9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08",
      "mime": "image/png",
      "size": 5678
    }
  ]
}
```

> 示例中的哈希/字节数仅示意，不是真实文件；生成时必须由内容计算。

字段规则：

| 字段                | 规则                                                                              |
| ------------------- | --------------------------------------------------------------------------------- |
| `format`            | 必须为字面量 `spinth-project`                                                     |
| `version`           | 必须为整数 `1`；更高版本拒绝导入                                                  |
| `createdAt`         | ISO 8601 时间字符串；仅诊断/展示，不参与恢复                                      |
| `generator.name`    | 必须为 `spinth`                                                                   |
| `generator.version` | 字符串，仅诊断；不用于兼容性判断                                                  |
| `sourceDocId`       | 导出时的 docId，1–128 字符；仅标识来源，导入不沿用为本地 docId                    |
| `document.kind`     | 必须为 `yjs-update`                                                               |
| `document.path`     | 必须为 `document.yjs`                                                             |
| `document.bytes`    | 与 `document.yjs` 实际字节数一致，正整数                                          |
| `document.sha256`   | 小写 64 位十六进制；与文件内容 SHA-256 一致                                       |
| `assets[].id`       | 小写 64 位十六进制 SHA-256；与文件内容一致                                        |
| `assets[].path`     | 必须等于 `assets/<id>`                                                            |
| `assets[].mime`     | v1 仅允许 `image/*`（大小写不敏感），1–128 字符；空 MIME 导出时归一为 `image/png` |
| `assets[].size`     | 与资产实际字节数一致，正整数                                                      |

约束：

- `assets` 中 `id` 与 `path` 不得重复；重复即 `PROJECT_MANIFEST_INVALID`。
- 字段级 zod 之外还需交叉校验：`path === 'assets/' + id`、MIME 匹配 `image/*`、`createdAt` 可被 `Date.parse` 解析、`assets.length` 不超上限。
- 导出时 `assets` 按 `id` 升序；导入方不要求有序。
- manifest 允许未知字段（zod 默认丢弃）；未知字段不得影响解析。
- manifest 必须是 UTF-8 JSON；实现可容忍 BOM，但导出不写 BOM。
- 导出时 `JSON.stringify(manifest, null, 2)` + 尾随换行，便于人工检查。

### 4.3 document.yjs

- 内容 = `Y.encodeStateAsUpdate(yDoc)`，包含全部 widget 数据与 tombstone。
- 导入时在临时 `Y.Doc` 上 `Y.applyUpdate`；失败即 `PROJECT_DOCUMENT_INVALID`。
- 若临时文档存在顶层 `widgets` 类型，必须是 `Y.Array`；不存在视为空文档（合法）。
- 导入**不做** widget schema 逐件校验：复用现有 DataEngine 的隔离区机制（未知类型/建模失败跳过并计数），避免导入层与控件注册表耦合。文件本身损坏由 Yjs apply 拦截。
- 文档不得包含 base64 图片写入路径；v1 只打包 `spinth-asset:` 引用。

### 4.4 assets/<sha256>

- 原始字节；文件名即内容 SHA-256（小写十六进制）。
- 导出前重新计算哈希并与 id 比对；不一致则拒绝导出，避免产出“自校验失败”的备份。
- 导入时再次校验；不一致即 `PROJECT_ASSET_INVALID`。
- 只打包当前文档实际引用的资产（`IMAGE.src` 为 `spinth-asset:`）；不打包未引用的库内资产。
- `data:` 图片保留在 Yjs 内（旧文档兼容），不单独入包；导出结果给出 warning。
- `http(s):` 图片保持 URL 原样，不下载、不打包；导出/导入结果给出 warning。

### 4.5 版本策略

- v1 只接受 `version === 1`。`version > 1` → `PROJECT_VERSION_UNSUPPORTED`，提示升级 spinth。
- 新增可选 manifest 字段不升版本；新增必需字段、改变路径/语义、增加资产类型必须升 `version`。
- 新增 widget 类型本身不需要升格式版本（Yjs 数据自描述），但新类型若引用新资产种类则需要 v2。
- 导入方遇到未知 ZIP 条目：忽略并记 warning；计入条目数/压缩包上限，但不解压、不计入解压后总字节上限。

## 5. 类型与公共 API

### 5.1 类型文件

新增 `packages/core/src/types/projectFile.ts`：

```ts
export const PROJECT_FORMAT = 'spinth-project' as const;
export const PROJECT_FORMAT_VERSION = 1 as const;

export const ProjectAssetEntrySchema = z.object({
  id: z.string().regex(/^[0-9a-f]{64}$/),
  path: z.string(),
  mime: z.string().min(1).max(128),
  size: z.number().int().positive(),
});

export const ProjectManifestSchema = z.object({
  format: z.literal(PROJECT_FORMAT),
  version: z.literal(PROJECT_FORMAT_VERSION),
  createdAt: z.string().min(1).max(64),
  generator: z.object({
    name: z.literal('spinth'),
    version: z.string().min(1).max(64),
  }),
  sourceDocId: z.string().min(1).max(128),
  document: z.object({
    kind: z.literal('yjs-update'),
    path: z.literal('document.yjs'),
    bytes: z.number().int().positive(),
    sha256: z.string().regex(/^[0-9a-f]{64}$/),
  }),
  assets: z.array(ProjectAssetEntrySchema),
});

export type ProjectManifest = z.infer<typeof ProjectManifestSchema>;
```

结果/错误类型（接口，建议）：

```ts
export type ProjectWarningCode =
  | 'EXTERNAL_IMAGES_SKIPPED'
  | 'DATA_URL_IMAGES_INCLUDED'
  | 'EMPTY_PROJECT'
  | 'UNKNOWN_ARCHIVE_ENTRIES_IGNORED'
  | 'UNREFERENCED_ASSETS_IGNORED'
  | 'CURRENT_DOC_FLUSH_FAILED';

export interface IProjectWarning {
  code: ProjectWarningCode;
  count?: number;
}

export interface IProjectStats {
  widgets: number;
  documentBytes: number;
  assetCount: number;
  assetBytes: number;
  archiveBytes: number;
}

export interface IProjectExportResult {
  blob: Blob;
  fileName: string;
  manifest: ProjectManifest;
  stats: IProjectStats;
  warnings: IProjectWarning[];
}

export interface IProjectImportResult {
  docId: string;
  sourceDocId: string;
  stats: IProjectStats;
  warnings: IProjectWarning[];
}
```

`IProjectExportOptions` / `IProjectImportOptions` 均包含可选 `signal?: AbortSignal`。

错误码（`ProjectFileError.code`）：

```
PROJECT_NOT_READY
PROJECT_ABORTED
PROJECT_CRYPTO_UNAVAILABLE
PROJECT_ARCHIVE_INVALID
PROJECT_ARCHIVE_LIMIT
PROJECT_MANIFEST_INVALID
PROJECT_VERSION_UNSUPPORTED
PROJECT_DOCUMENT_INVALID
PROJECT_DOCUMENT_LIMIT
PROJECT_ASSET_MISSING
PROJECT_ASSET_INVALID
PROJECT_ASSET_LIMIT
PROJECT_DOC_ID_COLLISION
PROJECT_STORAGE_WRITE_FAILED
```

`ProjectFileError` 必须保留 `code` 与可选 `details`（如 `{ assets: string[], phase: 'assets' | 'document' }`），不把原始二进制/JSON 塞进 message。

### 5.2 服务

新增 `packages/core/src/platform/projectFile/`：

```
projectFileError.ts      # 错误类、错误码、limit 常量
projectManifest.ts       # 构建/解析/校验 manifest
projectArchive.ts        # fflate 封装：打包/解包/条目校验
projectAssetRefs.ts      # 从 Y.Doc 收集资产引用、统计外链/dataURL
projectExport.ts         # 导出编排（纯读）
projectImport.ts         # 导入编排（校验→写资产→写新文档）
projectFileService.ts    # 依赖注入、ready/dispose、BoardSDK 门面
```

`ProjectFileService` 依赖：

```ts
interface IProjectFileServiceDeps {
  getDoc: () => { yDoc: Y.Doc; yWidgets: Y.Array<unknown>; docId: string } | null;
  assetStore: AssetStore;
  appVersion: string;
  createDoc: (docId: string, update: Uint8Array) => Promise<void>;
  flushCurrentDoc?: () => Promise<void>;
  randomDocId?: () => string;
  now?: () => Date;
  limits?: Partial<ProjectFileLimits>;
}
```

- `exportProject(opts?): Promise<IProjectExportResult>`
- `importProject(file: Blob, opts?): Promise<IProjectImportResult>`
- `dispose()`：置 disposed；之后调用返回 `PROJECT_NOT_READY`。
- `getDoc()` 仅在 `docState === 'synced'` 时返回文档；为空、SDK 未初始化或已 dispose → `PROJECT_NOT_READY`。
- `projectArchive.ts` 内部必须 `await import('fflate')`，不得在模块顶层静态 import；确保构建产物把 ZIP 库拆成按需 chunk。
- 不向 ServiceRegistry 注册单例；由 `boardComposition` 构造并赋给 `sdk.projectFile`（`@internal`）。

### 5.3 BoardSDK / 胶水层

```ts
exportProject(opts?: IProjectExportOptions): Promise<IProjectExportResult>;
importProject(file: Blob, opts?: IProjectImportOptions): Promise<IProjectImportResult>;
```

- `BoardSDK` 只做门面委托；`projectFile` 加入 `BoardPublicApi` 的 Omit 列表（实现字段不公开），并在 `dispose()` 中 `projectFile?.dispose()`。
- `spinthCommands` 增加同名薄转发；board 未绑定时返回 `null`（沿用现有命令的空操作语义）。
- `SPINTH_VERSION` 移到 `packages/core/src/version.ts` 单一源，`index.ts` re-export，避免项目模块 import `index.ts` 形成环。
- 不新增 zustand 状态：导出/导入的 busy/error 是组件本地状态。

### 5.4 文档快照写入

在 `dbProvider.ts` 增加（不是新开一套 schema）：

```ts
export async function createDocFromSnapshot(
  docId: string,
  update: Uint8Array,
  opts?: { now?: number },
): Promise<void>;
```

行为：

1. 校验 docId：`/^[A-Za-z0-9_-]{1,128}$/`。
2. 以 `indexedDB.open('spinth-doc:' + docId, 1)` 打开；用 `onupgradeneeded` 标记是否为新建。
   - 已存在（未触发 upgrade）→ 关闭并抛 `DOC_EXISTS`；导入层换 id 重试。
3. 单事务写两个 store：
   - `updates`：一条全量 update；
   - `allupdates`：`{ u: update, t: now ?? Date.now() }`。
4. 事务完成才 resolve，随后关闭 DB；失败时若本次新建则 best-effort `deleteDatabase`，再抛错。
5. 不创建 `DbProvider` 实例、不挂监听、不触发 compaction。

导入层把 `DOC_EXISTS` 映射为重试换 id；其他写入错误映射为 `PROJECT_STORAGE_WRITE_FAILED`（`details.phase='document'`）。

为什么不用 `DbProvider.attach`：它会挂监听/写缓冲/compaction，且语义是“打开已有文档”；导入是“一次性创建新文档”，需要最小、原子、可回滚的写入面。

### 5.5 导航前收口

`DataEngineService` 增加薄方法：

```ts
flushLocalWrites(): Promise<void> {
  return this.db.flushPendingWrites();
}
```

`ProjectFileService` 在创建新文档成功后调用注入的 `flushCurrentDoc`，best-effort 等待当前文档写缓冲落盘（建议最多等 2s）；若抛错或 flush 后 `persistState === 'failed'`，记 warning `CURRENT_DOC_FLUSH_FAILED`，不阻塞导入结果。这样导航到新画布时，当前文档的未落盘窗口最小。

## 6. 导出流程

前置：`docState === 'synced'`、服务未 dispose。

1. `signal` 检查；取 `yDoc` / `yWidgets` / `docId` 快照。
2. `documentBytes = Y.encodeStateAsUpdate(yDoc)`（同步，得到一个一致的时间点）。
3. `assetIds = collectLiveAssetRefs(yWidgets)`，排序。
   - 只处理 `IMAGE.src` 以 `spinth-asset:` 开头者；同 id 去重。
   - 统计 `http(s):` 与 `data:` 图片数量，生成 warning。
4. 逐个 `assetStore.get(id)`：
   - miss → `PROJECT_ASSET_MISSING`（列出 id）；
   - 读 `arrayBuffer`；重新计算 SHA-256，必须等于 id，否则 `PROJECT_ASSET_INVALID`；
   - MIME 非 `image/*`（空归一 `image/png`）→ `PROJECT_ASSET_INVALID`——不得产出导入侧会拒收的文件；
   - 大小超限 → `PROJECT_ASSET_LIMIT`；累计超限 → `PROJECT_ARCHIVE_LIMIT`。
5. 构建 manifest：document 字节数/哈希、assets 的 id/path/mime/size、createdAt（注入 clock）、generator、sourceDocId（超 128 字符截断、空回退占位值——保证产物可被导入侧解析）。
6. 生成 ZIP（异步 `fflate.zip`）：manifest 第一、document 次之、assets 按 id；图片 level 0。
7. 返回 Blob + fileName + manifest + stats + warnings。

约束：

- 不写 Yjs、不调用 `transact`、不产生 undo。
- 快照后用户继续编辑不影响本次导出文件；资产内容寻址不可变，读到的字节可安全打包。
- 空画布允许导出（`assets=[]`），结果带 `EMPTY_PROJECT` warning；UI 不禁用导出。
- 打包后必须校验 `zipBytes.length <= limits.archiveBytes`；超限返回 `PROJECT_ARCHIVE_LIMIT`，不得产出导入侧会拒收的文件。
- 导出不弹“另存为”对话框；由 app 壳用 Blob URL + `<a download>` 触发浏览器下载。

## 7. 导入流程

### 7.1 不变量

**所有校验通过之前，不写资产、不写文档库、不触碰当前 Y.Doc。**
当前画布的唯一影响是导入成功后的“导航前 flush”。

### 7.2 步骤

1. 检查文件大小（压缩包）≤ `MAX_ARCHIVE_BYTES`；读 `arrayBuffer`。
2. 解包并做条目级校验（§11）：
   - 条目名路径安全；已知条目去重；条目数/单条/总解压大小上限；
   - 未知条目忽略 + warning；不得解压到文件系统。
3. 取 `manifest.json` → 先读原始 `format`/`version` 做版本判定（`format` 匹配且 `version > 1` → `PROJECT_VERSION_UNSUPPORTED`），再走 `ProjectManifestSchema` 解析；避免把“版本过新”误报成普通损坏。
4. 校验 manifest 与压缩包一致：
   - 每个 manifest asset 条目存在；实际字节数/哈希匹配；MIME 合法；
   - document 条目存在；字节数/哈希匹配；
   - manifest 内 id/path 不重复。
5. 在临时 `Y.Doc` 上 `Y.applyUpdate(documentBytes)`；校验顶层 `widgets`（若存在必须是 `Y.Array`）。
6. `refs = collectLiveAssetRefs(tempDoc.getArray('widgets'))`：
   - 每个 ref 必须在 manifest assets 中；缺失 → `PROJECT_ASSET_MISSING`（列出 id）；
   - manifest 中未被引用的资产：校验通过但不写入，记 `UNREFERENCED_ASSETS_IGNORED` warning；
   - 临时文档中的外链/dataURL 图片：记 warning，不 fetch。
7. 生成新 docId（默认 `crypto.randomUUID().slice(0, 8)`；最多重试 5 次；冲突 → `PROJECT_DOC_ID_COLLISION`）。
8. 写资产：对每个**被引用**的资产调用 `assetStore.put(new Blob([bytes], { type: mime }))`，校验返回 id 与 manifest id 一致。
   - 失败 → `PROJECT_STORAGE_WRITE_FAILED`，`details.phase='assets'`；已写资产内容寻址、无害，交给现有 GC。
9. 写新文档：`createDoc(newDocId, documentBytes)`。
   - `DOC_EXISTS` → 回到步骤 7 换 id；
   - 其他失败 → `PROJECT_STORAGE_WRITE_FAILED`，`details.phase='document'`；新库由写入函数 best-effort 清理。
10. `flushCurrentDoc?.()`（best-effort），失败加 warning。
11. 返回 `{ docId, sourceDocId, stats, warnings }`。

### 7.3 导航与打开

- UI 成功后 `window.location.assign('/?doc=' + encodeURIComponent(result.docId))`。
- 新页面按现有启动链路打开新文档：`DbProvider.attach` 读到一条全量 update → DataEngine 建模 → 渲染。
- 导入文档的 undo 栈为空（符合预期）；资产由全局 AssetStore 共享。
- 导入两次同一文件 = 两个新画布；资产因内容寻址只存一份。
- 导入不修改 `sourceDocId` 对应的原文档，即使它就在本机。

## 8. 持久化与文档身份

- 新文档库名：`spinth-doc:<newDocId>`；与现有 `DbProvider` 完全同构。
- 写入一条全量 update + 一条审计记录；后续打开时 compaction/恢复路径无需特殊分支。
- 不把原文档的 Yjs clientID/guid 当成本地身份；`Y.Doc({ guid: newDocId })` 由启动链路创建。
- `sourceDocId` 只出现在 manifest/结果里，不用于数据库名、URL 或权限判断。
- 新 docId 生成必须使用 `crypto.randomUUID`（或 `crypto.getRandomValues`）；若不可用，导入失败而不是退回弱随机。
- 导入期间现有资产 GC 可能运行：新写资产 `t=Date.now()` 晚于会话启动基线，现有 `deleteIfOlderThan` 不会删；新文档在 GC 的 `indexedDB.databases()` 列表里也能被扫描到。无需改 GC。

## 9. UI / UX

### 9.1 入口

- 顶栏新增“项目”菜单按钮（app 壳，`packages/app/src/ProjectMenu.tsx`），位于保存状态/链接/新建之后、主题按钮之前。
- 菜单项：
  1. 导出项目（`.spinth.zip`）
  2. 导入项目…
- 后续“存储状态/备份”可复用同一菜单，不在本期实现。
- 隐藏 `<input type="file" accept=".zip,.spinth.zip,application/zip">` 由“导入项目”触发；`data-spinth-project-import` 供 E2E 定位。
- `IconName` 增加 `download` / `upload` / `more`（lucide 已有同义图标），仍只通过 `Icon` 语义名使用。

### 9.2 状态

- `docState !== 'synced'` 时按钮 disabled；初始化失败时 disabled。
- 导出中：菜单项禁用 + “正在导出…”；导入中：“正在导入…”。
- 成功导出：触发下载；`warnings` 为空时关闭菜单，非空时保持菜单并展示提示（如外链图片未打包）。不写任何 store。
- 成功导入：先展示 `warnings`（如有），用户确认后关闭菜单并导航到新 docId；无 warning 直接导航。
- 导出/导入返回的 warning 不得静默丢弃；外链图片、未知条目、未引用资产等提示必须在菜单内可见。
- 失败：菜单保持打开，`role="alert"` 显示 §10 的中文提示；允许重试/关闭。
- 只读态：导出可用；导入也可用（创建新画布，不改当前文档）。若产品要求只读态禁止导入，需在评审中明确，不能由实现自行决定。
- 不使用 `alert()/confirm()`；不做覆盖确认（因为永远新建）。

### 9.3 可访问性

- 按钮：`aria-label="项目"`、`aria-haspopup="menu"`、`aria-expanded`。
- 面板：`role="menu"`；项 `role="menuitem"`；Escape 关闭并把焦点还给按钮；点击外部关闭。
- 忙碌时 `aria-busy="true"`；错误 `role="alert"`。
- 键盘可达；不使用仅 hover 的交互。

### 9.4 390px

- 按钮 32×32；面板 `fixed`，右对齐，宽 `min(320px, calc(100vw - 16px))`，顶部在顶栏下方。
- 不改变顶栏高度、不让 docId/保存状态换行；面板不挤压工具坞。
- 菜单按钮不放在 docId 胶囊内；顶栏右侧顺序固定为：保存状态 → 链接 → 新建 → 项目 → 主题（实现可按现有间距微调，但不得新增换行）。

## 10. 错误模型与提示

`ProjectFileError` 由 core 抛出；app 只消费 `code`，不解析 message。建议映射：

| code                           | 用户提示（示例）                     | 处理               |
| ------------------------------ | ------------------------------------ | ------------------ |
| `PROJECT_NOT_READY`            | 画布尚未就绪，请稍后重试             | 禁用/重试          |
| `PROJECT_ABORTED`              | （不提示）                           | 静默               |
| `PROJECT_CRYPTO_UNAVAILABLE`   | 浏览器不支持安全校验，无法导出/导入  | 提示换浏览器/HTTPS |
| `PROJECT_ARCHIVE_INVALID`      | 项目文件已损坏或不是 spinth 项目     | 重选文件           |
| `PROJECT_ARCHIVE_LIMIT`        | 项目文件超过大小限制                 | 提示上限           |
| `PROJECT_MANIFEST_INVALID`     | 项目文件清单无效                     | 重选文件           |
| `PROJECT_VERSION_UNSUPPORTED`  | 项目文件版本过新，请升级 spinth      | 提示升级           |
| `PROJECT_DOCUMENT_INVALID`     | 项目文档数据损坏，无法导入           | 重选文件           |
| `PROJECT_DOCUMENT_LIMIT`       | 项目文档超过大小限制                 | 提示上限           |
| `PROJECT_ASSET_MISSING`        | 项目缺少 N 张图片资产，导入已取消    | 列出/计数          |
| `PROJECT_ASSET_INVALID`        | 项目图片校验失败，导入已取消         | 重选文件           |
| `PROJECT_ASSET_LIMIT`          | 项目图片超过大小限制                 | 提示上限           |
| `PROJECT_DOC_ID_COLLISION`     | 无法创建新画布，请重试               | 重试               |
| `PROJECT_STORAGE_WRITE_FAILED` | 本地存储空间不足或不可用，导入未完成 | 清理空间/重试      |

- 导出侧资产缺失/损坏：提示“有图片资产缺失或损坏，无法完整导出；请删除坏图后重试”。
- 当前文档 flush 失败：不阻断导入，但在菜单内提示“项目已导入；当前画布保存未完成，请确认保存后再关闭页面”（warning，不是 error）。
- 所有错误详情 `console.error` 记录，UI 不显示堆栈/二进制内容。

## 11. 安全与限额

### 11.1 限额（默认值，集中常量化；测试可注入更小值）

| 限制           | 默认值   |
| -------------- | -------- |
| 压缩包文件     | 160 MiB  |
| manifest.json  | 1 MiB    |
| document.yjs   | 64 MiB   |
| 单个资产       | 25 MiB   |
| 资产总字节     | 128 MiB  |
| 资产条目数     | 256      |
| ZIP 总解压字节 | 200 MiB  |
| ZIP 条目总数   | 512      |
| sourceDocId    | 128 字符 |
| MIME           | 128 字符 |

超限必须 fail-fast，错误码区分 archive/asset/document。

```ts
export interface ProjectFileLimits {
  archiveBytes: number;
  manifestBytes: number;
  documentBytes: number;
  assetBytes: number;
  totalAssetBytes: number;
  totalUncompressedBytes: number;
  assetCount: number;
  entryCount: number;
}

export const DEFAULT_PROJECT_FILE_LIMITS: ProjectFileLimits = {
  archiveBytes: 160 * 1024 * 1024,
  manifestBytes: 1 * 1024 * 1024,
  documentBytes: 64 * 1024 * 1024,
  assetBytes: 25 * 1024 * 1024,
  totalAssetBytes: 128 * 1024 * 1024,
  totalUncompressedBytes: 200 * 1024 * 1024,
  assetCount: 256,
  entryCount: 512,
};
```

### 11.2 ZIP 安全

- 不把条目写到文件系统；仍必须做路径校验：拒绝含 `..`、反斜杠、NUL、绝对路径、盘符的条目。
- 只接受精确的 `manifest.json`、`document.yjs`、`assets/<64-hex>`；未知条目忽略并 warning。
- 已知条目重复（同名）→ `PROJECT_ARCHIVE_INVALID`。
- 使用 fflate 的过滤/流式能力按 **解压后大小** 校验，避免 zip bomb；不能只看压缩包大小。
- 条目总数、单条大小、总解压大小任一超限即中止。
- ZIP64 不在 v1 必需范围；限额远低于 4 GiB。

### 11.3 内容安全

- SHA-256 由 `crypto.subtle` 计算；不可用则失败，不做无校验导入。
- MIME 仅 `image/*`；图片只经 `<img>`/PIXI 纹理渲染，不插入 HTML。
- 不执行/不解析项目内任何脚本、HTML、SVG 脚本；SVG 作为图片解码时的浏览器安全边界由浏览器保证。
- 导入校验期间不发起任何网络请求；`http(s):` 图片只作为字符串保留。
- 导入文本走现有富文本/文本引擎，不新增 `innerHTML` 路径。
- unknown widget 类型由 DataEngine 隔离，不阻塞其余文档。

## 12. 兼容与版本

- v1 导出/导入一一对应；不能读取 v0（不存在）。
- 未来 v2：新增必需字段/文件或改变语义时，`version` 加一；导入方对 `version > 1` 给出明确升级提示，绝不“尽力解析”。
- 对 `version === 1` 的未知 manifest 字段：忽略；未知 ZIP 条目：忽略 + warning。
- widget schema 演进继续走现有 Model `initializeY` 的补默认/隔离机制；项目文件层不重复实现。
- 协同：未来跨设备资产传输应作为独立 provider/包接入，不改变本项目文件格式的本地语义。

## 13. 测试计划

### 13.1 纯逻辑 / 单测（core，vitest）

| 文件                                | 必测                                                                                                                               |
| ----------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| `projectManifest.test.ts`           | 合法解析；format/version/字段缺失；坏 hash/path；重复 id/path；未知字段忽略；createdAt 非法                                        |
| `projectArchive.test.ts`            | 打包→解包 round-trip；坏 ZIP；缺 manifest/document；重复条目；路径穿越；未知条目 warning；单条/总量/条目数限额                     |
| `projectAssetRefs.test.ts`          | 只收集 IMAGE 的 `spinth-asset:`；去重；data/http/非 IMAGE 忽略；外链计数                                                           |
| `projectExport.test.ts`             | shape/text/image 文档；manifest/资产字节；stats；空画布；缺资产/坏哈希/超限/abort；文件名安全化；无 Yjs 写                         |
| `projectImport.test.ts`             | 合法导入写资产+新文档；缺资产/坏哈希/坏文档/版本/超限；全部失败路径零写入；未引用资产 warning；重复导入不同 docId；DOC_EXISTS 重试 |
| `projectFileService.test.ts`        | not ready/disposed；依赖注入；flush 失败 warning；异常映射                                                                         |
| `dbProvider.importSnapshot.test.ts` | 新库一 update + 一审计；`DbProvider.attach` 能恢复；已存在库拒绝；事务失败清理                                                     |
| `projectRoundTrip.test.ts`          | 真实 Y.Doc + fake-indexeddb AssetStore：导出→导入→打开，widget 数据/资产字节一致；Yjs 内无 base64                                  |

要求：

- 每个 §5.1 错误码至少一个用例。
- 限额测试注入小限额（如 1 KiB），不生成 25 MiB 夹具。
- 测试文件尽量 < 400 行；大矩阵按 manifest/archive/import 拆分。
- 新增纯逻辑模块分支覆盖目标 ≥ 90%（coverage 报告人工核对；不强制改全局阈值）。
- 单测不依赖真实网络、真实计时器、真实浏览器下载。

### 13.2 集成 / 编排

- `createDocFromSnapshot` 与 `DbProvider.attach` 的真实 IDB 链路（fake-indexeddb）。
- 资产写入使用真实 `AssetStore`（fake-indexeddb + Node `crypto.subtle`）。
- 失败注入：`createDoc` 抛错、`assetStore.put` 抛错、事务 abort；断言当前 Y.Doc 未被修改、无新文档库。

### 13.3 E2E（Playwright，`packages/app/e2e/projectFile.spec.ts`）

1. **round-trip（含图片）**：新建 shape/text/sticky + 粘贴唯一 PNG → 等待 saved → 菜单导出（download 事件）→ 记录文件名/路径 → 新文档页导入（`setInputFiles`）→ 等 URL 变化/synced → 断言 `modelCount`、类型、图片 `hasSprite` → reload 后仍恢复 → 资产库存在该 hash。
2. **原文档不受影响**：导入后回到原 doc URL，断言原内容仍在。
3. **导入失败**：坏 ZIP/版本过新/缺资产/坏 hash；错误文案可见；URL 不变；原 `modelCount` 不变；`indexedDB.databases()` 无新增 `spinth-doc:`（API 可用时）。
4. **当前文档落盘**：编辑→立即导入→回到原 doc，编辑内容仍在（验证 flush/导航收口）。
5. **只读**：`__spinth.updateEditable(false)` 后导出仍可用；导入创建新画布成功（只读态允许导入，见 §16 D6）。
6. **390px**：菜单面板完全在视口内；导出/导入项可点；顶栏不换行（断言高度 44px）。
7. **无网络**：导入期间监听外部 request，断言 0 次；导出同理。
8. **视觉**：顶栏不在现有 visual clip（y=44 起）内，不新增快照；若实现改了画布视觉则必须说明并重录，禁止假绿。

E2E 卫生：每例结束清理 `spinth-doc:<id>`；使用 `window.__spinth.__debug` 探针；坐标从世界坐标反推；不手写屏幕数字。

### 13.4 手工验收

- 用系统解压工具（`unzip -l`）检查 ZIP 结构；manifest 可读；document/assets 哈希正确。
- 在**全新浏览器 profile**（无 IndexedDB）导入含图片文件；断网后仍能打开。
- 清站点数据前导出、清空后导入，确认恢复。
- 故意改坏 manifest 版本/资产字节，确认错误提示且原画布无变化。
- 390px 真机/模拟器检查菜单与顶栏。

## 14. 验收标准

以下全部满足才可验收：

- [x] A1 `pnpm verify` 退出码 0（lint/prettier/typecheck/单测/build）。
- [x] A2 新 E2E 全绿；既有 spec 不回归；visual 4/4；图片/资产 6/6。
- [x] A3 round-trip 覆盖 SHAPE/TEXT/STICKY/IMAGE/LINE/MIND_MAP；图片 reload 后 `hasSprite=true`；资产字节/hash 一致。
- [x] A4 新图片资产写入 Yjs 时 `src` 是 `spinth-asset:`，不是 base64；导出包内是原始二进制。旧式 `data:` 图片只原样留在 Yjs 中并给出 warning，不得被二次 base64 打包。
- [x] A5 ZIP 结构严格符合 §4；标准工具可解包；manifest 字段/哈希正确。
- [x] A6 导入总是创建新 docId；原文档仍可打开且内容不变。
- [x] A7 坏 ZIP/坏版本/缺资产/坏 hash/超限/存储失败六类错误均有用户提示，且当前画布/原文档库无变化、无新文档库。
- [x] A8 导出/导入期间无外部网络请求。
- [x] A9 390px 菜单不溢出、不换行；键盘/Escape/焦点可用。
- [x] A10 只读态可导出；导入语义符合 §9.2。
- [x] A11 编辑后立即导入，原文档编辑不丢（flush 生效）。
- [x] A12 导入文档刷新后仍完整（IndexedDB 恢复）。
- [x] A13 fflate 只在动态 chunk；首屏同步 bundle 不引入 ZIP 库。
- [x] A14 `docs/20` 与实现一致；`docs/02/12/13/15/19` 同步；测试数字为实测。
- [x] A15 core 无 React/zustand；项目模块无 PIXI；无全局单例；新增文件 < 400 行；无新增 `any`。
- [x] A16 ZIP 路径穿越/重复条目/zip bomb/哈希伪造测试通过。
- [x] A17 导出 3×5MB 素材时 UI 不冻结（异步 zip）：证据 = core 侧可复现计时
      （`projectExport.test.ts` 3×5MB 用例）+ fflate 仅在动态 chunk 异步执行、
      主线程只做快照与哈希。
- [x] A18 实施方提供样例 `.spinth.zip` 与验收命令输出（`SPINTH_SAMPLE_OUT=<路径>`
      环境变量驱动，命令见 `projectRoundTrip.test.ts` 文件头注）。

## 15. 审查清单（代码评审时逐项核对）

- [ ] 设计边界：只改 core 数据/平台层 + app 壳；没有动 dataEngine/vmEngine 的核心分发逻辑（除 §5.4/§5.5 的明确小改）。
- [ ] 类型先行：zod schema 在 `types/projectFile.ts`；导入边界全部运行时校验；没有把 manifest 字段直接当可信类型。
- [ ] 数据流：导出只读 Y.Doc；导入只写临时 Y.Doc + 新库；没有直接改 VM/PIXI；没有把 base64 写回 Yjs。
- [ ] DI：`ProjectFileService` 构造注入；没有全局单例/隐式 import 副作用；`boardComposition` 装配清晰。
- [ ] 持久化：`createDocFromSnapshot` 单事务、新库检测、失败清理；没有复用 `DbProvider` 实例导致监听/compaction 副作用。
- [ ] 失败路径：校验先于写入；每个 await 有错误映射；没有吞异常；导航只在成功后。
- [ ] 安全：路径穿越、重复条目、解压后大小、哈希、MIME、无网络逐项有测试。
- [ ] UI：菜单可访问性、busy/error、Escape/焦点、390px、只读；没有把核心错误 message 直接展示。
- [ ] 性能：zip 异步；资产内存上限；没有在主线程做超大同步压缩。
- [ ] 测试质量：断言数据而非只断言“无报错”；失败用例真的失败；E2E 不靠未跟踪 actuals；清理 doc 库。
- [ ] 文档：§4 格式与代码一致；版本常量单一源；路线图/测试清单/资产文档同步；无过期数字。
- [ ] 构建：fflate 动态 chunk；没有新增启动网络/依赖服务端。

## 16. 决策

| ID  | 决策          | 结论                                 | 说明                               |
| --- | ------------- | ------------------------------------ | ---------------------------------- |
| D1  | ZIP 依赖      | `.spinth.zip` + `fflate`             | 动态 import；不新增其他 ZIP 依赖   |
| D2  | 导入身份      | 每次导入新建 docId                   | 不覆盖、不合并                     |
| D3  | 外链图片      | 保留 URL + warning，不下载           | 不进入资产包；导入校验期间零网络   |
| D4  | 未知 ZIP 条目 | 忽略 + warning，计入限额             | 不解压未知条目                     |
| D5  | 文件命名      | `spinth-<docId>-<时间戳>.spinth.zip` | 时间戳格式由实现定，E2E 用正则断言 |
| D6  | 只读态导入    | 允许（新建画布）                     | 不修改当前文档                     |

以上为当前决策；变更先改本文。
