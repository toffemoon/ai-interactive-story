"""一次性:对 DATABASE_URL 指向的库执行 schema.sql 建表(幂等)。

    DATABASE_URL="postgresql://..." python _init_schema.py

连不上(Supabase 直连常是 IPv6 / 库暂停)时,可直接把 schema.sql 贴进
Supabase 控制台 SQL Editor 运行,效果相同。
"""
import os
import sys
from pathlib import Path

import psycopg

url = os.environ.get("DATABASE_URL")
if not url:
    sys.exit("需要 DATABASE_URL 环境变量")

sql = (Path(__file__).resolve().parent / "schema.sql").read_text(encoding="utf-8")
stmts = []
for chunk in sql.split(";"):
    body = "\n".join(l for l in chunk.splitlines() if l.strip() and not l.strip().startswith("--"))
    if body.strip():
        stmts.append(chunk.strip())

with psycopg.connect(url, connect_timeout=15, autocommit=True) as conn:
    for st in stmts:
        conn.execute(st)
        print("  ok:", st.splitlines()[-1][:70] if st.splitlines() else st[:70])
print(f"\nschema 应用完成,共 {len(stmts)} 条语句")
