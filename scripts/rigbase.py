"""为骨骼拆件生成「好切」的底图：同一角色多生成几张侧面迈步候选，用关节识别打分，挑最好的。

  打分：头部是否严格侧面（两眼在水平方向几乎重合）、近侧手臂离身体够不够远、两腿张开够不够大
  结果写入 <图集>/raw_<角色>_walk.png（覆盖），并输出候选总览图 /tmp/rigbase_<角色>.jpg

用法：~/imggen/.venv/bin/python scripts/rigbase.py <视频名> <角色> [--n 6]
"""
import argparse
import json
import sys
from pathlib import Path

import cv2
import mediapipe as mp
import numpy as np
from mediapipe.tasks.python import BaseOptions, vision
from PIL import Image, ImageDraw

sys.path.insert(0, str(Path(__file__).parent))
from imagegen import CHAR_SIZE, Gen  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent
MODELS = Path.home() / "imggen" / "models"

WALK = (
    "the same person, strict side view of the whole body walking toward the {dir}, "
    "the head is also in strict side profile facing the walking direction with only one eye visible, not looking at the viewer, "
    "long walking stride with the two legs far apart, the near arm swung far forward and clearly away from the body, "
    "the far arm hidden behind the body"
)


def landmarks(det, img: Image.Image):
    rgb = np.array(img.convert("RGB"))
    r = det.detect(mp.Image(image_format=mp.ImageFormat.SRGB, data=rgb))
    if not r.pose_landmarks:
        return None
    h, w = rgb.shape[:2]
    return [(p.x * w, p.y * h, p.z, p.visibility) for p in r.pose_landmarks[0]]


def score(lm):
    P = lambda i: np.array(lm[i][:2])
    head = np.linalg.norm(P(0) - (P(7) + P(8)) / 2) + 1e-6
    torso = np.linalg.norm((P(11) + P(12)) / 2 - (P(23) + P(24)) / 2) + 1e-6
    # 侧脸：两眼水平距离 / 头的尺寸 越小越好
    profile = abs(lm[2][0] - lm[5][0]) / head
    # 近侧手臂（z 更小）离躯干中线的距离
    s = 11 if lm[11][2] < lm[12][2] else 12
    el, wr = (13, 15) if s == 11 else (14, 16)
    neck, hip = (P(11) + P(12)) / 2, (P(23) + P(24)) / 2
    d = hip - neck
    n = np.array([-d[1], d[0]]) / torso
    sep = (abs(np.dot(P(el) - neck, n)) + abs(np.dot(P(wr) - neck, n))) / 2 / torso
    # 两腿张开角
    a1 = np.degrees(np.arctan2(*(P(27) - hip)[::-1]))
    a2 = np.degrees(np.arctan2(*(P(28) - hip)[::-1]))
    stride = abs(a1 - a2)
    total = -profile * 2.0 + min(sep, 0.6) * 2.0 + min(stride, 45) / 45
    return total, {"侧脸": round(profile, 2), "手臂离身": round(sep, 2), "步幅": round(stride, 1)}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("video")
    ap.add_argument("cid")
    ap.add_argument("--n", type=int, default=6)
    ap.add_argument("--dir", default="right")
    args = ap.parse_args()
    folder = ROOT / "public" / "images" / args.video
    art = json.loads((ROOT / "videos" / args.video / "art.json").read_text())
    style, cstyle = art["style"], art.get("character_style", "")
    ref = Image.open(folder / f"raw_{args.cid}_stand.png").convert("RGB")
    det = vision.PoseLandmarker.create_from_options(
        vision.PoseLandmarkerOptions(base_options=BaseOptions(model_asset_path=str(MODELS / "mediapipe" / "pose_landmarker_heavy.task")), running_mode=vision.RunningMode.IMAGE)
    )
    gen = Gen()
    prompt = f"{WALK.format(dir=args.dir)}. Keep exactly the same person, face, hairstyle, clothes and art style as the reference image. {cstyle}, {style}"
    cands = []
    for i in range(args.n):
        img = gen.image(prompt, CHAR_SIZE, 100 + i, refs=[ref])
        lm = landmarks(det, img)
        sc, info = score(lm) if lm else (-9, {"识别": "失败"})
        cands.append((sc, info, img))
        print(f"候选 {i}: {sc:.2f} {info}", flush=True)
    best = max(cands, key=lambda c: c[0])
    best[2].save(folder / f"raw_{args.cid}_walk.png")
    gen.cutout(best[2]).save(folder / f"char_{args.cid}_walk.png")
    # 总览图
    tiles = []
    for sc, info, img in cands:
        t = img.copy()
        t.thumbnail((300, 440))
        dr = ImageDraw.Draw(t)
        dr.rectangle([0, 0, t.width, 22], fill=(0, 0, 0) if img is not best[2] else (200, 30, 30))
        dr.text((4, 4), f"{sc:.2f}", fill=(255, 255, 255))
        tiles.append(t)
    sheet = Image.new("RGB", (sum(t.width for t in tiles), max(t.height for t in tiles)), (30, 30, 40))
    x = 0
    for t in tiles:
        sheet.paste(t, (x, 0))
        x += t.width
    sheet.save(f"/tmp/rigbase_{args.cid}.jpg")
    print("选中：", best[1])


if __name__ == "__main__":
    main()
