/* global process, console */

/**
 * 执行器基础工具：子进程、日志、致命错误与容器清理注册、哈希。
 */

import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import { ROOT } from './config.mjs';

export function sh(cmd, args, opts = {}) {
  return execFileSync(cmd, args, {
    cwd: ROOT,
    encoding: 'utf8',
    stdio: opts.capture ? ['ignore', 'pipe', 'pipe'] : 'inherit',
    maxBuffer: 32 * 1024 * 1024,
    ...opts,
  });
}

export function log(...msgs) {
  console.log(`[visual-linux] ${msgs.join(' ')}`);
}

// die 前统一收口已注册的容器清理：process.exit 会绕过 try/finally，
// 失败路径（install/预检/复验红）不靠调用方自觉也能不留孤儿容器
const CLEANUPS = [];

export function die(code, ...msgs) {
  for (const m of msgs) console.error(`[visual-linux] ${m}`);
  while (CLEANUPS.length > 0) CLEANUPS.pop()();
  process.exit(code);
}

export { CLEANUPS };

export function sha256(file) {
  return createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

/** 尾部输出摘要（playwright 结果行；失败时给足排障信息而不刷屏） */
export function tailOf(text, lines = 15) {
  return String(text).trimEnd().split('\n').slice(-lines).join('\n');
}
