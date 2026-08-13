# AI 智能旅游攻略微信小程序架构

## 目录职责

- `apps/miniapp`：原生微信小程序入口和页面，负责面向用户的展示、微信登录、健康检查和
  旅行需求本地草稿交互。
- `apps/server`：NestJS + Fastify 的后端应用入口，负责 HTTP 接口、配置校验、数据库模块以及应用编排。
- `packages/shared-types`：前后端共享的 TypeScript 类型定义。
- `packages/shared-schemas`：使用 Zod 定义的运行时数据校验 Schema。
- `packages/prompts`：版本化 AI 提示词（prompt）共享包；当前包含 TripPlan Structured Output Prompt。
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

TASK-012 增加受认证的 `POST /routes/matrix` 基础层。共享契约限制矩阵点数为 2～10，点 ID 必须唯一，且坐标按路线
服务使用的 6 位小数规范化后不得重复；结果只包含 `n × (n - 1)` 个有向非对角线 cell。服务端的 `RouteMatrixService`
通过现有 `RouteService` 查询每一对点，使用最多 4 个并发 worker，不重新实现 Provider 或缓存。每个 cell 的路线仍优先
命中公共两点 `route_cache`；单条 Provider 返回空路线时生成不含 estimate 的 `unavailable` cell，Provider 系统性失败则
返回 `ROUTE_MATRIX_PROVIDER_ERROR`。如果所有 cell 都不可用，HTTP 层返回 `ROUTE_MATRIX_UNAVAILABLE`。矩阵不会按用户或整张
矩阵单独缓存，也不新增 Migration、Redis、路线优化或地图 UI。小程序 `RouteMatrixService` 复用现有 HTTP/认证链路并通过
`RouteMatrixResultSchema` 校验响应。

### Route Order 建议顺序（TASK-013）

`POST /routes/order` 先通过 `RouteMatrixService` 获取真实的 walking 或 driving 矩阵，再由纯函数最近邻算法生成访问顺序。
输入点数仍限制为 2～10，`startId`/`endId`（如果提供）必须引用不同的输入点；没有起点时按点 ID 字典序选择起点，指定终点
会被保留到最后。每一步只从当前点可用的有向 cell 中选择预计耗时最小者，耗时相同按真实距离、再按目标 ID 字典序比较。
不可用 cell 不参与候选，无法形成覆盖全部点的顺序时返回 `ROUTE_ORDER_UNAVAILABLE`；矩阵 Provider 系统性失败映射为
`ROUTE_ORDER_PROVIDER_ERROR`。结果返回相邻 legs、真实距离/耗时汇总、`algorithm=nearest_neighbor` 和 `isOptimal=false`，
并明确该启发式算法不保证全局最优。访问顺序层不重复实现 Provider、不新增整单缓存或 Migration，也不实现精确 TSP、DBSCAN、
TripPlan、Timeline、LLM 或地图 UI。小程序 `RouteOrderService` 沿用现有 Bearer Token、HTTP Client 和共享
`RouteOrderResultSchema`，缺少 Token 时不会发起网络请求。

TASK-014 增加 `POST /routes/order/explain` 以及共享 `RouteOrderExplanationResultSchema`。解释接口在同一次
`RouteMatrixService` 查询结果上生成访问顺序和逐步决策说明，不重复调用路线 Provider，也不增加整单缓存。每一步候选均携带真实
路线可用性；不可用候选只携带明确的排除原因，不携带距离或耗时。决策原因严格对应耗时最短、距离平局、目标 ID 平局和固定终点四类
比较过程，`order`、`legs`、决策和累计汇总必须保持一致。结果和说明均明确最近邻算法不保证全局最优；输入非法、Provider 系统性失败、
无法形成完整顺序分别使用 `ROUTE_ORDER_VALIDATION_ERROR`、`ROUTE_ORDER_PROVIDER_ERROR` 和 `ROUTE_ORDER_UNAVAILABLE`。候选、决策和
不可用路线数量受 2～10 个矩阵点的共享上限约束。小程序 `RouteOrderExplanationService` 复用 Bearer Token、HttpClient 和共享
Schema，缺少 Token 时不访问网络并在 `AUTH_TOKEN_INVALID` 时清理认证状态。

### 当前能力边界

