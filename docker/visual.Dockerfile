# Linux 视觉基线镜像（specs/linux-visual §5.2）。
# 构建上下文必须是 docker/ 目录（只送 visual-fonts.conf 进 daemon，不带工作区）：
#   docker build --platform linux/amd64 \
#     --build-arg PLAYWRIGHT_VERSION=<package.json 的精确版本> \
#     --build-arg NOTO_CJK_VERSION=<noble 实测 candidate，写死在脚本常量> \
#     -t spinth-visual:<版本> .
# 版本契约：PLAYWRIGHT_VERSION 必须与 package.json devDependencies.@playwright/test
# 一致（scripts/visual-linux.mjs 构建前断言）；镜像 tag 与浏览器构建绑定，不可漂移。
# 只在本地/CI 临时构建，不推 registry（specs D12）。

ARG PLAYWRIGHT_VERSION=1.64.1
FROM mcr.microsoft.com/playwright:v${PLAYWRIGHT_VERSION}-noble

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
