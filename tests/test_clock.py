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


def test_model_skip_needs_time_skip():
    assert S._clamp_time_advance(420, "Keep to the eight-forty car") == S.NATURAL_MAX_ADVANCE
    assert S._clamp_time_advance(420, "Keep to the eight-forty car", "waited until morning") == 420
    assert S._clamp_time_advance(5000, "Keep to the eight-forty car", "waited") == S.SKIP_MAX_ADVANCE
    assert S._clamp_time_advance(420, "Keep to the eight-forty car", "") == S.NATURAL_MAX_ADVANCE
