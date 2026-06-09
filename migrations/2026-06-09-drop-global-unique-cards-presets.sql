-- 2026-06-09 · 删除 cards/presets 的全局 unique(kind,name)/(name)
--
-- 背景:PR #44 期间,曾手动给 PROD 加过 cards_kind_name_key / presets_name_key(全局唯一)。
-- 但账户系统(Phase 1)改用**部分唯一索引**:
--   uq_cards_official = unique(kind,name) WHERE user_id IS NULL    (官方公共行)
--   uq_cards_user     = unique(user_id,kind,name) WHERE user_id IS NOT NULL  (用户私有行)
--   presets 同理。
-- 全局 unique(kind,name) 会让"用户私有卡 与 官方/他人同名"冲突 → **破坏每人数据独立**,
-- 故必须删除(官方行唯一性仍由 uq_*_official 保证;现 AUTH 关、全为官方行,删除无数据影响)。
-- 已于 2026-06-09 经 supabase MCP apply_migration 应用到 PROD。
--
-- 见 decisions/2026-06-09-schema线上分歧-对齐方向-提案.md

alter table cards   drop constraint if exists cards_kind_name_key;
alter table presets drop constraint if exists presets_name_key;
-- 兜底:若以"唯一索引"而非"约束"形式存在
drop index if exists cards_kind_name_key;
drop index if exists presets_name_key;
