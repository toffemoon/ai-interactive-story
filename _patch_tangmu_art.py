# 一次性:给糖沐卡补头像/立绘(库卡 + 所有含糖沐的预设),走本地 API。
import json
import urllib.request

BASE = "http://127.0.0.1:8001"
AVATAR = "assets/cards/tangmu-avatar.jpg"
MAIN = "assets/cards/tangmu-main.jpg"


def get(path):
    return json.load(urllib.request.urlopen(BASE + path))


def post(path, body):
    req = urllib.request.Request(BASE + path, data=json.dumps(body).encode("utf-8"),
                                 headers={"Content-Type": "application/json"}, method="POST")
    return json.load(urllib.request.urlopen(req))


# 1) 卡库里的糖沐
rows = get("/api/library/characters")
hit = [r for r in rows if "糖沐" in (r.get("name") or "")]
assert hit, "库里没找到糖沐"
card = hit[0]["data"]
inner = card.get("data") or card  # 完整 Card V2 或裸 data 两种形状都兼容
inner["avatar"] = AVATAR
inner["image"] = MAIN
if card.get("data"):
    card["data"] = inner
else:
    card = {"data": inner}
print("library save:", post("/api/library/save", {"kind": "characters", "data": card}))

# 2) 所有含糖沐的预设(详情页/聊天用的是预设里的拷贝)
presets = get("/api/presets")
for p in presets:
    pd = p.get("data") or {}
    touched = False
    for c in (pd.get("characters") or []):
        d = c.get("data") or {}
        if "糖沐" in (d.get("name") or ""):
            d["avatar"] = AVATAR
            d["image"] = MAIN
            touched = True
    if touched:
        body = dict(pd)
        body["name"] = p.get("name") or pd.get("name")
        print("preset save:", body["name"], post("/api/presets", body))
print("done")
