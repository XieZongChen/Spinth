# 00 — 总览：产品定位与架构铁律

## 1. 产品定位

spinth 是一个**本地优先的白板与思维导图编辑器**。当前版本只做单机：

- 打开即用，不需要账号、服务端或网络；
- 文档、撤销历史和图片资产保存在浏览器本地；
- 刷新可恢复，离线可继续编辑；
- 交互体验聚焦画布编辑本身：无限画布、形状/文本/便签/连线/画笔/图片/脑图。

**非目标（当前版本）**：账号体系、云端同步、多人协同、服务端资产端点。协同只保留
Yjs 文档、origin 纪律和资产 provider 边界，作为未来独立能力接入，不进入默认启动路径。

## 2. 架构铁律

> **所有写操作只写 Yjs；所有渲染只订阅 Yjs；本地操作与未来协同走同一条数据路径。**

```
用户交互 (Service)
   │  Model / DataProcessor
   ▼
Y.Doc ──────────────→ IndexedDB（本地持久化）
   │ observeDeep / onModelCreated$ / onModelRemoved$
   ▼
VmEngine ── ServiceRegistry 工厂 ──→ WidgetVm.setModel()
   │                                  │ yData.observeDeep → setState
   ▼                                  ▼
PIXI 舞台                         diff → render() → markRender()
```

推论：

1. VM 不写 Yjs；Service 不画 PIXI。
2. 「创建一个控件」= 往 Yjs 写一条数据；VM 是数据驱动的衍生物。
3. 拖拽/缩放期间只做视觉预览（root 位置/缩放 + 选区框），**零 Yjs 写入**；
   松手经 Model 写回（docs/05 §4.3/§4.4）。
4. 非用户写入（恢复、迁移、修复、replay）必须带非 null origin，不进 undo 栈。

## 3. 三层分包

| 包            | 职责                                                          | 禁止                   |
| ------------- | ------------------------------------------------------------- | ---------------------- |
| @spinth/core  | SDK：Yjs 数据引擎、PIXI 渲染、控件 Model/Vm/Service、交互逻辑 | import React / zustand |
| @spinth/react | zustand 只读镜像 + DOM UI（工具栏/操作栏/菜单/空态/错误态）   | 直接 import PIXI / Yjs |
| @spinth/app   | Vite + React 应用壳、主题、文档路由、顶栏                     | 越过 react 碰 core     |

依赖方向单向：`app → react → core`。包边界由 `eslint.config.js` 的
`no-restricted-imports` 强制。

## 4. 核心概念速查

| 概念                 | 含义                                                             | 详见       |
| -------------------- | ---------------------------------------------------------------- | ---------- |
| Model / Vm / Service | 控件三件套：数据 / 视图 / 交互                                   | docs/04    |
| cursorMode           | 工具状态机（cursor/hand/shape/sticky/text/pen/line/eraser/mind） | docs/03 §7 |
| zOrder               | fractional indexing 字符串，字典序即渲染序                       | docs/02 §2 |
| rect / YKeyValue     | 几何字段独立存储，分离高频位移与低频属性                         | docs/02 §2 |
| transaction          | Yjs 事务 = 撤销粒度的原子单位                                    | docs/02 §4 |
| 三态文本             | preview（PIXI 纹理）/ edit（DOM 双内核）                         | docs/07    |
| 编辑会话             | EditingService：跨控件编辑互斥 + 双内核 + descriptor 协议        | docs/17    |
| 排版 override        | per-实例 fontSize/textColor/align/lineHeight                     | docs/17 §4 |
| 资产引用             | `spinth-asset:<sha256>`，文档只存短引用                          | docs/19    |
| 按需渲染             | `renderId` 脏计数，静止时零 GPU 消耗                             | docs/03 §3 |

## 5. 单机边界

- 默认启动不传 `wsUrl`，不连接 relay，不读取远端地址，不展示协同状态。
- `y-websocket` 只在显式传入 `wsUrl` 时动态加载；单机产物不把协同栈放进启动主路径。
- 图片资产保存在本机 IndexedDB；跨设备协同需要额外的资产传输层，当前不实现。
- 本地文档是唯一副本，因此项目级导出/导入是数据安全能力，不是可选项。

## 6. 当前范围

已包含：无限画布、视口、按需渲染、空间索引与 culling；形状/文本/便签/连线/画笔/
图片/脑图；多选/编组/对齐/分布/旋转/参考线；富文本、排版、橡皮；undo/redo、
IndexedDB 持久化、本地资产库、移动端工具菜单。

暂不包含：服务端、账号、云端同步、多人协同、服务端资产端点。下一阶段计划见
[docs/13-roadmap.md](13-roadmap.md)。
