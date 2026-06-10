-- P0-1(v0.2 升级计划): 全部 public 表开启 RLS。
-- 背景: 此前 11 张表 RLS 全关,Supabase Data API 的 anon/authenticated 角色
-- 可经 PostgREST 直读写 users.password_hash / auth_tokens / 全量存档。
-- 开 RLS 且不建任何 policy = 对 anon/authenticated 全拒;
-- 应用经 DATABASE_URL 以表 owner(postgres)直连,owner 默认绕过 RLS,行为不变。
-- 已于 2026-06-10 在 test 库演练并通过 _validate_accounts 41/41。
alter table if exists public.users        enable row level security;
alter table if exists public.auth_tokens  enable row level security;
alter table if exists public.email_otp    enable row level security;
alter table if exists public.sessions     enable row level security;
alter table if exists public.messages     enable row level security;
alter table if exists public.cards        enable row level security;
alter table if exists public.presets      enable row level security;
alter table if exists public.memory_vec   enable row level security;
alter table if exists public.rate_limits  enable row level security;
alter table if exists public.usage_daily  enable row level security;
alter table if exists public.spend_daily  enable row level security;
