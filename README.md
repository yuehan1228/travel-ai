# AI 智能旅游攻略微信小程序

这是项目的 pnpm Monorepo。当前包含原生微信小程序壳、旅行需求本地表单草稿、NestJS +
Fastify 健康检查、微信登录、应用 Access Token、共享类型与 Schema，以及本地
PostgreSQL/Redis 编排。服务端已建立 PostgreSQL + Drizzle 的数据库基础模块、users Schema
和用户 Repository；当前已实现经过认证的旅行需求草稿 CRUD 和可替换的天气查询基础能力。

## 环境要求

- Node.js 20 或更高版本
- pnpm 9 或更高版本
- Docker Compose（仅本地基础设施需要）
- 微信开发者工具（仅运行小程序需要）

## 安装与验证

```bash
pnpm install
pnpm lint
pnpm typecheck
pnpm build
pnpm test
```

`pnpm format` 会格式化项目维护的源文件和配置。提交前建议再次运行其余四项检查。

## 启动后端

复制环境变量模板并按本机环境填写：

```bash
cp .env.example .env
pnpm build
pnpm --filter @travel-guide/server start
```

服务默认监听 `http://localhost:3000`，健康检查地址为：

```text
GET http://localhost:3000/health
```

服务启动时会校验 `NODE_ENV`、`PORT` 以及服务端微信/JWT 配置。每个 HTTP 响应都会带有 `x-request-id`：服务会
保留长度和字符合法的客户端请求 ID，否则使用 Node.js 标准库生成新的 ID。除成功的
`GET /health` 外，错误响应使用共享的 `ApiFailure` Envelope，并对 404 和未预期异常提供
稳定、脱敏的错误码；详细异常只写入脱敏服务端日志。`.env.example` 中的数据库和 Redis
密码仅为本地占位值，不应直接用于共享或生产环境。

## 启动本地基础设施

```bash
docker compose --env-file .env -f infra/docker/docker-compose.yml up -d
```

当前 Compose 只包含 PostgreSQL 和 Redis。`DatabaseModule` 使用 `pg` Pool 和 Drizzle
实例，但按模块显式导入；创建 Pool 不会主动查询，第一次数据库操作时才连接。应用启动
不会自动执行 Migration，必须显式执行：

```bash
pnpm --filter @travel-guide/server db:generate
pnpm --filter @travel-guide/server db:migrate
pnpm --filter @travel-guide/server db:check
```

`db:migrate` 失败时会返回非零状态。Migration 文件位于 `apps/server/migrations/`，可在
执行前审阅。当前提供经过认证的旅行需求草稿 CRUD（`POST /trips`、`GET /trips`、
`GET /trips/:id`、`PATCH /trips/:id`、`DELETE /trips/:id`）。天气查询使用 `GET /weather`，
也要求应用 Access Token。

地点/POI 查询使用需要认证的 `GET /places`，查询参数为 `cityName`、可选 `cityCode`、`keyword`、逗号分隔的
`categories`、`page` 和 `pageSize`。服务端通过可替换的 `PlaceProvider` 隔离地图供应商，当前适配器固定访问高德
POI 文本搜索接口；小程序仅提供类型安全的 `PlaceService`，尚未接入地图页面或 POI 选择流程。POI 必须来自地图
供应商或经过验证的缓存，不使用 AI 生成缺失地点。公共 POI 缓存不按用户拆分，Migration 不会自动执行。

路线估算使用需要认证的 `POST /routes/estimate`，当前支持 `walking` 和 `driving` 两点路线。服务端通过可替换的
`RouteProvider` 隔离高德路线规划 API，返回真实的道路距离和供应商预计耗时；不会用直线距离或固定速度推算，
也不会返回步骤指令或 Polyline。公共 `route_cache` 使用 PostgreSQL 和固定长度 SHA-256 key，不包含 userId 或
API Key。供应商暂时失败时仅在配置的 stale-if-error 窗口内返回已验证旧缓存；没有路线时返回
`ROUTE_UNAVAILABLE`，不携带伪造的距离、时长或费用。小程序 `RouteService` 只发送 Bearer Token，不保存地图
API Key。

