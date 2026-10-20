/**
 * 按需渲染调度（规格见 docs/03 §3）。
 *
 * 全局脏计数：任何视觉变化尾部调用 markRender()；
 * BoardApplication 的 rAF 循环比对计数，变了才真正 app.render()——静止时零 GPU 消耗。
 * （既有设计用 @render() 装饰器实现同语义；spinth 遵循「无装饰器魔法」约定改为显式调用。）
 */

let renderId = 0;

export function markRender(): void {
  renderId++;
}

export function getRenderId(): number {
  return renderId;
}
