# 构建阶段
FROM node:23 AS builder

WORKDIR /app
COPY . .
RUN npm ci
RUN npm run build

# 运行阶段
FROM nginx:alpine

COPY --from=builder /app/dist /usr/share/nginx/html

EXPOSE 80