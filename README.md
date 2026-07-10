# AI 互动故事

把角色 / 世界 / 故事 / 玩家设定做成卡组，AI 结合多角色、世界书、故事书、运行状态和记忆，生成可玩的互动故事回合（叙事 + 角色发言 + 玩家选项 + 状态更新）。上传文档或和 AI 对话就能建卡，不用手填字段。

> 任务 / bug / UI 问题 / 客户需求追踪走团队 **Linear**（YoRHa workspace);见 `CLAUDE.md` + 父 repo `decisions/2026-06-15-tooling-linear.md`。

## 特性

- **四类卡**：角色卡(NPC)、主角卡(玩家)、设定卡(世界书)、故事卡(故事书)。每类都能「贴文档 / 上传 AI 自动识别」或「多轮对话引导建出来」。
- **统一上传**：一个框扔进任意设定文字，AI 自动判类型并归位。
- **故事书结构化**：多结局(各自触发条件)、时间线、事件节点；完整故事或离散点子都能解析，缺字段 AI 推断并标「待确认」。
- **世界时钟**：故事内时间随情节流动，事件按时间 / 主线停滞主动恶化登场(不靠轮数)。
- **角色一致性**：每轮先做 CoT 自检，防角色 OOC / 无依据神化；玩家违背硬设定时世界用设定内逻辑挡回(生成时拒，不跳出故事)。
- **运行状态**：场景、玩家状态、关系、人物日志、事件时间线、事实边界，自动维护。
- **记忆**：standard(近期原文 + 滚动摘要) / deep(向量召回)，按上下文预算自适应。**可靠性硬化(Phase 1)**：问具体事实召不到时 in-character 认忘而非编造、不把编的内容写回记忆、发言者硬绑已知实体(挡幻觉角色)。
- **纯聊**：单角色 1v1 直聊(不走故事引擎)。
- **流式 + 并发**：回合叙事逐字输出，异步端点支持多人同时玩。
- **模型适配层**：引擎产出模型无关的 `ContextBundle`，适配器(DeepSeek / Claude)按目标模型组装 messages + 按 call_type 路由，换模型不改引擎核心。
- **受控本机反代**：operator 可按账户授权 Codex/OpenAI-compatible 本机反代；玩家浏览器负责模型调用，中央后端继续管理状态、记忆和存档。
- **接入**：MCP server(任意 MCP 客户端如 Claude Code / Desktop 直接驱动引擎) + Claude Skill。
- **评测平台**：自动 playthrough(LLM player bot) + Claude 作 judge + 动态维度 + 回归检测，住 `eval/`。
- **单对话重 roll**、**每轮 token 用量**、**会话续玩 / 存档**、**故事预设**(配好的卡组一键开新局 + 选人页)、**卡库**(建好 / 上传的卡集中管理)。

## 技术栈

- 后端：Python 3.12 + FastAPI
- LLM：DeepSeek(走 OpenAI 兼容协议，改 `.env` 即可换任意兼容提供商) + 模型适配层(DeepSeek / Claude)
- 数据 / 记忆：**Supabase Postgres + pgvector**(会话 / 卡库 / 预设 / 向量统一上云)；embedding 用本地 `BAAI/bge-small-zh-v1.5`(512 维，对话 / 世界书 / 故事书向量化召回)
- 前端：**Vite + React + react-router(HashRouter)**,构建产物在 `frontend-next/dist`(旧零构建单文件 `frontend/` 已于 2026-07-08 退役,见 `decisions/2026-07-07-frontend-next-cutover.md`)
- 评测：`eval/` 平台(player bot + Claude judge)
- 部署：后端 Render(`render.yaml`,同时 serve `frontend-next/dist`) + 前端 Vercel(`frontend-next/vercel.json`)

## 跑起来

```bash
# 1. 虚拟环境 + 依赖
uv venv
uv pip install -r requirements.txt

# 2. 配置(填 DeepSeek key + Supabase 连接串)
cp .env.example .env
#   LLM_API_KEY=...     DeepSeek key
#   DATABASE_URL=...    Supabase Postgres (session pooler)

# 3. 启动
uv run uvicorn src.api:app --reload --port 8000
# 浏览器打开 http://localhost:8000
```

> 数据 / 记忆都在 Supabase Postgres。首次需用 `schema.sql` 建表。

## 结构

```
src/
  models.py     数据模型(角色卡 Card V2 / 世界书 / 故事书 + 多结局·时间字段 / 玩家卡 / 运行状态)
  llm.py        LLM 调用层(同步 / 异步 / 流式 + token 用量收集)
  adapters.py   模型适配层(ContextBundle → DeepSeek / Claude 适配器 + 按 call_type 选模型)
  identify.py   识别(角色/世界/故事/玩家) + 统一分类路由 + 四类对话建卡
  story.py      故事回合引擎(prompt 拼装 / 状态机 / 记忆 / 世界时钟 / 一致性自检 / 流式 / Phase 1 护栏)
  chat.py       单角色纯聊(不走故事引擎)
  memory.py     长期记忆:向量化 + 检索(bge + pgvector)
  storage.py    持久化:会话 / 卡库 / 故事预设(Supabase Postgres)
  db.py         Postgres 连接池(psycopg3) + pgvector 注册
  api.py        FastAPI 端点 + serve 前端(挂 frontend-next/dist)
frontend-next/    主前端(Vite + React + HashRouter):src/routes(探索/纯聊/创作/游玩/我的/看板/故事详情/登录/论坛) + src/components + src/state
  dist/           构建产物(提交进 git,让 main 自包含可部署;改前端后 npm run build)
  public/covers/  预设封面图
eval/             评测平台(orchestrator / judge / harness / dimensions / 矩阵 runner)
integrations/     MCP server + Claude Skill
scripts/          一次性脚本(如 import_amphoreus.py)
decisions/ docs/  工程决策 + 设计文档
schema.sql        数据库表结构
data/             运行时临时数据(gitignore)
```

完整 API 参考(给 AI / 调用方)见 `docs/AI-API.md`；Codex 本机反代配置见 `docs/LOCAL-CODEX-PROXY.md`。

## 状态与路线

核心闭环 + 主要玩法已完成(见上「特性」)。进行中 / 后续：

- **[进行中] 记忆可靠性硬化 Phase 1**(召回条件化 + abstention 认忘 + 不回写 + 发言者门)—— 去风险 fixture 已达标，全 IP 对照矩阵跑中(见 `docs/design/2026-06-03-phase1-status.md`)。
- [ ] **Phase 2 · deep 记忆结构核心**：实体活档(结构化 delta + versioned 人格) + 三层 consolidation + bi-temporal 失效(见 `docs/design/2026-06-02-deep-memory-architecture.md`)。
- [x] 鉴权 / 限流 / 成本熔断:账户系统已上线(prod `AUTH_ENABLED=1`)+ costguard 按 IP 限流/熔断在 prod 生效。
- [ ] 内容安全审核 + per-user 配额 / 积分(公开规模化前要做)。
- [ ] 建卡后自检质检、对话建卡联网搜索增强、预设元数据 UI 内编辑、多角色发言权调度。
