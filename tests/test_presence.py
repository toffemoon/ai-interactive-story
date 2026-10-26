"""在场由引擎管(2026-10-27):大卡组开局名单、卡分在场/不在场、发言门、进场、知情者、近期原文保底、
精简重写的提示、JSON 拼回与截断补齐。全部离线:脚本 LLM + 内存存储,不碰网络和数据库。"""
import asyncio
import json
import os

os.environ.setdefault("LLM_API_KEY", "test-key")
os.environ.setdefault("LLM_BASE_URL", "https://example.invalid/v1")
os.environ.setdefault("LLM_MODEL", "test-model")

import pytest  # noqa: E402

from src import llm, memory  # noqa: E402
from src import story as S  # noqa: E402
from src.models import CharacterCard, CharacterData, PlayerCard, RuntimeState, StoryBook, StoryEvent  # noqa: E402
from eval.harness import in_memory_storage  # noqa: E402


def _card(name, secret=""):
    return CharacterCard(data=CharacterData(
        name=name, description=f"{name} keeps the lighthouse ledger. Second sentence stays out of the one-liner.",
        personality="dry", scenario="the harbour town", mes_example="",
        speech_rules=[f"SECRET: {secret}"] if secret else []))


def _deck(n=5):
    names = ["Ada Vale", "Bram Cole", "Cora Lind", "Dunn Smith", "Eli Rook", "Fay Moss"][:n]
    return [_card(nm, secret=f"{nm} hid the key") for nm in names]


PLAYER = PlayerCard(name="Pell Ward")


def _story(first_chars):
    return StoryBook(title="Harbour", premise="A harbour town at night.",
                     events=[StoryEvent(event_id="wake", title="Waking", summary="Pell wakes alone.",
                                        location="Pell's attic room", characters=first_chars)])


# ── 开局 ────────────────────────────────────────────────

def test_small_deck_keeps_old_opening():
    chars = _deck(3)
    st = S._init_state(chars, PLAYER, _story(["Pell Ward"]))
    assert st.scene.cast_tracked is False
    assert st.scene.present_characters == [c.data.name for c in chars]


def test_big_deck_opens_with_first_event_cast_only():
    chars = _deck(5)
    st = S._init_state(chars, PLAYER, _story(["Pell Ward", "Bram"]))
    assert st.scene.cast_tracked is True
    assert st.scene.present_characters == ["Bram Cole"]  # 事件里的简称也认;玩家不算
    assert st.scene.location == "Pell's attic room"


def test_big_deck_without_opening_cast_falls_back_to_everyone():
    chars = _deck(5)
    st = S._init_state(chars, PLAYER, None)  # 自建卡组没有故事书:开局照旧全员,由开场回合收窄
    assert st.scene.cast_tracked is True
    assert st.scene.present_characters == [c.data.name for c in chars]


def test_default_opening_cast_does_not_become_knowers(monkeypatch):
    chars = _deck(5)
    out_json = _turn_json([{"name": "Ada Vale", "text": "You're up."}], ["Ada Vale"],
                          [{"kind": "fact", "text": "Ada saw Pell wake.", "entity": "player"}])
    monkeypatch.setattr(memory, "ensure_loading", lambda: None)
    with in_memory_storage() as store, llm.scripted_backend(lambda *a, **k: out_json):
        asyncio.run(S.story_turn(session_id="t-open", characters=chars, user="", player=PLAYER, mode="standard"))
        data = store.load_session("t-open")
    fact = [m for m in data["long_memory"] if m.get("text") == "Ada saw Pell wake."][0]
    assert set(fact["knowers"]) == {S._PLAYER_ENTITY, S._char_id(chars[0], 0)}  # 不是全部五张卡


# ── 提示:在场整张卡,不在场一行 ─────────────────────────

def _tracked_state(present):
    st = RuntimeState()
    st.scene.cast_tracked = True
    st.scene.present_characters = present
    return st


