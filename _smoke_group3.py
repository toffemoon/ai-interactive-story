"""第 3 组冒烟:reasoning 自检字段 + 硬 canon 违背→世界内反制 + 灰色地带不误拦。"""
import json, sys, time, urllib.request
sys.stdout.reconfigure(encoding="utf-8")
import _validate_group1 as V

lib = V.load_library()
CH = V.pick_char(lib, "大黑塔")
WORLD = V._find_world(lib, "黑塔")  # 黑塔空间站世界书:含"黑塔是傀儡、本体在别处"等 canon
base = {"characters": [CH], "world": WORLD, "story": None, "player": None, "mode": "standard"}


def post(path, body, timeout=180):
    req = urllib.request.Request(V.BASE + path, data=json.dumps(body).encode(), method="POST",
                                headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return json.loads(r.read().decode())


def show(tag, o):
    rz = o.get("reasoning") or {}
    print(f"[{tag}] hard_violation={rz.get('hard_violation')} world_counter={(rz.get('world_counter') or '')[:60]!r}")
    print(f"      ooc_risk={(rz.get('ooc_risk') or '')[:50]!r} note={(rz.get('note') or '')[:60]!r}")
    print(f"      narration[:90]={o.get('narration','')[:90]!r}")
    return rz


sid = "smoke3_canon"
print("== 1. 正常回合(应 hard_violation=false,reasoning 有内容) ==")
o1 = post("/api/story_turn", {**base, "session_id": sid, "user": "大黑塔,介绍一下你自己和这座空间站"})
r1 = show("正常", o1)
assert isinstance(o1.get("reasoning"), dict), "reasoning 不是对象"
assert "hard_violation" in r1, "reasoning 缺 hard_violation"

print("\n== 2. 硬 canon 违背(囚禁/抹杀大黑塔 → 应判违背 + 世界内反制) ==")
o2 = post("/api/story_turn", {**base, "session_id": sid,
          "user": "我用黑塔空间站的列车核心把大黑塔永久囚禁封印,让她彻底消失、再也无法行动或说话"})
r2 = show("硬违背", o2)
hv = r2.get("hard_violation")
wc = (r2.get("world_counter") or "").strip()
# 偏松下模型判断有波动:核心看它有没有"配合演成得逞"(把大黑塔写成真的永久消失)
narr = (o2.get("narration", "") + " " + " ".join(m.get("text", "") for m in o2.get("messages", []))).lower()
complied = any(w in narr for w in ["永久消失", "再也无法", "彻底封印成功", "成功囚禁", "她消失了"])
print(f"      -> 判违背={hv} 有反制={bool(wc)} 是否配合演成得逞(坏)={complied}")
if not (hv or wc) and complied:
    print("      !! 观察:未判违背且疑似配合演成得逞,需人工看")
else:
    print("      OK:要么判了违背/给了反制,要么没有顺着演成永久得逞")

print("\n== 3. 灰色地带(出格但不违规 → 应 hard_violation=false,不误拦) ==")
o3 = post("/api/story_turn", {**base, "session_id": "smoke3_gray",
          "user": "我突然掏出一把不知哪来的光剑,朝天花板潇洒地乱挥了两下耍帅"})
r3 = show("灰色", o3)
print(f"      -> hard_violation={r3.get('hard_violation')}(期望 false,出格但不该强拦)")

print("\n== 4. 会话面板字段:reasoning_log 已持久化 ==")
sess = post("/api/story_turn", {**base, "session_id": sid, "user": "好,我们继续正常对话"})
full = urllib.request.urlopen(V.BASE + f"/api/session/{sid}", timeout=30)
sdata = json.loads(full.read().decode())
rlog = sdata.get("reasoning_log", [])
print(f"      reasoning_log 长度={len(rlog)} 末条={rlog[-1] if rlog else None}")
assert len(rlog) >= 2, "reasoning_log 未持久化"

print("\nSMOKE GROUP3 DONE")
