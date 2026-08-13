# 业务服务镜像。可选构建参数：
#   NPM_CONFIG_REGISTRY  镜像源（国内构建可设 https://registry.npmmirror.com）
#   HTTP_PROXY/HTTPS_PROXY  构建期代理（仅构建阶段，不写入最终运行层）
FROM node:22-alpine AS build
ARG NPM_CONFIG_REGISTRY=
ARG HTTP_PROXY=
ARG HTTPS_PROXY=
ARG NO_PROXY=localhost,127.0.0.1
ENV NPM_CONFIG_REGISTRY=${NPM_CONFIG_REGISTRY} \
    HTTP_PROXY=${HTTP_PROXY} \
    HTTPS_PROXY=${HTTPS_PROXY} \
    NO_PROXY=${NO_PROXY} \
    NODE_OPTIONS=--max-old-space-size=1536
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-fund --no-audit
COPY tsconfig.json ./
COPY src ./src
# npm run build 会调用 scripts/copy-migrations.mjs，必须一并拷入
COPY scripts ./scripts
RUN npm run build

FROM node:22-alpine
ARG NPM_CONFIG_REGISTRY=
ARG HTTP_PROXY=
ARG HTTPS_PROXY=
ARG NO_PROXY=localhost,127.0.0.1
ENV NPM_CONFIG_REGISTRY=${NPM_CONFIG_REGISTRY} \
    HTTP_PROXY=${HTTP_PROXY} \
    HTTPS_PROXY=${HTTPS_PROXY} \
    NO_PROXY=${NO_PROXY}
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-fund --no-audit
COPY --from=build /app/dist ./dist
# 运行层清掉代理，避免生产请求误走构建代理
ENV HTTP_PROXY= HTTPS_PROXY= NO_PROXY= NPM_CONFIG_REGISTRY=
EXPOSE 8720
USER node
CMD ["node", "dist/index.js"]
