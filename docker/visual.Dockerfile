# Linux 视觉基线镜像（specs/linux-visual §5.2）。
# 构建上下文必须是 docker/ 目录（只送 visual-fonts.conf 进 daemon，不带工作区）：
#   docker build --platform linux/amd64 \
#     --build-arg PLAYWRIGHT_VERSION=<package.json 的精确版本> \
#     --build-arg NOTO_CJK_VERSION=<noble 实测 candidate，写死在脚本常量> \
#     --build-arg PNPM_VERSION=<根 package.json 的 packageManager 版本> \
#     -t spinth-visual:<版本> .
# 版本契约：PLAYWRIGHT_VERSION 必须与 package.json devDependencies.@playwright/test
# 一致（scripts/visual-linux.mjs 构建前断言）；镜像 tag 与浏览器构建绑定，不可漂移。
# base 按 digest pin：同 tag 上游重发已实测发生（v1.64.1-noble 曾在数小时内换过
# Node 24→26 并移除 corepack），tag 可变意味着工具链随上游重建漂移。换 digest 时
# 必须同步 preflight 的 node 大版本期望（run.mjs），并复核渲染字节是否仍与基线全等。
# 只在本地/CI 临时构建，不推 registry（specs D12）。

ARG PLAYWRIGHT_VERSION=1.64.1
FROM mcr.microsoft.com/playwright:v${PLAYWRIGHT_VERSION}-noble@sha256:2f05f8a734509a7b3f26a912639488ee08f58a7b292d14d62271bcff9038768f

# 工具链层：镜像内直接装 pnpm（base 的 Node ≥25 已不带 corepack，运行期联网取
# pnpm 的机制随之移除）。版本由构建参数单源传入（根 package.json 的
# packageManager 字段，scripts/visual-linux/config.mjs 解析）——不在本文件写字面量
ARG PNPM_VERSION
RUN npm install -g pnpm@${PNPM_VERSION} && pnpm --version

# CJK 字体层：版本必传（无默认），防 apt 源更新后字形漂移（specs R11）
ARG NOTO_CJK_VERSION
RUN apt-get update && \
    DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends \
      fonts-noto-cjk=${NOTO_CJK_VERSION} && \
    rm -rf /var/lib/apt/lists/*

COPY visual-fonts.conf /etc/fonts/conf.d/99-spinth-visual.conf

# 构建期断言（specs §5.3 / N5）：sans-serif 必须命中 Noto Sans CJK SC 且 zh 可枚举，
# 失败即构建失败——不把豆腐块问题留到截图阶段
RUN fc-cache -f && \
    fc-list :lang=zh | grep -q 'Noto Sans CJK SC' && \
    fc-match sans-serif | grep -q 'Noto Sans CJK SC'
