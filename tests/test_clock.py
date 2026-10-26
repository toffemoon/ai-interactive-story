"""世界时钟推进(2026-10-27 诡秘长测):回指的"that night"不算跳时间;模型写明 time_skip 才能一回合跳过半夜。"""
import os

os.environ.setdefault("LLM_API_KEY", "test-key")
os.environ.setdefault("LLM_BASE_URL", "https://example.invalid/v1")
os.environ.setdefault("LLM_MODEL", "test-model")

from src import story as S  # noqa: E402


def test_back_reference_to_that_night_is_not_a_jump():
    assert S._explicit_jump_floor("Ask Melissa what she and Benson heard and saw that night") == 0


def test_forward_night_words_still_jump():
    assert S._explicit_jump_floor("We sleep until morning") >= 480


def test_day_part_line_names_the_time_in_words():
    line = S._day_part_line(2 * 60 + 21)
    assert "2:21 a.m." in line and "deep night" in line
    assert "first grey" in S._day_part_line(4 * 60 + 40)
    assert "1:05 p.m." in S._day_part_line(1440 + 13 * 60 + 5)  # 第二天 13:05


def test_sleeping_until_a_named_hour_lands_on_that_hour():
    assert S._target_clock_advance("Sleep until Melissa's knock at six", 3 * 60 + 40) == 140
    assert S._target_clock_advance("Do as she says and sleep until six", 1 * 60 + 13) == 4 * 60 + 47
    assert S._target_clock_advance("Agree, and go to bed until the six o'clock", 1 * 60 + 53) == 4 * 60 + 7
    assert S._target_clock_advance("Lie down until half past five", 3 * 60) == 150
    assert S._target_clock_advance("Wait till 7 a.m.", 23 * 60) == 8 * 60
    assert S._target_clock_advance("我先睡到六点", 2 * 60) == 4 * 60
    assert S._target_clock_advance("Ask her about the clock", 60) is None
    assert S._target_clock_advance("Wait, did it happen at two?", 3 * 60) is None
    assert S._target_clock_advance("Stay at 36 Zouteland Street", 600) is None


def test_model_skip_needs_time_skip():
    assert S._clamp_time_advance(420, "Keep to the eight-forty car") == S.NATURAL_MAX_ADVANCE
    assert S._clamp_time_advance(420, "Keep to the eight-forty car", "waited until morning") == 420
    assert S._clamp_time_advance(5000, "Keep to the eight-forty car", "waited") == S.SKIP_MAX_ADVANCE
    assert S._clamp_time_advance(420, "Keep to the eight-forty car", "") == S.NATURAL_MAX_ADVANCE
