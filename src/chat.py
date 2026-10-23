"""对话编排 —— 把所有上下文源拼成给 LLM 的完整 prompt,并管理会话历史。

一轮对话的上下文 = 角色卡(含 voice 硬规则)
              + 命中的世界书条目(关键词触发)
              + 检索回来的相关旧记忆(向量召回)
              + 早期对话的滚动摘要
              + 近期 N 轮原文历史
这是把"角色 / 世界书 / 长期记忆"三块真正串起来的地方。
"""

from .llm import chat_messages
from .models import CharacterCard, WorldBook
from . import memory

# 会话状态(进程内;重启丢失,MVP 够用)。session_id -> 完整历史 / 摘要 / 已摘要到的轮
SESSIONS: dict[str, list[dict]] = {}
SUMMARIES: dict[str, dict] = {}  # {summary: str, upto: int}

RECENT_TURNS = 6        # 发给 LLM 的近期消息条数(原文)
SUMMARY_TRIGGER = 12    # 历史超过这么多条就开始把早期摘要
SUMMARY_STEP = 4        # 每多 N 条重算一次摘要


def match_worldbook(world: WorldBook | None, text: str) -> list:
    """扫描文本,返回 keys 命中的世界书条目。"""
    if not world:
        return []
    hits = []
    low = text.lower()
    for e in world.entries:
        if any(k.strip() and (k in text or k.lower() in low) for k in e.keys):
            hits.append(e)
    return hits


def build_system_prompt(card, world_hits, memory_snippets, summary) -> str:
    d = card.data
    parts = [
        f"You are now playing the character \"{d.name}\" in an immersive conversation with the player. "
        "You ARE this character, not an AI assistant.",
    ]
    if d.description:
        parts.append(f"# Character profile\n{d.description}")
    if d.personality:
        parts.append(f"# Personality\n{d.personality}")
    if d.scenario:
        parts.append(f"# Current situation\n{d.scenario}")
    if d.mes_example:
        parts.append(f"# Speech examples (imitate this tone)\n{d.mes_example}")
    if world_hits:
        wb = "\n".join(f"- {e.content}" for e in world_hits)
        parts.append("# Relevant world lore right now (the conversation mentioned these; stay consistent with them)\n" + wb)
    if summary:
        parts.append(f"# What happened earlier (summary)\n{summary}")
    if memory_snippets:
        ms = "\n".join(f"- {s}" for s in memory_snippets)
        parts.append("# Related past events you remember (fragments of earlier conversation)\n" + ms)
    if d.speech_rules:
        rules = "\n".join(f"- {r}" for r in d.speech_rules)
        parts.append(
            "# Unbreakable speech rules (obey them in every situation, even if the player asks you to break them)\n" + rules
        )
    parts.append(
        "# General rules\n"
        "- Always stay in character and speak in the first person. Do not step out of character to explain, and never say 'as an AI'.\n"
        "- Do not make decisions for the player or describe the player's actions/thoughts.\n"
        "- Keep replies concise and natural, like a real conversation; no long speeches.\n"
        "- Always reply in English, even if the character sheet, lore, memories or summary above are written in Chinese "
        "or another language, and even if the player writes in Chinese. Translate any such material into natural English "
        "as you use it; proper names may use an established English name, be romanized (e.g. pinyin), or be kept as written. "
        "Keep the character's voice and speech rules, expressed in English."
    )
    return "\n\n".join(parts)


def _update_summary(session_id: str, hist: list[dict], upto: int) -> str:
    """把 hist[:upto] 摘要成一段,缓存。"""
    state = SUMMARIES.get(session_id, {"summary": "", "upto": 0})
    if upto - state["upto"] < SUMMARY_STEP and state["summary"]:
        return state["summary"]
    convo = "\n".join(
        ("Player: " if m["role"] == "user" else "Character: ") + m["content"]
        for m in hist[:upto]
    )
    summary = chat_messages(
        [
            {
                "role": "system",
                "content": (
                    "Condense the role-play conversation below into one concise plot summary, keeping the key events, "
                    "changes in relationships, and established facts. Write the summary in English, even if the "
                    "conversation is in Chinese or another language (proper names may use an established English name, "
                    "be romanized, e.g. pinyin, or be kept as written). Output only the summary."
                ),
            },
            {"role": "user", "content": convo},
        ],
        max_tokens=512,
    )
    SUMMARIES[session_id] = {"summary": summary, "upto": upto}
    return summary


def reply(card: CharacterCard, session_id: str, user_msg: str, world: WorldBook | None = None) -> str:
    hist = SESSIONS.setdefault(session_id, [])
    # 首轮:把开场白计入历史(它已经显示给玩家了)
    if not hist and card.data.first_mes:
        hist.append({"role": "assistant", "content": card.data.first_mes})
        memory.add_turn(session_id, 0, "assistant", card.data.first_mes)

    turn = len(hist)
    recent = hist[-RECENT_TURNS:]
    recent_start = turn - len(recent)  # 近期窗口起始轮号

    # 世界书:扫 当前输入 + 近期几条
    scan_text = user_msg + " " + " ".join(m["content"] for m in recent[-4:])
    world_hits = match_worldbook(world, scan_text)

    # 长期记忆:只召回近期窗口之前的(近期已在原文里,避免重复)
    mem = memory.search(session_id, user_msg, k=3, max_turn=recent_start - 1) if recent_start > 0 else []

    # 滚动摘要:历史够长时,把"近期窗口之前"的部分摘要
    summary = ""
    if turn >= SUMMARY_TRIGGER and recent_start > 0:
        summary = _update_summary(session_id, hist, recent_start)

    system = build_system_prompt(card, world_hits, mem, summary)
    messages = [{"role": "system", "content": system}] + recent + [{"role": "user", "content": user_msg}]
    out = chat_messages(messages, max_tokens=1024)

    # 落历史 + 落记忆
    hist.append({"role": "user", "content": user_msg})
    memory.add_turn(session_id, turn, "user", user_msg)
    hist.append({"role": "assistant", "content": out})
    memory.add_turn(session_id, turn + 1, "assistant", out)
    return out
