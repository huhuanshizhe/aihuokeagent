# AI Lead Gen

Discovery MVP acceptance and its frozen API boundary are documented in [docs/discovery-mvp-acceptance.md](docs/discovery-mvp-acceptance.md).

The standard/deep completion modes and field-evidence response contract are documented in [docs/enrichment-api.md](docs/enrichment-api.md).

Enrichment MVP acceptance evidence and its production backlog are recorded in [docs/enrichment-mvp-acceptance.md](docs/enrichment-mvp-acceptance.md).

Docker deployment, API authentication, and offline-client examples are documented in [docs/deployment.md](docs/deployment.md).

`npm run dev` 连接 Neon PostgreSQL（`DATABASE_URL`）。首次启动前请执行 `npm run db:push` 同步表结构。

独立的 B2B AI 获客引擎。它从 VertaX 主项目的获客雷达能力中抽离，目标是形成可独立部署、可被 VertaX 或其他软件调用的多租户 API 服务。

## 产品边界

这个服务负责从目标客户定义到可交付线索的完整数据闭环：

1. **Target**：接收企业资料、产品、目标市场和 ICP 条件。
2. **Discover**：通过可插拔数据源发现企业、联系人或采购机会。
3. **Normalize & Deduplicate**：标准化公司、域名、地区和来源标识，跨数据源去重。
4. **Enrich**：补全官网、联系方式、决策人、公司画像和证据来源。
5. **Qualify**：依据 ICP、证据质量和购买信号进行评分、分层与解释。
6. **Deliver**：通过查询 API、Webhook 或批量导出，把合格线索交给 CRM、营销软件或 VertaX。
7. **Learn**：记录接受、拒绝、转化和无效反馈，用于改进搜索与评分。

邮件发送、社媒发布、内容生产和完整 CRM 不属于本服务核心职责。服务可以生成外联建议或交付线索，但具体触达由调用方完成。这样可以保持 API 内核聚焦，也避免与 VertaX 主项目其他模块重复。

## 当前状态

当前原型已具备：

- Express + TypeScript 服务入口
- Neon PostgreSQL + Drizzle ORM 持久化
- `SCAN -> ENRICH` 同步流程
- Google Places、AI Search、Apollo、Hunter 等数据源适配器
- Exa、Firecrawl 和 AI 辅助补全
- 简单的本地调试 UI

已完成的发现—补全闭环强化：

- 发现 provider 并行执行，默认只启用已配置且支持关键词搜索的数据源
- 使用官网域名或“公司名 + 国家”进行保守的跨来源去重
- 同一候选可关联多个扫描批次，并独立保存各 provider 的来源证据
- 依据匹配度和现有证据完整度选择最值得补全的公司
- 补全保留发现阶段已有的网站、邮箱、电话、描述和企业字段
- Exa、决策人、Hunter、Firecrawl 和 AI Profile 按依赖并行执行
- 每个补全阶段返回 `completed`、`skipped` 或 `failed` 及耗时
- 可选 provider 未配置时不再把整条可用线索判为失败
- Pipeline 请求包含边界校验、工作量限制和统一错误码
- 中文/英文国家名称在发现入口统一为 ISO 国家代码，Provider 和结果使用同一地区语义
- 发现结果入库前执行快速企业资格判断，论文、百科、论坛、教程和区域不匹配结果会被拦截
- 扫描结果区分 `totalFetched`、`totalFound`、`totalRejected` 与 `totalNew`，并保留拒绝样例及原因
- 多关键词会全部执行（最多 20 个），各 Provider 采用受控并发并保存逐关键词抓取统计
- 候选按匹配度最高的单个关键词评分，避免多关键词池稀释相关性
- 资格分为 `qualified`、`review`、`rejected`，边界企业进入待验证而不是直接丢弃
- Provider HTTP、配额和 AI 抽取警告会进入顶层 API 与页面提示；安全回退不会把目录、榜单或市场报告写成企业
- 泰国市场默认组合 Google Places、Brave Places 与泰国工业部 DIW 官方工厂底库；DIW 全量 CSV 下载后缓存在 `data/cache`，后续扫描复用
- Google Places 对泰国/越南使用国家矩形硬限制，工业关键词同时生成本地语言变体，并按主要工业省份轮转查询
- Brave Web 在不支持 `TH`/`VN` 国家枚举时使用 `ALL + loc:`；Brave Places 则使用城市名称和地理请求头定位

