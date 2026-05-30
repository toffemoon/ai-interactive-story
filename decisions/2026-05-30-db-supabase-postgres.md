---
date: 2026-05-30
updated: 2026-05-30
status: active
type: engineering
supersedes: 文件 JSON 持久化 (storage.py v2 注释里的"后续换 SQLite"计划)
---

# 数据层：Supabase Postgres（上云 + 可维护）

引擎数据从本地 JSON 文件迁到 **Supabase 托管 Postgres**。主理人要求：数据上云 + 可维护。

## 决策

| | 选择 |
|---|---|
| 数据库 | Supabase 托管 Postgres 17 |
| project | `ai-interactive-story`（ref `yldfnbmpzkzjzjoyvfhb`, region `ap-southeast-1` 新加坡） |
| 向量 | **pgvector 0.8.0**（合进同一个库，不再单独跑 chromadb） |
| 连接 | session pooler（`aws-1-ap-southeast-1.pooler.supabase.com:5432`, IPv4, 支持 prepared statements 给 asyncpg） |
| 驱动 | asyncpg（FastAPI 异步，配连接池） |

**不选 SQLite**：SQLite 是本地文件，不满足"上云"。不选自建 PG：要可维护 = 托管，不自己运维。Supabase 主理人已熟（ripple 项目在用），dashboard + 自动备份 + 以后要 auth 现成。

## 从 0 修正的数据模型（关键）

旧设计（JSON 文件，storage.py v2）把**整个 session 当一个 blob 每回合全量重写** → 单回合 O(n)、整局 O(n²)。换 DB 但还用一个 JSON 列存整 session 不解决这个。

修正：**messages 拆成 append-only 行**，一回合一行，只 INSERT 不重写历史。

```
cards      (id uuid, kind, name, data jsonb, ts)          -- 4 类卡, 文档型, JSONB 存灵活 schema
presets    (id uuid, name, data jsonb, ts)
sessions   (id text, title, mode, state jsonb,            -- 小可变记录, 不含 messages
            short_memory jsonb, artifacts jsonb, ts)
messages   (id bigint identity, session_id fk, seq,       -- append-only, unique(session_id,seq)
            role, content, tokens jsonb, created_at)
memory_vec (id bigint identity, session_id fk, content,   -- 长期记忆 (深度模式)
            embedding vector(512), created_at)            -- bge-small-zh-v1.5 = 512 维
```

索引：`messages(session_id, seq)`、`memory_vec` hnsw cosine、`cards(kind)`。

## 已 provision + 测试（2026-05-30）

- ✅ project 创建 (ap-southeast-1)
- ✅ pgvector 扩展启用 (0.8.0)
- ✅ 5 张表 + 索引建好
- ✅ 端到端 smoke test：插 session + append 2 messages + card + 512 维向量 → 读回计数正确 + 向量余弦自相似度 = 1.0
- ✅ session pooler 连接从 psql + .env 验证通过

## 代码迁移（2026-05-30 完成）

driver 改用 **sync psycopg3 + 连接池**(不是 asyncpg) —— storage 调用 95% 在 sync 上下文(FastAPI sync 端点本就在 threadpool, 不阻塞 event loop), story.py 检索类已用 `asyncio.to_thread` 隔离。全栈 async ripple 大收益低; sync 驱动让 chat.py + 多数端点 + models 序列化一行不改。

- [x] `requirements.txt`: 加 `psycopg[binary]` + `psycopg-pool` + `pgvector`, 删 `chromadb` (sentence-transformers 保留, 仍算 bge embedding)
- [x] 新 `src/db.py`: psycopg3 ConnectionPool, 每连接 register_vector + dict_row, FastAPI lifespan init/close
- [x] 重写 `src/storage.py`: 文件 → psycopg, 函数签名不变。**messages append-only**: 快路径只 INSERT 新增几条; reroll/编辑改尾部 → 整段 resync。session 其余字段整体存 sessions.data jsonb (不枚举, 不丢字段)
- [x] 重写 `src/memory.py`: chromadb → pgvector。3 集合 (turn/lm/kb) 用 memory_vec.scope 区分; 查询向量用 `pgvector.Vector` 包 (避免 list 被当 array)。bge 模型加载机制不变
- [x] `src/api.py`: lifespan 启停池; `api_reroll` / `api_delete_session` 接上; async 端点裸 DB 调用包 to_thread
- [x] `src/story.py`: `_save_turn` / `_story_turn_impl` / `_extract_long_memory` 里的写入/读取调用包 `asyncio.to_thread` (跟现有检索调用对称)
- [x] `_migrate_to_pg.py`: 一次性迁移 `data/**/*.json` → Postgres (session blob 拆 sessions + messages 行)。chromadb 旧向量不迁, 深度模式下次加载 index_history 重建
- [x] 端到端测试通过 (真实 Supabase): session 往返 / append-only seq / reroll resync / 库+预设 CRUD / 向量三集合检索 + max_turn + visibility 过滤 / 全链 import + lifespan

## 连接 / 密钥

- 连接串走 session pooler，放各人本地 `.env`（gitignore），**不进 git**
- `.env.example` 有占位模板
- 真连接串主理人通过 Slack / 私下分享给 Yufei + 部署环境
- DB 密码在 Supabase dashboard 可 reset

## Why 写本地 decisions/ 不写父 repo

这是**引擎工程决策**（数据层选型），按 [CLAUDE.md](../CLAUDE.md) §4 两层规则放本 repo。"这引擎要不要成为 conversion-site 正式实现"那种才是父 repo 战略决策。

## Supersede

如果将来规模/成本要换（自建 PG / Neon / 加读副本 / 分库），开新决策 supersede 本文件。
