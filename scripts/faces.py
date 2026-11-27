"""给骨骼人偶生成表情：用 FLUX.2 klein 参考图编辑原图（闭眼、惊恐、悲伤、冷漠），按头部轮廓抠出 head_<表情>.png。

  编辑后的图和原图像素对齐，所以直接用 rig 里 head.png 的透明度当遮罩；每种表情生成 2 张候选，
  挑「头部以外几乎没改动、头部确实变了」的那张。结果写进 rig.json 的 faces 字段。

用法：~/imggen/.venv/bin/python scripts/faces.py public/images/<图集> <角色id> [--only blink shock ...]
"""
import argparse
import json
import sys
from pathlib import Path

import numpy as np
from PIL import Image

sys.path.insert(0, str(Path(__file__).parent))
from imagegen import Gen  # noqa: E402

KEEP = "Keep everything else exactly the same: same pose, same face shape, same hair, same clothes, same position, same background, same art style."
FACES = {
    "blink": "Edit the image: the person closes both eyes, eyelids gently shut, calm face.",
    "shock": "Edit the image: the person looks shocked and frightened, eyes wide open, eyebrows raised, mouth slightly open.",
    "sad": "Edit the image: the person looks sad, eyebrows slightly drawn together, eyes looking down, mouth turned down a little.",
    "cold": "Edit the image: the person has a cold blank expressionless stare, eyes slightly narrowed, mouth closed.",
}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("folder")
    ap.add_argument("cid")
    ap.add_argument("--only", nargs="*")
    ap.add_argument("--n", type=int, default=2)
    args = ap.parse_args()
    folder = Path(args.folder)
    rdir = folder / f"rig_{args.cid}"
    rig = json.loads((rdir / "rig.json").read_text())
    raw = Image.open(folder / f"raw_{args.cid}_walk.png").convert("RGB")
    O = np.asarray(raw).astype(np.float32)
    hp = rig["parts"]["head"]
    head = np.asarray(Image.open(rdir / hp["file"]).convert("RGBA"))
    x0, y0, w, h = hp["x"], hp["y"], hp["w"], hp["h"]
    inside = np.zeros(O.shape[:2], bool)
    inside[y0:y0 + h, x0:x0 + w] = head[..., 3] > 0
    gen = Gen()
    faces = set(rig.get("faces", []))
    for name, prompt in FACES.items():
        if args.only and name not in args.only:
            continue
        best = None
        for seed in range(1, args.n + 1):
            im = gen.image(f"{prompt} {KEEP}", raw.size, seed, refs=[raw])
            E = np.asarray(im.convert("RGB")).astype(np.float32)
            d = np.abs(E - O).mean(-1)
            drift = float(d[~inside].mean())
            change = float(d[inside].mean())
            score = change - drift * 4
            print(f"  {name} 候选 {seed}: 头部变化 {change:.1f}，其余改动 {drift:.1f}", flush=True)
            if best is None or score > best[0]:
                best = (score, E)
        E = best[1].astype(np.uint8)[y0:y0 + h, x0:x0 + w]
        out = np.dstack([E, head[..., 3]])
        Image.fromarray(out).save(rdir / f"head_{name}.png")
        faces.add(name)
    rig["faces"] = sorted(faces)
    (rdir / "rig.json").write_text(json.dumps(rig, ensure_ascii=False, indent=1))
    print(f"{args.cid}: 表情 {rig['faces']}")


if __name__ == "__main__":
    main()
