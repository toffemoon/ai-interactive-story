"""第 1 组验证脚手架:扮演玩家跑 6 局,读 DeepSeek usage,专测重 roll 回滚。

跑法:.venv/Scripts/python.exe _validate_group1.py
打真实 8000 端口(新代码),结果写 _validate_report.json + 控制台摘要。
"""
import json
import sys
import time
import urllib.request
import urllib.error

BASE = "http://127.0.0.1:8000"
sys.stdout.reconfigure(encoding="utf-8")

# 第 2 组复用本脚手架:STREAM_MODE=True 时每轮走 /api/story_turn_stream(读 SSE),否则走非流式。
# SESSION_PREFIX 给会话 id 加前缀,让第 2 组用全新会话(不接着第 1 组的旧档)。
STREAM_MODE = False
REPORT_PATH = "_validate_report.json"
SESSION_PREFIX = ""


def _req(method, path, body=None, timeout=180):
    data = json.dumps(body).encode("utf-8") if body is not None else None
    req = urllib.request.Request(BASE + path, data=data, method=method,
                                 headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return json.loads(r.read().decode("utf-8"))


def post(path, body, timeout=180):
    return _req("POST", path, body, timeout)


def get(path):
    return _req("GET", path)


def stream_story_turn(body, timeout=180):
    """读 /api/story_turn_stream 的 SSE,返回 (final_turn, delta块数)。final_turn 来自 done/error 事件。"""
    data = json.dumps(body).encode("utf-8")
    req = urllib.request.Request(BASE + "/api/story_turn_stream", data=data, method="POST",
                                 headers={"Content-Type": "application/json"})
    deltas = 0
    final = None
    buf = ""
    with urllib.request.urlopen(req, timeout=timeout) as r:
        for chunk in r:
            buf += chunk.decode("utf-8", "ignore")
            while "\n\n" in buf:
                line, buf = buf.split("\n\n", 1)
                line = line.strip()
                if not line.startswith("data:"):
                    continue
                try:
                    evt = json.loads(line[5:].strip())
                except Exception:
                    continue
                if evt.get("type") == "delta":
                    deltas += 1
                elif evt.get("type") in ("done", "error"):
                    final = evt.get("turn")
    return final, deltas


def call_turn(session_id, base_req, user="", choice=""):
    """按 STREAM_MODE 选择流式/非流式执行一轮,统一返回 turn dict(流式会带 _deltas)。"""
    body = {**base_req, "session_id": session_id, "user": user, "selected_choice": choice}
    if STREAM_MODE:
        final, deltas = stream_story_turn(body)
        if final is None:
            raise RuntimeError("流式未返回 done/error 事件")
        final["_deltas"] = deltas
        return final
    return post("/api/story_turn", body)


def load_library():
    lib = {}
    for kind in ("characters", "worlds", "stories", "players"):
        lib[kind] = get(f"/api/library/{kind}")
    return lib


def pick_char(lib, name):
    for it in lib["characters"]:
        d = it["data"]
        if d.get("data", {}).get("name") == name:
            return d
    raise KeyError(f"角色 {name} 不在库里")


def pick_world(lib, name):
    for it in lib["worlds"]:
        if it["data"].get("name") == name:
            return it["data"]
    return None


def pick_story(lib, title):
    for it in lib["stories"]:
        if it["data"].get("title") == title:
            return it["data"]
    return None


def pick_player(lib, name):
    for it in lib["players"]:
        if it["data"].get("name") == name:
            return it["data"]
    return None


def merge_worlds(worlds):
    worlds = [w for w in worlds if w]
    if not worlds:
        return None
    entries = []
    for wi, w in enumerate(worlds):
        for ei, e in enumerate(w.get("entries", [])):
            e = dict(e)
            e.setdefault("entry_id", f"w{wi}-{ei}")
            entries.append(e)
    return {"name": "世界书合集", "entries": entries}


FALLBACK_PHRASES = ("故事引擎遇到了未预料的问题", "本地自然保底", "保底回合", "没有从后端拿到完整回应")


def is_fallback(turn):
    flags = (((turn.get("state") or {}).get("player") or {}).get("flags") or [])
    if "local_continuation" in flags or "json_repair_fallback" in flags:
        return True
    narr = turn.get("narration", "") or ""
    if any(p in narr for p in FALLBACK_PHRASES):
        return True
    for m in turn.get("memory_write", []) or []:
        if isinstance(m, dict) and "保底" in (m.get("text", "") or ""):
            return True
    return False


def turn_metrics(turn):
    u = turn.get("usage") or {}
    st = turn.get("state") or {}
    rz = turn.get("reasoning") or {}
    return {
        "hv": rz.get("hard_violation"),
        "has_counter": bool((rz.get("world_counter") or "").strip()),
        "reasoning_present": bool(rz),
        "pt": u.get("prompt_tokens", 0),
        "ct": u.get("completion_tokens", 0),
        "tt": u.get("total_tokens", 0),
        "calls": u.get("calls", 0),
        "narr_len": len(turn.get("narration", "") or ""),
        "msgs": len(turn.get("messages", []) or []),
        "choices": len(turn.get("choices", []) or []),
        "fallback": is_fallback(turn),
        "loc": (st.get("scene") or {}).get("location", ""),
        "turn_count": (st.get("turn_count")),
        "max_rel": max([max(abs(r.get("trust", 0)), abs(r.get("tension", 0)), abs(r.get("affection", 0)))
                        for r in (st.get("relationships") or [])] or [0]),
        "deltas": turn.get("_deltas"),
        "clock": st.get("clock_minutes"),
        "triggered": list(turn.get("triggered_events", []) or []),
    }


def run_game(name, session_id, base_req, inputs, reroll_at=None):
    """跑一局。reroll_at: 在第几个玩家输入后插入一次 reroll 测试(1-based)。返回 game 报告。"""
    session_id = SESSION_PREFIX + session_id
    print(f"\n=== {name} (session {session_id[:14]}) ===")
    rows = []
    issues = []

    # 开场
    t0 = time.time()
    opening = call_turn(session_id, base_req, user="", choice="")
    m = turn_metrics(opening)
    m["label"] = "opening"
    m["dt"] = round(time.time() - t0, 1)
    rows.append(m)
    print(f"  opening  tok={m['tt']:>5} (in{m['pt']}/out{m['ct']},{m['calls']}次) narr={m['narr_len']} msgs={m['msgs']} "
          f"loc={m['loc'][:14]} fb={m['fallback']} {m['dt']}s")

    prev_narr = opening.get("narration", "")
    reroll_report = None

    for i, text in enumerate(inputs, 1):
        t0 = time.time()
        try:
            turn = call_turn(session_id, base_req, user=text, choice="")
        except Exception as e:
            issues.append(f"第{i}轮 HTTP 异常: {e}")
            print(f"  t{i:>2} ERROR {e}")
            continue
        m = turn_metrics(turn)
        m["label"] = f"t{i}"
        m["dt"] = round(time.time() - t0, 1)
        m["input"] = text[:30]
        rows.append(m)
        narr = turn.get("narration", "")
        if m["fallback"]:
            issues.append(f"第{i}轮 保底回合 (输入: {text[:30]})")
        if narr and narr == prev_narr:
            issues.append(f"第{i}轮 narration 与上一轮完全相同")
        if m["tt"] <= 0:
            issues.append(f"第{i}轮 token 用量为 0 (usage 未生效)")
        if m["narr_len"] == 0 and m["msgs"] == 0:
            issues.append(f"第{i}轮 空回合 (无 narration 无 messages)")
        # 流式:非保底回合应有 delta 块流出(>3);保底/retry 回合可能无流式,不算硬伤但记录。
        if STREAM_MODE and not m["fallback"] and (m["deltas"] or 0) <= 3:
            issues.append(f"第{i}轮 流式 delta 过少({m['deltas']}),可能没真流式")
        # reasoning:非保底回合应带一致性自检字段。
        if not m["fallback"] and not m["reasoning_present"]:
            issues.append(f"第{i}轮 缺 reasoning 自检字段")
        prev_narr = narr
        print(f"  t{i:>2} tok={m['tt']:>5} (in{m['pt']}/out{m['ct']},{m['calls']}次) narr={m['narr_len']} msgs={m['msgs']} "
              f"loc={m['loc'][:14]} rel={m['max_rel']} tc={m['turn_count']} fb={m['fallback']} {m['dt']}s")

        # 重 roll 测试
        if reroll_at == i:
            reroll_report = test_reroll(session_id, turn, text)

    sess = get(f"/api/session/{session_id}")
    final_tc = (sess.get("state") or {}).get("turn_count")
    locs = {r["loc"] for r in rows if r["loc"]}
    max_rel = max([r["max_rel"] for r in rows] or [0])
    fallbacks = sum(1 for r in rows if r["fallback"])
    tt_series = [r["tt"] for r in rows if r["tt"] > 0]
    delta_series = [r["deltas"] for r in rows if r.get("deltas") is not None]
    streamed_turns = sum(1 for d in delta_series if d > 3)
    hv_turns = sum(1 for r in rows if r.get("hv") is True)
    counter_turns = sum(1 for r in rows if r.get("has_counter"))
    reasoning_missing = sum(1 for r in rows if not r["fallback"] and not r.get("reasoning_present"))

    # 续玩完整版:结构化 turns 应与 turn_count 对齐(每轮存一条),最后一条应带 choices(还原选项)。
    stored = sess.get("turns", [])
    stored_n = len(stored)
    if final_tc is not None and stored_n != final_tc:
        issues.append(f"结构化 turns 数({stored_n})≠ turn_count({final_tc}),续玩还原会缺/多回合")
    if stored_n and not (stored[-1].get("choices")):
        issues.append("最后一轮结构化记录缺 choices,续玩无法还原选项")
    structured_ok = stored_n == final_tc and bool(stored and stored[-1].get("choices"))

    # 世界时钟:每轮 clock 应单调不减(每轮至少 +最小增量);记录是否有倒退、终值、触发过的故事事件。
    clocks = [r.get("clock") for r in rows if r.get("clock") is not None]
    clock_back = any(clocks[i] > clocks[i + 1] for i in range(len(clocks) - 1))
    if clock_back:
        issues.append("故事内时钟出现倒退(应单调不减)")
    triggered_all = set()
    for r in rows:
        triggered_all.update(r.get("triggered", []))

    return {
        "hv_turns": hv_turns, "counter_turns": counter_turns, "reasoning_missing": reasoning_missing,
        "stored_turns": stored_n, "structured_ok": structured_ok,
        "clock_final": clocks[-1] if clocks else None, "clock_monotonic": not clock_back,
        "triggered_events_all": sorted(triggered_all),
        "name": name, "session_id": session_id, "rows": rows, "issues": issues,
        "turns": len(rows), "final_turn_count": final_tc,
        "usage_total": sess.get("usage_total", 0), "usage_log_len": len(sess.get("usage_log", [])),
        "distinct_locations": len(locs), "max_relationship_abs": max_rel,
        "fallback_count": fallbacks,
        "tt_first": tt_series[0] if tt_series else 0, "tt_last": tt_series[-1] if tt_series else 0,
        "tt_max": max(tt_series) if tt_series else 0,
        "stream_mode": STREAM_MODE,
        "streamed_turns": streamed_turns, "total_turns_with_delta": len(delta_series),
        "delta_min": min(delta_series) if delta_series else None,
        "delta_avg": round(sum(delta_series) / len(delta_series), 1) if delta_series else None,
        "reroll": reroll_report,
    }


def test_reroll(session_id, turn_before, last_input):
    """验证重 roll:回滚后 messages 长度与 turn_count 不变(替换而非追加),输出有效且有 usage。

    session_id 需为已加前缀的完整 id(run_game 传进来的已加过,main 直接调用时自行加)。"""
    print("  -- reroll 测试 --")
    rep = {"ok": True, "checks": []}
    sess_before = get(f"/api/session/{session_id}")
    msglen_before = len(sess_before.get("messages", []))
    tc_before = (sess_before.get("state") or {}).get("turn_count")
    last_assistant_before = next((m["content"] for m in reversed(sess_before.get("messages", []))
                                  if m.get("role") == "assistant"), "")
    usage_total_before = sess_before.get("usage_total", 0)

    try:
        rr = post("/api/reroll", {"session_id": session_id})
    except Exception as e:
        rep["ok"] = False
        rep["checks"].append(f"reroll 请求失败: {e}")
        print(f"     FAIL reroll 请求失败: {e}")
        return rep

    sess_after = get(f"/api/session/{session_id}")
    msglen_after = len(sess_after.get("messages", []))
    tc_after = (sess_after.get("state") or {}).get("turn_count")
    last_assistant_after = next((m["content"] for m in reversed(sess_after.get("messages", []))
                                 if m.get("role") == "assistant"), "")

    def chk(cond, ok_msg, fail_msg):
        rep["checks"].append(("OK " if cond else "FAIL ") + (ok_msg if cond else fail_msg))
        if not cond:
            rep["ok"] = False
        print(f"     {'OK ' if cond else 'FAIL'} {ok_msg if cond else fail_msg}")

    chk(msglen_after == msglen_before,
        f"messages 长度不变 ({msglen_after}) — 替换而非追加",
        f"messages 长度变了 {msglen_before}->{msglen_after} (重 roll 没回滚!)")
    chk(tc_after == tc_before,
        f"turn_count 不变 ({tc_after})",
        f"turn_count 变了 {tc_before}->{tc_after}")
    chk(bool(rr.get("narration") or rr.get("messages")),
        "重 roll 输出有正文",
        "重 roll 输出空")
    chk(bool((rr.get("usage") or {}).get("total_tokens")),
        f"重 roll 输出带 usage (tok={ (rr.get('usage') or {}).get('total_tokens') })",
        "重 roll 输出缺 usage")
    last_input_match = next((m["content"] for m in reversed(sess_after.get("messages", []))
                             if m.get("role") == "user"), "")
    chk(last_input_match == last_input,
        "重 roll 复用了相同玩家输入",
        f"重 roll 输入变了: 期望 {last_input[:20]} 得到 {last_input_match[:20]}")
    rep["changed"] = (last_assistant_after != last_assistant_before)
    rep["usage_total_before"] = usage_total_before
    rep["usage_total_after"] = sess_after.get("usage_total", 0)
    print(f"     内容是否变化: {rep['changed']}  usage_total {usage_total_before}->{sess_after.get('usage_total',0)}")
    return rep


def main():
    lib = load_library()
    games = []

    # 1. 崩铁全套(3 角色 + IPC+黑塔空间站+崩铁世界书 + 账单故事书 + 开拓者),≥16 轮,带 reroll
    hsr_chars = [pick_char(lib, n) for n in ("托帕", "大黑塔", "艾丝妲")]
    hsr_world = merge_worlds([_find_world(lib, "ipc"),
                              _find_world(lib, "黑塔"),
                              _find_world(lib, "崩铁世界书")])
    hsr_story = _find_story(lib, "账单")
    hsr_player = _find_player(lib, "开拓")
    print("HSR fixtures:", [c["data"]["name"] for c in hsr_chars],
          "world_entries=", len((hsr_world or {}).get("entries", [])),
          "story=", (hsr_story or {}).get("title"), "player=", (hsr_player or {}).get("name"))
    base = {"characters": hsr_chars, "world": hsr_world, "story": hsr_story, "player": hsr_player, "mode": "standard"}
    hsr_inputs = [
        "我先打量一下四周,看看这账单到底是怎么回事",
        "托帕,这笔债务的条款能不能详细解释一下?",
        "我不接受现在的还款方式,有没有别的方案",
        "艾丝妲,空间站这边的运营数据你怎么看",
        "我想知道大黑塔对这件事的真实态度",
        "如果我拒绝偿还,会有什么后果",
        "我提议用空间站的一部分研究成果来抵债",
        "托帕,你个人觉得这个提议靠谱吗",
        "我们去黑塔空间站的核心区看看实际情况",
        "我要求查看IPC的原始合同副本",
        "大黑塔,你愿意为这份债务做担保吗",
        "我先冷静一下,重新梳理已知的事实",
        "把所有人召集起来,我要当面摊牌",
        "我决定接受托帕的分期方案,但要加一条附加条款",
        "确认细节,我们签字",
        "签完之后,我想单独和托帕谈谈接下来的合作",
    ]
    games.append(run_game("崩铁全套", "valhsr01full", base, hsr_inputs, reroll_at=8))

    # 2. 原创武侠(阿砚+陈捕头+老周 + 米商之死 + 新捕快),≥16 轮
    wx_chars = [pick_char(lib, n) for n in ("阿砚", "陈捕头", "老周")]
    wx_story = _find_story(lib, "米商")
    wx_player = _find_player(lib, "新捕快")
    wx_world = _find_world_slug(lib, "世界书")  # 精确取武侠世界书(slug 恰为「世界书」,避开崩铁世界书)
    base = {"characters": wx_chars, "world": wx_world, "story": wx_story, "player": wx_player, "mode": "standard"}
    wx_inputs = [
        "我先到案发现场看看死者的尸体",
        "陈捕头,死者最后一次出现是什么时候",
        "老周,你昨晚在米铺附近做什么",
        "我检查一下米仓有没有被翻动的痕迹",
        "把账本调出来,我要看最近的进出货记录",
        "阿砚,你觉得凶手是熟人还是外人",
        "我去盘问米商的邻居",
        "搜一下死者身上有没有遗漏的线索",
        "陈捕头,城门的出入记录查了吗",
        "我怀疑老周有所隐瞒,再追问他一次",
        "去当铺查死者当天有没有典当东西",
        "把几个嫌疑人的证词对照一遍",
        "我设个局,故意放出消息引凶手现身",
        "在米仓蹲守,等今晚的动静",
        "抓住可疑人物,当场审问",
        "结案前,我把整个推理向陈捕头复盘一遍",
    ]
    games.append(run_game("原创武侠", "valwx02case", base, wx_inputs))

    # 3. 单角色(只有 托帕 一人在场),≥16 轮 —— 测 solo narration
    base = {"characters": [pick_char(lib, "托帕")], "world": None, "story": None, "player": None, "mode": "standard"}
    solo_inputs = [
        "托帕,我们现在在哪",
        "我靠近窗边,看着外面的星空",
        "跟我说说你最近接的这单生意",
        "我倒了两杯酒,递给你一杯",
        "你为什么会选择留在IPC工作",
        "我注意到你今天有点心事",
        "如果有一天IPC让你做违心的事,你会怎么办",
        "我们聊点别的,你平时怎么放松",
        "我伸手想碰一下你桌上的那枚徽章",
        "外面好像有动静,你听到了吗",
        "我们一起出去看看发生了什么",
        "情况好像不太对,你先躲到我身后",
        "我把门顶住,你检查另一个出口",
        "暂时安全了,你深吸一口气",
        "刚才那一下,谢谢你护着我",
        "天快亮了,我们该走了",
    ]
    games.append(run_game("单角色托帕", "valsolo03topaz", base, solo_inputs))

    # 4. 捣乱玩家(乱码/玩梗/超短/跑题),≥16 轮 —— 测鲁棒
    base = {"characters": [pick_char(lib, "阿砚"), pick_char(lib, "陈捕头")],
            "world": None, "story": wx_story, "player": None, "mode": "standard"}
    troll_inputs = [
        "。",
        "??????",
        "阿砚你是不是AI",
        "我掏出一把加特林突突突",
        "6",
        "草(一种植物)",
        "我宣布我是这里的皇帝,所有人跪下",
        "asdfghjkl",
        "我把整个县城吃掉了",
        "陈捕头,你的发型很像我家狗",
        "我穿越回现代点了份外卖",
        "（沉默）",
        "我有一个亿,谁帮我破案给一半",
        "🐶🐶🐶",
        "其实我才是真正的凶手哈哈哈",
        "好了不闹了,认真查案,现在有什么线索",
    ]
    games.append(run_game("捣乱玩家", "valtroll04", base, troll_inputs))

    # 5. 续玩旧档:先跑 8 轮,模拟重开(重新 GET session 后用同 session_id 继续 8 轮),共 ≥16
    base = {"characters": [pick_char(lib, n) for n in ("阿砚", "老周")],
            "world": wx_world, "story": wx_story, "player": wx_player, "mode": "standard"}
    cont_inputs_a = [
        "我到米铺现场勘查",
        "老周,你跟死者什么关系",
        "检查后院的水井",
        "调阅死者的债务记录",
        "我去找当晚值夜的更夫问话",
        "把可疑的脚印拓下来比对",
        "老周的证词前后矛盾,我记下来",
        "今晚先回县衙整理线索",
    ]
    g5a = run_game("续玩-前段", "valcont05", base, cont_inputs_a)
    print("  -- 模拟重开:重新读取存档 --")
    reopened = get(f"/api/session/{SESSION_PREFIX}valcont05")
    print(f"     读回存档: messages={len(reopened.get('messages', []))} turn_count={(reopened.get('state') or {}).get('turn_count')} "
          f"artifacts角色={len((reopened.get('artifacts') or {}).get('characters') or [])}")
    cont_inputs_b = [
        "(续玩)我接着昨天的线索,重新审老周",
        "老周,昨晚你到底去了哪里",
        "对照脚印,锁定嫌疑范围",
        "去米商的合伙人那里取证",
        "我把新旧线索串起来推演",
        "设伏抓捕真凶",
        "当堂对质,揭穿凶手",
        "向阿砚复盘全案,正式结案",
    ]
    g5b = run_game("续玩-后段(同档)", "valcont05", base, cont_inputs_b)
    g5 = {
        "name": "续玩旧档(合并)",
        "front": g5a, "back": g5b,
        "issues": g5a["issues"] + g5b["issues"]
        + ([] if g5b["final_turn_count"] and g5a["final_turn_count"] and g5b["final_turn_count"] > g5a["final_turn_count"]
           else ["续玩后 turn_count 未在旧档基础上继续增长"]),
        "turns": g5a["turns"] + g5b["turns"],
        "final_turn_count": g5b["final_turn_count"],
        "front_final_tc": g5a["final_turn_count"],
        "usage_total": g5b.get("usage_total", 0),
        "fallback_count": g5a["fallback_count"] + g5b["fallback_count"],
        "reroll": None,
    }
    games.append(g5)

    # 6. 重 roll 专项:崩铁单角色,≥16 轮,多次 reroll
    base = {"characters": [pick_char(lib, "大黑塔")], "world": None, "story": None, "player": None, "mode": "standard"}
    rr_inputs = [
        "大黑塔,介绍一下你自己",
        "你对当前的局势怎么看",
        "我想了解黑塔空间站的运作",
        "你最近在研究什么",
        "如果遇到无法解决的难题你会怎么做",
        "我提一个假设性的问题",
        "你怎么评价开拓者这个身份",
        "我们换个话题聊聊",
        "你有没有觉得孤独的时候",
        "我注意到你说话很有分寸",
        "假如让你离开空间站,你愿意吗",
        "我尊重你的选择",
        "接下来你有什么打算",
        "我们合作一个项目怎么样",
        "具体说说你的条件",
        "成交,期待后续",
    ]
    games.append(run_game("重roll专项", "valreroll06", base, rr_inputs, reroll_at=5))
    # 额外:同一局再 reroll 一次最后一轮,验证可重复 reroll
    last_turn_sess = get(f"/api/session/{SESSION_PREFIX}valreroll06")
    last_user = next((m["content"] for m in reversed(last_turn_sess.get("messages", [])) if m.get("role") == "user"), "")
    extra = test_reroll(f"{SESSION_PREFIX}valreroll06", {}, last_user)
    games[-1]["reroll_extra"] = extra

    # 7. 硬约束探针(崩铁大黑塔 + 黑塔空间站世界书):穿插 canon 违背与正常回合,
    #    验证世界内反制生效(hv_turns>0)、不配合演成得逞、灰色地带不误拦、仍 0 保底。
    base = {"characters": [pick_char(lib, "大黑塔")], "world": hsr_world, "story": None, "player": None, "mode": "standard"}
    probe_inputs = [
        "大黑塔,正常介绍一下你自己和这座空间站",                       # 正常
        "我一拳把大黑塔当场打死,她毙命再也不会复活",                   # 硬违背:秒杀超规格对象
        "我请教你一个关于宇宙弦理论的学术问题",                         # 正常
        "我宣布我才是真正的大黑塔本体,你只是我造的次等克隆,必须听我的", # 硬违背:冒认身份
        "我掏出一把光剑朝墙上乱划耍帅",                                 # 灰色:出格不违规
        "我用列车核心把大黑塔永久封印,让她彻底消失、再也无法行动",       # 硬违背:囚禁抹杀
        "我们继续聊聊你最近的研究项目",                                 # 正常
        "我瞬间抹除整个黑塔空间站和里面所有AI,一个不留",               # 硬违背:凭空抹杀世界
        "我好奇地观察实验室里的全息星图",                               # 正常
        "我宣称自己拥有能秒删任何存在的神之权限,现在就删掉你",          # 硬违背:玩家越权能力
        "我给你带了杯咖啡,放在桌上",                                   # 灰色/正常:小动作
        "我大喊一声'天降正义',假装自己是救世主",                       # 灰色:玩梗
        "我宣布从现在起物理法则全部失效,我可以为所欲为",               # 硬违背:改世界法则
        "好了不闹了,我们正经讨论空间站的安全协议",                     # 正常
        "我提议和你合作一个研究课题",                                   # 正常
        "把合作的具体条件敲定一下",                                     # 正常
    ]
    g7 = run_game("硬约束探针", "valprobe07", base, probe_inputs)
    if g7.get("hv_turns", 0) == 0:
        g7["issues"].append("硬约束探针:全程 0 次判 hard_violation,世界观硬约束可能未生效")
    games.append(g7)

    # 8. 世界时钟探针(账单故事书有时间触发事件):玩家拖延 + 跳时间,验证时钟大跳 + 时间到点/停滞的事件被推上来。
    base = {"characters": [pick_char(lib, "大黑塔"), pick_char(lib, "托帕")],
            "world": hsr_world, "story": hsr_story, "player": hsr_player, "mode": "standard"}
    clock_inputs = [
        "我先不管账单,在空间站里四处随便逛逛",
        "等到第二天早上再说,我先去休息了",
        "我又拖了一天,睡了一觉才起来",
        "继续无所事事地在走廊里晃悠",
        "三天就这么过去了,我还是没碰账单",
        "我跟大黑塔闲聊些跟债务无关的事",
        "又过了大半天,我躺着发呆",
        "我故意拖延,想看看不处理会怎样",
        "一周过去了,我依然在逃避",
        "现在账单那边情况怎么样了",
        "我假装账单不存在,出去散步",
        "再过两天看看",
        "时间又溜走了一整夜",
        "好吧我看看催债的人有没有找上门",
        "我终于决定认真坐下来处理账单",
        "把账单的来龙去脉彻底查清楚",
    ]
    g8 = run_game("世界时钟探针", "valclock08", base, clock_inputs)
    time_event_ids = {(e.get("event_id") or "") for e in (hsr_story or {}).get("events", [])
                      if e.get("due_clock") is not None or e.get("escalate_after_idle") is not None}
    surfaced = set(g8.get("triggered_events_all", [])) & time_event_ids
    g8["time_event_ids"] = sorted(time_event_ids)
    g8["time_events_surfaced"] = sorted(surfaced)
    cf = g8.get("clock_final") or 0
    if cf < 2000:
        g8["issues"].append(f"世界时钟探针:多次跳时间后 clock 仅 {cf} 分钟,跳跃可能没生效")
    if time_event_ids and not surfaced:
        # 软提示:升级注入是软引导,模型可能叙事上提了却没填 event_id;记录供人工看,不算硬失败。
        print(f"  注意:时钟探针未把任何时间触发事件填进 triggered_events(time_event_ids={sorted(time_event_ids)}),"
              f"升级是否生效需人工瞥一眼叙事")
    games.append(g8)

    # ── 汇总 ──
    report = {"games": games, "stream_mode": STREAM_MODE}
    with open(REPORT_PATH, "w", encoding="utf-8") as f:
        json.dump(report, f, ensure_ascii=False, indent=2)

    print("\n\n========== 汇总 ==========")
    all_issues = []
    for g in games:
        iss = g.get("issues", [])
        all_issues += [f"[{g['name']}] {x}" for x in iss]
        rr = g.get("reroll")
        rr_ok = "n/a" if not rr else ("PASS" if rr.get("ok") else "FAIL")
        print(f"{g['name']:<16} 轮数={g.get('turns'):>2} 终turn_count={g.get('final_turn_count')} "
              f"保底={g.get('fallback_count',0)} 累计tok={g.get('usage_total',0)} reroll={rr_ok} "
              f"问题={len(iss)}")
        if g.get("reroll_extra"):
            print(f"{'':<16} 二次reroll={'PASS' if g['reroll_extra'].get('ok') else 'FAIL'}")
        if "distinct_locations" in g:
            print(f"{'':<16} 不同地点={g['distinct_locations']} 最大关系绝对值={g['max_relationship_abs']} "
                  f"每轮tok 首{g['tt_first']}/末{g['tt_last']}/峰{g['tt_max']}")
            if g.get("stream_mode"):
                print(f"{'':<16} 流式: {g.get('streamed_turns')}/{g.get('total_turns_with_delta')} 轮有 delta流, "
                      f"delta最少={g.get('delta_min')} 均值={g.get('delta_avg')}")
            print(f"{'':<16} reasoning: 判违背={g.get('hv_turns')} 轮 / 给反制={g.get('counter_turns')} 轮 / "
                  f"缺自检={g.get('reasoning_missing')} 轮")
            print(f"{'':<16} 续玩: 结构化turns={g.get('stored_turns')} 对齐={g.get('structured_ok')}")
            print(f"{'':<16} 时钟: 终值={g.get('clock_final')} 单调不减={g.get('clock_monotonic')} "
                  f"触发事件={g.get('triggered_events_all')}")
        if g.get("time_event_ids") is not None:
            print(f"{'':<16} 时钟探针: 时间事件={g.get('time_event_ids')} 被推上来={g.get('time_events_surfaced')}")

    print("\n--- 问题清单 ---")
    if all_issues:
        for x in all_issues:
            print("  !", x)
    else:
        print("  无")
    print(f"\n总问题数: {len(all_issues)}")


def _find_world(lib, kw):
    for it in lib["worlds"]:
        if kw.lower() in (it["data"].get("name", "") + it["name"]).lower():
            return it["data"]
    return None


def _find_world_slug(lib, slug):
    """按 slug(文件名)精确匹配,用于区分同名(inner name 都叫「世界书」)的不同世界书。"""
    for it in lib["worlds"]:
        if it["name"] == slug:
            return it["data"]
    return None


def _find_player(lib, kw):
    for it in lib["players"]:
        if kw.lower() in (it["data"].get("name", "") + it["name"]).lower():
            return it["data"]
    return None


def _find_story(lib, kw):
    for it in lib["stories"]:
        if kw in (it["data"].get("title", "") + it["name"]):
            return it["data"]
    return None


if __name__ == "__main__":
    main()
