"""成本对比 —— DeepSeek 生成故事 vs Claude 当裁判,看模型与成本的差距。

读真实产物估算:
- 生成侧:playthrough 里每轮的 usage(本演示是手写但贴近真实 DeepSeek 量级的 token 数)。
- 裁判侧:judge_packets.json 的实际 prompt 字符数估 token + 每包约 600 输出 token。

价格用各家公开 list price(2026 年初量级,会变;只为看相对差距,不为精确账单)。
中文 token 估算用 chars*0.6(中文 tokenizer 经验值);标注为估算。
"""

import json
from pathlib import Path

DEMO = Path(__file__).parent

# 公开 list price(USD / 百万 token)。量级参考,非实时报价。
PRICES = {
    "deepseek-chat":   {"in": 0.27, "out": 1.10},   # DeepSeek V3 系,极低
    "claude-sonnet":   {"in": 3.00, "out": 15.00},  # 强裁判
    "claude-haiku":    {"in": 1.00, "out": 5.00},   # 便宜裁判 / 分层первый遍
}
CN_TOKENS_PER_CHAR = 0.6  # 中文 token 估算系数(估算,非精确)


def _cost(model, tin, tout):
    p = PRICES[model]
    return (tin * p["in"] + tout * p["out"]) / 1_000_000


def main():
    playthrough = json.load(open(DEMO / "authored_playthrough.json", encoding="utf-8"))
    packets = json.load(open(DEMO / "judge_packets.json", encoding="utf-8"))

    # 生成侧(DeepSeek)
    gen_in = sum(r["engine_output"]["usage"].get("prompt_tokens", 0) for r in playthrough)
    gen_out = sum(r["engine_output"]["usage"].get("completion_tokens", 0) for r in playthrough)
    gen_total = gen_in + gen_out
    gen_cost = _cost("deepseek-chat", gen_in, gen_out)

    # 裁判侧(Claude):input 从 packet prompt 字符估,output 估每包 600 token
    judge_in = int(sum(len(p["prompt"]) for p in packets) * CN_TOKENS_PER_CHAR)
    judge_out = 600 * len(packets)
    judge_cost_sonnet = _cost("claude-sonnet", judge_in, judge_out)
    judge_cost_haiku = _cost("claude-haiku", judge_in, judge_out)

    turns = len(playthrough)
    print("# 成本对比:DeepSeek 生成 vs Claude 裁判\n")
    print(f"对局:{turns} 轮 · 裁判包:{len(packets)} 个\n")
    print("## 生成侧 — DeepSeek")
    print(f"- token:输入 {gen_in:,} + 输出 {gen_out:,} = **{gen_total:,}**")
    print(f"- 成本:**${gen_cost:.5f}**  (≈ ${gen_cost/turns:.5f}/轮)\n")
    print("## 裁判侧 — Claude(估算)")
    print(f"- token:输入 ~{judge_in:,} + 输出 ~{judge_out:,}")
    print(f"- Sonnet 全判:**${judge_cost_sonnet:.5f}**  (≈ ${judge_cost_sonnet/turns:.5f}/轮)")
    print(f"- Haiku 全判:**${judge_cost_haiku:.5f}**  (≈ ${judge_cost_haiku/turns:.5f}/轮)\n")
    print("## 差距")
    print(f"- 用 Sonnet 当裁判,**评一轮的钱 ≈ 生成一轮的 {judge_cost_sonnet/gen_cost:.1f} 倍**")
    print(f"- 用 Haiku 当裁判,≈ 生成的 {judge_cost_haiku/gen_cost:.1f} 倍")
    print(f"- 启示:生成便宜、评判贵 → 评判要分层(Haiku 先粗筛,只对可疑轮上 Sonnet),")
    print(f"  并把成熟 judge 维度『毕业』成零成本的 structural 检查。")
    print("\n> 价格为各家公开 list price 量级(会变);中文 token 用 chars*0.6 估算。仅看相对差距。")

    md_lines = [
        "# 成本对比:DeepSeek 生成 vs Claude 裁判", "",
        f"对局 {turns} 轮 · 裁判包 {len(packets)} 个。价格为公开 list price 量级(会变),中文 token 按 chars*0.6 估。", "",
        "| 角色 | 模型 | 输入 token | 输出 token | 成本 | 每轮 |",
        "|---|---|---|---|---|---|",
        f"| 生成 | deepseek-chat | {gen_in:,} | {gen_out:,} | ${gen_cost:.5f} | ${gen_cost/turns:.5f} |",
        f"| 裁判 | claude-sonnet | ~{judge_in:,} | ~{judge_out:,} | ${judge_cost_sonnet:.5f} | ${judge_cost_sonnet/turns:.5f} |",
        f"| 裁判 | claude-haiku | ~{judge_in:,} | ~{judge_out:,} | ${judge_cost_haiku:.5f} | ${judge_cost_haiku/turns:.5f} |",
        "",
        f"**差距**:Sonnet 评一轮 ≈ 生成一轮的 **{judge_cost_sonnet/gen_cost:.1f}×**;Haiku ≈ **{judge_cost_haiku/gen_cost:.1f}×**。",
        "",
        "**启示**:生成便宜、评判贵。所以评判分层(Haiku 粗筛 → 只对可疑轮上 Sonnet),",
        "并把规律稳定的 judge 维度毕业成零成本 structural 检查;评测不必每轮全量上贵裁判。",
    ]
    (DEMO / "cost.md").write_text("\n".join(md_lines) + "\n", encoding="utf-8")


if __name__ == "__main__":
    main()
