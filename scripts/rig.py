"""把一张 AI 生成的「侧面迈步全身像」自动拆成可动部件，输出骨骼描述。

  流程：
    1. BiRefNet 抠图；MediaPipe 识别关节
    2. 部位分割（SegFormer clothes）：每个像素是头发/脸/上衣/裤子/裙子/鞋/手臂皮肤/腿皮肤
    3. 在「该类别允许的骨骼」里，把像素归给归一化距离最近的那根骨骼
       头发、脸 → 头；鞋 → 小腿；手臂皮肤 → 手臂；腿皮肤 → 腿；上衣 → 躯干或手臂；裤子 → 躯干或腿
    4. 每个部件只保留与骨骼相连的那一块，碎片交回躯干；关节处补一圈重叠，转动时不露缝
  底图请先用 scripts/rigbase.py 挑选（头部严格侧面、四肢彼此分开）。

用法：~/imggen/.venv/bin/python scripts/rig.py <图片目录> <角色id> [--dress]
  读取 <目录>/raw_<角色>_walk.png，写出 <目录>/rig_<角色>/*.png、rig.json 和检查图 debug.jpg
"""
import argparse
import json
from pathlib import Path

import cv2
import mediapipe as mp
import numpy as np
import torch
from mediapipe.tasks.python import BaseOptions, vision
from PIL import Image

MODELS = Path.home() / "imggen" / "models"
IDX = {"nose": 0, "eye_l": 2, "eye_r": 5, "ear_l": 7, "ear_r": 8, "sh_l": 11, "sh_r": 12, "el_l": 13, "el_r": 14, "wr_l": 15, "wr_r": 16,
       "hip_l": 23, "hip_r": 24, "kn_l": 25, "kn_r": 26, "an_l": 27, "an_r": 28, "toe_l": 31, "toe_r": 32}
# SegFormer clothes 的类别 → 允许归属的骨骼前缀
LABEL_BONES = {
    1: ("head",), 2: ("head",), 3: ("head",), 11: ("head",), 17: ("head", "torso"),  # 帽子 头发 墨镜 脸 围巾
    4: ("torso", "uarm", "farm"),  # 上衣（含袖子）
    5: ("torso", "thigh"), 6: ("torso", "thigh", "shin"), 7: ("torso", "uarm", "farm"), 8: ("torso",),  # 裙子 裤子 连衣裙（含袖子） 腰带
    9: ("shin",), 10: ("shin",),  # 鞋
    12: ("thigh", "shin"), 13: ("thigh", "shin"),  # 腿
    14: ("uarm", "farm"), 15: ("uarm", "farm"),  # 手臂皮肤/手
    16: ("torso", "uarm", "farm"),  # 包
}


def alpha_of(img: Image.Image) -> np.ndarray:
    from torchvision import transforms
    from transformers import AutoModelForImageSegmentation

    seg = AutoModelForImageSegmentation.from_pretrained(MODELS / "birefnet", trust_remote_code=True).to("cuda").eval().half()
    tf = transforms.Compose([transforms.Resize((1024, 1024)), transforms.ToTensor(), transforms.Normalize([0.485, 0.456, 0.406], [0.229, 0.224, 0.225])])
    with torch.no_grad():
        m = seg(tf(img).unsqueeze(0).to("cuda").half())[-1].sigmoid().cpu()[0, 0].float().numpy()
    return cv2.resize(m, img.size, interpolation=cv2.INTER_LINEAR)


def parse(img: Image.Image) -> np.ndarray:
    from transformers import AutoModelForSemanticSegmentation, SegformerImageProcessor

    path = MODELS / "segformer-clothes"
    proc = SegformerImageProcessor.from_pretrained(path)
    model = AutoModelForSemanticSegmentation.from_pretrained(path).cuda().eval()
    with torch.no_grad():
        lg = model(**{k: v.cuda() for k, v in proc(images=img, return_tensors="pt").items()}).logits
    return torch.nn.functional.interpolate(lg, size=img.size[::-1], mode="bilinear").argmax(1)[0].cpu().numpy()


