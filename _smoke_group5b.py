"""第 5b 组冒烟:time_advance clamp(自然/跳跃)+ due/idle 恶化登场逻辑 + 实战时钟推进。"""
import json, sys, urllib.request
sys.stdout.reconfigure(encoding="utf-8")
import _validate_group1 as V
from src import story
from src.models import StoryBook, StoryEvent, RuntimeState, EventTimelineItem


def post(path, body, timeout=180):
    req = urllib.request.Request(V.BASE + path, data=json.dumps(body).encode(), method="POST",
                                headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return json.loads(r.read().decode())


def get(path):
    with urllib.request.urlopen(V.BASE + path, timeout=30) as r:
        return json.loads(r.read().decode())


print("== 1. _clamp_time_advance(自然推进 vs 玩家跳时间) ==")
cases = [
    (30, "我四处看看", 30, "自然小推进"),
    (99999, "我四处看看", story.NATURAL_MAX_ADVANCE, "自然推进被 clamp 到上限"),
    (0, "我四处看看", story.MIN_TIME_ADVANCE, "至少 +最小增量防冻住"),
    (1440, "我们等到第二天早上再说", 1440, "玩家说第二天 → 放开大跳"),
    (600, "睡了一觉", 600, "睡一觉 → 跳跃词放开"),
    (None, "随便", story.MIN_TIME_ADVANCE, "缺值兜底最小增量"),
]
for raw, act, expect, desc in cases:
    got = story._clamp_time_advance(raw, act)
    ok = got == expect
    print(f"  {'OK ' if ok else 'FAIL'} clamp({raw},{act!r})={got} 期望{expect} — {desc}")
    assert ok, desc

print("\n== 2. _due_escalations(到点/停滞才登场,已 active 不再算) ==")
sb = StoryBook(events=[
    StoryEvent(event_id="bill_grow", title="账单增殖", summary="账单随时间增多", escalate_after_idle=30, severity=4),
    StoryEvent(event_id="topaz_push", title="托帕施压", summary="托帕来催债", due_clock=120, severity=3),
    StoryEvent(event_id="quiet", title="无时间事件", summary="不随时间", severity=2),
])
st = RuntimeState()
st.clock_minutes = 10; st.idle_minutes = 5
print("  早期(clock=10,idle=5):", [e.event_id for e, _ in story._due_escalations(sb, st)], "(期望空)")
assert story._due_escalations(sb, st) == []
st.clock_minutes = 130; st.idle_minutes = 40
esc = story._due_escalations(sb, st)
print("  过点后(clock=130,idle=40):", [(e.event_id, r) for e, r in esc])
ids = {e.event_id for e, _ in esc}
assert "bill_grow" in ids and "topaz_push" in ids and "quiet" not in ids, "恶化登场判定错"
# 账单已 active → 不再算待登场
st.timeline = [EventTimelineItem(event_id="bill_grow", title="账单增殖", status="active")]
esc2 = story._due_escalations(sb, st)
print("  账单已active后:", [e.event_id for e, _ in esc2], "(账单应不在内)")
assert "bill_grow" not in {e.event_id for e, _ in esc2}

print("\n== 3. 实战:时钟随轮推进 + 跳时间大跳 ==")
lib_stories = get("/api/library/stories")
bill = next((s["data"] for s in lib_stories if "账单" in (s["data"].get("title") or "")), None)
print(f"  账单故事书: events={len(bill.get('events',[]))} endings={len(bill.get('endings',[]))} clock_start={bill.get('clock_start')}")
charlib = get("/api/library/characters")
topaz = next(c["data"] for c in charlib if c["data"]["data"]["name"] == "托帕")
base = {"characters": [topaz], "world": None, "story": bill, "player": None, "mode": "standard"}
sid = "smoke5b_clock"
try:
    req = urllib.request.Request(V.BASE + f"/api/session/{sid}", method="DELETE"); urllib.request.urlopen(req, timeout=20)
except Exception: pass

op = post("/api/story_turn", {**base, "session_id": sid, "user": ""})
c0 = op["state"]["clock_minutes"]
print(f"  开场 clock={c0}(故事书 clock_start={bill.get('clock_start')})")
t1 = post("/api/story_turn", {**base, "session_id": sid, "user": "我仔细看看这张账单上写了什么"})
c1 = t1["state"]["clock_minutes"]
print(f"  自然推进一轮 clock={c1}(增量={c1-c0},应在 1~{story.NATURAL_MAX_ADVANCE} 之间)")
assert story.MIN_TIME_ADVANCE <= (c1 - c0) <= story.NATURAL_MAX_ADVANCE, "自然推进增量越界"
t2 = post("/api/story_turn", {**base, "session_id": sid, "user": "我决定先回去休息,等到第二天早上再处理"})
c2 = t2["state"]["clock_minutes"]
print(f"  玩家「第二天」后 clock={c2}(增量={c2-c1},应明显大跳 >300)")
assert (c2 - c1) > 300, "玩家跳时间未放大"
print(f"  idle_minutes={t2['state'].get('idle_minutes')} main_resolved={t2['state'].get('main_resolved')}")
assert "local_continuation" not in (((t2.get("state") or {}).get("player") or {}).get("flags") or []), "带时钟掉保底"

print("\nSMOKE GROUP5B PASSED")
