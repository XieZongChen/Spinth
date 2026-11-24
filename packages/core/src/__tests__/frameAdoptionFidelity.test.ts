import { describe, expect, it } from 'vitest';
import { makeFrameEnv } from './helpers/frameFidelityEnv';

describe('创建即归属的作用域（真 Yjs + 真 HistoryService）', () => {
  it('工具创建（事务外 add）：框内新件归属、框外不归属', () => {
    const h = makeFrameEnv();
    h.addFrame('f1', 0, 0, 300, 300);
    h.addShape('in', 10, 10);
    h.addShape('out', 500, 500);
    expect(h.dataOf('in').parentId).toBe('f1');
    expect('parentId' in h.dataOf('out')).toBe(false);
    h.dispose();
  });

  it('粘贴批（engine.transact 内连发 add）：已有父的框外子保持父——审查三轮 P2 红探针', () => {
    const h = makeFrameEnv();
    h.addFrame('f1', 0, 0, 300, 300);
    h.addShape('c1', 10, 10); // 归属 f1
    expect(h.dataOf('c1').parentId).toBe('f1');
    // 缩小容器使子元素完全在框外（缩放不重判归属——框外子只可能由此产生）
    h.engine.getModelById('f1')!.updateRect({ x: 200, width: 100 }); // f1: 200..300
    expect(h.dataOf('c1').parentId).toBe('f1'); // 滞回：缩放路径不动归属
    // 「复制 f1+c1 → 粘贴」：桶映射已给副本父 f2；副本子同在 f2 框外
    h.engine.transact(() => {
      h.addFrame('f2', 500, 0, 100, 300); // f2: 500..600
      h.addShape('c2', 310, 10, { parentId: 'f2' }); // 310..360：不在任何容器内
    });
    expect(h.dataOf('c2').parentId).toBe('f2'); // 曾被 rule 3 清成 undefined（副本与原件分叉）
    h.dispose();
  });

  it('裸批量（engine.transact 内 add）不触发创建归属：无父件落进容器也不被收养', () => {
    // FrameService 的批量守卫只管「创建事件不重判」。粘贴副本的归属另有入口——
    // ClipboardService 在粘贴批收尾后显式调落点判定（clipboardLanding.test）
    const h = makeFrameEnv();
    h.addFrame('f1', 0, 0, 300, 300);
    h.engine.transact(() => h.addShape('p1', 10, 10)); // 无父、几何在 f1 内
    expect('parentId' in h.dataOf('p1')).toBe(false); // 创建事件路径不收养
    // 标记不粘连：批量收尾后，工具创建照常归属
    h.addShape('in2', 10, 10);
    expect(h.dataOf('in2').parentId).toBe('f1');
    h.dispose();
  });

  it('undo 恢复：已有父子保持父（删容器 → undo），且恢复不产生幻影撤销项', () => {
    const h = makeFrameEnv();
    h.addFrame('f1', 0, 0, 300, 300);
    h.addShape('c1', 10, 10);
    h.history.stopCapturing();
    h.engine.getModelById('f1')!.updateRect({ x: 200, width: 100 });
    h.history.stopCapturing();
    h.engine.removeByIds(['f1', 'c1']);
    h.history.stopCapturing();

    h.history.undo(); // 恢复删除：f1 + c1 回来
    expect(h.dataOf('f1').x).toBe(200); // 仍是缩小后的几何（只回退了删除）
    expect(h.dataOf('c1').parentId).toBe('f1'); // 曾被清成 undefined

    h.history.undo(); // 回退缩放——若恢复时偷写过归属，这一步会先吃掉那笔
    expect(h.dataOf('f1').x).toBe(0);
    expect(h.dataOf('f1').width).toBe(300);
    h.dispose();
  });

  it('undo 恢复：无父件不被收养——先画形状后画容器（建容器不收养），删形状 undo 后仍是顶层', () => {
    const h = makeFrameEnv();
    h.addShape('s1', 10, 10); // 此时无容器
    h.addFrame('f1', 0, 0, 300, 300); // 包住 s1——建容器不收养既有元素
    expect('parentId' in h.dataOf('s1')).toBe(false);
    h.history.stopCapturing();
    h.engine.removeByIds(['s1']);
    h.history.stopCapturing();

    h.history.undo();
    expect('parentId' in h.dataOf('s1')).toBe(false); // 曾被收养进 f1
    h.dispose();
  });

  it('redo 重放粘贴批同样不重判', () => {
    const h = makeFrameEnv();
    h.engine.transact(() => {
      h.addFrame('f2', 500, 0, 100, 300);
      h.addShape('c2', 310, 10, { parentId: 'f2' });
    });
    h.history.stopCapturing();
    h.history.undo(); // 撤销粘贴：f2 + c2 移除
    expect(h.engine.getModelById('c2')).toBeUndefined();
    h.history.redo(); // 重放：观察者相重建模型
    expect(h.dataOf('c2').parentId).toBe('f2');
    h.dispose();
  });
});
