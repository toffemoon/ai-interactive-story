-- 按账户授权浏览器调用玩家本机的 OpenAI-compatible 模型反代。
-- 默认关闭;仅 superadmin 可经 operator 控制台开启。

alter table users
  add column if not exists local_proxy_enabled boolean not null default false;

comment on column users.local_proxy_enabled is
  'Whether this user may run story LLM calls through a browser-local proxy';

-- 主理人固定拥有权限;应用层同时保证该权限不可撤销。
update users
set local_proxy_enabled = true
where lower(email) = 'gengyue081@gmail.com';
