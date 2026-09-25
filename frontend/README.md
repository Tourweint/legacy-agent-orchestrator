# frontend —— 对话前端（阶段 7）

Vue 3 + Vite 三视图（对话 / 执行轨迹 / 结果），消费编排引擎 8090 的 SSE 事件流——**界面展示的内容全部来自事件流**（与证据链同源，第 10 章 §6.1）。

## 运行

```bash
npm install
npm run dev      # → http://localhost:5173（/api 代理到 8090；前置：编排引擎已启动）
npm run build    # 产物 dist/；生产形态 = vite preview 独立进程（决策 A8）
```

## 结构

```text
src/
  api/client.js    REST 封装（chat/tasks/reply/cancel/evidence）
  api/sse.js       SSE 封装（终态关流、重连状态）
  stores/task.js   当前任务状态（事件 seq 排序去重 / 证据 / 挂起 / 取消）
  components/      三视图组件 + 主题切换 + 调试入口（G5）
  styles/          设计变量（深浅双主题，G6）
```

## 展示纪律（第 10 章）

- 事件流是唯一数据源；seq 排序去重；断线续传按 Last-Event-ID。
- 不出现接口 URL / 参数名 / 状态机状态名；P3 段展示接口的**业务语义名 + 使用身份**。
- "不确定（查证中）"= 琥珀 + 进行中动效，**无重试按钮**；UNRESOLVED = 琥珀待处理卡，不折叠。
- 深浅双主题（投影风险对冲）；颜色只用于表达状态。
