-- 批次 4 · DB 卫生(v0.2 升级计划 P3-4 / P2-19 / P2-21 / P2-20)
-- 全部幂等;先在 test 库演练 + 回归通过,再经 supabase MCP apply_migration 应用 prod。
--
-- ⚠ 设计取舍(P2-20):不加 memory_vec.session_id → sessions 的级联 FK——
--   引擎写入顺序是 memory.add_turn(写向量)先于 storage.save_session(建 sessions 行),
--   新局第一回合时 sessions 行尚不存在,该 FK 会让首回合直接失败。
--   改用:① 一次性孤儿清理(删前先入库内备份表,含 embedding 可完整还原);
--        ② delete_session 同事务补删向量(storage.py,只动删除路径不动写入路径)。

-- ── P2-20 ① 孤儿向量:备份 → 清理(prod 实查 59 行,均属一个已删 session) ──
create table if not exists _backup_memory_vec_orphans_20260611 as
  select mv.* from memory_vec mv
  where not exists (select 1 from sessions s where s.id = mv.session_id);

delete from memory_vec mv
  where not exists (select 1 from sessions s where s.id = mv.session_id);

-- ── P3-4 sessions 复合索引(先于数据增长;单列旧索引被覆盖,顺手删) ──
create index if not exists idx_sessions_user_updated on sessions (user_id, updated_at desc);
drop index if exists idx_sessions_user;

-- ── P2-19 cards / presets 加 identity PK(additive,旧行自动编号,不改现有查询) ──
alter table cards   add column if not exists id bigint generated always as identity;
alter table presets add column if not exists id bigint generated always as identity;

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'cards_pkey') then
    alter table cards add constraint cards_pkey primary key (id);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'presets_pkey') then
    alter table presets add constraint presets_pkey primary key (id);
  end if;
end $$;

-- ── P2-21 user_id 四列补 FK(on delete set null = 删用户后回到"无主可认领",契合现有语义)
--    NOT VALID 不扫表不锁业务;VALIDATE 在下方单独做(仅共享锁;prod 实查无悬挂值,必过) ──
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'sessions_user_fk') then
    alter table sessions add constraint sessions_user_fk
      foreign key (user_id) references users(id) on delete set null not valid;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'cards_user_fk') then
    alter table cards add constraint cards_user_fk
      foreign key (user_id) references users(id) on delete set null not valid;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'presets_user_fk') then
    alter table presets add constraint presets_user_fk
      foreign key (user_id) references users(id) on delete set null not valid;
  end if;
  -- memory_vec.user_id 代码路径从不写值(恒 null,phase1 预留列),FK 对写入零影响
  if not exists (select 1 from pg_constraint where conname = 'memory_vec_user_fk') then
    alter table memory_vec add constraint memory_vec_user_fk
      foreign key (user_id) references users(id) on delete set null not valid;
  end if;
end $$;

alter table sessions   validate constraint sessions_user_fk;
alter table cards      validate constraint cards_user_fk;
alter table presets    validate constraint presets_user_fk;
alter table memory_vec validate constraint memory_vec_user_fk;

-- 备份表也开 RLS(与全库一致,Data API 不可见)
alter table _backup_memory_vec_orphans_20260611 enable row level security;
