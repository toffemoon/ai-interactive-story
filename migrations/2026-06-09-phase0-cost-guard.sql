-- Phase 0 成本熔断 + 限流(账户系统路线图 Phase 0)
-- 见 decisions/2026-06-09-phase0-成本熔断与限流-提案.md
--
-- 应用到现有线上库(Supabase project: ai-interactive-story, ap-southeast-1):
--     psql "$DATABASE_URL" -f migrations/2026-06-09-phase0-cost-guard.sql
--   或经 supabase MCP apply_migration。
-- 全部为新增表 + 幂等(create table if not exists),不改旧表,无破坏性。
-- 建表只是前置;真正生效要再设 .env 的 COST_GUARD_ENABLED=1(门控,可回退)。

-- 限流计数器:key = 'ip:<addr>'(Phase 1 起也用 'user:<uuid>');原子 upsert + 窗口重置。
create table if not exists rate_limits (
  key           text        primary key,
  count         integer     not null default 0,
  window_start  timestamptz not null default now()
);

-- 每来源每日用量账本:subject = 'ip:<addr>'(Phase 1 起 'user:<uuid>')。
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

-- 全局每日花费熔断单行(热路径,preflight/record 用 pg_advisory_xact_lock 串行化)。
create table if not exists spend_daily (
  day      date          primary key,
  usd      numeric(12,6) not null default 0,
  tripped  boolean       not null default false
);