路线矩阵使用需要认证的 `POST /routes/matrix`，接受 2～10 个带唯一 ID 的点，生成有向非对角线的两点组合。矩阵
逐条复用 `RouteService` 和公共两点缓存，最多并发 4 个查询；单条路线不可用时仅标记对应 cell，不伪造距离、时长或
费用。全部路线均不可用时返回 `ROUTE_MATRIX_UNAVAILABLE`，输入和 Provider 系统性失败分别返回稳定的矩阵错误码。
小程序 `RouteMatrixService` 复用现有 Bearer Token、HTTP Client 和共享 Zod Schema。多途经点优化（TSP）、公交详情、
地图 UI 和 LLM 公共生成接口仍未实现。

共享包现已提供严格的 `TripPlan`、`TripPlanDay` 和 `TripPlanItem` 结构化契约，用于后续 AI
Structured Output 与小程序 Runtime 校验；Schema 只能校验来源字段的一致性，`providerPlaceId` 等实体真实性白名单
仍需由服务端生成编排基于已验证的 POI 数据执行。TASK-016 增加了不暴露 HTTP 接口的
`TripPlanGenerationService`、可替换 `LLMProvider`、Fake Provider 和版本化 Prompt；服务只接受经过严格
校验的天气、POI 和路线 Context，最多向模型提供 30 个候选 POI，并在返回后再次校验 TripPlan、Place、RouteEstimate
和天气白名单。OpenAI-compatible Provider 只从服务端 `LLM_*` 配置读取 Host、API Key 和模型，设置请求超时，供应商
原始响应和 Prompt 不写入日志；测试只使用 Fake Provider。TASK-016 本身不注册 HTTP 生成接口；后续 TASK-017 接入了版本化生成 API，
TASK-018 再接入小程序生成流程和只读攻略页面。

### TripPlan 生成 API（TASK-017）

TripPlan 生成已经接入受认证的版本化 API：`POST /trips/:id/generate` 只接受严格空对象 `{}`，
服务端从当前用户拥有的 Trip 组装已验证的输入、天气、POI、路线和路线顺序；客户端不能传入模型、Provider、
Prompt、天气或 POI。读取使用 `GET /trips/:id/plan`（版本摘要及最新 ready 快照）和
`GET /trips/:id/plan/:version`（指定版本）。三个接口都要求 `Authorization: Bearer <access-token>`，
并返回共享 `ApiSuccess` Envelope；`x-request-id` 与 Envelope 的 `requestId` 一致。

版本状态为 `generating`、`ready`、`failed`。一次只有一个请求可以从 `draft`、`ready` 或 `failed` 原子预留为
`generating`；并发请求返回 `TRIP_PLAN_GENERATION_IN_PROGRESS`。成功事务同时写入
`trip_plan_versions`、`trip_plan_days` 和 `trip_plan_items` 并切换为 `ready`；失败事务切换为 `failed`，不保存
部分 Plan 快照，版本号按 Trip 递增且不可修改。所有读取和写入同时带 `userId` 与 `tripId`，跨用户和不存在的
Trip/版本使用统一的脱敏错误。稳定错误包括 `TRIP_NOT_FOUND`、`TRIP_PLAN_NOT_FOUND`、`TRIP_PLAN_DAY_NOT_FOUND`、
`TRIP_PLAN_GENERATION_IN_PROGRESS`、`TRIP_PLAN_VALIDATION_ERROR`、`TRIP_PLAN_PROVIDER_ERROR`、
`TRIP_PLAN_OUTPUT_INVALID`、`TRIP_PLAN_ENTITY_MISMATCH`、`TRIP_PLAN_UNAVAILABLE` 和
`TRIP_PLAN_PERSISTENCE_ERROR`。

新增 Drizzle Migration `apps/server/migrations/0005_trip_plan_versions.sql` 及对应 `migrations/meta` journal/snapshot，
包含版本唯一约束、日/条目外键、状态/快照检查和索引。应用启动不会自动执行 Migration；请先审阅 SQL，再显式运行
`pnpm --filter @travel-guide/server db:migrate`。小程序仅提供类型安全的
`generateTripPlan`、`getLatestTripPlan`、`getTripPlanVersion` 服务，复用 HTTP/Auth/Bearer 和共享 Schema；缺少 Token
不会联网，`AUTH_TOKEN_INVALID` 会清理认证状态。不新增攻略编辑、单日重生成、页面、地图 UI、实时价格或精确 TSP。

