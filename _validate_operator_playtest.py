"""验证 OC 开测 + 玩家对话 + SGT(静态:不触发 LLM)。"""
import os, re, subprocess, tempfile, sys
os.environ["OPERATOR_TOKEN"] = "test-op-token"
from fastapi.testclient import TestClient
from src.api import app
c = TestClient(app); H = {"X-Operator-Token": "test-op-token"}
ok = True
def chk(n, cond):
    global ok; print(("  OK  " if cond else "  XX  ") + n); ok = ok and cond

r = c.get("/operator"); html = r.text
chk("/operator 200", r.status_code == 200)
for tok in ['id="playmsg"', "function playSay", "function startOCTest", "function sgt(", 'id="clk"', "class=octest", "startOCTest("]:
    chk("含 " + tok, tok in html)
m = re.search(r"<script>(.*?)</script>", html, re.S); js = m.group(1) if m else ""
f = tempfile.NamedTemporaryFile("w", suffix=".js", delete=False, encoding="utf-8"); f.write(js); f.close()
try:
    res = subprocess.run(["node", "--check", f.name], capture_output=True, text=True)
    chk("控制台 JS node --check", res.returncode == 0)
    if res.returncode:
        print("   ", (res.stderr or res.stdout)[:300])
except FileNotFoundError:
    print("  (node 缺,跳过 JS 检查)")

d = c.get("/api/operator/oc", headers=H).json(); o = (d.get("ocs") or [{}])[0]
chk("OC 返回 card=true(萍狗有引擎卡)", o.get("card") is True)
chk("/oc/start 无 token 403", c.post("/api/operator/oc/start", json={"index": 0}).status_code == 403)
chk("/say 无 token 403", c.post("/api/operator/say", json={"session_id": "x", "user": "hi"}).status_code == 403)
chk("/oc/start 越界 400", c.post("/api/operator/oc/start", headers=H, json={"index": 99}).status_code == 400)
chk("/say 空输入 400", c.post("/api/operator/say", headers=H, json={"session_id": "x", "user": "  "}).status_code == 400)
print("\n" + ("✅ 静态全过" if ok else "❌ 有失败")); sys.exit(0 if ok else 1)
