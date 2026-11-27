"""关键姿势逐张生成（动态漫做法）：用骨骼人偶摆出的姿势草稿 + 角色定妆照，让 FLUX.2 klein 重画一张干净的完整人物图。

  草稿负责定姿势、位置、大小（所有帧脚踩同一条地面线，切换时不跳）；定妆照负责长相、衣服、画风。
  每个姿势生成 n 张候选，按「轮廓和草稿重合度」挑最好的，BiRefNet 抠图。
  输出 public/images/<图集>/pose_<角色>/<姿势>.png（透明底，和原图同尺寸、同坐标）。

用法：~/imggen/.venv/bin/python scripts/posegen.py public/images/<图集> <角色> <草稿目录> [--only 名字 ...] [--n 2]
"""
import argparse
import json
import sys
from pathlib import Path

import numpy as np
from PIL import Image

sys.path.insert(0, str(Path(__file__).parent))
from imagegen import Gen  # noqa: E402
from rig import alpha_of  # noqa: E402

PROMPT = (
    "Edit the image: repaint this character so the body looks natural and clean. Keep exactly the same pose, position, size, face, "
    "hairstyle, clothes, colors and soft painterly art style. Fix the shoulders, elbows, hips and knees so the arms and legs connect "
    "smoothly and look anatomically correct, remove any seams, smears, gaps or duplicated parts. Full body, plain flat light gray background, no text."
)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("folder")
    ap.add_argument("cid")
    ap.add_argument("guides")
    ap.add_argument("--only", nargs="*")
    ap.add_argument("--n", type=int, default=2)
    args = ap.parse_args()
    folder = Path(args.folder)
    out = folder / f"pose_{args.cid}"
    out.mkdir(exist_ok=True)
    ident = Image.open(folder / f"raw_{args.cid}_walk.png").convert("RGB")
    gen = Gen()
    meta = {}
    for g in sorted(Path(args.guides).glob("*.png")):
        name = g.stem.replace(".", "_")
        if args.only and name not in args.only:
            continue
        guide = Image.open(g).convert("RGB").resize(ident.size)
        _, gm = alpha_of(guide)
        best = None
        for seed in range(1, args.n + 1):
            im = gen.image(PROMPT, ident.size, seed, refs=[guide])
            a, m = alpha_of(im)
            iou = float((m & gm).sum() / max(1, (m | gm).sum()))
            print(f"  {name} 候选 {seed}: 轮廓重合 {iou:.2f}", flush=True)
            if best is None or iou > best[0]:
                best = (iou, im, a)
        iou, im, a = best
        im.save(out / f"raw_{name}.png")
        rgba = np.dstack([np.asarray(im), (a * 255).clip(0, 255).astype(np.uint8)])
        Image.fromarray(rgba).save(out / f"{name}.png")
        meta[name] = round(iou, 3)
    (out / "poses.json").write_text(json.dumps({"size": list(ident.size), "poses": meta}, ensure_ascii=False, indent=1))
    print("完成", meta)


if __name__ == "__main__":
    main()
