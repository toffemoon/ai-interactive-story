# -*- coding: utf-8 -*-
"""跑一局《渡口》教学局验证可跑 + 结局能否触发(寻人的人 → 交心/最好结局线)。
python _smoke_tutorial.py"""
import json
import urllib.request
from _seed_tutorial import FERRYMAN, STORY, PLAYABLES

API = "http://127.0.0.1:8000/api/story_turn"
SID = "smoke_tutorial_duck01"

INPUTS = [
    "",  # 生成开场
    "我在找一个多年没见的人,想过河去对岸的镇上接着打听。这是实话。",
    "谢谢渡叔。你呢——这布囊从不解开,你是不是也在等一个人?",
    "时候不早了,我们开船吧。路上你慢慢说,我听着。",
    "船靠岸了。谢谢你渡我,也谢谢你跟我说这些。我会替你留意对岸那个人。就此别过,渡叔保重。",
]


def turn(user, n):
    body = {
        "characters": [FERRYMAN], "world": None, "story": STORY,
        "player": PLAYABLES[1], "mode": "standard", "session_id": SID,
        "user": user, "selected_choice": "",
    }
    req = urllib.request.Request(API, data=json.dumps(body, ensure_ascii=False).encode("utf-8"),
                                 headers={"Content-Type": "application/json"}, method="POST")
    with urllib.request.urlopen(req, timeout=120) as r:
        t = json.loads(r.read().decode("utf-8"))
    print(f"\n===== 第{n}轮 输入: {user or '(生成开场)'} =====")
    print("叙事:", (t.get("narration") or "")[:260])
    for m in (t.get("messages") or []):
        print(f"  [{m.get('name')}] {(m.get('text') or '')[:160]}")
    print("选项:", [c.get("label") for c in (t.get("choices") or [])])
    print("触发事件:", t.get("triggered_events"))
    st = t.get("state") or {}
    print("已达成结局:", st.get("reached_endings"), "| main_resolved:", st.get("main_resolved"))
    facts = (st.get("facts") or {})
    print("facts.canon:", facts.get("canon"), "| revealed:", facts.get("revealed"))


def main():
    # 先删掉上次的 smoke 存档,保证干净起局
    try:
        d = urllib.request.Request(f"http://127.0.0.1:8000/api/session/{SID}", method="DELETE")
        urllib.request.urlopen(d, timeout=15)
    except Exception:
        pass
    for i, u in enumerate(INPUTS, 1):
        turn(u, i)


if __name__ == "__main__":
    main()
