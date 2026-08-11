# AI 智能旅游攻略微信小程序架构

## 目录职责

- `apps/miniapp`：原生微信小程序入口和页面，负责面向用户的展示、微信登录、健康检查和
  旅行需求本地草稿交互。
- `apps/server`：NestJS + Fastify 的后端应用入口，负责 HTTP 接口、配置校验、数据库模块以及应用编排。
- `packages/shared-types`：前后端共享的 TypeScript 类型定义。
- `packages/shared-schemas`：使用 Zod 定义的运行时数据校验 Schema。
- `packages/prompts`：后续 AI 能力使用的提示词（prompt）共享包；当前仅保留包边界。
- `packages/config`：跨应用共享的基础配置常量和环境类型。
- `infra/docker`：本地基础设施容器编排，目前只包含 PostgreSQL 和 Redis。

## 当前架构形态

当前采用模块化单体（modular monolith）：`apps/server` 是一个可独立启动的 NestJS 应用，内部按模块组织能力。
现阶段不拆分微服务，第三方旅行数据 API 仍按模块隔离。TASK-008 已增加服务端旅行需求
草稿 CRUD；小程序旅行需求表单仍只负责共享 Schema 校验和本地草稿保存，不调用
`POST /trips`。TASK-009 增加了需要认证的天气查询和可替换 Provider，但不改变上述本地草稿行为。后续新增能力应先保持
模块边界清晰，再根据实际规模评估是否需要服务拆分。

## HTTP 基础能力

- 服务在 Fastify 请求生命周期中解析 `x-request-id`。长度和字符合法的客户端值会被保留，
  缺失或非法值使用 Node.js 标准库生成；请求 ID 同时写入响应头和错误 Envelope。
- 除 `GET /health` 的成功响应外，错误响应统一使用共享 `ApiFailure` Schema，支持
  `NOT_FOUND`、`VALIDATION_ERROR`、受控的 Auth 错误码和脱敏的 `INTERNAL_ERROR`。错误响应
  不会暴露堆栈、文件路径、内部异常消息或敏感配置。
- 服务增加 JSON API 所需的基础安全响应头，并记录包含 request ID、HTTP 方法、路径、状态
  和耗时的安全日志；请求 body、Token、Cookie、Authorization、OpenID 和密钥不会写入日志。
- `GET /health` 是保留的原始 `HealthResponse` 成功响应，不包装为 ApiSuccess。应用启动时启用
  NestJS shutdown hooks，关闭时停止接受新请求并释放 Fastify 应用。

认证模块通过固定 URL 的微信 Code2Session Provider 换取会话身份，使用 OpenID 幂等创建
内部用户，并签发应用自己的短期 HMAC-SHA256 Access Token。Provider 通过接口和 Nest
Injection Token 注入，业务服务不依赖具体 HTTP 实现；测试使用 Fake Provider，不访问真实
微信接口。`session_key` 只在 Provider 解析响应期间存在，不保存、返回或写入日志。

`POST /auth/login` 成功响应使用共享 ApiSuccess Envelope。小程序使用版本化 Storage Key
保存 Access Token 和最小 `AuthUser`，损坏缓存会安全清除；小程序不保存 code、OpenID、
UnionID、session_key 或 AppSecret。Guard 只将内部 user ID 放入请求上下文，并验证 Bearer
Token 的签名、exp、issuer 和 audience。Trip API 的每个请求都必须通过同一个 `AuthGuard`，
并使用 Token 中的内部 `userId` 做数据隔离；当前不实现 Refresh Token、手机号/头像
昵称授权或第三方 OAuth。

## 数据库边界

数据库基础设施使用 PostgreSQL、`pg` 和 Drizzle ORM：Schema 以 TypeScript 定义，SQL
Migration 由 Drizzle Kit 生成并保存在 `apps/server/migrations/`。选择 Drizzle 是因为它
运行时开销小、Schema 类型来自 TypeScript，并且不需要 Prisma Engine 等额外二进制文件。

`DatabaseModule` 是可被业务模块显式导入的 NestJS 模块，提供经过独立运行时校验的数据库
环境配置、惰性 PostgreSQL Pool、类型化 Drizzle 实例和幂等的应用关闭清理。Pool 创建本身
不会执行查询，第一次实际操作才建立连接；模块不使用全局可变单例。认证模块使用 Drizzle
UserRepository 按 OpenID 幂等创建 `users` 记录。旅行草稿使用 `trips` 表和 Drizzle
`TripRepository`：所有查询都同时约束 `tripId` 与 `userId`（列表也约束 `userId`），默认
排除 `deleted_at` 非空记录。创建和更新前使用共享 `CreateTripInputSchema` 标准化完整旅行
需求，将结果保存到 `input_snapshot`，并同步 `city_name`、日期和人数冗余列。删除使用
软删除（设置 `status=deleted`、`deleted_at` 和 `updated_at`），不物理删除，也不通过错误
差异泄露其他用户记录。数据库不包含 TripPlan、TripDay、TimelineItem 或攻略生成逻辑。

### 天气 Provider 与缓存（TASK-009）

