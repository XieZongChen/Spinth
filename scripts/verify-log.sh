#!/usr/bin/env bash
# 门禁日志包装：保留 pnpm verify 的真实退出码。
# 裸 `pnpm verify | tail` 的退出码是 tail 的 0——红测试会被管道吞掉。
# 用法：pnpm verify:log（全文写入临时日志，末尾打印路径与 exit）。
set -uo pipefail

tmp="${TMPDIR:-/tmp}"
log="${tmp%/}/spinth-verify.log"
pnpm verify 2>&1 | tee "$log"
code="${PIPESTATUS[0]}"
printf '\n[verify] full log: %s (exit %s)\n' "$log" "$code"
exit "$code"