当前代码可以编译，但仍是单机验证原型，尚不适合直接作为对外 API。主要缺口包括：

- 无租户、调用方和 API Key 模型
- 无统一请求校验、错误码和版本化响应协议
- 扫描与补全在 HTTP 请求内同步执行，长任务不可靠
- 缺少任务状态、重试、幂等和取消机制
- 缺少配额、限流、成本统计和审计日志
- 缺少 OpenAPI 文档、Webhook 签名和 SDK 友好的契约
- 与 VertaX 主项目中的 Radar/Prospect 数据模型存在重复

## 目标架构

```text
VertaX / CRM / 客户软件
          |
      REST API v1
          |
 Auth + Tenant + Quota
          |
 Job Orchestrator -------- Webhook Delivery
          |
 Discover -> Normalize -> Enrich -> Qualify
          |                    |
   Source Adapters        Evidence Store
          |
     PostgreSQL + Queue
```

核心原则：

- **API first**：UI 只是 API 的一个客户端。
- **异步任务**：创建任务立即返回 `jobId`，通过轮询或 Webhook 获取结果。
- **租户隔离**：所有业务记录都必须属于一个 tenant，所有查询都在 tenant 范围内执行。
- **适配器隔离**：第三方数据源差异收敛到统一 provider contract。
- **证据优先**：评分和 AI 结论必须保留来源、时间和置信度。
- **可替换基础设施**：业务逻辑不直接依赖 Express、SQLite 或某个队列产品。

## API v1 最小闭环

建议第一版只承诺以下资源：

```text
POST   /v1/jobs                    创建 discover/enrich/full-pipeline 任务
GET    /v1/jobs/:jobId             查询任务状态与进度
POST   /v1/jobs/:jobId/cancel      取消尚未完成的任务
GET    /v1/leads                   分页查询线索
GET    /v1/leads/:leadId           获取线索、联系人、评分和证据
POST   /v1/leads/:leadId/feedback  提交接受/拒绝/转化反馈
POST   /v1/webhooks                注册结果通知地址
GET    /v1/providers               查询可用数据源与健康状态
GET    /health                     存活检查
GET    /ready                      依赖就绪检查
```

## 公开扫描 API（vertax 客户端契约）

面向 vertax-local / 外部调用方的精简发现接口。只做 SCAN，不做 ENRICH。

```text
POST /api/public/scan
```

请求体：

```json
{ "keyword": "wedding photography", "country": "泰国" }
```

约定：

- `keyword`：单个非空字符串（不接受数组）
- `country`：ISO 码 / 英文名 / 中文名（如 `TH`、`Thailand`、`泰国`）；无法识别返回 400
- 适配器：固定自动规划（与调试 UI「自动规划数据源」一致）
- `maxResults`：固定为 20（调用方不可改）
- 鉴权：与其它业务 API 相同；配置了 `SERVICE_API_KEY` 时需 `Authorization: Bearer <key>` 或 `X-Api-Key`
- 成功响应一次返回：`{ "success": true, "data": { runId, duration, totalFetched, totalFound, totalNew, totalQualified, totalReview, totalRejected, errors, warnings, candidates } }`
- **无需**再调 `GET /api/scan/results`；普通 `POST /api/scan` 同样直接带 `candidates`
- `GET /api/scan/results?runId=` 仅用于回看历史（如调试页「历史记录」）
- 公开接口不返回 `resourcePlan` / `adapterResults` / samples 等调试字段

本地测试页：`http://localhost:3100/public-scan.html`（顶栏「公开 API」）。

## Discovery Resource Registry

系统通过版本化资源包积累国家与行业经验：

- `resources/markets`：国家语言、地理边界、区域集群、本地查询表达和首选来源
- `resources/industries`：行业意图、关键词、排除词、本地术语、资格信号
- `resources/sources`：来源覆盖、权威性、字段、成本、更新、缓存和生命周期

资源 API：

