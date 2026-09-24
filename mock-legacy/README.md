# 校园教室预约管理系统

基于 `Spring Boot 3 + Vue 3 + MySQL` 的校园教室预约系统，面向学生、教师与管理员提供教室/座位预约、签到、候补、通知、维护管理、统计分析等完整业务能力。项目已包含前后端源码、数据库脚本、Docker 部署文件、接口文档和测试用例，适合作为课程设计或毕业设计项目。

## 项目特性

- 学生按时间段预约座位，查看已预约记录与历史记录
- 教师或管理员按时间段预约整间教室
- 预约冲突校验，避免同一资源在相同时间被重复占用
- 签到与爽约处理，支持信用分扣减、违规记录、通知提醒
- 候补队列机制，在资源释放后自动补位
- 通知中心，支持未读数统计、已读处理
- 教室维护窗口管理，维护期间自动限制预约
- 管理端提供用户管理、教室管理、预约管理、系统配置、统计分析
- 前端楼栋列表改为后端驱动，并在本地做缓存以减少重复请求

## 技术栈

### 后端

- `Java 17`
- `Spring Boot 3.5.9`
- `Spring Security`
- `JWT`
- `MyBatis`
- `MySQL 8`
- `Spring Validation`
- `Spring Scheduling`
- `SpringDoc OpenAPI / Swagger UI`
- `JUnit 5 + Mockito`

### 前端

- `Vue 3`
- `Vue Router 4`
- `Pinia`
- `Element Plus`
- `Axios`
- `ECharts`
- `Vite`

### 部署

- `Docker`
- `Docker Compose`
- `Nginx`

## 功能模块

### 用户端

- 登录、注册、获取当前用户信息、修改密码
- 查询可用教室、楼栋、座位布局、已占用座位
- 提交座位预约或整间教室预约
- 取消预约、查看当前预约与历史预约
- 签到
- 提交候补、查看我的候补、取消候补
- 查看通知、标记已读

### 管理端

- 用户状态管理与用户数据导出
- 教室、座位、楼栋信息维护
- 预约记录查询、删除与导出
- 教室维护时间段管理
- 系统配置项管理
- 数据统计与分析面板

## 项目结构

```text
campusClassroomReservationSystem
|- backend                    # Spring Boot 后端
|  |- src/main/java           # 控制器、服务、Mapper、实体、配置
|  |- src/main/resources      # 应用配置
|  `- sql/classroom.sql       # 数据库初始化脚本
|- frontend                   # Vue 3 前端
|  |- src/api                 # 接口封装
|  |- src/stores              # Pinia 状态管理
|  |- src/views               # 页面视图
|  `- src/config              # 前端配置
|- nginx                      # Nginx 反向代理配置
|- docker-compose.yaml        # 容器编排
|- 接口文档.md                # 当前接口说明
|- 测试点清单.md              # 测试覆盖清单
`- 毕业设计评估与答辩建议.md  # 毕设视角说明
```

## 本地运行

### 1. 环境要求

- `JDK 17`
- `Node.js 18+`
- `MySQL 8`
- `Maven 3.9+` 或使用仓库自带 `mvnw`

### 2. 初始化数据库

创建数据库：

```sql
CREATE DATABASE classroom DEFAULT CHARACTER SET utf8mb4;
```

然后执行：

```text
backend/sql/classroom.sql
```

### 3. 配置后端

后端默认使用：

```yaml
spring:
  datasource:
    url: jdbc:mysql://localhost:3306/classroom?useUnicode=true&characterEncoding=utf8&serverTimezone=UTC&useSSL=false&allowPublicKeyRetrieval=true
    username: root
    password: 123456
```

对应文件为：

- `backend/src/main/resources/application.yaml`
- `backend/src/main/resources/application-local.yaml`

如果你的本地数据库账号、密码或端口不同，需要先修改 `application-local.yaml`。

### 4. 启动后端

在项目根目录执行：

```powershell
cd backend
.\mvnw.cmd spring-boot:run
```

后端默认端口：

```text
http://localhost:8080
```

### 5. 启动前端

在项目根目录执行：

```powershell
cd frontend
npm install
npm run dev
```

前端默认端口：

```text
http://localhost:5173
```

前端开发服务器已配置代理：

- `/api -> http://localhost:8080`

对应配置文件：

- `frontend/vite.config.js`

## Docker 部署

在项目根目录执行：

```powershell
docker compose up --build
```

默认端口：

- 前端：`http://localhost`
- 后端：`http://localhost:8080`
- MySQL：`localhost:3307`

### 注意事项

当前 `docker-compose.yaml` 中挂载的初始化脚本是：

```text
./backend/sql/classroom_withdata.sql
```

但仓库中目前存在的是：

```text
./backend/sql/classroom.sql
```

如果直接使用 Docker Compose，请先将 `docker-compose.yaml` 中的脚本路径改为现有文件，或补充对应的 `classroom_withdata.sql`。

## 接口文档

- 项目内文档：[`接口文档.md`](./接口文档.md)
- Swagger UI：`http://localhost:8080/swagger-ui.html`

当前主要接口包括：

- 认证接口：`/auth/*`
- 教室接口：`/classrooms/*`
- 预约接口：`/reservations/*`
- 候补接口：`/waitlist/*`
- 通知接口：`/notifications/*`
- 管理端接口：`/admin/*`

## 测试

后端已补充核心业务单元测试，覆盖：

- 系统配置解析与更新
- 签到与爽约处理
- 候补创建、补位与取消
- 预约服务核心规则

示例测试命令：

```powershell
cd backend
.\mvnw.cmd "-Dtest=SystemConfigServiceImplTest,AttendanceServiceImplTest,WaitlistServiceImplTest" test
```

相关文档：

- [`测试点清单.md`](./测试点清单.md)

## 已验证

以下命令已在当前项目中通过：

```powershell
cd frontend
npm run build
```

```powershell
cd backend
.\mvnw.cmd -DskipTests compile
```

```powershell
cd backend
.\mvnw.cmd "-Dtest=SystemConfigServiceImplTest,AttendanceServiceImplTest,WaitlistServiceImplTest" test
```

## 适用场景

- 本科课程设计
- 毕业设计
- 校园资源预约系统原型
- Spring Boot + Vue 全栈练习项目

## 相关文档

- [`接口文档.md`](./接口文档.md)
- [`测试点清单.md`](./测试点清单.md)
- [`毕业设计评估与答辩建议.md`](./毕业设计评估与答辩建议.md)

## 许可证

本仓库当前包含 `LICENSE` 文件；如需对外分发或商用，请先确认许可证内容与适用范围。
