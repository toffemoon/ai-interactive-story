"""验证 operator 控制台「OC集」:端点 + 静态图 + 控制台 JS 语法。"""
import os, re, subprocess, tempfile, sys
os.environ["OPERATOR_TOKEN"] = "test-op-token"
from fastapi.testclient import TestClient
from src.api import app

c = TestClient(app)
H = {"X-Operator-Token": "test-op-token"}
ok = True
def chk(n, cond):
    global ok; print(("  OK  " if cond else "  XX  ") + n); ok = ok and cond

# 控制台页面
r = c.get("/operator")
chk("/operator 200", r.status_code == 200)
html = r.text
chk("含 OC集 tab", 'id="tabOC"' in html and "OC集" in html)
chk("含 #ocwrap 容器", 'id="ocwrap"' in html)
chk("含 mdToHtml", "function mdToHtml" in html)
chk("含 loadOC/showOC", "function loadOC" in html and "function showOC" in html)

# 提取 <script> 用 node --check 验 JS 语法(防 Python 串转义把 JS 弄坏)
m = re.search(r"<script>(.*?)</script>", html, re.S)
js = m.group(1) if m else ""
chk("提取到 script", bool(js))
jsf = tempfile.NamedTemporaryFile("w", suffix=".js", delete=False, encoding="utf-8")
jsf.write(js); jsf.close()
try:
    res = subprocess.run(["node", "--check", jsf.name], capture_output=True, text=True)
    chk("控制台 JS 语法 node --check 通过", res.returncode == 0)
    if res.returncode != 0:
        print("    node:", (res.stderr or res.stdout).strip()[:400])
except FileNotFoundError:
    print("  (node 不在 PATH,跳过 JS 语法检查)")

# OC 端点
r = c.get("/api/operator/oc")
chk("无 token 403", r.status_code == 403)
r = c.get("/api/operator/oc", headers=H)
chk("带 token 200", r.status_code == 200)
ocs = r.json().get("ocs", [])
chk("返回 1 个 OC", len(ocs) == 1)
o = ocs[0] if ocs else {}
chk("user=Larus Canus", o.get("user") == "Larus Canus")
chk("character=萍狗", o.get("character") == "萍狗")
chk("profile 完整(含苹果王国/交换生)", "苹果王国" in (o.get("profile") or "") and "交换生" in (o.get("profile") or ""))
chk("world 含 荒海", "荒海" in (o.get("world") or ""))
chk("art url /oc-assets", (o.get("art") or "").startswith("/oc-assets/"))
chk("map url /oc-assets", (o.get("map") or "").startswith("/oc-assets/"))

# 静态图可取
for label, url in [("立绘", o.get("art")), ("地图", o.get("map"))]:
    rr = c.get(url)
    chk(f"{label}可取(200+image)", rr.status_code == 200 and rr.headers.get("content-type", "").startswith("image"))

print("\n" + ("✅ 全部通过" if ok else "❌ 有失败项"))
sys.exit(0 if ok else 1)