```text
GET  /api/resources                 查看完整资源目录
POST /api/resources/plan            生成国家 × 行业发现策略
GET  /api/resources/metrics         查看匿名来源效果
POST /api/resources/reload          重新加载版本化 JSON
GET  /api/resources/markets/:code   查看市场包
GET  /api/resources/industries/:id  查看行业包
```

浏览器管理/诊断页为 `http://localhost:3100/resources.html`。`research` 来源只展示，不会进入自动执行；每次扫描会把来源、国家、行业、耗时与质量结果写入匿名指标，并在样本达到两次后参与规划排序。

创建完整流水线任务的建议输入：

```json
{
  "type": "full_pipeline",
  "target": {
    "industries": ["industrial automation"],
    "countries": ["DE", "PL"],
    "companyTypes": ["distributor", "system integrator"],
    "products": ["robotic painting system"]
  },
  "limits": {
    "maxCandidates": 100,
    "maxEnrichments": 20
  },
  "callbackUrl": "https://example.com/webhooks/lead-gen"
}
```

## 与 VertaX 主项目的关系

短期不复制主项目的全部 Radar 实现。迁移时按能力拆分：

- 子项目拥有：provider adapters、任务编排、标准化、去重、补全、评分、证据和对外 API。
- VertaX 拥有：登录与工作台 UI、知识引擎、内容增长、社媒运营、外联执行和业务 CRM 状态。
- 两者通过 API/Webhook 连接，不共享运行时数据库。
- 主项目中成熟的 Radar 算法应逐项迁入共享的纯业务模块，而不是继续复制文件。

## 交付阶段

### Phase 0：稳定原型

- 建立统一 API 响应与错误协议
- 增加 Zod 请求校验、日志、配置校验和基础测试
- 拆开 HTTP、业务服务和存储层
- 固化 provider contract 与标准化 Lead schema

### Phase 1：可集成 API

- API Key 鉴权与 tenant 隔离
- 异步 Job 模型、进度、重试、幂等和取消
- OpenAPI 3.1 文档
- Webhook 投递、签名和重试
- 配额、限流、调用成本与审计日志

### Phase 2：生产化

- PostgreSQL 持久化与数据库迁移
- 可靠队列和 worker 独立部署
- 结构化日志、指标、追踪和告警
- 数据保留、删除、密钥管理和合规策略
- 负载、故障恢复与租户隔离测试

### Phase 3：获客质量闭环

- ICP 规则与可解释评分
- 反馈学习与排除规则
- 多来源实体合并和证据时效
- 成本/覆盖率/准确率评估
- VertaX 适配器与通用 SDK

## 本地运行

```bash
npm install
copy .env.example .env
npm run dev
```

默认地址为 `http://localhost:3100`，健康检查为 `GET /api/health`。

### 阿里云百炼模型配置

发现阶段的 AI 搜索会调用百炼模型，把搜索结果抽取成结构化企业候选。中国内地（北京地域）默认配置为：

```env
DASHSCOPE_API_KEY=sk-你的百炼密钥
DASHSCOPE_BASE_URL=https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions
DASHSCOPE_MODEL=qwen3.7-plus
```

API Key 必须在百炼控制台创建并只保存在本机 `.env`。项目仍兼容旧的 `TEXT_API_KEY`、`TEXT_BASE_URL` 和 `TEXT_MODEL` 变量；若两套变量同时存在，优先使用 `DASHSCOPE_*`。

泰国官方工厂数据不需要 API Key。首次泰国扫描会从工业部 DIW 下载全量 CSV 并缓存；也可以提前指定本地文件：

```env
THAI_FACTORY_CACHE_PATH=D:\data\thailand-factories.csv
```

完整发现—补全调用：

```bash
curl -X POST http://localhost:3100/api/pipeline/run \
  -H "Content-Type: application/json" \
  -d '{
    "keywords": ["industrial automation distributor"],
    "countries": ["DE"],
    "maxResults": 25,
    "enrichTopN": 10,
    "enrichmentConcurrency": 3
  }'
```

构建：

```bash
npm run build
npm test
npm run verify:schema
```

## 下一步

从 Phase 0 开始，第一批代码应优先完成 API 契约、输入校验、统一错误处理和测试基线；在这些边界稳定后，再引入数据库和队列，避免基础设施变化反复影响业务逻辑。
