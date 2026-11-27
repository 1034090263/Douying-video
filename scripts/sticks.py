"""火柴人姿势图：按动作的关键姿势画成和连续动作图一样的排版（一行 ≤4 帧 512x1024；多于 4 帧两行），给 seqgen.py --poses 当第二张参考图。
姿势参数和 src/acting.ts 一致（正值 = 往前；bend = 肘/膝弯曲）。

用法：python3 scripts/sticks.py <输出目录>
"""
import math
import sys
from pathlib import Path

from PIL import Image, ImageDraw


def L(s, b):
    return (s, b)


STAND = dict(lean=1, ln=L(3, 4), lf=L(-3, 4), an=L(-4, 10), af=L(4, 10))
RAISE = dict(lean=-2, ln=L(10, 10), lf=L(-8, 8), an=L(160, 25), af=L(25, 35))
WIND = dict(lean=-5, ln=L(10, 10), lf=L(-8, 8), an=L(158, 45), af=L(25, 35))
HIT = dict(lean=10, ln=L(20, 22), lf=L(-12, 10), an=L(38, 4), af=L(-25, 30))
FLINCH = dict(lean=1, ln=L(8, 22), lf=L(-6, 20), an=L(30, 60), af=L(25, 60))
JOLT = dict(lean=-10, ln=L(12, 14), lf=L(-10, 12), an=L(70, 75), af=L(60, 70))
DOWN = dict(lean=4, ln=L(3, 6), lf=L(-3, 6), an=L(-2, 8), af=L(2, 8), head=22)


def walk(ph):
    s, c = math.sin(ph), math.cos(ph)
    return dict(lean=5, ln=L(24 * s, 6 + 50 * max(0, c) ** 1.6), lf=L(-24 * s, 6 + 50 * max(0, -c) ** 1.6), an=L(-20 * s, 14 + 16 * max(0, -s)), af=L(20 * s, 14 + 16 * max(0, s)))


def mix(a, b, t):
    o = {}
    for k in set(a) | set(b):
        va, vb = a.get(k, 0), b.get(k, 0)
        o[k] = (va[0] + (vb[0] - va[0]) * t, va[1] + (vb[1] - va[1]) * t) if isinstance(va, tuple) or isinstance(vb, tuple) else va + (vb - va) * t
    return o


ACTIONS = {
    "walk": [walk(i * math.pi / 3 + math.pi / 2) for i in range(6)],
    "stop": [mix(walk(0), STAND, t) for t in (0, 0.33, 0.66, 1)],
    "shock": [STAND, FLINCH, JOLT, mix(JOLT, STAND, 0.15)],
    "raise": [mix(JOLT, RAISE, t) for t in (0, 0.33, 0.66, 1)],
    "strike": [RAISE, WIND, mix(WIND, HIT, 0.4), mix(WIND, HIT, 0.8), HIT, HIT],
    "down": [mix(HIT, DOWN, t) for t in (0, 0.33, 0.66, 1)],
}


def seg(p, ang, n):
    r = math.radians(ang)
    return (p[0] + n * math.sin(r), p[1] + n * math.cos(r))


def figure(d, cx, ground, H, pose):
    near, far = (25, 25, 25), (150, 150, 150)
    hip = (cx, ground - H * 0.5)
    lean = math.radians(pose.get("lean", 0))
    neck = (hip[0] + H * 0.3 * math.sin(lean), hip[1] - H * 0.3 * math.cos(lean))
    head = math.radians(pose.get("head", 0))
    for key, col, w in (("lf", far, 14), ("af", far, 12), (None, near, 18), ("ln", near, 16), ("an", near, 13)):
        if key is None:
            d.line([hip, neck], fill=col, width=w)
            hc = (neck[0] + H * 0.09 * math.sin(lean + head), neck[1] - H * 0.09 * math.cos(lean + head))
            d.ellipse([hc[0] - H * 0.07, hc[1] - H * 0.07, hc[0] + H * 0.07, hc[1] + H * 0.07], outline=col, width=8)
            d.line([(hc[0] + H * 0.06, hc[1]), (hc[0] + H * 0.1, hc[1] + H * 0.01)], fill=col, width=6)  # 鼻子朝右
            continue
        sw, bd = pose[key]
        if key[0] == "l":
            k = seg(hip, sw, H * 0.24)
            a = seg(k, sw - bd, H * 0.24)
            d.line([hip, k, a], fill=col, width=w, joint="curve")
            d.line([a, (a[0] + H * 0.07, a[1])], fill=col, width=w)
        else:
            sh = (neck[0], neck[1] + H * 0.03)
            e = seg(sh, sw, H * 0.17)
            h = seg(e, sw + bd, H * 0.16)
            d.line([sh, e, h], fill=col, width=w, joint="curve")


def sheet(poses):
    n = len(poses)
    if n <= 4:
        W, Hh, cols = 512 * n, 1024, n
    else:
        cols = (n + 1) // 2
        W, Hh = 512 * cols, 2048
    im = Image.new("RGB", (W, Hh), (225, 225, 225))
    d = ImageDraw.Draw(im)
    for i, p in enumerate(poses):
        r, c = divmod(i, cols)
        figure(d, 256 + c * 512, 1024 * (r + 1) - 60, 900, p)
    return im


if __name__ == "__main__":
    out = Path(sys.argv[1])
    out.mkdir(parents=True, exist_ok=True)
    for name, poses in ACTIONS.items():
        sheet(poses).save(out / f"{name}.png")
    print("火柴人姿势图 →", out)
