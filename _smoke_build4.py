"""第 3 步冒烟:对话建卡四类(characters/players/worlds/stories)各跑一段,产物按类型成形。"""
import json, sys, urllib.request
sys.stdout.reconfigure(encoding="utf-8")
B = "http://127.0.0.1:8000"


def post(p, b, t=120):
    r = urllib.request.Request(B + p, data=json.dumps(b).encode(), method="POST", headers={"Content-Type": "application/json"})
    return json.loads(urllib.request.urlopen(r, timeout=t).read())


def run(kind, answers):
    print(f"\n== {kind} ==")
    messages, draft = [], None
    last = None
    for ans in answers:
        messages.append({"role": "user", "content": ans})
        out = post("/api/build_card", {"kind": kind, "messages": messages, "draft": draft, "seed": ""})
        draft = out["draft"]
        messages.append({"role": "assistant", "content": (out["reply"] + "\n" + out["next_question"]).strip()})
        last = out
    print("  done=", last["done"], " filled=", last.get("filled"))
    return draft


d = run("players", [
    "我扮演一个落魄的赏金猎人,叫秦九",
    "目标是还清欠下的赌债;能力是箭术精准、识人很准;弱点是欠了高利贷、信不过人",
    "开局我知道债主是城南的钱半城,可以了就这样",
])
print(f"  主角卡: name={d.get('name')!r} role={(d.get('role') or '')[:20]!r} goals={len(d.get('goals',[]))} abilities={len(d.get('abilities',[]))} constraints={len(d.get('constraints',[]))} known={len(d.get('known_facts',[]))}")
assert d.get("name") and d.get("goals") and (d.get("abilities") or d.get("constraints")), "主角卡核心字段没填"

d = run("worlds", [
    "建一个武侠世界的设定卡,就叫江湖风物志",
    "有个大门派叫青冥派,在西岭山,擅长剑法,掌门姓沈",
    "城里还有个黑市叫鬼市,半夜才开,专卖违禁的奇门兵器和消息",
    "差不多了",
])
print(f"  设定卡: name={d.get('name')!r} entries={len(d.get('entries',[]))}")
for e in d.get("entries", [])[:3]:
    print(f"    条目 keys={e.get('keys')} comment={e.get('comment')!r} content={(e.get('content') or '')[:30]!r}")
assert d.get("name") and len(d.get("entries", [])) >= 2 and all(e.get("content") for e in d["entries"]), "设定卡条目没成形"

d = run("stories", [
    "一个悬疑故事,主角是新来的捕快,查一桩命案",
    "前提:城里富商被毒杀在自家书房;主线大概是 勘验现场→盘问家眷→锁定凶手",
    "结局有两个:抓到真凶平反、和 凶手买通官府逃脱;好了就这样",
])
print(f"  故事卡: title={d.get('title')!r} premise={len(d.get('premise',''))}字 main_plot={len(d.get('main_plot',[]))} events={len(d.get('events',[]))} endings={len(d.get('endings',[]))}")
for e in d.get("endings", [])[:3]:
    print(f"    结局 {e.get('title')!r} 条件={e.get('conditions')}")
assert d.get("title") and d.get("premise") and len(d.get("endings", [])) >= 1, "故事卡核心没成形"

d = run("characters", ["建个角色,叫墨七,沉默的刀客", "他话少、出手快,绝不食言,自称'在下'", "可以了"])
print(f"  角色卡: name={d.get('name')!r} personality={len(d.get('personality',''))}字 speech_rules={len(d.get('speech_rules',[]))}")
assert d.get("name") and d.get("personality"), "角色卡没成形"

print("\nBUILD 4 KINDS PASSED")
