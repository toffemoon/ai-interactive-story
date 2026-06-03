"""抽取一次 run 的关键探针轮(记忆探针 query_turn + 脚本 abstention 轮)的
玩家动作 / 引擎叙事 / 角色发言 / memory_write / 真值token是否出现,供 standard vs deep
人工判 abstention(召回正确 / 诚实认忘 / 自信编造)。

    PYTHONIOENCODING=utf-8 python -m eval.probe_inspect eval/runs/stress-001 mistport_deep
"""
from __future__ import annotations

import json
import sys

from .stress_fixtures import FIXTURES


def inspect(run_dir: str, fixture_key: str):
    pt = json.load(open(f"{run_dir}/playthrough.json", encoding="utf-8"))
    fx = FIXTURES[fixture_key]()
    probes = {int(p["query_turn"]): p for p in fx.get("memory_probes", [])}
    scripted = {int(t): a for t, a in (fx.get("scripted_actions") or {}).items()}
    turns = sorted(set(probes) | set(scripted))

    by_turn = {r["turn"]: r for r in pt}
    print(f"### {run_dir}  fixture={fixture_key}  共 {len(pt)} 轮\n")
    for t in turns:
        r = by_turn.get(t)
        if not r:
            print(f"== turn {t} (缺) ==\n"); continue
        eo = r["engine_output"]
        narr = eo.get("narration") or ""
        msgs = eo.get("messages", [])
        blob = narr + " " + " ".join((m.get("text") or m.get("content") or "") for m in msgs)

        tag = []
        if t in probes:
            tok = probes[t]["token"]
            tag.append(f"记忆探针[{probes[t]['id']}] 真值={tok!r} {'✅出现' if tok in blob else '❌未现'}")
        if t in scripted:
            tag.append("脚本abstention/canon轮")
        print(f"== turn {t} == {' · '.join(tag)}")
        print(f"  玩家: {r.get('player_input','')[:200]}")
        if narr:
            print(f"  叙事: {narr[:260]}")
        for m in msgs:
            spk = m.get("name") or m.get("speaker") or m.get("character_id") or "?"
            print(f"  [{spk}] {(m.get('text') or m.get('content') or '')[:240]}")
        mw = eo.get("memory_write")
        if mw:
            print(f"  memory_write: {json.dumps(mw, ensure_ascii=False)[:260]}")
        print()


if __name__ == "__main__":
    inspect(sys.argv[1], sys.argv[2] if len(sys.argv) > 2 else "mistport_deep")