旅行草稿 CRUD、基础天气查询、POI 检索、两点路线估算、路线矩阵、确定性的访问顺序建议、TripPlan 版本化生成 API 和小程序只读
攻略页面是当前能力。精确路线优化、地图 UI、编辑和公共未认证攻略生成仍留待后续任务；TASK-016 提供服务端内部的 LLM Provider、
版本化 Prompt 和 TripPlan 生成编排基础层，TASK-017 接入受认证 API，TASK-018 接入小程序生成与展示流程。共享包提供严格的
TripPlan 结构化契约和 Runtime Schema，Schema 不证明 `providerPlaceId` 等实体真实性，真实性白名单校验由生成编排执行；天气、地点
和路线模块不创建 TripPlan 实例、Timeline 或攻略生成逻辑。

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

### TripPlan 生成编排（TASK-016）

`TripPlanModule` 只提供服务端内部的 `TripPlanGenerationService`，不注册生成 Controller，也不保存攻略数据库版本。
服务通过 `TRIP_PLAN_LLM_PROVIDER` Injection Token 依赖最小 `LLMProvider` 接口；默认实现是无 SDK 依赖的
OpenAI-compatible Chat Completions Provider，测试使用 `FakeLLMProvider`。`LLM_BASE_URL`、`LLM_API_KEY`、`LLM_MODEL`、
超时和输出上限只从服务端运行时配置读取；生产 Base URL 必须是 HTTPS，开发/测试使用本地 HTTP 时必须显式设置
`LLM_ALLOW_INSECURE_LOCALHOST=true`。请求失败、超时和供应商非成功状态均映射为脱敏错误，不记录 Authorization、API Key、
完整 Prompt、用户自由文本或供应商原始响应。

生成 Context 仅允许经过 `CreateTripInputSchema`、`DailyWeatherSchema`、`PlaceSchema`、`RouteEstimateSchema` 和
`RouteOrderResultSchema` 验证的数据。编排层在单次 Provider 调用前确定性截断最多 30 个候选 POI，并在返回后先使用
`TripPlanSchema`，再对 POI 的 provider/providerPlaceId/id/所有真实字段、路线和天气执行精确白名单匹配；任何新增、篡改或
unavailable 路线作为交通耗时都会稳定失败。`climate_reference` 天气必须原样保留并带有
`WEATHER_CLIMATE_REFERENCE` warning；unavailable 天气不能携带测量值。没有已验证 POI 时返回 `TRIP_PLAN_UNAVAILABLE`。
该层不主动调用地图、天气或路线 Provider，不执行自动修复或多轮 Agent。

### TripPlan 生成 API 与版本持久化（TASK-017）

`TripPlanController` 在 `AuthGuard` 和 `CurrentUserId` 后提供 `POST /trips/:id/generate`、
`GET /trips/:id/plan` 与 `GET /trips/:id/plan/:version`。生成请求体是严格空对象，所有 Trip 输入和上下文数据
均由服务端按 `userId + tripId` 读取并通过既有 Weather/Place/Route/RouteOrder Service 及
`TripPlanGenerationContextSchema` 验证；LLM Provider 只调用一次，客户端不能指定模型、Provider、POI、天气、路线或
密钥。成功输出经 `TripPlanSchema` 和共享版本结果 Schema 再次校验，实体不一致、输出篡改、上下文不完整和 Provider
不可用分别映射稳定错误码，不记录 Prompt、密钥或原始响应。

`DrizzleTripPlanRepository` 在事务中执行原子预留和保存：`draft`、`ready`、`failed` 可以进入
`generating`，并发请求只有一个成功；版本使用 `(trip_id, version)` 唯一约束并递增。成功同时保存
`trip_plan_versions`、`trip_plan_days`、`trip_plan_items` 后置为 `ready`；异常只保留 `failed` 元数据，不留部分
快照或子表记录。读取始终带用户隔离条件，跨用户与不存在记录不可区分；最新列表只允许指向 ready 版本，并在读后通过
共享 Schema 校验 `tripId`、版本和状态一致性。所有响应使用 Api Envelope，`x-request-id` 和 `requestId` 保持一致。

小程序 `TripPlanService` 封装生成、单日重生成和只读版本调用，复用 `HttpClient`、`AuthService` 和共享 Zod Runtime Schema；
无 Token 不发网络请求，认证失效清除本地 Token。TASK-017 API 本身不包含编辑、公开未认证分享、地图 UI、实时价格、Redis、队列或精确 TSP；
小程序页面和生成体验属于 TASK-018。Migration 由 Drizzle Kit 生成并登记在 `apps/server/migrations/meta`，应用启动不自动执行；部署前必须人工审阅
`0005_trip_plan_versions.sql` 并显式运行 `db:migrate`。

### TripPlan 单日重新生成（TASK-019）