### 小程序 TripPlan 生成与只读详情（TASK-018）

小程序首页提交顺序为“表单校验 → 登录检查 → `CreateTripInputSchema` → 保存本地草稿 →
`POST /trips` → 进入生成页”。创建或生成失败不会清除草稿；提交按钮和生成请求均有重复保护。
生成页按“正在准备旅行需求、正在查询天气、正在筛选景点、正在规划路线、正在生成攻略、正在保存攻略”六阶段循环展示体验文案，只表示当前工作阶段，不伪造百分比或完成状态；页面卸载、成功和失败都会清理
定时器。服务返回 `generating`、认证失效或稳定错误码时分别显示等待、重新登录或可重试的中文提示。

`pages/trip-plan/index` 是只读攻略详情页：所有响应先通过严格 `TripPlanSchema`/版本 Schema，再渲染头部、每日天气、
时间线、地点、路线、费用、提示和提醒，以及住宿、餐饮、交通、通用提示和分类预算。`forecast`、`climate_reference`、
`unavailable` 分别按预报、历史气候参考和无可靠数据展示；缺失或不可用路线不填充距离、时长或费用，不使用 `rich-text`。
历史版本最多保留 100 条摘要（包括 `generating`、`failed` 和 `ready`）；只有 `ready` 版本可切换并渲染，切换失败时保留当前已显示的攻略。页面参数也经过 UUID/版本 Schema 校验，认证令牌
仍只由 `AuthService` 管理。TASK-018 本身不包含攻略编辑、单日重生成、替换地点、聊天、地图、分享、实时价格或协作功能。

### TripPlan 单日重新生成（TASK-019）

服务端新增受认证的 `POST /trips/:id/regenerate-day`。请求体严格限制为
`{ sourceVersion, dayNumber, instruction? }`：版本和日号是正安全整数，instruction 会去除首尾空白并限制为 500 字符，额外字段一律拒绝。
源版本必须属于当前用户且为 `ready`，目标日必须存在；天气、真实 POI、路线和相邻日上下文均由服务端通过既有抽象组装，客户端不能提交或伪造事实。
单日生成只调用一次可替换的 LLM，并在 Schema 和真实实体白名单校验后，仅替换目标日，重新计算每日及总预算。

单日重生成与整单生成共享 Trip 行级原子状态和版本号 reservation，同一旅行需求同时只能有一个操作。成功在事务中保存完整新快照并递增版本；失败只保留 `failed` 元数据并恢复原有 `ready` 状态，旧版本及其日/条目快照不可变。
跨用户或不存在的 Trip 统一返回 `TRIP_NOT_FOUND`，其他稳定 TripPlan 错误码沿用生成 API。小程序 `TripPlanService.regenerateTripPlanDay` 和只读详情页的每日按钮支持可选 instruction、单飞 loading、失败重试；成功切换到新版本，失败保留旧攻略，认证失效时清理 Token。仍不引入 Redis、队列、攻略编辑或实时协作。

### TripPlan 版本差异与恢复（TASK-020）

详情接口 `GET /trips/:id/plan/diff?fromVersion=1&toVersion=2` 只比较同一用户拥有的两个 `ready` 版本。比较按 `dayNumber` 和稳定的
`item.id` 匹配，完整检查天气、地点、路线、提醒、费用、建议和预算字段；`generatedAt` 只是生成元数据，单独变化不会形成业务差异。
差异输出按日号、条目 ID 和字段名排序，超过共享上限时返回稳定验证错误，不静默截断。

