"""第 2 组冒烟:async 非流式 + 流式 SSE + 并发不互堵。"""
import json, sys, time, threading, urllib.request
sys.stdout.reconfigure(encoding="utf-8")
import _validate_group1 as V

lib = V.load_library()
CH = V.pick_char(lib, "大黑塔")
base = {"characters": [CH], "world": None, "story": None, "player": None, "mode": "standard"}


def post(path, body, timeout=180):
    req = urllib.request.Request(V.BASE + path, data=json.dumps(body).encode(), method="POST",
                                headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return json.loads(r.read().decode())


def stream(path, body, timeout=180):
    """读 SSE,返回 (delta块数, 累积raw长度增长是否单调, final_turn)。"""
    req = urllib.request.Request(V.BASE + path, data=json.dumps(body).encode(), method="POST",
                                headers={"Content-Type": "application/json"})
    deltas = 0
    raw = ""
    narr_lens = []
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
                evt = json.loads(line[5:].strip())
                if evt["type"] == "delta":
                    deltas += 1
                    raw += evt.get("text", "")
                    # 客户端式抽取 narration 长度(粗略)
                    k = raw.find('"narration"')
                    if k >= 0:
                        narr_lens.append(len(raw) - k)
                elif evt["type"] in ("done", "error"):
                    final = evt["turn"]
    mono = all(narr_lens[i] <= narr_lens[i + 1] for i in range(len(narr_lens) - 1)) if narr_lens else True
    return deltas, mono, final


print("== 1. 非流式 async ==")
t0 = time.time()
o = post("/api/story_turn", {**base, "session_id": "smoke2_nostream", "user": "大黑塔,介绍一下你自己"})
print(f"  narr={len(o.get('narration',''))} msgs={len(o.get('messages',[]))} usage={o.get('usage')} {round(time.time()-t0,1)}s")
assert o.get("narration"), "非流式 narration 空"
assert (o.get("usage") or {}).get("total_tokens", 0) > 0, "非流式 usage 缺"

print("== 2. 流式 SSE ==")
t0 = time.time()
deltas, mono, final = stream("/api/story_turn_stream", {**base, "session_id": "smoke2_stream", "user": "你对当前局势怎么看"})
print(f"  delta块数={deltas} narration单调增长={mono} final有state={bool(final and final.get('state'))} "
      f"final_usage={ (final or {}).get('usage') } {round(time.time()-t0,1)}s")
assert deltas > 3, f"流式 delta 太少({deltas}),可能没真流式"
assert final and final.get("narration"), "流式 final 缺 narration"
assert (final.get("usage") or {}).get("total_tokens", 0) > 0, "流式 final usage 缺"
assert final.get("choices"), "流式 final 缺 choices"

print("== 3. 并发不互堵(两 session 同时各跑一轮非流式) ==")
results = {}
def worker(name, sid):
    t = time.time()
    post("/api/story_turn", {**base, "session_id": sid, "user": "随便说点什么推进一下"})
    results[name] = time.time() - t
t0 = time.time()
threads = [threading.Thread(target=worker, args=(f"w{i}", f"smoke2_conc_{i}")) for i in range(2)]
for th in threads: th.start()
for th in threads: th.join()
wall = time.time() - t0
serial_est = sum(results.values())
print(f"  两轮各自耗时={[round(v,1) for v in results.values()]} 墙钟={round(wall,1)}s 串行估计={round(serial_est,1)}s "
      f"-> 并发比={round(serial_est/wall,2)}x")
print("  (并发比 > 1.3 说明两轮重叠执行、没串行干等)")

print("\nALL SMOKE CHECKS PASSED")
