# 连线锚定端相邻段禁拖（近形禁拖）

## 0. 结论摘要

拖动连线贴着图形的那段（锚定端相邻的首/末段，通常是短 stub 段）时，线在锚点处
变成斜线。根因是段滑移的旧规则「首末段两档：长段（≥30）拆几字形保正交；短段
（<30）斜连退化（锚点保持 + 拐点平移求交）」——贴图形的走廊 stub 段恒短，
拖它必在锚点处产出斜段。用户拍板反转：**去掉该规则，靠近图形就不让拖拽**
（范围已确认：只禁线身拖拽；端点圆点自身的拖拽——换边重锚定/拖离解绑——保留）。

## 1. 决策记录

- 2026-09-30 拍板「首末段两档」（长段几字/短段斜连）→ 2026-11 用户实测反转：
  近形段拖拽整体禁用（长段几字形分支也不再可达于锚定侧——「靠近图形不让
  拖拽」是全量口径）；
- 自由端（悬空端）相邻段照常可拖：斜连/几字两档数学保留，仅服务于自由端侧
  （悬空线仍可整理形状）；
- 端点拖拽（12px 热区）不属「线身拖拽」，保留全部能力（lineEndpoint E2E 不动）。

## 2. 实施（segmentBodyGrabbable 单源）

- `lineHandles.ts`：新纯函数 `segmentBodyGrabbable(anchored, segIndex, segCount)`
  ——段 0 且 start 锚定 / 末段且 end 锚定 / 唯一段任一端锚定 → 不可抓；
  `capsuleAnchors` 加可选 `anchored` 参数（fallback 决策后过滤，缺省不过滤
  = 纯数学口径兼容既有单测）；
- `lineSegTextSlide.ts` `maybeSegmentSlideGrab`：segIndex 定出后读模型
  `startNodeId/endNodeId`（`toJSON?.()` 防御桩/极端时序），胶囊与线身两路共用
  门控；拒绝返回 false → 手势交还 selector → 线整体拖拽本就是空操作 = 按下
  无响应；
- `lineHoverMath.ts` `resolveLineHover` 加可选 `anchored`：锚定相邻段不设
  hoverSegIndex/segmentActive、不出 ns/ew-resize 光标（防「光标说可拖但按下
  无反应」）；
- `lineHoverOverlay.ts`（onCursorHover/showSegmentHandles）与
  `lineSegmentHandles.ts`（show）从 `vm.state.startNodeId/endNodeId` 取锚定
  标记下传——胶囊不渲染、快照不含、hover 不亮三处同源；
- `slideSegment` 数学本体不动（锚定侧经手势不可达；斜连/几字分支保留给自由
  端侧），仅更新注释与 docs/08 §10.3 规格。

## 3. 测试

- 单测 `lineHandles.test.ts` 新增 describe（3 例）：segmentBodyGrabbable
  真值表（锚定侧首末拒/中段恒可/自由端侧放行）、唯一段（任一端锚定拒/全自由
  放行）、capsuleAnchors anchored 过滤与缺省兼容；
- 单测 `lineHoverMath.test.ts`（2026-11 审查返工补，5 例）：端点 grab/段身
  方向光标/锚定相邻段无反馈/**过滤后索引空间回归锁**（长首末段被过滤时 hover
  中段 segmentActive = 过滤数组首位——`resolveLineHover` 的 capsuleAnchors
  findIndex 必须带 anchored 与渲染同数组，否则高亮错位）；
- E2E `lineSelect.spec.ts`：hover 用例段数断言与光标段号换算改为「主段剔除
  首末」口径，并新增 hover 首段无高亮无拖向光标断言；批次 3.7 用例改写为
  「首末段禁拖」——段条快照不含首末段（距首/末段中点 >24px，含非空守卫
  防过滤吃掉全部胶囊后循环空跑假绿）、按首段中点拖 40 零位移零写（pinned
  维持、undo 深度不动一步回退中段滑移）；中段滑移用例（拖最长非首末段）
  不受影响原样通过；
- E2E `lineText.spec.ts` 双胶囊用例同步口径（2026-11 审查返工）：拖左胶囊
  重塑折线后另一侧胶囊弧长中点落到锚定末段 → 双胶囊退单胶囊（§4 声明的
  有意边界），补「剩余胶囊距首/末段中点 >24px」位置断言。

## 4. 边界

- STRAIGHT 线本就无段语义（`maybeSegmentSlideGrab` 早退），其「拖拽变斜」
  只可能来自端点拖离解绑——属保留能力；
- 有字双胶囊若恰在首末段（短线），随门控一并消失——该线仍可拖自由端侧段
  与文字滑移。