`POST /trips/:id/plan/:version/restore` 不接受客户端 Plan，恢复目标快照经 Schema 重新校验后复制到一个新的递增不可变版本，并更新
`generatedAt`。版本、日、条目和 Trip 状态在同一事务中保存；失败只留下失败元数据并恢复操作前的 `ready` 状态，历史版本不会被覆盖。
整单生成、单日重生成和恢复共用 Trip 行级原子 `generating` reservation，仍不使用 LLM、Redis、队列或后台任务。小程序详情页提供两个 ready
版本的普通文本差异查看和历史版本恢复入口，恢复加载或失败时保留当前攻略，认证失效仍由 `AuthService` 清理 Token。

访问顺序建议使用需要认证的 `POST /routes/order`，在真实路线矩阵上运行确定性的最近邻（nearest-neighbor）贪心算法。
请求可指定 `startId` 和 `endId`；未指定起点时按点 ID 字典序选择，候选路线按预计耗时、距离和目标 ID 依次打破平局，
并将指定终点保留到最后。不可用的两点路线不会参与候选；若无法覆盖全部点则返回 `ROUTE_ORDER_UNAVAILABLE`。结果明确标记
`algorithm=nearest_neighbor` 和 `isOptimal=false`，总距离与总耗时只汇总真实矩阵中的可用路线。该算法不保证全局最优，
不实现精确 TSP、动态规划、LLM 或地图展示；小程序 `RouteOrderService` 负责 Bearer Token 和共享 Schema 响应校验。

访问顺序解释使用 `POST /routes/order/explain`，与普通顺序请求复用同一次真实路线矩阵和两点缓存查询。每个决策会列出可用候选
的真实距离/耗时、不可用候选及排除原因，并明确说明最近邻启发式不保证全局最优；不可用候选不会携带伪造的距离或耗时。解释结果中的
`order`、`decisions`、`legs` 和汇总字段由严格共享 Zod Schema 校验，Provider 系统性失败和无法覆盖全部点仍分别映射为稳定的
`ROUTE_ORDER_PROVIDER_ERROR` 与 `ROUTE_ORDER_UNAVAILABLE`。小程序 `RouteOrderExplanationService` 复用现有认证和 HTTP Client，
缺少 Token 时不会访问网络，Token 失效时清理认证状态。

### 旅行需求草稿 API（TASK-008）

所有 `/trips` 请求都必须携带 `Authorization: Bearer <access-token>`。服务端从
TASK-007 的 `AuthGuard` 获取内部 `userId`，每一条列表、详情、更新和删除查询都同时带有
`userId` 条件；不存在的记录和其他用户的记录统一返回 `TRIP_NOT_FOUND`，不泄露所有权。

创建和更新会使用共享 `CreateTripInputSchema` 标准化完整旅行需求，并将标准化结果保存到
`input_snapshot`；冗余的 `city_name`、日期和人数列与快照保持一致。删除是软删除（设置
`status=deleted`、`deleted_at` 和 `updated_at`），默认列表、详情、更新和删除查询都会排除
已删除记录。API 返回共享 `ApiSuccess`/`ApiFailure` Envelope，并保留请求 ID。

### 天气查询 API（TASK-009）

`GET /weather` 需要携带 `Authorization: Bearer <access-token>`，查询参数为
`cityName`、可选的 `cityCode`、`startDate` 和 `endDate`。日期使用 UTC 纯日期计算，单次最多
14 天。服务通过 `WeatherProvider` 接口隔离供应商；当前生产适配器固定访问高德天气接口
（固定 Host，不接受客户端 URL）。选择高德是因为其中国大陆城市编码、中文天气类型和近
期逐日预报字段适合当前小程序场景；测试使用 Fake Provider，不访问真实网络。

天气日期完全落在供应商预报有效区间内时返回 `forecast`。超出区间的日期会请求可注入的历史
气候 Provider，并在有真实数据时标记 `source=climate_reference`、`isReference=true` 和提示
“当前距离出行时间较远，以下天气为历史气候参考。”。当前默认 Provider 没有内置历史数据，
因此没有真实数据时返回 `unavailable`，绝不伪造温度或天气类型。
预报和气候参考结果写入 PostgreSQL `weather_cache` 表，TTL 分别约为 45 分钟和 60 天，缓存按
标准化地点、日期范围、Provider 和数据来源共享，不按用户重复保存。应用启动不会自动执行
Weather Migration，执行前请审阅 `apps/server/migrations/0001_real_lockjaw.sql`。

