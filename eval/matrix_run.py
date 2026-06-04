"""Phase 1 对照矩阵:fixtures × {baseline, phase1} × seeds × turns,出 mean±range 前后对照。
baseline = story.PHASE1_FIXES off(无①召回条件化/②abstention/③不回写/④发言者门);phase1 = on。
deep 模式:直连 pgvector + 预热 bge + 召回门控降到 0.45。结果增量写 JSONL(可断点续跑)。

  PYTHONIOENCODING=utf-8 python -m eval.matrix_run --fixtures mistport_deep,sherlock,xiyou \
      --conditions baseline,phase1 --seeds 3 --turns 200 --mode deep
"""
from __future__ import annotations

import argparse
import asyncio
import json
import os
import time
from statistics import mean

from . import big_test
from .stress_fixtures import FIXTURES

DS_IN, DS_OUT = 0.27, 1.10
OUT = "eval/runs/_matrix.jsonl"


def _done_cells(path: str) -> set:
    done = set()
    if os.path.exists(path):
        for line in open(path, encoding="utf-8"):
            try:
                r = json.loads(line)
                done.add((r["fixture"], r["condition"], r["seed"]))
            except Exception:
                pass
    return done


async def run_cell(fixture_key: str, condition: str, seed: int, turns: int, mode: str) -> dict:
    from src import story as _story, memory as _memory
    fx = FIXTURES[fixture_key]()
    # baseline = 全关;phase1 = Phase1 开、Phase3 关;phase3 = Phase1+Phase3 都开。
    _story.PHASE1_FIXES = (condition in ("phase1", "phase3"))
    _story.PHASE3_KNOWERS = (condition == "phase3")
    sess = f"matrix-{fixture_key}-{condition}-{seed}"
    if mode == "deep":
        # deep 走 run_big 内置的离线内存向量库(本地 bge + numpy 余弦),不碰 Supabase pgvector;
        # 每个 cell 的向量库在 run_big 内独立新建,无跨 cell 残留,无需清理。
        _story.DEEP_WARMUP_AT, _story.DEEP_RECALL_AT = 0.30, 0.45
    t0 = time.time()
    playthrough, ptok = await big_test.run_big(fx, total_turns=turns, mode=mode, session_id=sess)
    try:  # 落盘 playthrough,便于失败时诊断(看角色到底说了啥 / 在场标注对不对)
        os.makedirs("eval/runs/p3-cells", exist_ok=True)
        with open(f"eval/runs/p3-cells/{fixture_key}-{condition}-{seed}.json", "w", encoding="utf-8") as fh:
            json.dump(playthrough, fh, ensure_ascii=False)
    except Exception as e:
        print("  [save playthrough 失败,忽略]", e, flush=True)
    mem = big_test.check_memory_probes(playthrough, fx)
    spk = big_test.check_speaker_validity(playthrough, fx)
    abst = big_test.check_abstention(playthrough, fx)
    contra = big_test.check_contradiction(playthrough, fx)        # #2 矛盾消解
    kb = big_test.check_knowledge_boundary(playthrough, fx)       # Phase 3 知识边界
    eng_in = sum(r["engine_output"].get("usage", {}).get("prompt_tokens", 0) for r in playthrough)
    eng_out = sum(r["engine_output"].get("usage", {}).get("completion_tokens", 0) for r in playthrough)
    cost = (eng_in * DS_IN + eng_out * DS_OUT) / 1e6
    return {
        "fixture": fixture_key, "condition": condition, "seed": seed, "mode": mode, "turns": len(playthrough),
        "mem_retention": mem["retention_rate"], "mem_passed": mem["passed"], "mem_total": mem["total"],
        "abstain_rate": abst["abstain_rate"], "abstain_passed": abst["passed"], "abstain_total": abst["total"],
        "fab_tells": abst["fab_tells"], "wrote_facts": abst["wrote_facts"],
        "speaker_invalid": spk["invalid"], "speaker_total": spk["total_messages"],
        "contra_rate": contra["rate"], "contra_passed": contra["passed"], "contra_total": contra["total"],
        "kb_absent_abstain": kb["absent_abstain_rate"], "kb_absent_ok": kb["absent_ok"], "kb_absent_total": kb["absent_total"],
        "kb_witness_recall": kb["witness_recall_rate"], "kb_witness_ok": kb["witness_ok"], "kb_witness_total": kb["witness_total"],
        "kb_over_abstention": kb["over_abstention"],
        "cost_usd": round(cost, 4), "secs": round(time.time() - t0),
    }


