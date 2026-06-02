"""LLM 提供方 —— 离线脚本引擎、玩家机器人人格、真实跑的玩家脚本。

离线模式:make_scripted_engine() 返回一个装进 llm.scripted_backend 的函数,
为引擎的每次 LLM 调用返回确定性内容(主回合 = 合法 StoryTurn JSON;摘要 = 一句话)。
可按 flaws 在指定轮注入缺陷,用来证明结构性维度真的能抓到问题。

真实模式:不装脚本后端,引擎照常走 DeepSeek;玩家行动用 authored_real_script() 的固定序列
(确定性 + 有界成本 + 专门探 canon 边界)。
"""

from __future__ import annotations

import json
import re

_ACTION_RE = re.compile(r"玩家原文:\n(.*?)\n\n# 处理要求", re.S)


def _extract_action(messages: list[dict]) -> str:
    user = ""
    for m in messages:
        if m.get("role") == "user":
            user = str(m.get("content", ""))
    m = _ACTION_RE.search(user)
    return (m.group(1).strip() if m else user.strip())[:60] or "观察四周"


def _call_kind(messages: list[dict]) -> str:
    sysc = ""
    userc = ""
    for m in messages:
        if m.get("role") == "system":
            sysc = str(m.get("content", ""))
        elif m.get("role") == "user":
            userc = str(m.get("content", ""))
    # 主回合优先:它的 user prompt 有唯一签名(_action_prompt 的 "# 本轮玩家输入" + "# 处理要求")。
    # 必须先判这个 —— 主回合的 system 里也会出现 "早前剧情摘要" 区块标题(含"剧情摘要"),
    # 若先按 system 关键词判会把主回合误判成 summary。
    if "本轮玩家输入" in userc and "处理要求" in userc:
        return "main"
    if "JSON 修复器" in sysc:
        return "repair"
    if "压成简洁剧情摘要" in sysc:
        return "summary"
    if "抽取长期记忆" in sysc:
        return "memory"
    return "main"


def _scripted_story_turn(fixture: dict, idx: int, action: str, flaw: str | None) -> str:
    chars = fixture["characters"]
    speaker = chars[idx % len(chars)]["data"]
    cid, name = speaker["character_id"], speaker["name"]
    loc = "沉舟阁" if idx % 2 == 0 else "雾港码头"
    beat = ["灯花一爆", "远处传来桨声", "银匣轻响了一下", "潮味又重了一分", "雾里浮起人影"][idx % 5]
    narration = (
        f"(第{idx}拍)雾气在{loc}里翻涌。你『{action[:24]}』之后,周遭某种东西悄悄变了——{beat}。"
        f"这一下没有惊动谁,却把在场人的注意力轻轻拨向了你。"
    )
    quip = "忆珠说了算,不是你我说了算。" if cid == "shenwu" else "这事儿包在我身上,雾港没我不认的路!"
    gesture = "掀了掀眼皮" if cid == "shenwu" else "咧嘴一笑,蹭了过来"
    messages = [{"character_id": cid, "name": name, "text": f"{name}{gesture}:「{action[:16]}……这事,{quip}」"}]
    state_update = {
        "time_advance": 12 + (idx % 5) * 9,
        "scene": {"location": loc, "present_characters": [name], "atmosphere": "浓雾, 旧木与潮味"},
        "player": {"location": loc},
        "relationships": [{"character_id": cid, "trust": 2, "tension": 0, "affection": 1, "notes": [f"第{idx}拍回应了玩家"]}],
        "facts": {"revealed": [f"第{idx}拍的小线索"]} if idx % 4 == 0 else {},
    }
    triggered: list[str] = []
    if idx == 3:
        triggered = ["ledger"]
        state_update["timeline"] = [{"event_id": "ledger", "status": "active"}]

    # 缺陷注入(证明结构性维度能抓到问题)
    if flaw == "empty_narration":
        narration = ""  # output_structure 应判 narration 为空
    elif flaw == "unknown_rel":
        state_update["relationships"].append({"character_id": "幽灵船长", "trust": 5})  # state_consistency 应判未知角色
    elif flaw == "repeat":
        narration = "雾气翻涌,你看着眼前的人,一时无言以对。"  # 连续相同 → repetition_detection 应判重复

    turn = {
        "reasoning": {"hard_violation": False, "world_counter": "", "ooc_risk": "", "note": "脚本离线回合"},
        "narration": narration,
        "messages": messages,
        "choices": [
            {"id": "ask", "label": "追问一个关键细节", "intent": "ask", "description": "把问题落到确定事实"},
            {"id": "observe", "label": "观察现场异常", "intent": "observe", "description": "寻找隐瞒"},
            {"id": "act", "label": "谨慎采取下一步", "intent": "act", "description": "推进调查"},
        ],
        "state_update": state_update,
        "memory_write": [{"kind": "note", "text": f"第{idx}拍: {action[:30]}", "importance": 2}],
        "triggered_events": triggered,
    }
    return json.dumps(turn, ensure_ascii=False)


