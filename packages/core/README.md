# @spinth/core

本地优先的白板与思维导图 SDK（PIXI 8 + Yjs）：渲染 / 数据 / 交互引擎。

- **数据流铁律**：所有写操作只写 Yjs；所有渲染只订阅 Yjs；本地操作与未来协同走同一条路径。
- **控件三件套**：`widgets/<type>/` 各含 Model（zod schema）+ Vm（PIXI）+ Service
  （交互）——规格见 docs/04。
- **平台服务域**：`platform/` 每子目录一个服务域（dataEngine / vmEngine / viewport /
  selector / textEngine 等），组合根（app.ts）显式装配；服务 token 在 tokens.ts，
  控件 token/工厂在 widgetRuntime.ts。
- **统一编辑会话**：`platform/textEngine/editingService`（双内核 descriptor 协议，
  docs/17）服务 TEXT/STICKY/SHAPE/LINE/mind 五类文字编辑。
- **资产层**：`platform/dataEngine/assetStore` 内容寻址存储图片，文档只存
  `spinth-asset:<sha256>`（docs/19）。
- **协作者模式**：宿主 service + 拆出协作类（host 窄回调），先例见 line/mind 目录。

单测：`pnpm test`（仓库根）。完整规格文档见仓库根 `docs/`（00-21，文档即规格）。