def _agg(rows: list[dict], key: str):
    vals = [r[key] for r in rows if r.get(key) is not None]
    if not vals:
        return None
    return {"mean": round(mean(vals), 3), "min": min(vals), "max": max(vals), "n": len(vals)}


def report(path: str):
    rows = [json.loads(l) for l in open(path, encoding="utf-8") if l.strip() and "error" not in json.loads(l)]
    fixtures = sorted({r["fixture"] for r in rows})
    metrics = ["kb_absent_abstain", "kb_witness_recall", "kb_over_abstention", "contra_rate",
               "mem_retention", "abstain_rate", "fab_tells", "wrote_facts", "speaker_invalid", "cost_usd"]
    print("\n========= 矩阵对照(★kb=知识边界 / contra=#2矛盾;mean[min..max]) =========")
    for fx in fixtures:
        print(f"\n### {fx}")
        for cond in ("baseline", "phase1", "phase3"):
            cr = [r for r in rows if r["fixture"] == fx and r["condition"] == cond]
            if not cr:
                continue
            parts = []
            for m in metrics:
                a = _agg(cr, m)
                if a:
                    parts.append(f"{m}={a['mean']}[{a['min']}..{a['max']}]")
            print(f"  {cond:9} (seeds={len(cr)})  " + "  ".join(parts))
    print("\n(原始每 cell 见 " + path + ")")


async def main_async(a):
    fixtures = a.fixtures.split(",")
    conditions = a.conditions.split(",")
    OUT = a.out
    done = _done_cells(OUT)
    # 按 seed 外层:先跑完 seed0 的全部 cell(~一份完整单种子对照),再 seed1,便于早出增量结果。
    todo = [(f, c, s) for s in range(a.seeds) for f in fixtures for c in conditions
            if (f, c, s) not in done]
    print(f"== 矩阵:{len(fixtures)}fix × {len(conditions)}cond × {a.seeds}seed = {len(fixtures)*len(conditions)*a.seeds} cell"
          f",已完成 {len(done)},待跑 {len(todo)} ==", flush=True)
    for i, (f, c, s) in enumerate(todo):
        print(f"\n[{i+1}/{len(todo)}] {f} · {c} · seed{s} · {a.turns}轮 {a.mode} ...", flush=True)
        try:
            r = await run_cell(f, c, s, a.turns, a.mode)
        except Exception as e:
            print(f"  cell 失败(记下跳过):{e!r}", flush=True)
            r = {"fixture": f, "condition": c, "seed": s, "error": repr(e)[:200]}
        with open(OUT, "a", encoding="utf-8") as fh:
            fh.write(json.dumps(r, ensure_ascii=False) + "\n")
        if "error" not in r:
            print(f"  ✓ mem={r['mem_retention']} abstain={r['abstain_rate']} "
                  f"speaker={r['speaker_invalid']}/{r['speaker_total']} ${r['cost_usd']} {r['secs']}s", flush=True)
    report(OUT)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--fixtures", default="mistport_deep,sherlock,xiyou")
    ap.add_argument("--conditions", default="baseline,phase1")
    ap.add_argument("--seeds", type=int, default=3)
    ap.add_argument("--turns", type=int, default=200)
    ap.add_argument("--mode", default="deep")
    ap.add_argument("--out", default=OUT)
    ap.add_argument("--report-only", action="store_true")
    a = ap.parse_args()
    if a.report_only:
        report(a.out)
    else:
        asyncio.run(main_async(a))


if __name__ == "__main__":
    main()
