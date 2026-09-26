# frontend —— 对话前端

Vue 3 + Vite 三视图（对话 / 执行轨迹 / 结果），消费编排引擎 8090 的 SSE 事件流——**界面展示的内容全部来自事件流**（与证据链同源，第 10 章 §6.1）。

阶段 7 初始交付后，2026-09-26 完成**全方位系统性优化**（5 阶段 + P0/P1/P2 深化），详见 [前端优化方案](../docs/设计方案/2026-09-26-前端全方位系统性优化方案.md)。

## 运行

```bash
npm install
npm run dev            # → http://localhost:5173（/api 代理到 8090；前置：编排引擎已启动）
npm run build          # 产物 dist/；生产形态 = vite preview 独立进程（决策 A8）
npm run preview        # 预览生产构建
```

### 代码质量

```bash
npm run lint           # ESLint 检查并自动修复
npm run lint:check     # ESLint 检查（不修复）
npm run format         # Prettier 格式化
npm run format:check   # Prettier 格式检查
npm run lint:css       # Stylelint 检查并自动修复
npm run lint:css:check # Stylelint 检查（不修复）
```

## 结构

```text
src/
  api/
    client.js          REST 封装（chat/tasks/reply/cancel/evidence）
    sse.js             SSE 封装（终态关流、指数退避重连 1s→30s 封顶、重连状态回调）
    endpoints.js       API 端点常量与请求限制（单一数据源）
  stores/
    task.js            当前任务状态（事件 seq 排序去重 / 证据 / 挂起 / 取消 / SSE 连接状态）
  composables/
    useTheme.js        主题管理（深浅双主题 + localStorage 持久化）
    useCopy.js         剪贴板复制（clipboard API + execCommand 降级 + 2s 成功反馈）
  components/
    App.vue            根组件（顶栏 + 双栏布局 + 任务状态徽章 + SSE 连接指示器 + 快捷键模态框）
    ChatPane.vue       对话区（消息列表 + 候选意图 + 取消按钮 + Composer）
    TrajectoryPane.vue 执行轨迹区（任务ID + 结果卡片 + PhaseSection 列表）
    Composer.vue       输入组件（输入框 + 发送按钮 + 快捷键提示 + 终态"再办一件"）
    PhaseSection.vue   单个阶段组件（chevron + 阶段信息 + 折叠动画 + 条目列表）
    TrajectoryItem.vue 单条证据项（图标 + 摘要 + 身份徽章 + 时间戳）
    ResultCard.vue     结果卡片（终态结论 + 资源结果 + 补偿信息）
    EmptyState.vue     空状态组件（图标 + 标题 + 描述）
    SkeletonLoader.vue 骨架屏加载组件（shimmer 动画）
    ErrorState.vue     错误状态组件（图标 + 标题 + 消息 + 重试）
    ThemeToggle.vue    主题切换按钮（旋转动画）
    DebugTaskPanel.vue 调试入口（结构化任务 JSON 提交）
    KeyboardShortcutsModal.vue 快捷键帮助面板（按 ? 弹出，三组分类）
  icons/               15 个 SVG 图标组件（零运行时依赖，index.js 统一导出）
  styles/
    tokens.css         设计令牌体系（色彩/间距/字号/圆角/阴影/动效，深浅双主题）
    base.css           基础样式（reset/排版/滚动条/焦点环/skip-link/响应式/Reduced Motion）
    components.css     组件样式系统（btn/card/chip/input/badge）
    animations.css     动画系统（pulse/spin/message-in/item-in/result-in/skeleton-shimmer/ripple-expand）
```

## 优化成果（2026-09-26）

### 视觉设计系统
- 完整设计令牌体系（tokens.css），向后兼容
- 组件样式系统（components.css：btn/card/chip/input/badge）
- 15 个 SVG 图标组件（零运行时依赖）
- 动画系统（8 种动画）

### 用户体验
- EmptyState / SkeletonLoader / ErrorState 三组件
- 顶栏任务状态徽章（5 种状态：运行中/等待输入/已办成/未能办成/待人工处理）
- SSE 连接状态指示器（连接中/已连接/重连中显示第N次+倒计时/失败）
- 微交互动画与消息进入动画

### 响应式与可访问性
- 3 断点响应式（1024/768/480px）
- 语义化标签（header/main/section）
- ARIA 标签与 role
- :focus-visible 焦点环
- skip-link 跳转链接
- Reduced Motion 支持
- Lighthouse：Accessibility 100、Best Practices 100、SEO 91

### 性能与架构
- SSE 指数退避重连（1s→30s 封顶，最多 10 次）
- useTheme / useCopy composables
- API 端点常量提取（endpoints.js）
- 构建优化（manualChunks vendor 分离、target es2020、cssCodeSplit）
- 生产构建 gzip 仅 ~47KB（vendor 32KB + app 12KB + CSS 6KB）

### 键盘快捷键
- `Enter` / `Ctrl+Enter`：发送消息
- `Ctrl/Cmd+K`：全局聚焦输入框（自动全选）
- `Esc`：清空输入 / 取消任务 / 关闭弹窗
- `?`：弹出快捷键帮助面板（输入框中不触发）

### 组件细粒度拆分（P2）
- Composer.vue：输入区域独立封装
- PhaseSection.vue：单个阶段独立封装
- KeyboardShortcutsModal.vue：快捷键帮助面板

### 工程化
- ESLint（eslint:recommended + vue/vue3-recommended + prettier）
- Prettier（全量格式化）
- Stylelint（stylelint-config-standard + recommended-vue）
- 全部检查 0 errors 通过

## 展示纪律（第 10 章）

- 事件流是唯一数据源；seq 排序去重；断线续传按 Last-Event-ID。
- 不出现接口 URL / 参数名 / 状态机状态名；P3 段展示接口的**业务语义名 + 使用身份**。
- "不确定（查证中）"= 琥珀 + 进行中动效，**无重试按钮**；UNRESOLVED = 琥珀待处理卡，不折叠。
- 深浅双主题（投影风险对冲）；颜色只用于表达状态。
- 所有用户输入以文本方式渲染，禁止未经转义的 HTML 渲染（无 v-html）。
- SSE 文本经过统一处理，接口错误不直接展示内部异常信息。
