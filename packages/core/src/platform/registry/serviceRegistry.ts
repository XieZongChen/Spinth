/**
 * 轻量类型安全 DI（ADR-3，规格见 docs/04 §3）。
 * 不用 inversify：显式构造注入、无装饰器反射魔法，依赖关系在组合根一眼可读。
 */

/** 类型化 token：symbol 携带幻类型参数，resolve 时推导出 T */
export interface Token<T> {
  readonly key: symbol;
  /** 幻类型位，不出现在运行时 */
  readonly __type?: T;
}

export function token<T>(desc: string): Token<T> {
  return { key: Symbol(desc) };
}

type Factory<T> = (r: ServiceRegistry) => T;

export class ServiceRegistry {
  private factories = new Map<symbol, Factory<unknown>>();
  private singletons = new Map<symbol, unknown>();

  /** transient：每次 resolve 新建 */
  register<T>(t: Token<T>, factory: Factory<T>): this {
    this.factories.set(t.key, factory as Factory<unknown>);
    return this;
  }

  /** singleton：首次 resolve 缓存 */
  registerSingleton<T>(t: Token<T>, factory: Factory<T>): this {
    this.factories.set(t.key, (r) => {
      if (!this.singletons.has(t.key)) {
        this.singletons.set(t.key, factory(r));
      }
      return this.singletons.get(t.key);
    });
    return this;
  }

  resolve<T>(t: Token<T>): T {
    const factory = this.factories.get(t.key);
    if (!factory) {
      throw new Error(`[ServiceRegistry] token 未注册: ${t.key.description}`);
    }
    return factory(this) as T;
  }

  /** AutoFactory 等价物：控件 Model/Vm 的 transient 工厂 */
  factory<T>(t: Token<T>): () => T {
    return () => this.resolve(t);
  }

  /** 释放全部单例（组合根 destroy 时调用） */
  dispose(): void {
    for (const s of this.singletons.values()) {
      if (s && typeof s === 'object' && 'dispose' in s && typeof s.dispose === 'function') {
        (s as IDisposable).dispose();
      }
    }
    this.singletons.clear();
    this.factories.clear();
  }
}

interface IDisposable {
  dispose(): void;
}
