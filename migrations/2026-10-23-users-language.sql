-- 2026-10-23 中英双语:账户的界面 / AI 输出语言('en' | 'zh';NULL = 还没选过,前端开局会让用户选)。
-- 附加列,幂等。应用启动时 src/db.py ensure_users_language_column() 也会自动执行同一句,本文件留档。
alter table users add column if not exists language text;
