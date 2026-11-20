import { BehaviorSubject } from 'rxjs';
import { DragCreateServiceBase } from '../base/dragCreateServiceBase';
import { genId } from '../../utils/id';
import type {
  IActionBarOption,
  IDataEngineService,
  IHistoryService,
  ISelectorService,
  IViewportService,
} from '../../types';
import { SYMBOL_KINDS, type SymbolKind } from './symbolGlyphs.generated';
import {
  SYMBOL_DEFAULT_HEIGHT,
  SYMBOL_DEFAULT_WIDTH,
  SYMBOL_MIN_HEIGHT,
  SYMBOL_MIN_WIDTH,
} from './symbolGeometry';

/**
 * 符号种类选项（specs/symbol-widget §4.1 清单，顺序即分组顺序：
 * 网络设备 → 数据存储 → 文档；icon = @spinth/react Icon 语义名）。
 * 与 SYMBOL_KINDS 的双向覆盖由 symbolGlyphs.test 锁死（加 SVG 忘加选项即红）。
 */
export const SYMBOL_OPTIONS: IActionBarOption[] = [
  { id: 'net-server', label: '服务器', icon: 'symbol-net-server' },
  { id: 'net-router', label: '路由器', icon: 'symbol-net-router' },
  { id: 'net-switch', label: '交换机', icon: 'symbol-net-switch' },
  { id: 'net-firewall', label: '防火墙', icon: 'symbol-net-firewall' },
  { id: 'net-cloud', label: '云', icon: 'symbol-net-cloud' },
  { id: 'net-load-balancer', label: '负载均衡', icon: 'symbol-net-load-balancer' },
  { id: 'net-internet', label: '互联网', icon: 'symbol-net-internet' },
  { id: 'net-user', label: '用户', icon: 'symbol-net-user' },
  { id: 'net-database', label: '数据库', icon: 'symbol-net-database' },
  { id: 'net-storage', label: '存储', icon: 'symbol-net-storage' },
  { id: 'data-queue', label: '队列', icon: 'symbol-data-queue' },
  { id: 'doc-file', label: '文件', icon: 'symbol-doc-file' },
  { id: 'doc-folder', label: '文件夹', icon: 'symbol-doc-folder' },
];

/**
 * 符号工具（specs/symbol-widget §6.1）：DragCreateServiceBase 模板——单击
 * 默认尺寸按下点居中、工具保持可连击；拖拽跟手草稿、松手选中回选择工具；
 * 网格吸附经 bindGridSnap 接线（起止角量化）。创建一次事务写
 * { type:'SYMBOL', symbol: 当前种类, label:'', ...rect }。
 */
export class SymbolService extends DragCreateServiceBase {
  protected readonly scope = 'symbol' as const;
  protected readonly defaultSize = { width: SYMBOL_DEFAULT_WIDTH, height: SYMBOL_DEFAULT_HEIGHT };
  protected override readonly minDraftSize = { width: SYMBOL_MIN_WIDTH, height: SYMBOL_MIN_HEIGHT };

  /** 工具默认种类（会话级，§6.2：不落库不持久化）；档位外取值忽略 */
  private defaultKind: SymbolKind = 'net-server';
  readonly defaultSymbol$ = new BehaviorSubject<SymbolKind>('net-server');

  /** 基类构造是 protected（模板基类不直接实例化）——子类显式公开（ShapeService 同款） */
  constructor(
    viewport: IViewportService,
    engine: IDataEngineService,
    history: IHistoryService,
    selector: ISelectorService,
  ) {
    super(viewport, engine, history, selector);
  }

  get defaultSymbol(): SymbolKind {
    return this.defaultKind;
  }

  setDefaultSymbol(kind: string): void {
    if (!SYMBOL_KINDS.includes(kind as SymbolKind)) return;
    if (kind === this.defaultKind) return;
    this.defaultKind = kind as SymbolKind;
    this.defaultSymbol$.next(this.defaultKind);
  }

  override createWidget(x: number, y: number, width: number, height: number): string {
    const id = genId();
    this.engine.add({
      id,
      type: 'SYMBOL',
      zOrder: this.engine.genInitialOrder(),
      symbol: this.defaultKind,
      label: '',
      x,
      y,
      width,
      height,
    } as never);
    return id;
  }
}
