-- ai-interactive-story 数据库 schema(Supabase Postgres + pgvector)
-- 幂等。全新库一键建表:
--     psql "$DATABASE_URL" -f schema.sql
--   或  python _init_schema.py   (读 DATABASE_URL,执行本文件)
--
-- 对齐策略(2026-06-09;2026-06-15 核线上更新,见 decisions/2026-06-09-schema线上分歧-对齐方向-提案.md):
--   **本文件以线上 PROD 结构为准**。sessions=id(text)、messages=(session_id,seq)、memory_vec=(session_id,scope,ext_id)。
--   cards/presets:batch4(2026-06-11)已给 PROD 加了代理 `id bigint identity` 主键;唯一性仍走部分唯一索引,
--     storage.py 仍按自然键(kind,name)/(name)做 on conflict upsert、不依赖 id。
--   注:PROD 另有 user_id 外键(sessions/cards/presets/memory_vec → users,on delete set null,batch4 加);
--     因本文件建表顺序 cards/presets 在 users 之前,FK 未内联(fresh build 如需,在 users 建表后补 ALTER)。

create extension if not exists vector;

-- 会话:整局存 data jsonb(不枚举字段)。user_id = 归属(账户系统;NULL=遗留/匿名)。
create table if not exists sessions (
  id          text        primary key,
  user_id     uuid,
  data        jsonb       not null default '{}'::jsonb,
  updated_at  timestamptz not null default now()
);
create index if not exists idx_sessions_user on sessions (user_id);

-- 对话:append-only,自然键主键 (session_id, seq);删会话级联删消息。
create table if not exists messages (
  session_id  text    not null references sessions(id) on delete cascade,
  seq         integer not null,
  data        jsonb   not null,
  primary key (session_id, seq)
);

-- 卡库(角色/世界书/故事书/玩家卡)。代理 id 主键(batch4 2026-06-11);唯一性仍靠部分唯一索引。
-- user_id NULL=官方公共卡(只读可见);非 NULL=用户私有卡。唯一性走部分唯一索引(无全局 unique)。
create table if not exists cards (
  kind        text        not null,
  name        text        not null,
  data        jsonb       not null default '{}'::jsonb,
  updated_at  timestamptz not null default now(),
  user_id     uuid,
  id          bigint      generated always as identity primary key   -- 代理 PK(batch4);app 不依赖,仍按自然键 upsert
);
create index if not exists cards_kind_idx on cards (kind);
create unique index if not exists uq_cards_official on cards (kind, name)          where user_id is null;
create unique index if not exists uq_cards_user     on cards (user_id, kind, name)  where user_id is not null;

-- 预设(成套开局)。同卡库:NULL=官方公共预设;非 NULL=用户私有。
create table if not exists presets (
  name        text        not null,
  data        jsonb       not null default '{}'::jsonb,
  updated_at  timestamptz not null default now(),
  user_id     uuid,
  id          bigint      generated always as identity primary key   -- 代理 PK(batch4)
);
create unique index if not exists uq_presets_official on presets (name)          where user_id is null;
create unique index if not exists uq_presets_user     on presets (user_id, name)  where user_id is not null;

-- 长期记忆向量(深度模式;scope: turn/lm/kb;embedding = bge-small-zh-v1.5 512 维)。
-- 自然键主键 (session_id, scope, ext_id);embedding 可空(降级/未就绪时不写向量)。
create table if not exists memory_vec (
  session_id  text        not null,
  scope       text        not null,
  ext_id      text        not null,
  content     text        not null,
  embedding   vector(512),
  meta        jsonb       not null default '{}'::jsonb,
  created_at  timestamptz not null default now(),
  user_id     uuid,
  primary key (session_id, scope, ext_id)
);
create index if not exists idx_memory_vec_lookup on memory_vec (session_id, scope);
create index if not exists idx_memory_vec_ann    on memory_vec using hnsw (embedding vector_cosine_ops);

-- ── 账户系统(账户系统路线图 Phase 1;见 decisions/2026-06-09-账户系统路线图-*)── PROD 已建。
-- fresh build 默认 .env AUTH_ENABLED=0;PROD 已开 AUTH_ENABLED=1(账户系统已上线)。翻开关才按 user 隔离。
-- email = 已验证主身份(注册走邮箱验证码);username 可选登录名;role = user/admin/superadmin。
-- superadmin 由 .env SUPERADMIN_EMAIL 钉(不存进 role 列也算 super)。
create table if not exists users (
  id                uuid          primary key default gen_random_uuid(),
  username          text          unique,
  email             text          not null unique,
  password_hash     text          not null,            -- pbkdf2_sha256$iter$salt$hash
  display_name      text,
  role              text          not null default 'user',   -- user / admin / superadmin
  email_verified_at timestamptz,
  status            text          not null default 'active',  -- active / blocked
  created_at        timestamptz   not null default now(),
  last_seen_at      timestamptz,
  avatar            text                                       -- data URI jpeg/png/webp <=200KB(见 migrations/2026-06-10-users-avatar.sql;PROD 已建)
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

-- 邮箱验证码(注册时发码验证邮箱;只存 sha256(email:code+pepper))
create table if not exists email_otp (
  id          bigserial   primary key,
  email       text        not null,
  code_hash   text        not null,
  purpose     text        not null default 'register',
  expires_at  timestamptz not null,
  attempts    integer     not null default 0,
  consumed_at timestamptz,
  created_at  timestamptz not null default now()
);
create index if not exists idx_email_otp_lookup on email_otp (email, purpose, created_at desc);

-- ── Phase 0 成本熔断 + 限流(账户系统路线图 Phase 0;见 decisions/2026-06-09-phase0-*)──
-- 状态(2026-06-15 核线上 prod):三张表已在 PROD 建好且有数据,render.yaml COST_GUARD_ENABLED=1,
--   熔断 + 限流在生产已生效(subject 现为 'ip:<addr>');fresh build 默认仍 .env COST_GUARD_ENABLED=0。
--   per-user('user:<uuid>')配额待 Phase 1。
create table if not exists rate_limits (
  key           text        primary key,
  count         integer     not null default 0,
  window_start  timestamptz not null default now()
);
create table if not exists usage_daily (
  subject     text          not null,          -- 'ip:<addr>'(Phase 1 起 'user:<uuid>')
  day         date          not null,
  turns       integer       not null default 0,
  tokens      bigint        not null default 0,
  usd         numeric(12,6) not null default 0,
  updated_at  timestamptz   not null default now(),
  primary key (subject, day)
);
create index if not exists idx_usage_daily_day on usage_daily (day, usd desc);
create table if not exists spend_daily (
  day      date          primary key,
  usd      numeric(12,6) not null default 0,
  tripped  boolean       not null default false
);
