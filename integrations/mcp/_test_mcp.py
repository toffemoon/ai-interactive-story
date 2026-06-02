"""MCP 工具层冒烟测试。

前置:后端在 STORY_API_BASE(默认 http://127.0.0.1:8000)跑着,且 DB + LLM 可用。
做法:直接 import server 的工具函数调用 —— 验证工具注册 + HTTP 代理 + 卡组缓存 + 端到端一回合。

运行:.venv/Scripts/python integrations/mcp/_test_mcp.py
"""
from __future__ import annotations

import os
import sys
import uuid

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")  # Windows 控制台默认 GBK,中文/emoji 会崩

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import anyio  # noqa: E402
import server as S  # noqa: E402


def _show(turn: dict, label: str) -> None:
    print(f"--- {label} ---")
    print("  narration:", (turn.get("narration") or "")[:110])
    msgs = turn.get("messages") or []
    if msgs:
        print("  say:", msgs[0].get("name"), "->", (msgs[0].get("text") or "")[:90])
    print("  choices:", [c.get("id") for c in (turn.get("choices") or [])])


def main() -> int:
    print("STORY_API_BASE =", S.BASE)

    # 1. MCP 工具是否都注册上了
    tools = anyio.run(S.mcp.list_tools)
    print(f"[1] MCP tools registered: {len(tools)} -> {[t.name for t in tools]}")
    assert len(tools) >= 14, "工具数量不对"

    # 2. 识别(auto)
    r = S.identify("姓名:测试剑客。沉默寡言,门派被灭后独自下山复仇,说话很冲,从不解释。", kind="auto")
    print(f"[2] identify auto -> kind={r.get('kind')} conf={r.get('confidence')} name={(r.get('data') or {}).get('data',{}).get('name')}")
    assert r.get("kind") in {"character", "world", "story", "player"}

    # 3. 卡库
    chars = S.library_list("characters")
    print(f"[3] library characters: {len(chars)} (first={chars[0]['name'] if chars else None})")
    if not chars:
        print("库里没有角色卡,跳过开局测试。")
        return 0
    card = chars[0]["data"]

    # 4. 开局 + 推进一回合(用缓存卡组)
    sid = "mcp-test-" + uuid.uuid4().hex[:8]
    t0 = S.story_start(sid, [card])
    _show(t0, "[4] story_start 开场")
    assert t0.get("narration") or t0.get("messages"), "开场回合为空"
    cid = (t0.get("choices") or [{}])[0].get("id", "")
    t1 = S.story_act(sid, selected_choice=cid) if cid else S.story_act(sid, user="我走上前打个招呼")
    _show(t1, "[5] story_act 第二回合")
    assert t1.get("narration") or t1.get("messages"), "第二回合为空"

    # 5. 续玩还原(验证 artifacts 恢复)+ 清理
    S._SESSIONS.pop(sid, None)  # 清掉内存缓存,模拟 MCP 重启
    t2 = S.story_act(sid, user="环顾四周")  # 应从后端 artifacts 自动恢复卡组
    _show(t2, "[6] story_act 重启后(从 artifacts 恢复卡组)")
    sess = S.session_get(sid)
    print(f"[7] session turns={len(sess.get('turns') or [])} usage_total={sess.get('usage_total')}")
    print("[8] delete:", S.session_delete(sid))

    # 清理测试期间 identify 入库的角色卡
    for c in S.library_list("characters"):
        if (c.get("data") or {}).get("data", {}).get("name") == "测试剑客":
            print("[9] cleanup:", S.library_delete("characters", c["name"]))
            break

    print("\nOK ✅  MCP 工具层端到端跑通")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
