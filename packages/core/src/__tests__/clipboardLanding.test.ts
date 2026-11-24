import { BehaviorSubject } from 'rxjs';
import { describe, expect, it } from 'vitest';
import { ClipboardService } from '../platform/clipboard/clipboardService';
import { makeFrameEnv } from './helpers/frameFidelityEnv';
import type { IDataEngineService, IFrameLookup, IHistoryService } from '../types';

/**
 * 粘贴落点归属（specs/container-frame §4.7，人类拍板）：真 Y.Doc + 真 DataEngine +
 * 真 HistoryService + 真 ClipboardService + 真 FrameService。锁三件事——无父副本
 * 完全落进容器即归属；带父副本不被改判；粘贴与归属是同一步撤销。ClipboardService
 * 与 FrameService 之间的时序（粘贴批之后另起事务）桩测不出，必须在这层锁。
 */
type Env = ReturnType<typeof makeFrameEnv>;

function makeClipboard(h: Env) {
  const selector = {
    selected$: new BehaviorSubject<string[]>([]),
    setSelected: (ids: string[]): void => selector.selected$.next(ids),
  };
  const viewport = {
    editable$: new BehaviorSubject(true),
    vpBounds$: new BehaviorSubject({ x: 0, y: 0, width: 1000, height: 600 }),
  };
  const clip = new ClipboardService(
    h.engine as unknown as IDataEngineService,
    h.vmEngine,
    selector as never,
    viewport as never,
    h.history as unknown as IHistoryService,
    () => h.svc as unknown as IFrameLookup,
  );
  return { clip, selector };
}

/** 复制选区 → 切断捕获窗 → 粘贴到 target（快照包络左上角落点），返回副本 id */
async function copyPaste(
  h: Env,
  clip: ClipboardService,
  selector: { selected$: BehaviorSubject<string[]> },
  ids: string[],
  target: { x: number; y: number },
): Promise<string[]> {
  selector.selected$.next(ids);
  await clip.copySelected();
  h.history.stopCapturing();
  clip.pasteAt(target);
  h.history.stopCapturing();
  return selector.selected$.value; // 粘贴后选区 = 本批新件
}

describe('粘贴落点归属（真引擎）', () => {
  it('无父副本完全落进容器 → 归属；一步 undo 连同粘贴一并回退；redo 保留归属', async () => {
    const h = makeFrameEnv();
    h.addFrame('f1', 500, 0, 300, 300);
    h.addShape('s1', 10, 10); // 顶层件，建在 f1 之外
    const { clip, selector } = makeClipboard(h);
    const [copy] = await copyPaste(h, clip, selector, ['s1'], { x: 520, y: 20 }); // 520..570
    expect(copy).toBeDefined();
    expect(copy).not.toBe('s1');
    expect(h.dataOf(copy!).parentId).toBe('f1');

    h.history.undo(); // 一步：粘贴批 + 归属写同属一个撤销项
    expect(h.engine.getModelById(copy!)).toBeUndefined();
    h.history.redo();
    expect(h.dataOf(copy!).parentId).toBe('f1');
    h.dispose();
  });

  it('副本跨出容器边界 → 保持顶层', async () => {
    const h = makeFrameEnv();
    h.addFrame('f1', 500, 0, 300, 300);
    h.addShape('s1', 10, 10);
    const { clip, selector } = makeClipboard(h);
    const [copy] = await copyPaste(h, clip, selector, ['s1'], { x: 780, y: 20 }); // 780..830
    expect('parentId' in h.dataOf(copy!)).toBe(false);
    h.dispose();
  });

  it('复制「容器 + 框外子」：副本子的归属由桶映射给足，落点判定不改判', async () => {
    const h = makeFrameEnv();
    h.addFrame('f1', 0, 0, 300, 300);
    h.addShape('c1', 10, 10); // 创建即归属 f1
    h.engine.getModelById('f1')!.updateRect({ x: 200, width: 100 }); // 缩小：c1 成框外子
    expect(h.dataOf('c1').parentId).toBe('f1');
    const { clip, selector } = makeClipboard(h);
    // 包络 (10..300, 0..300) 左上角落 (500, 0)：副本容器 690..790，副本子 500..550
    const [frameCopy, childCopy] = await copyPaste(h, clip, selector, ['f1'], { x: 500, y: 0 });
    expect(h.dataOf(frameCopy!).type).toBe('FRAME');
    expect(h.dataOf(childCopy!).parentId).toBe(frameCopy); // 曾按「完全离开」清成 undefined
    h.dispose();
  });

  it('无父副本落进同批的容器副本内 → 归属该副本容器', async () => {
    const h = makeFrameEnv();
    h.addShape('s1', 520, 20); // 先有形状
    h.addFrame('f1', 500, 0, 300, 300); // 后画容器包住它——不收养既有元素
    expect('parentId' in h.dataOf('s1')).toBe(false);
    const { clip, selector } = makeClipboard(h);
    // 包络 = f1；落点 (600, 100)：容器副本 (600..900, 100..400)，形状副本 (620, 120)
    const newIds = await copyPaste(h, clip, selector, ['f1', 's1'], { x: 600, y: 100 });
    const frameCopy = newIds.find((id) => h.dataOf(id).type === 'FRAME')!;
    const shapeCopy = newIds.find((id) => h.dataOf(id).type === 'SHAPE')!;
    expect(h.dataOf(shapeCopy).parentId).toBe(frameCopy);
    h.dispose();
  });

  it('复制单个子（批外父置空）后粘贴落进容器 → 归属落点处容器', async () => {
    const h = makeFrameEnv();
    h.addFrame('f1', 500, 0, 300, 300);
    h.addFrame('f2', 0, 0, 300, 300);
    h.addShape('c1', 10, 10); // 归属 f2
    const { clip, selector } = makeClipboard(h);
    // 只复制 c1：原父 f2 不在批内 → 副本不带父；落点在 f1 内 → 归属 f1（不是 f2）
    const [copy] = await copyPaste(h, clip, selector, ['c1'], { x: 520, y: 20 });
    expect(h.dataOf(copy!).parentId).toBe('f1');
    h.dispose();
  });

  it('画笔副本不参与落点归属（模型矩形是占位值）', async () => {
    const h = makeFrameEnv();
    h.addFrame('f1', 500, 0, 300, 300);
    h.add({
      id: 'pen1',
      type: 'PEN',
      points: [
        [10, 10],
        [40, 40],
      ],
      color: '#000000',
    });
    const { clip, selector } = makeClipboard(h);
    // 包络取模型矩形 (0,0,100,100)（占位）；落点 (520, 20)
    const [copy] = await copyPaste(h, clip, selector, ['pen1'], { x: 520, y: 20 });
    expect(h.dataOf(copy!).type).toBe('PEN');
    expect('parentId' in h.dataOf(copy!)).toBe(false);
    h.dispose();
  });
});