def keypoints(rgb: np.ndarray):
    det = vision.PoseLandmarker.create_from_options(
        vision.PoseLandmarkerOptions(base_options=BaseOptions(model_asset_path=str(MODELS / "mediapipe" / "pose_landmarker_heavy.task")), running_mode=vision.RunningMode.IMAGE)
    )
    r = det.detect(mp.Image(image_format=mp.ImageFormat.SRGB, data=rgb))
    if not r.pose_landmarks:
        raise SystemExit("没有识别到人体关节")
    h, w = rgb.shape[:2]
    lm = r.pose_landmarks[0]
    return {k: np.array([lm[i].x * w, lm[i].y * h]) for k, i in IDX.items()}, {k: lm[i].z for k, i in IDX.items()}


def seg_dist(X, Y, a, b):
    """所有像素到线段 a-b 的距离"""
    d = b - a
    L = float(np.dot(d, d)) + 1e-6
    t = np.clip(((X - a[0]) * d[0] + (Y - a[1]) * d[1]) / L, 0, 1)
    return np.hypot(X - (a[0] + t * d[0]), Y - (a[1] + t * d[1]))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("folder")
    ap.add_argument("cid")
    ap.add_argument("--dress", action="store_true", help="穿裙子：大腿藏在裙子里，腿只拆膝盖以下")
    args = ap.parse_args()
    folder = Path(args.folder)
    raw = Image.open(folder / f"raw_{args.cid}_walk.png").convert("RGB")
    rgb = np.array(raw)
    a = alpha_of(raw)
    fg = a > 0.5
    label = parse(raw)
    k, z = keypoints(rgb)
    H, W = fg.shape
    Y, X = np.mgrid[0:H, 0:W].astype(np.float32)

    near = "l" if z["sh_l"] < z["sh_r"] else "r"
    far = "r" if near == "l" else "l"
    legs = sorted(["l", "r"], key=lambda s: z[f"hip_{s}"] + z[f"kn_{s}"] + z[f"an_{s}"])  # [近, 远]
    hip = (k["hip_l"] + k["hip_r"]) / 2
    neck = (k["sh_l"] + k["sh_r"]) / 2
    face = (k["ear_l"] + k["ear_r"] + k["nose"]) / 3
    facing = 1 if k["nose"][0] > (k["ear_l"][0] + k["ear_r"][0]) / 2 else -1
    torso_len = np.linalg.norm(neck - hip)
    head_top = face + (face - neck) * 0.7

    # 骨骼：名称 → (起点, 终点, 归一化半径, 关节点, 父部件)
    bones = {}
    bones["torso"] = (neck, hip, torso_len * 0.3, hip, None)
    bones["head"] = (neck + (face - neck) * 0.35, head_top, np.linalg.norm(face - neck) * 0.9, neck + (face - neck) * 0.2, "torso")
    axis = (hip - neck) / (torso_len + 1e-6)
    nrm = np.array([-axis[1], axis[0]])
    off = lambda p: abs(float(np.dot(p - neck, nrm))) / torso_len  # 离躯干中线多远
    for tag, s in (("", near), ("_far", far)):
        sh, el, wr = k[f"sh_{s}"], k[f"el_{s}"], k[f"wr_{s}"]
        if tag == "_far" and (off(el) + off(wr)) / 2 < 0.3:
            print("远侧手臂被身体挡住，不单独拆")
            continue
        arm_r = np.linalg.norm(el - sh) * 0.22
        bones[f"uarm{tag}"] = (sh, el, arm_r, sh, "torso")
        bones[f"farm{tag}"] = (el, wr + (wr - el) * 0.4, arm_r * 0.95, el, f"uarm{tag}")
    for tag, s in zip(("near", "far"), legs):
        hp, kn, an, toe = k[f"hip_{s}"], k[f"kn_{s}"], k[f"an_{s}"], k[f"toe_{s}"]
        leg_r = np.linalg.norm(kn - hp) * 0.2
        foot = an + (toe - an) * 1.5
        if not args.dress:
            bones[f"thigh_{tag}"] = (hp, kn, leg_r, hp, "torso")
            bones[f"shin_{tag}"] = (kn, foot, leg_r * 0.85, kn, f"thigh_{tag}")
        else:
            bones[f"shin_{tag}"] = (kn, foot, leg_r * 0.85, kn, "torso")

    names = list(bones)
    D = np.stack([seg_dist(X, Y, b[0], b[1]) / b[2] for b in bones.values()])
    # 按部位类别限制可选骨骼：不允许的骨骼距离设为无穷大
    for lab_id, prefixes in LABEL_BONES.items():
        sel = label == lab_id
        if not sel.any():
            continue
        for i, n in enumerate(names):
            if not n.startswith(prefixes):
                D[i][sel] = np.inf
    owner = np.argmin(D, axis=0)
    owner[~fg] = -1

    # 每个部件只保留与骨骼相连的那一块，碎片交回躯干
    torso_i = names.index("torso")
    for i, n in enumerate(names):
        if n == "torso":
            continue
        m = (owner == i).astype(np.uint8)
        cnt, lab = cv2.connectedComponents(m)
        if cnt <= 2:
            continue
        a0, a1 = bones[n][0], bones[n][1]
        probe = [(a0 + (a1 - a0) * t).astype(int) for t in (0.2, 0.4, 0.6, 0.8)]
        keep = {lab[min(max(p[1], 0), H - 1), min(max(p[0], 0), W - 1)] for p in probe} - {0}
        if not keep:
            sizes = [(lab == j).sum() for j in range(1, cnt)]
            keep = {int(np.argmax(sizes)) + 1}
        owner[(m > 0) & ~np.isin(lab, list(keep))] = torso_i

    out = folder / f"rig_{args.cid}"
    out.mkdir(exist_ok=True)
    for f in out.glob("*.png"):
        f.unlink()
    parts = {}
    colors = np.random.default_rng(1).integers(60, 255, (len(names), 3))
    debug = (rgb * 0.35).astype(np.uint8)
    for i, n in enumerate(names):
        m = owner == i
        debug[m] = (debug[m] + colors[i] * 0.65).astype(np.uint8)
        j = bones[n][3]
        # 关节处补一圈重叠：子部件额外带上关节附近的父部件像素
        if bones[n][4]:
            rj = bones[n][2] * (0.3 if n == 'head' else 0.85)  # 脖子处只要一小圈
            m = m | (fg & (np.hypot(X - j[0], Y - j[1]) < rj) & (owner == names.index(bones[n][4])))
        ys, xs = np.where(m)
        if len(xs) == 0:
            continue
        x0, y0, x1, y1 = xs.min(), ys.min(), xs.max() + 1, ys.max() + 1
        rgba = np.dstack([rgb, (a * m * 255).clip(0, 255)]).astype(np.uint8)[y0:y1, x0:x1]
        Image.fromarray(rgba).save(out / f"{n}.png")
        parts[n] = {"file": f"{n}.png", "x": int(x0), "y": int(y0), "w": int(x1 - x0), "h": int(y1 - y0), "pivot": [float(j[0]), float(j[1])], "parent": bones[n][4]}
    Image.fromarray(debug).save(out / "debug.jpg")

    order = ["farm_far", "uarm_far", "thigh_far", "shin_far", "torso", "head", "thigh_near", "shin_near", "uarm", "farm"]
    hand = bones["farm"][1]
    rig = {"size": list(raw.size), "facing": facing, "ground": float(max(k["an_l"][1], k["an_r"][1]) + 25),
           "order": [o for o in order if o in parts], "parts": parts,
           "keypoints": {kk: [float(v[0]), float(v[1])] for kk, v in k.items()}, "hand": [float(hand[0]), float(hand[1])]}
    (out / "rig.json").write_text(json.dumps(rig, ensure_ascii=False, indent=1))
    print(f"{args.cid}: 部件 {rig['order']}，朝向={'右' if facing > 0 else '左'}")


if __name__ == "__main__":
    main()
