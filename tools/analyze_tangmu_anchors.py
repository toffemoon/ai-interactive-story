"""从立绘 alpha 通道测头中心(x,y 占图比例)+ 身体左缘 x 占比。脖颈检测:头是顶部先宽后窄的段。"""
import glob, os, json
import numpy as np
from PIL import Image

DIR = r"C:/Users/admin/Desktop/ai-interactive-story/frontend-next/public/home"

def analyze(path):
    im = Image.open(path).convert("RGBA")
    a = np.array(im)[:, :, 3]
    H, W = a.shape
    mask = a > 30
    rows = np.where(mask.any(axis=1))[0]
    if len(rows) == 0:
        return None
    top, bot = int(rows[0]), int(rows[-1])
    fh = bot - top
    width = mask.sum(axis=1).astype(float)
    # 平滑
    k = max(3, fh // 60)
    kernel = np.ones(k) / k
    sw = np.convolve(width, kernel, mode="same")
    # 头段:top .. top+0.35H 里找先出现峰后的最小(脖颈)
    lo = top + int(0.05 * fh)
    hi = top + int(0.32 * fh)
    seg = sw[lo:hi]
    if len(seg) < 3:
        neck = top + int(0.15 * fh)
    else:
        # 峰后最小:找 seg 的最大位置,其后到 hi 的最小
        peak = lo + int(np.argmax(seg))
        after = sw[peak:hi]
        neck = peak + int(np.argmin(after)) if len(after) else top + int(0.15 * fh)
    # 头中心
    head_rows = mask[top:neck]
    ys, xs = np.where(head_rows)
    if len(xs) == 0:
        hx = 0.5
        hy = (top + (top + neck) / 2) / H
    else:
        hx = (xs.mean()) / W
        hy = (top + (neck - top) / 2) / H  # 头顶到脖颈中点
    # 身体左缘(整躯干):脖颈下 0.5H 内最左非透明 x
    b_lo, b_hi = neck, min(bot, neck + int(0.5 * fh))
    body = mask[b_lo:b_hi]
    bxs = np.where(body.any(axis=0))[0]
    body_left = (int(bxs[0]) / W) if len(bxs) else 0.30
    # 气泡纵向范围内的左缘:气泡中心=头中心 y,半高≈0.09H,取 [hy-0.09, hy+0.11] 段最左点
    # (气泡文字向下延展多,下探多一点)。这才是气泡实际会撞到的立绘左轮廓。
    hy_px = int(hy * H)
    bb_lo = max(0, hy_px - int(0.09 * H))
    bb_hi = min(H, hy_px + int(0.11 * H))
    bband = mask[bb_lo:bb_hi]
    bbxs = np.where(bband.any(axis=0))[0]
    left_at_bubble = (int(bbxs[0]) / W) if len(bbxs) else body_left
    return {
        "top_frac": round(top / H, 3), "neck_frac": round(neck / H, 3),
        "head_x": round(float(hx), 3), "head_y": round(float(hy), 3),
        "body_left": round(float(body_left), 3),
        "left_at_bubble": round(float(left_at_bubble), 3),
    }

out = {}
for n in range(1, 13):
    p = os.path.join(DIR, f"tangmu{n:02d}.png")
    if os.path.exists(p):
        out[f"tangmu{n:02d}"] = analyze(p)
print(json.dumps(out, ensure_ascii=False, indent=2))
