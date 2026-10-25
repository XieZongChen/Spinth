import { z } from 'zod';

/**
 * zod 运行时配置（生产 CSP 兼容）：zod v4 默认探测 JIT（new Function），
 * 即使异常被捕获，严格 CSP 仍会上报 securitypolicyviolation——上游已知，
 * util.js 明示 `jitless` 跳过探测。解析改走解释器路径，本仓库 schema 量级
 * 下的性能差异不可测。pwa.spec P4 以 0 violation 锁死该回归
 * （specs/pwa.md §7.3）。
 */
z.config({ jitless: true });
