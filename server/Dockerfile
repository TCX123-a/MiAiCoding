# server/Dockerfile —— miai-api 多阶段构建（docs/22 §6.3；旧文档草图已按实测修正）。
# 构建上下文 = 发布包里的 server/ 子树（releases/<sha>/server，由 deploy.sh 解包），本文件与 .dockerignore 随包走。
#
# 【已定稿】镜像基：bookworm-slim（本模板）——旧文档 D4/07-tail 的 alpine 字眼作废。
#   2026-10-10 收口（4拍板项建议书 §末尾登记项）：交接文档 §2.2 ② 已按 docs/22 定为
#   node:24-bookworm-slim，磁盘实现即本文件，以 docs/22 为准，此处注释同步为结论。
#   全仓运行依赖 4 个（fastify / fastify-type-provider-zod / pg / zod）全纯 JS 零原生，两种基都能跑；
#   选 bookworm-slim：更接近官方推荐、glibc 面更安全。
#
# 为什么基础镜像下限是 node:24：密码哈希走 Node 24 内置 crypto.argon2（src/lib/password.ts），
#   降级到 22 及以下直接不可用；node:24 镜像自带非 root 用户 node（uid 1000），运行层可直接 USER node。
# 为什么本文件不写 HOST/端口：src/config.ts 的 HOST 默认是 127.0.0.1（容器内回环，Caddy 反代必 502）——
#   HOST=0.0.0.0 由 compose 的 environment 注入（见 deploy/compose.yml），不在这里写死，避免「以为容器自己就懂」。

FROM node:24-bookworm-slim AS build
WORKDIR /app
# 先只拷依赖清单：源码改动不重装依赖（层缓存）
COPY package.json package-lock.json ./
RUN npm ci --registry=https://registry.npmmirror.com
# tsconfig.build.json extends ./tsconfig.json（两份都要拷）；rootDir=src ⇒ 产物平铺进 dist/
COPY tsconfig.json tsconfig.build.json ./
COPY src ./src
RUN npm run build

FROM node:24-bookworm-slim
ENV NODE_ENV=production
WORKDIR /app
# 运行层只装 dependencies（4 个纯 JS 包）；tsx / vitest / typescript 等 dev 依赖不进镜像
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --registry=https://registry.npmmirror.com
# 应用入口 = dist/server.js；迁移 runner 在 dist/db/ 子目录（见下方 COPY migrations 的注释）
COPY --from=build /app/dist ./dist
# 迁移 runner 用相对路径定位迁移目录（src/db/migrate.ts：path.resolve(这里, '../../migrations')）
# ⇒ 容器里 dist/db/../.. = /app，迁移目录必须落在 /app/migrations；漏拷 = 迁移找不到任何文件
COPY migrations ./migrations
# 非 root 运行（docs/22 §6.8 底线）
USER node
EXPOSE 8787
CMD ["node", "dist/server.js"]