`POST /trips/:id/regenerate-day` 受 `AuthGuard` 保护，仅接受严格的
`RegenerateTripPlanDayInput`（`sourceVersion`、`dayNumber` 为正安全整数，`instruction` 首尾 trim 后最多 500 字符，禁止额外字段）。
服务端先按 `userId + tripId` 校验 Trip 和 `ready` 源版本，再确认目标日存在；上下文通过 Weather、Place、Route 和 RouteOrder 抽象读取，包含目标天气、已验证真实 POI/路线和相邻日快照，不接受客户端事实。
`TripPlanGenerationService.regenerateDay` 对不可信的单日输出执行严格 `TripPlanDaySchema`、天气/路线/Place 白名单校验，并且每次只调用一次 LLM。

单日操作与整单生成共用 Trip 行的原子 `generating` reservation，因此同一 Trip 不能并发生成；新完整快照在一个事务中写入递增版本，只有目标日替换，其余日、建议和提示保持不变，随后重算每日及分类/总预算并再次验证完整 `TripPlanSchema`。失败版本只保留 `failed` 元数据并恢复源版本的 `ready` 状态，旧版本的 JSON、日和条目行从不更新。读取和写入继续同时约束 `userId + tripId`，不存在或跨用户 Trip 使用 `TRIP_NOT_FOUND`；ready 源快照中不存在目标日时使用 `TRIP_PLAN_DAY_NOT_FOUND`，源版本非 ready 仍使用 `TRIP_PLAN_NOT_FOUND`。

小程序详情页为每个 ready 日提供普通文本 instruction 输入和“重新生成本日”按钮；状态由单飞 guard 控制，成功切换到返回的新版本，失败保留旧快照并允许重试，`AUTH_TOKEN_INVALID` 仍由 `AuthService` 清理认证状态。该能力不引入 Redis、队列、编辑 API、地图或实时协作。

### TripPlan 版本差异与不可变恢复（TASK-020）

`GET /trips/:id/plan/diff` 接受两个不同的正安全整数版本，仅允许比较当前用户的同一 Trip 下的 `ready` 快照。纯比较函数按 `dayNumber`
和稳定 `item.id` 匹配，完整比较每日摘要、天气、地点、路线、提醒、费用、住宿/餐饮建议、交通/通用提示和分类/总预算；对象值使用确定性
键序比较，输出按日号、条目 ID、字段名排序。`generatedAt` 不属于业务内容，单独更新时间不会产生差异；差异超过共享上限时返回验证错误，绝不静默
截断。

`POST /trips/:id/plan/:version/restore` 只接受空对象，目标必须是当前用户的 `ready` 版本。恢复在同一 Trip 事务中预留新版本并物化完整日/条目行，
复制源快照且更新 `generatedAt`，成功后 Trip 为 `ready`；历史版本保持不可变。整单生成、单日重生成和恢复共享同一个原子 `generating`
reservation（`operation` 分别为 `generate`、`regenerate-day`、`restore`），并发请求统一返回进行中错误；失败只保存 `failed` 元数据并恢复操作前的
`ready` 状态。服务不调用 LLM、天气、POI 或路线 Provider，且不引入 Redis、队列、聊天、地图、分享和协作能力。

小程序详情页只用原生 `text/view` 展示两个 ready 版本之间的结构化差异，并为非当前版本提供恢复按钮；恢复采用单飞 loading，成功切换到新版本，失败
保留当前快照，`AUTH_TOKEN_INVALID` 继续通过 `AuthService` 清理认证状态。

### TripPlan 受控内容编辑（TASK-021）

编辑接口 `PATCH /trips/:id/plan/:version` 只接受严格的 `EditTripPlanInput`，并要求 body 的 `sourceVersion` 与 URL
版本一致。白名单仅包括计划 `summary`；每日 `summary`、结构化 `warnings`；行程条目的 `description`、
`recommendationReason`、`tips` 和 `estimatedCostCny`。Schema 使用 strict object，至少包含一项编辑，拒绝未知字段、重复日号/条目 ID、
越界数组和超长文本；地点、路线、来源、生成时间、Schema 版本和预算分类汇总等服务端事实不能由客户端提交。

服务端先按 `userId + tripId` 做认证隔离，再读取同一用户的 ready 源快照并校验快照 `tripId`。纯函数 `applyTripPlanEdits` 复制快照而不修改源对象，
对不存在的日/条目统一返回 `TRIP_PLAN_ENTITY_MISMATCH`，重新通过完整 `TripPlanSchema`，从条目金额重算每日和分类/总预算；若没有实际业务变化则在
reservation 之前验证失败，不创建新版本。
编辑不会调用 LLM、天气、POI 或路线 Provider，`generatedAt` 由服务端生成。