def test_prompt_splits_on_and_offstage():
    chars = _deck(5)
    p = S._prompt_en(chars, PLAYER, None, [], [], [], [], _tracked_state(["Bram Cole"]), {})
    assert "## Bram Cole (" in p
    assert "# Offstage characters" in p
    assert "- Ada Vale (" in p and "## Ada Vale" not in p
    assert "Ada Vale hid the key" not in p          # 不在场的人的秘密不进提示
    assert "Second sentence" not in p.split("# Offstage characters")[1].split("\n\n")[0]
    assert "Bram Cole hid the key" in p              # 在场的人照常带整张卡


def test_prompt_with_nobody_present_allows_empty_messages():
    p = S._prompt_en(_deck(5), PLAYER, None, [], [], [], [], _tracked_state([]), {})
    assert "messages may be an empty list" in p
    assert "nobody besides the player" in p


def test_small_deck_prompt_has_no_offstage_section():
    st = RuntimeState()
    st.scene.present_characters = ["Ada Vale"]
    p = S._prompt_en(_deck(3), PLAYER, None, [], [], [], [], st, {})
    assert "# Offstage characters" not in p and "## Bram Cole (" in p


# ── 发言门 ───────────────────────────────────────────────

def test_speaker_gate_drops_absent_card_characters():
    chars = _deck(5)
    dropped = []
    items = [{"name": "Bram Cole", "text": "Evening."}, {"name": "Dunn", "text": "Nighthawk business."},
             {"name": "Cora Lind", "text": "I just walked in."}]
    out = S._normalize_messages(items, chars, allowed=["Bram Cole", "Cora Lind"], dropped=dropped)
    assert [m.name for m in out] == ["Bram Cole", "Cora Lind"]
    assert dropped == ["Dunn Smith"]


def test_speaker_gate_off_for_small_decks():
    out = S._normalize_messages([{"name": "Bram Cole", "text": "Hi."}], _deck(3))
    assert [m.name for m in out] == ["Bram Cole"]


# ── 名单规整、正文里的进场 ───────────────────────────────

def test_cast_list_is_normalised_to_card_names():
    chars = _deck(5)
    assert S._canon_cast(["ada-vale", "Dunn", "Sergeant Holt", "Ada Vale"], chars) == ["Ada Vale", "Dunn Smith", "Sergeant Holt"]
    assert S._canon_cast(["the man at the door (unnamed, not a card character)", "Mrs. Holt (baker)"], chars) == \
        ["the man at the door", "Mrs. Holt (baker)"]


def test_direct_speech_in_narration_counts_as_arrival():
    chars = _deck(5)
    narr = "The door opens. 'Nobody leaves Tingen,' Dunn said, turning the book over."
    assert S._narrated_arrivals(narr, [], chars, ["Bram Cole"]) == ["Dunn Smith"]


def test_reported_speech_is_not_an_arrival():
    chars = _deck(5)
    narr = "Bram shrugs. As Eli always said, a ledger never lies. Dunn said he would come by tomorrow."
    assert S._narrated_arrivals(narr, [], chars, ["Bram Cole"]) == []


def test_line_plus_mention_counts_as_arrival():
    chars = _deck(5)
    narr = "Cora Lind pushes the door open with her hip, a basket on her arm."
    assert S._narrated_arrivals(narr, [{"name": "Cora Lind", "text": "Morning."}], chars, []) == ["Cora Lind"]


