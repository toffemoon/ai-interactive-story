"""验证后台导演控制台三模式 —— 用临时 session,跑完即删,不污染库。"""
import os
os.environ["OPERATOR_TOKEN"] = "test-op-token"

from fastapi.testclient import TestClient
from src.api import app
from src import storage

SID = "_optest_session_zzz"
H = {"X-Operator-Token": "test-op-token"}

# 造一个最小可玩 session(带 artifacts,供 director now 重建用;本测试不跑 now)
storage.save_session(SID, {
    "artifacts": {
        "story": {"title": "测试故事"},
        "player": {"name": "测试玩家"},
        "world": {}, "chars": [], "playables": [],
    },
    "turns": [{"player_input": "你好", "narration": "夜色四合。", "messages": [],
               "choices": [], "triggered_events": [], "reasoning": {}, "usage": {},
               "operator_applied": []}],
})

c = TestClient(app)
ok = True
def chk(name, cond):
    global ok
    print(("  ✓ " if cond else "  ✗ ") + name)
    ok = ok and cond

try:
    # 1) 无 token → 403
    r = c.post("/api/operator/inject", json={"session_id": SID, "content": "x"})
    chk("无 token 被拒(403)", r.status_code == 403)

    # 2) direct 模式 + target → 引擎直插一条角色台词,逐字
    r = c.post("/api/operator/inject", headers=H, json={
        "session_id": SID, "content": "你逃不掉的。", "mode": "direct", "target": "长夜月"})
    j = r.json()
    chk("direct 200", r.status_code == 200)
    chk("direct 返回 mode=direct", j.get("mode") == "direct")
    t = j.get("turn", {})
    chk("direct 台词逐字进 messages", t.get("messages", [{}])[0].get("text") == "你逃不掉的。")
    chk("direct 角色名正确", t.get("messages", [{}])[0].get("name") == "长夜月")
    chk("direct narration 为空", t.get("narration") == "")
    chk("direct operator_applied 留痕", t.get("operator_applied", [{}])[0].get("mode") == "direct")

    # 3) narration 模式 → 引擎直插一条旁白,逐字
    r = c.post("/api/operator/inject", headers=H, json={
        "session_id": SID, "content": "天台的灯毫无预兆地全灭了。", "mode": "narration"})
    j = r.json()
    t = j.get("turn", {})
    chk("narration narration 逐字", t.get("narration") == "天台的灯毫无预兆地全灭了。")
    chk("narration messages 为空", t.get("messages") == [])
    chk("narration 留痕 mode=narration", t.get("operator_applied", [{}])[0].get("mode") == "narration")

    # 4) direct 不给 target → 退化为旁白
    r = c.post("/api/operator/inject", headers=H, json={
        "session_id": SID, "content": "无主之言。", "mode": "direct", "target": ""})
    j = r.json()
    chk("direct 无 target 退化 narration", j.get("mode") == "narration")
    chk("direct 无 target 进 narration 字段", j.get("turn", {}).get("narration") == "无主之言。")

    # 5) director 模式 next(不 now)→ 进队列,不插回合
    before = len(storage.load_session(SID).get("turns", []))
    r = c.post("/api/operator/inject", headers=H, json={
        "session_id": SID, "content": "让长夜月起疑", "mode": "director", "sticky": True})
    j = r.json()
    chk("director 返回 mode=director", j.get("mode") == "director")
    chk("director sticky 回显", j.get("sticky") is True)
    chk("director pending>=1", j.get("pending", 0) >= 1)
    after = len(storage.load_session(SID).get("turns", []))
    chk("director next 不插回合", after == before)

    # 6) 队列项含 mode/sticky
    q = storage.load_session(SID).get("operator_inject", [])
    chk("队列项带 mode=director", q and q[-1].get("mode") == "director")
    chk("队列项带 sticky", q and q[-1].get("sticky") is True)

    # 7) 落地回合数:初始1 + direct1 + narration1 + 退化1 = 4
    final = storage.load_session(SID)
    chk("共落地 4 回合", len(final.get("turns", [])) == 4)

    # 8) GET 队列端点
    r = c.get(f"/api/operator/inject/{SID}", headers=H)
    chk("GET 队列 200", r.status_code == 200)

    # 9) /operator 控制台页面可访问(有 token 配置)
    r = c.get("/operator")
    chk("/operator 页面 200", r.status_code == 200)
    chk("控制台含模式下拉", 'id="mode"' in r.text)
    chk("控制台含 onMode", "function onMode()" in r.text)
    chk("控制台含留痕标签 class", "oplabel" in r.text)

finally:
    storage.delete_session(SID)
    print("  (已清理临时 session)")

print("\n" + ("✅ 全部通过" if ok else "❌ 有失败项"))
exit(0 if ok else 1)