`TripPlanRepository` 的 `reserveEdit` 与生成、单日重生成、恢复共用同一个 Trip 行级原子 `generating` reservation，且记录稳定
`operation='edit'`。成功事务同时写入新递增版本、日和条目并切换 Trip 为 `ready`；任何失败只保留 `failed` 版本元数据，恢复编辑前的 `ready` 状态，
旧 JSON 和历史子表行不可变。小程序只在 ready 版本显示摘要、行程描述/推荐理由/小贴士/金额编辑入口，不提供 warnings 编辑控件，使用单飞 loading，成功切换版本，失败保留旧攻略和输入草稿；认证失效仍集中由
`AuthService` 处理。当前边界仍不包含聊天、地图、分享、实时价格和多人协作。

### TripPlan 具体地点替换（TASK-022）

`GET /trips/:id/plan/:version/items/:itemId/replacement-candidates` 与
`POST /trips/:id/plan/:version/replace-item` 均受 `AuthGuard` 保护。候选列表由服务端从既有 `PlaceService` 读取并经过共享
Schema 校验，仅允许 `attraction`、`food`、`hotel` 条目，排除原地点、重复 Provider POI、计划中已使用的 POI 和无坐标 POI，最多 20 条。
候选请求必须带 `dayNumber`，可选 `page` 和 `pageSize`（`page >= 1`、`1 <= pageSize <= 20`）；分页边界透传给 `PlaceService`，
响应严格为 `{ items, pagination }`，候选包含 `place` 与 `recommendationReason`，不添加 `itemType` 等额外字段。替换请求和结果包含
`dayNumber`，服务端只允许替换该日中的条目。
替换请求的 POI ID 只能来自服务端重新验证的候选列表，客户端不能提交 Place 事实。

替换在读取 ready 源快照后创建不可变递增版本；通过既有 `RouteService` 重算替换项前后相邻的真实路线，任一受影响路线不可用都返回
`TRIP_PLAN_REPLACEMENT_UNAVAILABLE`，不伪造距离/时长，也不静默删除旧路线。除目标地点和受影响路线外，日期、时间、天气、其他日期和其余事实字段保持不变，
结果再次通过完整 `TripPlanSchema`，不调用 LLM。`operation='replace-item'` 与生成、单日重生成、恢复、编辑共用 Trip 行级原子
`generating` reservation；成功事务写入完整版本快照，失败仅保留 `failed` 元数据并恢复原 `ready` 状态，无 Redis、队列或 Migration。
小程序详情页只用原生文本列出候选、二次确认并单飞提交，成功切换版本，失败保留旧快照和选择，认证失效由 `AuthService` 处理；不引入地图、HTML、chat 或实时价格。

### TripPlan 同日 Timeline 顺序调整（TASK-023）

新增受认证的 `POST /trips/:id/plan/:version/reorder-items`。严格 `ReorderTripPlanItemsInput` 要求
`sourceVersion` 与 URL 版本一致，`dayNumber` 指向 ready 源快照中的目标日，`orderedItemIds` 必须完整且唯一覆盖该日条目；纯函数
`reorderTripPlanDayItems` 不修改源快照，并在 reservation 前拒绝实体集合不完整、重复或顺序无变化。

服务端按新顺序复用 `RouteService` 估算所有相邻地点的真实路线，按源条目的游览时长保持当天最早开始时间并确定性加入真实路线分钟数，拒绝不可用路线、重叠和跨日；不直连 Provider 或直线估算。费用/预算不变，完整新快照再次通过 `TripPlanSchema`。
`operation='reorder-items'` 与生成、单日重生成、恢复、编辑和地点替换共享 Trip 行级原子 reservation；成功事务保存递增不可变 ready 版本，失败仅保存失败元数据并恢复操作前 ready，历史版本和子表行不可变，无 Redis、队列或 Migration。

小程序详情页仅提供原生上移/下移按钮形成按日顺序草稿，并可恢复原顺序；保存为新版本前二次确认，确认后才单飞提交，成功切换版本，失败保留当前攻略和顺序草稿，认证失效继续由 `AuthService` 处理，不引入拖拽库、地图、HTML 或聊天。

### TripPlan 同日 Timeline 自动路线顺序优化（TASK-024）