天气模块只依赖 `WeatherProvider`、`ClimateReferenceProvider` 和缓存 Repository 接口，具体
实现通过 Nest Injection Token 注入。生产默认适配器为高德天气（中国大陆城市编码和中文
逐日预报字段覆盖适合当前场景）：请求 Host 在服务端常量中
固定，API Key 仅从服务端环境读取，调用设置明确超时并校验 HTTP 状态及供应商错误码；供应商
原始响应不会返回客户端，也不会写入日志。测试注入 Fake Provider、Fake Cache Repository
和可控 Clock，因此不访问真实天气 API 或 PostgreSQL。

服务使用 UTC 纯日期计算预报有效区间。近期日期使用 `forecast`，远期日期请求可注入的历史
气候 Provider，混合范围按日期合并并升序返回；参考日期带有明确 Notice，绝不被描述为准确
预报。当前默认 Provider 不内置历史数据，数据源不可用时返回 `unavailable`，不生成任何猜测
的温度、降雨概率或天气类型。
历史参考和预报分别写入 `weather_cache`，缓存 key 包含标准化地点、日期范围、Provider 和
数据来源，不包含 API Key，也不按用户拆分。无来源时返回 `WEATHER_UNAVAILABLE`，不伪造温度、
降雨概率或天气类型。Migration 不会在应用启动自动执行。

### Place Provider 与 POI 缓存（TASK-010）

地点模块只依赖 `PlaceProvider` 和 `PlaceRepository` 接口，具体实现通过 Nest Injection Token 注入。当前实现固定使用
高德地点文本搜索 Host；API Key 只从服务端 `PLACE_API_KEY` 读取，请求设置明确超时并校验 HTTP 与供应商业务状态。供应商
原始响应、API Key 和完整请求 URL 不会返回客户端或写入日志。

POI 必须携带供应商提供的 `providerPlaceId`、名称、地址和合法经纬度；服务端会校验并去重后写入 `pois`，不会由 AI 或
随机数据补充景点、餐厅、评分、电话和营业时间。搜索结果存入 `poi_search_cache`，公共缓存 key 基于 Provider、标准化城市、
关键词、分类和分页生成 SHA-256 摘要，不包含明文关键词、用户 ID 或 API Key。高德 Provider 使用固定的 v5 文本搜索 Host，
并将最多 50 条客户端分页拆分为上游每页最多 25 条的确定性请求。新鲜缓存优先命中，供应商失败时可在短暂 stale-if-error 窗口返回已验证缓存。
Migration 不会随应用启动自动执行，测试使用 Fake Provider、Fake Repository 和 Fake Clock，不访问真实地图网络或 PostgreSQL。

### Route Provider 与短期路线缓存（TASK-011）

路线模块只依赖 `RouteProvider` 和 `RouteCacheRepository` 接口，NestJS 使用 Injection Token 注入实现。第一版高德适配器
固定访问官方 v5 `https://restapi.amap.com/v5/direction/walking` 或 `/driving`，服务端环境变量提供 API Key；请求只携带
标准化至最多 6 位小数的 `longitude,latitude`、可选 POI ID 和 `show_fields=cost`，响应仅提取第一条方案的真实
`distance`、`duration` 以及驾车 `tolls`。HTTP 错误、业务状态码、超时、空路线和非法供应商结果都会被安全处理，原始
JSON、步骤指令和 Polyline 不会返回或写入日志。

`RouteService` 先校验严格共享 Schema，将坐标标准化后查找公共新鲜缓存；缓存 key 是只含 Provider、模式和规范化坐标的
固定长度 SHA-256 摘要，不包含 userId、完整坐标文本或 API Key。成功的 Provider 结果和真实 `unavailable` 结果写入
PostgreSQL `route_cache`，读取和写入都经过 `RouteEstimateSchema`。供应商失败时仅尝试配置的 stale-if-error 窗口，旧数据
标记为 `dataSource=cache`；没有可用路线不会生成距离、时长或费用。Migration 位于 `apps/server/migrations/0004_robust_scorpion.sql`，
不会随应用启动自动执行。

小程序仅提供类型安全的 `RouteService.estimateRoute`，复用现有 `HttpClient` 与 `AuthService` 自动附加 Bearer Token，并
在 `AUTH_TOKEN_INVALID` 时清理认证状态；路线 API Key 只存在服务端。测试注入 Fake Provider、Fake Repository 和 Fake Clock，
不访问真实地图 API 或 PostgreSQL。多点路线优化、公交换乘详情、路线几何 Polyline、地图页面、TSP、TripPlan、Timeline 和
LLM 不在当前范围内。

### 当前能力边界

旅行草稿 CRUD、基础天气查询、POI 检索和两点路线估算是当前服务端旅行业务能力。路线/距离矩阵优化、地图 UI、攻略生成和 AI
（LLM）能力留待后续任务；天气、地点和路线模块不创建 TripPlan、Timeline 或攻略生成逻辑。

Migration 不会在应用启动时自动执行，也没有重置或删除生产表脚本。启动本地 PostgreSQL
后，复制 `.env.example` 为 `.env` 并运行：

```bash
docker compose --env-file .env -f infra/docker/docker-compose.yml up -d
pnpm --filter @travel-guide/server db:migrate
```

执行前可用 `pnpm --filter @travel-guide/server db:check` 检查 Migration；Schema 变更后
使用 `pnpm --filter @travel-guide/server db:generate` 生成新的可审阅 SQL。UUID 由应用使用
Node.js `crypto.randomUUID()` 生成，数据库列不声明 UUID 扩展或默认表达式，因此 Migration
不依赖未声明的 PostgreSQL 扩展。
