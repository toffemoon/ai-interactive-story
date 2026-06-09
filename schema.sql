-- ai-interactive-story 数据库 schema(Supabase Postgres + pgvector)
-- 幂等。全新库一键建表:
--     psql "$DATABASE_URL" -f schema.sql
--   或  python _init_schema.py   (读 DATABASE_URL,执行本文件)
-- 说明:此前 repo 无 DDL 文件、表靠手动建;本文件按线上 schema 内省补齐,供部署到新库用。

create extension if not exists vector;

-- 会话:整局存 data jsonb(不枚举字段,避免丢字段)。user_id = 归属(账户系统;NULL=遗留/匿名)
create table if not exists sessions (
  id          text primary key,
  user_id     uuid,
  data        jsonb       not null default '{}'::jsonb,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists idx_sessions_user on sessions (user_id);

-- 对话:append-only 行,每回合 INSERT 新行
create table if not exists messages (
  id          bigserial   primary key,
  session_id  text        not null,
  seq         integer     not null,
  data        jsonb       not null,
  created_at  timestamptz not null default now(),
  unique (session_id, seq)
);
create index if not exists idx_messages_session on messages (session_id, seq);

-- 卡库(角色/世界书/故事书/玩家卡)。user_id NULL=官方公共卡;非 NULL=用户私有卡。
create table if not exists cards (
  id          uuid        primary key default gen_random_uuid(),
  user_id     uuid,
  kind        text        not null,
  name        text        not null,
  data        jsonb       not null default '{}'::jsonb,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
-- 唯一性:官方行(NULL)按 (kind,name);用户行按 (user_id,kind,name)
create unique index if not exists uq_cards_official on cards (kind, name)         where user_id is null;
create unique index if not exists uq_cards_user     on cards (user_id, kind, name) where user_id is not null;

-- 预设(成套开局)。同卡库:user_id NULL=官方公共预设;非 NULL=用户私有。
create table if not exists presets (
  id          uuid        primary key default gen_random_uuid(),
  user_id     uuid,
  name        text        not null,
  data        jsonb       not null default '{}'::jsonb,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create unique index if not exists uq_presets_official on presets (name)          where user_id is null;
create unique index if not exists uq_presets_user     on presets (user_id, name)  where user_id is not null;

-- 长期记忆向量(深度模式;scope: turn/lm/kb;embedding = bge-small-zh-v1.5 512 维)
create table if not exists memory_vec (
  id          bigserial   primary key,
  session_id  text        not null,
  user_id     uuid,
  scope       text        not null,
  ext_id      text        not null,
  content     text        not null,
  embedding   vector(512) not null,
  meta        jsonb       not null default '{}'::jsonb,
  created_at  timestamptz not null default now(),
  unique (session_id, scope, ext_id)
);
create index if not exists idx_memory_vec_lookup on memory_vec (session_id, scope);
create index if not exists idx_memory_vec_ann    on memory_vec using hnsw (embedding vector_cosine_ops);

-- ── Phase 0 成本熔断 + 限流(账户系统路线图 Phase 0;见 decisions/2026-06-09-phase0-*)──
-- 默认关闭(.env COST_GUARD_ENABLED=0);建表只是前置,翻开关才生效。

-- 限流计数器:key = 'ip:<addr>'(Phase 1 起也用 'user:<uuid>')
create table if not exists rate_limits (
  key           text        primary key,
  count         integer     not null default 0,
  window_start  timestamptz not null default now()
);

-- 每来源每日用量账本:subject = 'ip:<addr>'(Phase 1 起 'user:<uuid>')
create table if not exists usage_daily (
  subject     text          not null,
  day         date          not null,
  turns       integer       not null default 0,
  tokens      bigint        not null default 0,
  usd         numeric(12,6) not null default 0,
  updated_at  timestamptz   not null default now(),
  primary key (subject, day)
);
create index if not exists idx_usage_daily_day on usage_daily (day, usd desc);

-- 全局每日花费熔断单行(热路径用 pg_advisory_xact_lock 串行化)
create table if not exists spend_daily (
  day      date          primary key,
  usd      numeric(12,6) not null default 0,
  tripped  boolean       not null default false
);

-- ── 账户系统(账户系统路线图 Phase 1;见 decisions/2026-06-09-账户系统路线图-*)──
-- 默认关闭(.env AUTH_ENABLED=0);建表只是前置,翻开关才按 user 隔离。
create table if not exists users (
  id            uuid          primary key default gen_random_uuid(),
  username      text          not null unique,
  email         text          unique,
  password_hash text          not null,            -- pbkdf2_sha256$iter$salt$hash
  display_name  text,
  is_admin      boolean       not null default false,
  status        text          not null default 'active',  -- active / blocked
  created_at    timestamptz   not null default now(),
  last_seen_at  timestamptz
);

-- 不透明 token 会话(登出/吊销=UPDATE;库里只存 sha256(token+pepper))
create table if not exists auth_tokens (
  token_hash    text          primary key,
  user_id       uuid          not null references users(id) on delete cascade,
  created_at    timestamptz   not null default now(),
  expires_at    timestamptz   not null,
  last_used_at  timestamptz,
  revoked_at    timestamptz
);
create index if not exists idx_auth_tokens_user on auth_tokens (user_id);