def test_cast_declared_in_reasoning_brings_a_character_on(monkeypatch):
    chars = _deck(5)
    out_json = json.dumps({
        "reasoning": {"cast": ["Bram Cole", "Dunn"], "note": "Dunn knocks"},
        "narration": "A knock. Dunn Smith stands at the door, rain on his coat.",
        "messages": [{"name": "Dunn Smith", "text": "May I come in?"}],
        "choices": [{"id": "a", "label": "Let him in", "intent": "act"}],
        "state_update": {"time_advance": 5, "scene": {"location": "Pell's attic room"}},
        "memory_write": [{"kind": "fact", "text": "Dunn came to the attic.", "entity": "player"}],
        "triggered_events": [],
    })
    monkeypatch.setattr(memory, "ensure_loading", lambda: None)
    story = _story(["Pell Ward", "Bram Cole"])
    with in_memory_storage() as store, llm.scripted_backend(lambda *a, **k: out_json):
        out = asyncio.run(S.story_turn(session_id="t-cast", characters=chars, user="Open the door",
                                       story=story, player=PLAYER, mode="standard"))
        data = store.load_session("t-cast")
    assert [m.name for m in out.messages] == ["Dunn Smith"]
    assert out.state.scene.present_characters == ["Bram Cole", "Dunn Smith"]
    fact = [m for m in data["long_memory"] if m.get("text") == "Dunn came to the attic."][0]
    assert S._char_id(chars[3], 3) in fact["knowers"]


def test_moving_away_leaves_people_behind(monkeypatch):
    """玩家换地点:回合开始在场、没跟来的人不再在场,也不是新地点那些事的知情者;
    reasoning.cast 里顺手列了她也不把她加回来。"""
    chars = _deck(5)
    out_json = json.dumps({
        "reasoning": {"cast": ["Bram Cole", "Cora Lind"], "note": "walk to the harbour office"},
        "narration": "Pell leaves Bram at the attic and walks to the harbour office, where Cora Lind looks up.",
        "messages": [{"name": "Cora Lind", "text": "Yes?"}],
        "choices": [{"id": "a", "label": "Ask for work", "intent": "ask"}],
        "state_update": {"time_advance": 30, "scene": {"location": "Harbour office", "present_characters": ["Cora Lind"]}},
        "memory_write": [{"kind": "fact", "text": "Pell asked Cora for work at the harbour office.", "entity": "player"}],
        "triggered_events": [],
    })
    monkeypatch.setattr(memory, "ensure_loading", lambda: None)
    story = _story(["Pell Ward", "Bram Cole"])
    with in_memory_storage() as store, llm.scripted_backend(lambda *a, **k: out_json):
        out = asyncio.run(S.story_turn(session_id="t-move", characters=chars, user="Walk to the harbour office",
                                       story=story, player=PLAYER, mode="standard"))
        data = store.load_session("t-move")
    assert out.state.scene.present_characters == ["Cora Lind"]
    fact = [m for m in data["long_memory"] if m.get("text", "").startswith("Pell asked Cora")][0]
    assert set(fact["knowers"]) == {S._PLAYER_ENTITY, S._char_id(chars[2], 2)}  # 留在阁楼的 Bram 不知道


# ── 实体键覆盖全部卡 ─────────────────────────────────────

def test_roster_covers_every_card_and_short_names():
    chars = _deck(6)
    roster, _ = S._entity_roster(chars, PLAYER)
    assert {S._roster_key(c.data.name, roster) for c in chars} == {S._char_id(c, i) for i, c in enumerate(chars)}
    assert S._roster_key("Dunn", roster) == S._char_id(chars[3], 3)
    assert S._roster_key("Pell Ward", roster) == S._PLAYER_ENTITY


# ── 近期原文保底 ─────────────────────────────────────────

def test_recap_keeps_last_two_turns_in_full():
    long_story = "x" * 2000 + "\nAda Vale: I came in through the partition door."
    msgs = [{"role": "user", "content": "a"}, {"role": "assistant", "content": "y" * 2000},
            {"role": "user", "content": "b"}, {"role": "assistant", "content": long_story}]
    recap, start = S._recent_recap(msgs, 1400)
    assert "I came in through the partition door." in recap
    assert start == 0


# ── 精简重写 ─────────────────────────────────────────────

