"""一次性迁移:旧 data/**/*.json → Supabase Postgres。

用法:
    cp .env.example .env && 填 DATABASE_URL
    uv run python _migrate_to_pg.py            # 真迁
    uv run python _migrate_to_pg.py --dry-run  # 只看会迁啥

迁移内容:
- data/sessions/*.json   → sessions + messages (save_session 自动拆 append-only 行)
- data/library/<kind>/*.json → cards (save_library)
- data/presets/*.json    → presets (save_preset)

不迁 data/memory/ (chromadb 向量) —— 那是派生数据。深度模式下次加载会话时
index_history 会按 Postgres 里的对话重建向量,旧 chroma 目录可删。
"""

import json
import sys
from pathlib import Path

from src import storage

ROOT = Path(__file__).resolve().parent
DATA = ROOT / "data"
DRY = "--dry-run" in sys.argv


def _load(f: Path):
    try:
        return json.loads(f.read_text(encoding="utf-8"))
    except Exception as e:
        print(f"  ! skip {f.name}: {e}")
        return None


def migrate() -> None:
    n_sess = n_msg = n_card = n_preset = 0

    sdir = DATA / "sessions"
    if sdir.exists():
        for f in sorted(sdir.glob("*.json")):
            data = _load(f)
            if data is None:
                continue
            sid = data.get("session_id") or f.stem
            msgs = len(data.get("messages", []) or [])
            print(f"  session {sid} ({msgs} msgs)" + (" [dry]" if DRY else ""))
            if not DRY:
                storage.save_session(sid, data)
            n_sess += 1
            n_msg += msgs

    ldir = DATA / "library"
    if ldir.exists():
        for kind_dir in sorted(p for p in ldir.iterdir() if p.is_dir()):
            kind = kind_dir.name
            for f in sorted(kind_dir.glob("*.json")):
                payload = _load(f)
                if payload is None:
                    continue
                print(f"  card {kind}/{f.stem}" + (" [dry]" if DRY else ""))
                if not DRY:
                    storage.save_library(kind, f.stem, payload)
                n_card += 1

    pdir = DATA / "presets"
    if pdir.exists():
        for f in sorted(pdir.glob("*.json")):
            payload = _load(f)
            if payload is None:
                continue
            print(f"  preset {f.stem}" + (" [dry]" if DRY else ""))
            if not DRY:
                storage.save_preset(f.stem, payload)
            n_preset += 1

    print(f"\n{'[dry-run] 会迁' if DRY else '已迁'}: "
          f"{n_sess} sessions / {n_msg} messages / {n_card} cards / {n_preset} presets")
    if not DATA.exists():
        print("(没有 data/ 目录 —— 全新部署, 无需迁移)")


if __name__ == "__main__":
    migrate()
