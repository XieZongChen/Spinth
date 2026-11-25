# 图片手柄缩放的比例锁（image-ratio-lock）

## 0. 结论摘要

`IMAGE` 的能力位 `keepRatio: true` 与注释「图片默认锁定比例」早已存在，但
`rectEditorService` / `resizeMath` 没有任何读取点——图片手柄缩放一直是自由缩放。
现让该能力位生效：**普通拖拽保持自由缩放，按住 Shift 拖手柄时按手势起点矩形的
宽高比锁定**。单帧目标矩形统一下沉到 `resizeMath.planResize`（纯函数），服务只接线。

## 1. 根因

- 能力位是「声明了没人读」：`WIDGET_REGISTRY.IMAGE.capabilities.keepRatio` 为 true，
  `imageVm.ts` 头注释写「保持比例由 keepRatio 交给 RectEditor 语义层」，而
  RectEditor 只读 `resizable` / `rotatable`。
- 缩放路径此前没有任何修饰键语义；Shift 在缩放手势里是空位。

## 2. 拍板记录（2026-11-26，人类确认）

- **普通拖拽自由缩放，按住 Shift 锁比例**。备选方案「默认锁定 + Shift 解除」被
  否决——已发布的默认行为不变，不纠正用户已经拉歪的图。
- **比例取手势起点矩形**（`start.width / start.height`）。图片的自然尺寸没有持久化，
  且用户可能有意拉伸过；按当前比例锁是唯一不引入「跳回原比例」的口径。
- **参考线与网格只作用于主轴**（实施中收紧）：非主轴的值反正会被比例派生覆盖，
  若照常吸附它，会出现「画了参考线却没吸上去」的假反馈。

## 3. 实施

### 3.1 数学（`platform/rectEditor/resizeMath.ts`）

- `lockMainDir(start, dir, free)`：比例锁的主轴。边柄 = 自身所在轴；角柄 = 自由
  缩放输出里相对变化量大的一轴（各轴位移除以起点尺寸——大矩形上的小抖动不压过
  小轴的真实拉伸；相等取宽）。返回该轴上被拖的单轴方向。
- `lockAspectRect(start, dir, next, ratio)`：主轴保留输出尺寸，另一轴按 `ratio`
  派生。角柄对侧角锚定不动；边柄对边不动、另一轴保持起点边（上/左）。任一轴不足
  `RESIZE_MIN_SIZE` 时两轴等比放大到都满足（比例优先于指针）。非正 / 非有限
  `ratio` 原样返回。
- `resizeRotatedRect` 增可选尾参 `ratio`：旋转态的比例锁在局部系内完成，对侧锚定
  反解落在锁定后的矩形上。
- `planResize(start, dir, world, theta, ratio, snaps)`：单帧目标矩形的唯一出口。
  旋转态不吸附；θ=0 未锁比例 = 自由缩放后全轴吸附/量化（现状）；θ=0 锁比例 =
  主轴判定 → 把非主轴尺寸还原成起点值、按单轴方向吸附/量化 → 比例收敛。
- `createResizeSnaps(refLine, gridSnapOn)`：吸附/量化的组装（参考线先、网格后，
  命中对齐线的轴不量化），依赖经 thunk 取。

### 3.2 服务（`platform/rectEditor/rectEditorService.ts`）

- `ResizeState.ratio`：`startResize` 按能力位读取（`capabilities.keepRatio === true`，
  与 `resizable` / `rotatable` 同款读法，无类型分支），值 = 起点宽 / 高。
- `onWindowMove` 每帧读 `e.shiftKey`：Shift 且 `ratio` 有值才锁。每帧只看当前修饰键，
  手势中途按下 / 松开即时切换（docs/14 规则 3：无跨帧状态）。
- 文件此前 394 行、贴着 400 行铁律——单帧计算整体下沉到 `resizeMath` 后为 398 行。

### 3.3 文档与注释订正

- docs/05 §4.4 补比例锁；docs/04 §4 能力位补 `keepRatio` 语义。
- `types/widget.ts`（能力位注释、IMAGE / SYMBOL 两处行内注释）、`imageVm.ts` 头注释：
  「图片默认锁定比例」改为当前事实。

## 4. 测试

| 层                                  | 用例                                                                                                                                                                                                   | 修前               |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------ |
| `resizeMath.test.ts`（新）17 例     | 四角柄主轴与对侧角锚定、四边柄、等比幂等、缩小、最小尺寸等比放大、非法 ratio、`resizeRotatedRect` 的 ratio 尾参（θ=0 等价、旋转态比例 + 对侧角世界位不动、不传 ratio 对照）                            | 全红（导出不存在） |
| `rectEditorRatio.test.ts`（新）8 例 | Shift 拖 se 比例保持；比例取自起点矩形；吸附只作用于主轴（断言交给吸附的是单轴方向与非主轴起点尺寸）；非主轴不吸附；不按 Shift 自由；非 keepRatio 按 Shift 也自由；中途按下 / 松开即时切换；旋转态生效 | 同上               |
| `imageResize.spec.ts`（新）1 例     | 拖放 200×100 PNG → Shift 拖 se 得 350×175（比例 2、左上不动）→ undo 一步回 200×100 → 普通拖拽 350×160                                                                                                  | 红（高 160）       |

变异验证：去掉服务里的 Shift 门控，`rectEditorRatio.test.ts` 的 8 条里 6 条锁相关
用例变红，「不按 Shift / 非 keepRatio 自由缩放」两条与既有 `rectEditor.test.ts`
不受影响。

回归（实测通过）：`styleResize.spec`、`rotate.spec`、`rotateAnchor.spec`、
`alignAnchor.spec`、`textEditShape.spec`、`imageCreate.spec` 共 24 例；
`flowchart.spec` F-6a–d 与 `container.spec` C-7（网格吸附缩放、容器缩放——其他
类型缩放不变）。

## 5. 手工验证（不写入 docs）

1. 插入一张图片，普通拖角手柄：可自由拉歪（与之前一致）。
2. 按住 Shift 拖角手柄：宽高比不变，对侧角不动；松开 Shift 继续拖：立即恢复自由。
3. 按住 Shift 拖边手柄：对边不动，另一轴保持上 / 左边。
4. 已拉歪的图按住 Shift 拖：按拉歪后的比例锁，不跳回原比例。
5. 靠近参考线按住 Shift 拖：只有主轴吸附并画线；另一轴不画线。
6. 一次 Shift 拖拽 = 一步撤销。

## 6. 边界

- 移动端无修饰键：图片恒自由缩放（触摸缩放锁比例需要独立入口，未做）。
- 自然尺寸比例不持久化，无法提供「恢复原始比例」。
- 参考线的等间距徽标不参与比例锁（只走 `snapForResize` 的对齐线）。
