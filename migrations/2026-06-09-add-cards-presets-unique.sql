-- 2026-06-09 · 补 cards / presets 缺失的 UNIQUE 约束(对齐 schema.sql)
--
-- 跑法: psql "$DATABASE_URL" -f migrations/2026-06-09-add-cards-presets-unique.sql
-- 幂等: 约束已存在则跳过,可重复执行。
--
-- 起因
-- ----
-- 导入新故事(scripts/import_story.py)时,写库连续报:
--   psycopg.errors.InvalidColumnReference:
--   there is no unique or exclusion constraint matching the ON CONFLICT specification
--
-- storage.save_library / save_preset 用 `insert ... on conflict (kind,name)/(name) do update`
-- 做幂等 upsert,依赖这两条唯一约束。schema.sql 里本就声明了
-- (`cards unique(kind,name)`、`presets name ... unique`),但**线上旧库的这两张表当初无约束建出**,
-- 而 `create table if not exists` 不会给已存在的表补约束 → upsert 报错。
--
-- 本迁移把这两条约束补回(线上库已手动 ALTER 过同样的两条;此文件是把它固化进 repo,
-- 供新库 / 其它环境对齐)。补前已确认两张表无重复 (kind,name) / name 行。

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'cards'::regclass and contype = 'u'
      and conname = 'cards_kind_name_key'
  ) then
    alter table cards add constraint cards_kind_name_key unique (kind, name);
    raise notice 'added cards_kind_name_key';
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'presets'::regclass and contype = 'u'
      and conname = 'presets_name_key'
  ) then
    alter table presets add constraint presets_name_key unique (name);
    raise notice 'added presets_name_key';
  end if;
end $$;
