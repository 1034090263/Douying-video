"""给背景图生成 2.5D 视差遮罩：Depth Anything V2 估计深度 → 中景/近景两张羽化遮罩。

  public/images/<名字>/bg_xxx.png → bg_xxx_m1.png（中景）、bg_xxx_m2.png（近景）
  渲染时：远景=原图，中景/近景=原图按遮罩裁出，随镜头以不同速度移动，形成视差。

用法：~/imggen/.venv/bin/python scripts/depth.py byakuya
"""
import sys
from pathlib import Path

import numpy as np
import torch
from PIL import Image, ImageFilter
from transformers import pipeline

ROOT = Path(__file__).resolve().parent.parent
MODEL = Path.home() / "imggen" / "models" / "depth-v2-small"


def main():
    folder = ROOT / "public" / "images" / sys.argv[1]
    bgs = [p for p in sorted(folder.glob("bg_*.png")) if not p.stem.endswith(("_m1", "_m2"))]
    todo = [p for p in bgs if not (p.with_name(p.stem + "_m2.png")).exists() or p.stat().st_mtime > p.with_name(p.stem + "_m2.png").stat().st_mtime]
    if not todo:
        print("遮罩都是最新的")
        return
    est = pipeline("depth-estimation", model=str(MODEL), device=0 if torch.cuda.is_available() else -1)
    for p in todo:
        img = Image.open(p).convert("RGB")
        d = np.array(est(img)["depth"].resize((540, 945)), dtype=np.float32)
        d = (d - d.min()) / (d.max() - d.min() + 1e-6)  # 越大越近
        for name, q in (("_m1", 55), ("_m2", 82)):
            thr = np.percentile(d, q)
            m = np.clip((d - thr) / 0.08 + 0.5, 0, 1)  # 软阈值
            mask = Image.fromarray((m * 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(4))
            rgba = Image.new("RGBA", mask.size, (255, 255, 255, 0))
            rgba.putalpha(mask)
            rgba.save(p.with_name(p.stem + name + ".png"))
        print("视差遮罩", p.name)


if __name__ == "__main__":
    main()