def test_retry_prompt_uses_real_presence_and_recent_story():
    chars = _deck(5)
    msgs = S._compact_retry_messages_en("Ask Bram", chars, _tracked_state(["Bram Cole"]), [], [],
                                        recap="Story: Bram lit the lamp.", clock="Now: Day 1 00:47",
                                        player_name="Pell Ward")
    user = msgs[1]["content"]
    assert "Characters present: Bram Cole\n" in user
    assert "Not present (cannot speak this turn): Ada Vale, Cora Lind, Dunn Smith, Eli Rook" in user
    assert "Bram lit the lamp." in user and "Now: Day 1 00:47" in user


# ── JSON ─────────────────────────────────────────────────

def test_json_rejoins_a_root_closed_too_early():
    raw = ('{"narration":"n","messages":[],"choices":[{"label":"a"}]},'
           '"state_update":{"scene":{"present_characters":["Bram Cole"]}},"triggered_events":[]}')
    obj = S._json_obj(raw)
    assert obj["state_update"]["scene"]["present_characters"] == ["Bram Cole"]


def test_json_salvages_output_cut_after_the_choices():
    raw = ('{"narration":"n","messages":[{"name":"Bram Cole","text":"t"}],"choices":[{"label":"a"},{"label":"b"}],'
           '"state_update":{"time_advance":5,"scene":{"location":"Har')
    obj = S._json_obj(raw)
    assert obj["narration"] == "n" and len(obj["choices"]) == 2


def test_json_does_not_salvage_a_cut_narration():
    with pytest.raises(json.JSONDecodeError):
        S._json_obj('{"reasoning":{"note":"x"},"narration":"The lamp gutt')


# ── 状态更新:换地点 + 空名单 ─────────────────────────────

def test_empty_present_list_only_clears_when_moving():
    st = _tracked_state(["Bram Cole"])
    st.scene.location = "Attic"
    S._apply_state_update(st, {"scene": {"location": "Attic", "present_characters": []}})
    assert st.scene.present_characters == ["Bram Cole"]
    S._apply_state_update(st, {"scene": {"location": "Street", "present_characters": []}})
    assert st.scene.present_characters == []


# ── 整回合:进场、发言门、知情者 ──────────────────────────

def _turn_json(messages, present, memory_write):
    return json.dumps({
        "reasoning": {"note": "t"}, "narration": "Something happens.", "messages": messages,
        "choices": [{"id": "a", "label": "Wait", "intent": "observe"}],
        "state_update": {"time_advance": 5, "scene": {"location": "Pell's attic room", "present_characters": present}},
        "memory_write": memory_write, "triggered_events": [],
    })


def test_full_turn_entrance_gate_and_knowers(monkeypatch):
    chars = _deck(5)
    story = _story(["Pell Ward"])
    outputs = iter([
        # 回合 1:没人在场;Cora 被写进名单(进场)可以开口,Dunn 没进场却开口 → 拦下
        _turn_json([{"name": "Cora Lind", "text": "Knock knock."}, {"name": "Dunn Smith", "text": "I know things."}],
                   ["Cora Lind"], [{"kind": "fact", "text": "Cora found Pell awake.", "entity": "player"}]),
    ])

    def responder(kind, messages, *, model, max_tokens, json_mode):
        return next(outputs)

    monkeypatch.setattr(memory, "ensure_loading", lambda: None)
    with in_memory_storage() as store, llm.scripted_backend(responder):
        out = asyncio.run(S.story_turn(session_id="t-presence", characters=chars, user="Listen at the door",
                                       story=story, player=PLAYER, mode="standard"))
        data = store.load_session("t-presence")
    assert [m.name for m in out.messages] == ["Cora Lind"]
    assert data["gate_log"][-1]["dropped"] == ["Dunn Smith"]
    assert out.state.scene.present_characters == ["Cora Lind"]
    fact = [m for m in data["long_memory"] if m.get("text") == "Cora found Pell awake."][0]
    assert set(fact["knowers"]) == {S._PLAYER_ENTITY, S._char_id(chars[2], 2)}  # 进场的 Cora 知道,Dunn 不知道
