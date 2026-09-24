# 校园教室预约系统前端

Vue 3 + Element Plus 前端界面，接口按后端 `openapi.yaml` 与 Controller 实现生成。

## 启动

```bash
cd frontend
npm install
npm run dev
```

默认前端地址：`http://localhost:5173`

开发环境通过 Vite 代理访问后端：前端请求 `/api/*`，代理到 `http://localhost:8080/*`。