优化接口 `POST /trips/:id/plan/:version/optimize-order` 使用严格的
`OptimizeTripPlanDayInput`，只允许服务端根据源版本目标日的真实地点条目确定顺序；可选 `startItemId`/`endItemId` 必须是目标日真实地点且不能相同。纯函数 `optimizeTripPlanDayItems` 只校验完整条目集合并复制快照，不调用 Provider、不估算时间或路线事实。

TripPlanService 在任何路线查询前通过 `operation='optimize-order'` 预留共享 Trip 行级 reservation。随后由 `RouteMatrixService` 获取真实矩阵，`RouteOrderService` 对同一矩阵运行 nearest-neighbor；优化层不直连地图 Provider，不使用直线距离、固定速度、TSP 或伪造路线。真实地点按结果填充原地点槽位，非地点条目保持原相对顺序；使用源条目游览时长、当天最早开始时间和真实相邻路线耗时重算时间，拒绝 unavailable、重叠和跨日结果。

成功快照再次通过完整 `TripPlanSchema`，金额、预算、源版本和其他日期保持不变，并在事务中保存新的不可变 ready 版本。失败只留下 failed 元数据并恢复原 ready 状态；该 reservation 与生成、单日重生成、恢复、编辑、地点替换和手工顺序调整互斥。小程序详情页仅使用原生控件提供可选起点/终点、二次确认、单飞提交和失败保留，不增加地图、拖拽、HTML、导航、聊天、实时价格、Redis 或队列。

### TripPlan 自动优化只读审计（TASK-025）

`GET /trips/:id/plan/:version/optimize-audit` 受认证保护，查询始终带 `userId + tripId`，只读取 `ready` 版本，不创建 reservation、不写数据库，也不重新调用 RouteMatrix、地图 Provider、LLM 或天气。共享 strict Schema 将审计候选限制为：available 必须携带真实距离和耗时，unavailable 禁止携带伪造度量；decision 必须逐步对应最终顺序，timeline change 必须对应保存的时间和 RouteEstimate，并明确 nearest-neighbor 不保证全局最优。

TASK-024 的 `trip_plan_versions` 只保存最终 TripPlan 快照，没有保存完整 RouteMatrix、候选排除原因或 RouteOrderExplanation。Repository 因而默认返回 `TRIP_PLAN_AUDIT_UNAVAILABLE`，服务端禁止从最终路线反推候选。保留可选的 evidence repository seam 供未来版本持久化完整审计事实；在证据存在时仍会重新通过完整 Schema、TripPlan、路线度量和可选 sourceVersion 快照校验，任何篡改均稳定失败。小程序详情页仅用原生文本显示可回放审计或证据缺失提示，失败不清空当前攻略，`AUTH_TOKEN_INVALID` 由统一 AuthService 清理。

### 小程序 TripPlan 生成流程与只读详情（TASK-018）

首页提交由轻量表单状态转换为严格 `CreateTripInputSchema` 输入，先检查 `AuthService` 登录状态，再保存本地草稿并调用
`POST /trips`；创建或后续生成失败时草稿保持不变。提交和生成均使用单飞（single-flight）保护，避免重复创建或重复生成。
生成页按“正在准备旅行需求、正在查询天气、正在筛选景点、正在规划路线、正在生成攻略、正在保存攻略”六段中文阶段文案循环提示，不对应服务端百分比或完成状态；成功、失败、认证失效和页面卸载都会停止并清理阶段
定时器，失败可重试且不会重置草稿。

`pages/trip-plan/index` 只渲染经过共享 `TripPlanSchema` 和版本结果 Schema 校验的 `ready` 快照。页面包含头部、每日天气和
时间线、已验证地点、真实路线、日/总费用、提示与 warning，以及住宿、餐饮、交通、通用提示和分类预算。天气的
`forecast`、`climate_reference`、`unavailable` 语义分别显示预报、历史气候参考通知和“暂无可靠天气数据”；没有路线或路线
`unavailable` 时只展示缺失/不可用状态，不生成距离、时长或费用。普通文本使用原生 `text/view`，不解析 `rich-text`。

详情页对 URL 的 `tripId` 和可选 `version` 做 UUID/整数范围校验；历史版本最多保留 100 条摘要（包括生成中、失败和可查看状态），只有 `ready` 摘要进入切换选择器，切换请求失败或返回
非 `ready` 状态时保留旧快照。认证令牌和失效清理继续集中在 `AuthService`，页面与 adapter 不记录令牌、Prompt、Provider 原始
响应或任何密钥。TASK-018 明确不实现编辑、单日重生成、替换地点、聊天、地图、分享、实时价格、Redis/队列/实时协作功能。
