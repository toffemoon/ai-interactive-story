"""第 5c 组验证:统一上传分类由 _smoke_group5c.py 单测(4 类 + 改判 + 短文)。
这里只做轻量回归 2 局(崩铁全套 + 单角色,流式),确认 5c 的新端点没碰生成路径、引擎端到端正常。
(5c 不改 story.py 生成逻辑,故不重跑完整 8 局。)写 _validate_report5c.json。
"""
import json, sys
sys.stdout.reconfigure(encoding="utf-8")
import _validate_group1 as V

V.STREAM_MODE = True
V.SESSION_PREFIX = "g5cs_"


def main():
    lib = V.load_library()
    games = []
    hsr = [V.pick_char(lib, n) for n in ("托帕", "大黑塔", "艾丝妲")]
    hsr_world = V.merge_worlds([V._find_world(lib, "ipc"), V._find_world(lib, "黑塔"), V._find_world(lib, "崩铁世界书")])
    base = {"characters": hsr, "world": hsr_world, "story": V._find_story(lib, "账单"),
            "player": V._find_player(lib, "开拓"), "mode": "standard"}
    games.append(V.run_game("崩铁全套", "g5c_hsr", base, [
        "我先打量四周看看这账单怎么回事", "托帕,条款能详细说说吗", "我不接受现在的还款方式",
        "艾丝妲,空间站数据你怎么看", "大黑塔对这事什么态度", "如果我拒绝偿还会怎样",
        "我提议用研究成果抵债", "托帕你觉得这提议靠谱吗", "我们去核心区看看",
        "我要求看IPC原始合同", "大黑塔愿意担保吗", "我冷静一下重新梳理",
        "把所有人召集起来摊牌", "我接受分期但加一条附加条款", "确认细节我们签字", "签完单独和托帕谈合作",
    ]))
    base2 = {"characters": [V.pick_char(lib, "托帕")], "world": None, "story": None, "player": None, "mode": "standard"}
    games.append(V.run_game("单角色托帕", "g5c_solo", base2, [
        "托帕我们现在在哪", "我靠近窗边看星空", "说说你最近的生意", "我倒两杯酒递你一杯",
        "你为什么留在IPC", "我注意到你有心事", "如果IPC让你做违心事呢", "聊点别的你怎么放松",
        "我想碰碰你的徽章", "外面好像有动静", "我们出去看看", "情况不对你躲我身后",
        "我顶住门你查出口", "暂时安全了", "刚才谢谢你护着我", "天快亮了该走了",
    ]))

    report = {"games": games, "note": "5c 轻量回归(2局),分类路由由 smoke 单测"}
    with open("_validate_report5c.json", "w", encoding="utf-8") as f:
        json.dump(report, f, ensure_ascii=False, indent=2)
    print("\n========== 5c 回归汇总 ==========")
    allissues = []
    for g in games:
        allissues += [f"[{g['name']}] {x}" for x in g.get("issues", [])]
        print(f"{g['name']:<14} 轮={g.get('turns')} 保底={g.get('fallback_count')} 结构化={g.get('structured_ok')} "
              f"时钟终={g.get('clock_final')} 单调={g.get('clock_monotonic')} 缺自检={g.get('reasoning_missing')} "
              f"流式={g.get('streamed_turns')}/{g.get('total_turns_with_delta')}")
    print(f"\n总问题数: {len(allissues)}")
    for x in allissues:
        print("  !", x)


if __name__ == "__main__":
    main()