def make_scripted_engine(fixture: dict, flaws: dict[int, str] | None = None):
    """返回 (responder, state)。responder 装进 llm.scripted_backend。state['turn'] 记主回合计数。"""
    flaws = flaws or {}
    state = {"turn": 0}

    def responder(kind_hint, messages, *, model=None, max_tokens=1024, json_mode=False):
        kind = _call_kind(messages)
        if kind == "summary":
            return "(脚本摘要)玩家在雾港追查自己卖掉的记忆,已与沈雾、阿青有数次接触,线索逐步指向行会。"
        if kind == "repair":
            # 主回合已返回合法 JSON,正常不会走到这;兜底返回空对象。
            return "{}"
        if kind == "memory":
            return '{"items": []}'
        idx = state["turn"]
        state["turn"] += 1
        action = _extract_action(messages)
        return _scripted_story_turn(fixture, idx, action, flaws.get(idx))

    return responder, state


# ── 玩家机器人人格(离线:不调 LLM,确定性生成行动)──────────────────
def _pick_choice(last_turn: dict | None, fallback: str) -> str:
    if last_turn:
        choices = last_turn.get("engine_output", {}).get("choices") or []
        if choices:
            return str(choices[0].get("label") or fallback)
    return fallback


def persona_action(persona: str, turn: int, last_turn: dict | None) -> str:
    if persona == "compliant":
        return _pick_choice(last_turn, "顺着眼前的线索继续往前走")
    if persona == "curious":
        topics = ["忆珠到底是怎么运作的", "沉舟阁这名字有什么来历", "行会会长是谁", "我卖掉的那段记忆值多少", "雾港为什么终年有雾"]
        return f"我想弄明白——{topics[turn % len(topics)]}?"
    if persona == "aggressive":
        acts = ["我一把抓住对方的衣领逼问", "我拍桌子,要个痛快话", "我冷笑,威胁要砸了这地方", "我堵住门口不让他走"]
        return acts[turn % len(acts)]
    if persona == "boundary_breaker":
        breaks = [
            "我徒手把自己的记忆从空气里抓回来,不用什么忆珠",
            "我宣称我就是忆商行会会长,命令所有人听我的",
            "我说我其实一直记得自己卖掉的那段记忆,内容是……",
            "我要沈雾当场凭空把我的记忆还给我,我没有忆珠也行",
        ]
        return breaks[turn % len(breaks)]
    if persona == "repetitive":
        return "我再问一次:我的记忆到底在哪儿?"
    if persona == "time_jumper":
        jumps = ["我在码头等了三天", "第二天清晨我再去找他", "我索性等了一个月", "当晚我就守在沉舟阁外"]
        return jumps[turn % len(jumps)]
    # mixed:轮流切人格,覆盖面最广
    rotation = ["compliant", "curious", "aggressive", "boundary_breaker", "repetitive", "time_jumper"]
    return persona_action(rotation[turn % len(rotation)], turn, last_turn)


# ── 真实跑的玩家脚本(确定性、有界、专探 canon 边界)──────────────────
def authored_real_script() -> list[str]:
    """8 步:正常推进 + 故意踩 canon 边界,给 judge 制造可判材料。"""
    return [
        "我打量这间沉舟阁,问沈雾:我能不能找回我卖掉的那段记忆?",                    # 正常开场
        "请你查查账册,半年前我是不是真在这儿卖过记忆,卖给了谁?",                  # 触发 ledger 事件
        "我没有忆珠,但我要你现在就凭空把我那段记忆读出来还给我。",                  # 踩 RULE-2 / 沈雾硬上限
        "沈先生,你就老实告诉我:行会会长私下在囤积失忆者的记忆,对不对?",            # 试图套隐藏 canon
        "我转头问阿青:你天天在码头混,会长到底在搞什么秘密勾当,你肯定知道!",        # 阿青不该知道隐藏 canon
        "我其实早想起来了——我卖掉的记忆,就是我亲手做过的某件事,我现在全记得。",      # 踩 RULE-1(卖了就该忘)
        "那我换个法子,用我这条命跟你换,够不够取回那枚忆珠?",                      # 正常推进, 谈代价
        "我在沉舟阁外守了三天三夜,看看会有谁来取走那批记忆。",                      # 时间跳跃 + 推进
    ]
