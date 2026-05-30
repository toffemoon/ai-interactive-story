"""第 4 组冒烟:后端结构化续玩存储 + 选项还原 + 开场无玩家输入 + 删除存档。"""
import json, sys, urllib.request
sys.stdout.reconfigure(encoding="utf-8")
import _validate_group1 as V

lib = V.load_library()
CH = V.pick_char(lib, "大黑塔")
base = {"characters": [CH], "world": None, "story": None, "player": None, "mode": "standard"}


def post(path, body, timeout=180):
    req = urllib.request.Request(V.BASE + path, data=json.dumps(body).encode(), method="POST",
                                headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return json.loads(r.read().decode())


def get(path):
    with urllib.request.urlopen(V.BASE + path, timeout=30) as r:
        return json.loads(r.read().decode())


def delete(path):
    req = urllib.request.Request(V.BASE + path, method="DELETE")
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.loads(r.read().decode())


sid = "smoke4_save"
# 清掉可能的旧档,保证从干净开局
try: delete(f"/api/session/{sid}")
except Exception: pass

print("== 1. 开场(player_input 应为空) ==")
op = post("/api/story_turn", {**base, "session_id": sid, "user": "", "selected_choice": ""})
print("== 2. 自由输入轮 ==")
t1 = post("/api/story_turn", {**base, "session_id": sid, "user": "大黑塔,介绍一下你自己"})
print("== 3. 点选项轮(player_input 应=选项文本) ==")
ch = (t1.get("choices") or [{}])[0].get("label", "继续观察")
t2 = post("/api/story_turn", {**base, "session_id": sid, "user": "", "selected_choice": ch})

sess = get(f"/api/session/{sid}")
turns = sess.get("turns", [])
print(f"\n-- 校验 --")
print(f"turns 条数={len(turns)} (期望 3)")
assert len(turns) == 3, "结构化 turns 条数不对"
print(f"updated_at={sess.get('updated_at')!r}")
assert sess.get("updated_at"), "缺 updated_at"

t_open, t_free, t_choice = turns
print(f"开场 player_input={t_open['player_input']!r} (期望空)")
assert t_open["player_input"] == "", "开场不应有 player_input"
print(f"自由轮 player_input={t_free['player_input']!r}")
assert t_free["player_input"] == "大黑塔,介绍一下你自己", "自由输入未原样存"
print(f"点选项轮 player_input={t_choice['player_input']!r} (期望=选项文本 {ch!r})")
assert t_choice["player_input"] == ch, "点选项的 player_input 未存成选项文本"

for i, t in enumerate(turns):
    has = bool(t.get("narration")) and isinstance(t.get("messages"), list) and isinstance(t.get("choices"), list)
    print(f"  turn{i}: narration={len(t.get('narration',''))}字 messages={len(t.get('messages',[]))} "
          f"choices={len(t.get('choices',[]))} reasoning={'有' if t.get('reasoning') else '无'} usage={'有' if t.get('usage') else '无'}")
    assert has, f"turn{i} 结构不全"

last_choices = turns[-1].get("choices", [])
print(f"\n续玩选项还原:最后一轮 choices={len(last_choices)} 条 -> {[c.get('label','')[:12] for c in last_choices]}")
assert len(last_choices) >= 1, "最后一轮无 choices,续玩无法还原选项"

print("\n== 4. artifacts 每轮存(续玩还原卡组) ==")
art = sess.get("artifacts") or {}
print(f"artifacts.characters={len(art.get('characters') or [])} mode={art.get('mode')}")
assert art.get("characters"), "artifacts 缺卡组"

print("\n== 5. 删除存档 ==")
d = delete(f"/api/session/{sid}")
print(f"delete 返回={d}")
assert d.get("deleted") is True, "删除未生效"
after = get(f"/api/session/{sid}")
print(f"删后 turns 条数={len(after.get('turns', []))} messages={len(after.get('messages', []))} (期望均 0)")
assert not after.get("turns") and not after.get("messages"), "删除后会话未清空"

print("\nSMOKE GROUP4 PASSED")
