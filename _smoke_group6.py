"""第 6 组冒烟:对话式建卡——从零多轮引导 + 完善已有 OC,产物纯 Card V2。"""
import json, sys, urllib.request
sys.stdout.reconfigure(encoding="utf-8")
import _validate_group1 as V


def post(path, body, timeout=120):
    req = urllib.request.Request(V.BASE + path, data=json.dumps(body).encode(), method="POST",
                                headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return json.loads(r.read().decode())


def filled_fields(d):
    out = []
    for k in ("name", "description", "personality", "scenario", "first_mes", "mes_example"):
        if (d.get(k) or "").strip():
            out.append(k)
    if d.get("speech_rules"):
        out.append(f"speech_rules×{len(d['speech_rules'])}")
    return out


def run_conversation(tag, answers, seed="", draft=None):
    print(f"\n== {tag} ==")
    messages = []
    cur_draft = draft
    last = None
    for i, ans in enumerate(answers, 1):
        messages.append({"role": "user", "content": ans})
        out = post("/api/build_card", {"messages": messages, "draft": cur_draft, "seed": seed})
        cur_draft = out["draft"]
        messages.append({"role": "assistant", "content": (out["reply"] + "\n" + out["next_question"]).strip()})
        last = out
        print(f"  t{i} 玩家:{ans[:26]}")
        print(f"     助手:{out['reply'][:46]} | 问:{out['next_question'][:34]}")
        print(f"     草稿已填:{filled_fields(cur_draft)} done={out['done']} filled={out.get('filled')}")
    return cur_draft, last


# 1. 从零建卡
zero_answers = [
    "我想建一个角色,但完全不知道怎么写,你带我一步步来",
    "是个武侠世界的剑客,叫阿砚,二十出头,门派被灭了独自下山",
    "他很沉默寡言,一心复仇,说话很冲、从不解释自己,信不过任何人",
    "他压力大时先动手再说,对弱者却有点心软;最恨背叛",
    "他说话短促,爱用'哼''滚'这种字,绝不示弱,偶尔冷笑一声",
    "可以了,就照这样定下来吧",
]
draft, last = run_conversation("从零建卡(武侠剑客阿砚)", zero_answers)
print("\n  -- 校验 --")
print(f"  最终草稿: name={draft.get('name')!r} desc={len(draft.get('description',''))}字 "
      f"personality={len(draft.get('personality',''))}字 speech_rules={len(draft.get('speech_rules',[]))}条 "
      f"mes_example={len(draft.get('mes_example',''))}字")
assert draft.get("name"), "建完没有 name"
assert draft.get("description") and draft.get("personality"), "核心字段没填"
assert len(draft.get("speech_rules", [])) >= 3, "speech_rules 不足 3 条(表达 DNA 没化成规则)"
# 产物可包成合法 Card V2
card = {"spec": "chara_card_v2", "spec_version": "2.0", "data": draft}
print(f"  包成 Card V2 成功:{card['spec']} / {card['data']['name']}")

# 2. 完善已有薄弱 OC
thin = {"name": "林晚", "description": "一个神秘的女医师,在乱世里游走行医", "personality": "",
        "scenario": "", "first_mes": "", "mes_example": "", "speech_rules": [], "tags": []}
draft2, last2 = run_conversation(
    "完善已有 OC(薄弱的林晚)",
    ["帮我把林晚这张卡补全,她现在只有名字和一句背景",
     "她外冷内热,治病救人却收很高的诊金,从不解释自己的过去",
     "她说话慢条斯理,爱用反问句,绝不轻易许诺",
     "好,就这样"],
    seed=json.dumps(thin, ensure_ascii=False), draft=thin,
)
print("\n  -- 校验 --")
print(f"  补全后: personality={len(draft2.get('personality',''))}字 speech_rules={len(draft2.get('speech_rules',[]))}条 "
      f"mes_example={len(draft2.get('mes_example',''))}字")
assert draft2.get("name") == "林晚", "完善模式把名字改了"
assert draft2.get("personality") and len(draft2.get("speech_rules", [])) >= 2, "薄弱字段没补上"

print("\nSMOKE GROUP6 PASSED")
