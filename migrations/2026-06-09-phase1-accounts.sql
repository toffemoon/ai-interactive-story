-- 账户系统 Phase 1:用户 + token + 数据归属(会话/卡库/预设按人隔离)
-- 见 decisions/2026-06-09-账户系统路线图-提案.md
--
-- 应用到现有线上库:
--     psql "$DATABASE_URL" -f migrations/2026-06-09-phase1-accounts.sql
--   或经 supabase MCP apply_migration。
-- 全部幂等 + 加列/换约束,无数据破坏:旧 cards/presets 行 user_id=NULL → 自动成为「官方公共」(只读可见)。
-- 建表/加列只是前置;真正按 user 隔离要再设 .env 的 AUTH_ENABLED=1(门控,可回退)。

-- 1) 用户
create table if not exists users (
  id            uuid          primary key default gen_random_uuid(),
  username      text          not null unique,
  email         text          unique,
  password_hash text          not null,
  display_name  text,
  is_admin      boolean       not null default false,
  status        text          not null default 'active',
  created_at    timestamptz   not null default now(),
  last_seen_at  timestamptz
);

-- 2) 不透明 token 会话
create table if not exists auth_tokens (
  token_hash    text          primary key,
  user_id       uuid          not null references users(id) on delete cascade,
  created_at    timestamptz   not null default now(),
  expires_at    timestamptz   not null,
  last_used_at  timestamptz,
  revoked_at    timestamptz
);
create index if not exists idx_auth_tokens_user on auth_tokens (user_id);

-- 3) 归属列(加列幂等;旧行 user_id=NULL)
alter table sessions   add column if not exists user_id uuid;
alter table cards      add column if not exists user_id uuid;
alter table presets    add column if not exists user_id uuid;
alter table memory_vec add column if not exists user_id uuid;
create index if not exists idx_sessions_user on sessions (user_id);

-- 4) 卡库/预设唯一性改造:旧全局唯一约束 → 官方行(NULL)与用户行各自部分唯一。
--    旧约束被 save_library/save_preset 的 on conflict 引用,storage.py 已改 update-then-insert,
--    故这里安全 drop。约束名为 Postgres 内联 unique 的默认名(线上若不同,按 \d 实名调整)。
alter table cards   drop constraint if exists cards_kind_name_key;
alter table presets drop constraint if exists presets_name_key;
create unique index if not exists uq_cards_official  on cards   (kind, name)          where user_id is null;
create unique index if not exists uq_cards_user      on cards   (user_id, kind, name)  where user_id is not null;
create unique index if not exists uq_presets_official on presets (name)                where user_id is null;
create unique index if not exists uq_presets_user     on presets (user_id, name)        where user_id is not null;
