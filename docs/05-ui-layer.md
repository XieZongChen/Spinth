# 05 — UI 层

## 1. 单向数据流

```
core 输出流 → bridge → zustand 只读镜像 → React 组件
用户操作   → commands → core
```

- store 没有 reducer/action，只有 bridge 写入。
- 组件禁止直接改 store 业务字段。
- 所有命令集中在 `commands.ts`，组件只调用 `spinthCommands.*`。

## 2. 顶栏

单机模式只展示：

- 文档 id；
- 本地保存状态：`已保存` / `保存中…` / `保存失败 · 点击重试`；
- 复制文档链接、新建画布、主题切换。

不展示“已同步”或任何远端连接状态。

## 3. 工具坞

- 底部居中；移动端允许横向滚动。
- 激活工具显示常驻二级菜单（ToolFlyout）。
- ToolFlyout 通过 portal + fixed 定位，按视口 clamp，避免被滚动容器裁剪。

## 4. 空态与只读

- 空画布显示快捷键引导；建首件即隐。
- 只读态禁用写工具、撤销/重做/删除，保留选择和复制。

## 5. 主题与移动端

- 主题令牌在 `packages/app/src/styles/tokens.css`。
- 顶栏使用 `h-11`，画布 `h-dvh`；390px 下 docId 必须截断，不能挤压状态。
