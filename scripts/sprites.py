"""把人物姿势图整理成「逐帧精灵」：抠图、定脚底锚点、统一身高单位，写出 pose_<角色>/sprites.json。

  两种来源：
    sheet  一张连续动作图（模型按剧情一次画出的几帧，左右排开）→ 按连通块切成单帧，锚点 = 两脚中点
    guide  姿势草稿修整出来的整幅图（scripts/posegen.py，和原图同坐标）→ 锚点 = 骨骼原图的胯部 x、地面 y
  unit = 这个来源里「人站直时的身高」（像素），渲染时按 角色身高 / unit 缩放，各来源大小一致。

用法：
  ~/imggen/.venv/bin/python scripts/sprites.py sheet public/images/<图集> <角色> <连续图.png> <动作名> [--frames 4]
  ~/imggen/.venv/bin/python scripts/sprites.py guide public/images/<图集> <角色>
"""
import argparse
import json
import sys
from pathlib import Path

import cv2
import numpy as np
from PIL import Image

sys.path.insert(0, str(Path(__file__).parent))
from rig import alpha_of  # noqa: E402


def load_meta(d: Path):
    f = d / "sprites.json"
    return json.loads(f.read_text()) if f.exists() else {}


def foot_anchor(alpha: np.ndarray):
    ys, xs = np.where(alpha > 0.5)
    bottom = ys.max()
    low = ys > bottom - (bottom - ys.min()) * 0.04
    return float(xs[low].mean()), float(bottom)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("mode", choices=["sheet", "guide"])
    ap.add_argument("folder")
    ap.add_argument("cid")
    ap.add_argument("sheet", nargs="?")
    ap.add_argument("action", nargs="?")
    ap.add_argument("--frames", type=int, default=4)
    args = ap.parse_args()
    folder = Path(args.folder)
    d = folder / f"pose_{args.cid}"
    d.mkdir(exist_ok=True)
    meta = load_meta(d)
    if args.mode == "sheet":
        im = Image.open(args.sheet).convert("RGB")
        a, fg = alpha_of(im)
        fg = cv2.morphologyEx(fg.astype(np.uint8), cv2.MORPH_CLOSE, np.ones((9, 9), np.uint8))
        cnt, lab, stats, _ = cv2.connectedComponentsWithStats(fg)
        comps = sorted([i for i in range(1, cnt) if stats[i, cv2.CC_STAT_AREA] > fg.size * 0.01], key=lambda i: stats[i, cv2.CC_STAT_LEFT])
        if len(comps) != args.frames:
            print(f"  警告：找到 {len(comps)} 个人，期望 {args.frames}")
        heights = [stats[i, cv2.CC_STAT_HEIGHT] for i in comps]
        unit = float(np.median(heights))
        rgb = np.asarray(im)
        for n, i in enumerate(comps, 1):
            x, y, w, h = stats[i, :4]
            pad = 12
            x0, y0, x1, y1 = max(0, x - pad), max(0, y - pad), min(im.width, x + w + pad), min(im.height, y + h + pad)
            m = (lab[y0:y1, x0:x1] == i).astype(np.float32)
            m = cv2.dilate(m, np.ones((5, 5), np.uint8))
            alpha = a[y0:y1, x0:x1] * m
            name = f"{args.action}_{n}"
            Image.fromarray(np.dstack([rgb[y0:y1, x0:x1], (alpha * 255).astype(np.uint8)])).save(d / f"{name}.png")
            fx, fy = foot_anchor(alpha)
            meta[name] = {"file": f"{name}.png", "w": int(x1 - x0), "h": int(y1 - y0), "ax": fx, "ay": fy, "unit": unit}
        print(f"{args.action}: {len(comps)} 帧，身高单位 {unit:.0f}px")
    else:
        rig = json.loads((folder / f"rig_{args.cid}" / "rig.json").read_text())
        hipx, ground = rig["spine"][0][0], rig["ground"]
        rest = np.asarray(Image.open(d / "rest.png"))[..., 3] > 128
        ys = np.where(rest)[0]
        unit = float(ys.max() - ys.min())  # 站直时从头顶到鞋底
        ground = float(ys.max())
        for f in sorted(d.glob("*.png")):
            if f.name.startswith("raw_") or f.stem in meta and meta[f.stem].get("src") == "sheet":
                continue
            im = Image.open(f)
            if im.size != tuple(rig["size"]):
                continue
            meta[f.stem] = {"file": f.name, "w": im.width, "h": im.height, "ax": hipx, "ay": ground, "unit": unit, "src": "guide"}
        print(f"guide：身高单位 {unit:.0f}px，共 {sum(1 for v in meta.values() if v.get('src') == 'guide')} 张")
    (d / "sprites.json").write_text(json.dumps(meta, ensure_ascii=False, indent=1))


if __name__ == "__main__":
    main()