如只需检查 Compose 配置，可运行：

```bash
docker compose --env-file .env.example -f infra/docker/docker-compose.yml config
```

## 运行微信小程序

小程序保持原生微信小程序实现，不使用 Taro、React 或 Vue。先安装依赖并生成微信运行时
依赖目录：

```bash
pnpm install
pnpm --filter @travel-guide/miniapp build:runtime
```

然后在微信开发者工具中导入 `apps/miniapp`。项目使用测试 AppID；在工具的“工具 → 构建
npm”中可以按 `project.config.json` 的 `packNpmRelationList` 重新构建 npm。由于 pnpm
workspace 的 symlink 在部分开发者工具版本中不能直接作为小程序运行时依赖，仓库提供的
`build:runtime` 会把 `@travel-guide/shared-types`、`@travel-guide/shared-schemas` 和
Zod 的浏览器可用运行时代码复制到被忽略的 `apps/miniapp/miniprogram_npm`，不把服务端
代码打入小程序。依赖或共享 Schema 变更后需重新执行该命令。

首页目前提供项目名称、当前环境、旅行需求表单、本地草稿保存和“检查服务状态”按钮。
提交时会在保留草稿的前提下调用受认证的 `POST /trips`，随后进入 TripPlan 生成页和只读详情页；
TripPlan 生成、详情和版本读取复用小程序 Trip/TripPlan Service。环境配置
集中在 `apps/miniapp/config/environment.ts`，支持 `development`、`test` 和 `production`；
测试环境使用本地地址，生产环境只保留 `.invalid` 占位地址。发布前应在不提交到仓库的本地
变更中替换生产 Base URL，并同时在微信公众平台的“开发 → 开发管理 → 开发设置 → 服务器
域名”中配置经过备案且合法的 HTTPS request 合法域名。不要把 API Key、AppSecret 或真实
生产域名提交到仓库。

后端基础层已提供请求 ID、JSON API 安全响应头、统一错误 Envelope 和优雅关闭；`GET
/health` 保留原始 `HealthResponse` 成功响应结构。`POST /auth/login` 通过抽象的微信
Code2Session Provider 查询或创建用户，并签发只用于应用认证的短期 Access Token。
数据库模块提供连接池、Drizzle 实例、基础 `users`、`trips` Schema 和用户 Repository。
微信 `session_key` 只在 Provider 解析响应期间存在，绝不保存、返回或记录；当前不提供
Refresh Token；Trip API 仅使用短期 Access Token，不引入 Redis Session。

## 目录结构

```text
apps/
  miniapp/          原生微信小程序
  server/           NestJS + Fastify 模块化单体
packages/
  shared-types/     前后端共享 TypeScript 类型
  shared-schemas/   Zod 运行时 Schema
  prompts/          后续 AI Prompt 包边界
  config/           共享环境类型和常量
docs/               架构和开发文档
infra/docker/       本地 PostgreSQL、Redis 编排
```

架构边界和后续演进原则见 [docs/architecture.md](docs/architecture.md)。

## 环境变量

