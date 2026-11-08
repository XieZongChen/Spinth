/**
 * 跨层共享的交互阈值常量（屏幕 px）。
 *
 * 防手抖是屏幕手感，阈值必须按屏幕像素定义、使用处每帧现读缩放换算
 * （Batch 1 · 1.8④：世界单位在 0.05x 下 1px 抖动即判拖拽、4x 下迟滞 40px）。
 */

/** 起拖阻尼（docs/05 §4.1）：位移达到此值才算「拖」，低于则视为单击/未起拖。
 *  三处共用同一手感：选中拖拽起拖（selectorDragOps）、框选边缘滚屏判据
 *  （selectorMarquee）、创建工具单击与拖拽画图的分界（dragCreateServiceBase） */
export const DRAG_TRACTION_SCREEN = 10;
