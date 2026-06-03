-- ai-interactive-story 数据库 schema(Supabase Postgres + pgvector)
-- 幂等。全新库一键建表:
--     psql "$DATABASE_URL" -f schema.sql
--   或  python _init_schema.py   (读 DATABASE_URL,执行本文件)
-- 说明:此前 repo 无 DDL 文件、表靠手动建;本文件按线上 schema 内省补齐,供部署到新库用。

create extension if not exists vector;

-- 会话:整局存 data jsonb(不枚举字段,避免丢字段)
create table if not exists sessions (
  id          text primary key,
  data        jsonb       not null default '{}'::jsonb,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

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

-- 卡库(角色/世界书/故事书/玩家卡)
create table if not exists cards (
  id          uuid        primary key default gen_random_uuid(),
  kind        text        not null,
  name        text        not null,
  data        jsonb       not null default '{}'::jsonb,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (kind, name)
);

-- 预设(成套开局)
create table if not exists presets (
  id          uuid        primary key default gen_random_uuid(),
  name        text        not null unique,
  data        jsonb       not null default '{}'::jsonb,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- 长期记忆向量(深度模式;scope: turn/lm/kb;embedding = bge-small-zh-v1.5 512 维)
create table if not exists memory_vec (
  id          bigserial   primary key,
  session_id  text        not null,
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