| 变量                                                  | 用途                                            |
| ----------------------------------------------------- | ----------------------------------------------- |
| `NODE_ENV`                                            | `development`、`test` 或 `production`           |
| `PORT`                                                | 后端监听端口                                    |
| `POSTGRES_HOST` / `POSTGRES_PORT`                     | PostgreSQL 地址和端口                           |
| `POSTGRES_USER` / `POSTGRES_PASSWORD` / `POSTGRES_DB` | 本地 PostgreSQL 配置                            |
| `POSTGRES_SSL`                                        | 是否启用 PostgreSQL SSL（`true`/`false`）       |
| `POSTGRES_POOL_MIN` / `POSTGRES_POOL_MAX`             | 连接池最小/最大连接数                           |
| `POSTGRES_IDLE_TIMEOUT_MS`                            | 空闲连接超时（毫秒）                            |
| `POSTGRES_CONNECTION_TIMEOUT_MS`                      | 建立连接超时（毫秒）                            |
| `REDIS_HOST` / `REDIS_PORT`                           | Redis 地址和端口                                |
| `REDIS_USERNAME` / `REDIS_PASSWORD` / `REDIS_DB`      | 本地 Redis 配置                                 |
| `WECHAT_APP_ID` / `WECHAT_APP_SECRET`                 | 服务端微信 Code2Session 配置                    |
| `JWT_ACCESS_SECRET`                                   | 服务端 Access Token 密钥（至少 32 字符）        |
| `JWT_ACCESS_EXPIRES_IN_SECONDS`                       | Access Token 有效期（300～86400 秒）            |
| `WEATHER_PROVIDER`                                    | 服务端天气 Provider 名称（默认 `amap`）         |
| `WEATHER_API_KEY`                                     | 服务端天气 Provider API Key                     |
| `WEATHER_REQUEST_TIMEOUT_MS`                          | 天气供应商请求超时（500～30000 毫秒）           |
| `WEATHER_FORECAST_HORIZON_DAYS`                       | 预报有效天数（1～14 天）                        |
| `PLACE_PROVIDER`                                      | 服务端地点 Provider（当前仅 `amap`）            |
| `PLACE_API_KEY`                                       | 服务端地图/POI Provider API Key                 |
| `PLACE_REQUEST_TIMEOUT_MS`                            | 地点供应商请求超时（500～30000 毫秒）           |
| `PLACE_CACHE_TTL_SECONDS`                             | POI 搜索缓存 TTL（60 秒～7 天）                 |
| `ROUTE_PROVIDER`                                      | 路线 Provider（当前仅 `amap`）                  |
| `ROUTE_API_KEY`                                       | 服务端路线 Provider API Key                     |
| `ROUTE_REQUEST_TIMEOUT_MS`                            | 路线供应商请求超时（500～30000 毫秒）           |
| `ROUTE_CACHE_TTL_SECONDS`                             | 路线缓存 TTL（60 秒～7 天）                     |
| `ROUTE_STALE_IF_ERROR_SECONDS`                        | Provider 失败时可使用旧缓存的窗口（0～7 天）    |
| `LLM_PROVIDER`                                        | 服务端 LLM Provider（当前 `openai_compatible`） |
| `LLM_BASE_URL` / `LLM_API_KEY`                        | 服务端 LLM Host 和密钥（仅服务端）              |
| `LLM_MODEL`                                           | 服务端模型名称                                  |
| `LLM_REQUEST_TIMEOUT_MS`                              | LLM 请求超时（500～120000 毫秒）                |
| `LLM_MAX_OUTPUT_TOKENS`                               | Structured Output 最大 token 数（128～16384）   |
| `LLM_ALLOW_INSECURE_LOCALHOST`                        | 仅开发/测试显式允许本地 HTTP（生产必须 HTTPS）  |

微信登录流程为：小程序调用 `wx.login()` 获取一次性 code，调用 `POST /auth/login`；服务端
通过固定的微信 Code2Session URL 换取 OpenID，按 OpenID 幂等创建 users 记录，再签发应用
自己的 HMAC-SHA256 Access Token。Token 校验验证签名、有效期、issuer 和 audience，JWT 中
只保存内部用户 ID 等认证 claims，不复用微信 `session_key`。

服务端测试通过注入 Fake WechatProvider 和 Fake UserRepository 完成，不访问真实微信接口、
网络或 PostgreSQL。小程序只保存版本化的 Access Token 和最小用户资料，损坏缓存会被清除；
不会保存 code、OpenID、UnionID、session_key 或任何服务端密钥。当前没有 Refresh Token、
手机号/头像昵称授权、公共攻略生成 API、地图 UI 或路线优化；TASK-016 的 LLM Provider 和生成编排仅供服务端内部使用，当前路线模块只提供受认证保护的两点真实路线估算，POI 仅提供受认证保护的检索基础层，天气参考不等同于准确预报，首页仍保持 TASK-004
的本地旅行表单和草稿行为。

不要将 `.env`、真实密码、微信 AppSecret、JWT Secret、天气/地图/LLM API Key 提交到仓库；天气
API Key 只存在服务端配置，不会进入小程序 Runtime。
