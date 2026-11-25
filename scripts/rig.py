"""把一张 AI 生成的「侧面迈步全身像」自动拆成可动部件，输出骨骼描述。

  流程：BiRefNet 抠图 → MediaPipe 识别关节 → 沿骨骼切出头 / 近侧手臂 / 两条腿 → 躯干补洞 → rig.json
  部件在关节处留圆形重叠，旋转时不露缝；远侧手臂在侧面基本被身体挡住，留在躯干上。

用法：~/imggen/.venv/bin/python scripts/rig.py <图片目录> <角色id> [--dress]
  读取 <目录>/raw_<角色>_walk.png，写出 <目录>/rig_<角色>/*.png 和 rig.json
"""
import argparse
import json
import math
from pathlib import Path

import cv2
import mediapipe as mp
import numpy as np
import torch
from mediapipe.tasks.python import BaseOptions, vision
from PIL import Image

MODELS = Path.home() / "imggen" / "models"
IDX = {"nose": 0, "ear_l": 7, "ear_r": 8, "sh_l": 11, "sh_r": 12, "el_l": 13, "el_r": 14, "wr_l": 15, "wr_r": 16,
       "hip_l": 23, "hip_r": 24, "kn_l": 25, "kn_r": 26, "an_l": 27, "an_r": 28, "toe_l": 31, "toe_r": 32}


def alpha_of(img: Image.Image) -> np.ndarray:
    from torchvision import transforms
    from transformers import AutoModelForImageSegmentation

    seg = AutoModelForImageSegmentation.from_pretrained(MODELS / "birefnet", trust_remote_code=True).to("cuda").eval().half()
    tf = transforms.Compose([transforms.Resize((1024, 1024)), transforms.ToTensor(), transforms.Normalize([0.485, 0.456, 0.406], [0.229, 0.224, 0.225])])
    with torch.no_grad():
        m = seg(tf(img).unsqueeze(0).to("cuda").half())[-1].sigmoid().cpu()[0, 0].float().numpy()
    return cv2.resize(m, img.size, interpolation=cv2.INTER_LINEAR)


def keypoints(rgb: np.ndarray):
    opt = vision.PoseLandmarkerOptions(base_options=BaseOptions(model_asset_path=str(MODELS / "mediapipe" / "pose_landmarker_heavy.task")), running_mode=vision.RunningMode.IMAGE)
    det = vision.PoseLandmarker.create_from_options(opt)
    r = det.detect(mp.Image(image_format=mp.ImageFormat.SRGB, data=rgb))
    if not r.pose_landmarks:
        raise SystemExit("没有识别到人体关节")
    h, w = rgb.shape[:2]
    lm = r.pose_landmarks[0]
    return {k: np.array([lm[i].x * w, lm[i].y * h]) for k, i in IDX.items()}, {k: lm[i].z for k, i in IDX.items()}


def width_at(alpha, a, b, t=0.5, maxw=200):
    """沿骨骼 a→b 在 t 处，测量轮廓的垂直宽度"""
    p = a + (b - a) * t
    d = (b - a) / (np.linalg.norm(b - a) + 1e-6)
    n = np.array([-d[1], d[0]])
    def run(sign):
        for s in range(1, maxw):
            q = (p + n * s * sign).astype(int)
            if not (0 <= q[0] < alpha.shape[1] and 0 <= q[1] < alpha.shape[0]) or alpha[q[1], q[0]] < 0.5:
                return s
        return maxw
    return run(1) + run(-1)


def capsule(shape, pts, r):
    m = np.zeros(shape, np.uint8)
    for a, b in zip(pts[:-1], pts[1:]):
        cv2.line(m, tuple(map(int, a)), tuple(map(int, b)), 255, int(r * 2))
    for p in pts:
        cv2.circle(m, tuple(map(int, p)), int(r), 255, -1)
    return m


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("folder")
    ap.add_argument("cid")
    ap.add_argument("--dress", action="store_true", help="穿裙子：大腿藏在裙子里，只拆膝盖以下")
    args = ap.parse_args()
    folder = Path(args.folder)
    raw = Image.open(folder / f"raw_{args.cid}_walk.png").convert("RGB")
    rgb = np.array(raw)
    a = alpha_of(raw)
    A = (a > 0.5).astype(np.uint8) * 255
    k, z = keypoints(rgb)

    # 前后：MediaPipe 的 z 越小越靠近镜头；手臂只拆近侧那只
    near_arm = "l" if z["sh_l"] < z["sh_r"] else "r"
    legs = sorted(["l", "r"], key=lambda s: z[f"hip_{s}"] + z[f"kn_{s}"] + z[f"an_{s}"])  # [近, 远]
    hip = (k["hip_l"] + k["hip_r"]) / 2
    neck = (k["sh_l"] + k["sh_r"]) / 2
    face = (k["ear_l"] + k["ear_r"]) / 2
    facing = 1 if k["nose"][0] > face[0] else -1

    parts = {}

    def take(name, mask, pivot, parent, child_pivot=None):
        m = cv2.bitwise_and(mask, A)
        ys, xs = np.where(m > 0)
        if len(xs) == 0:
            return
        x0, y0, x1, y1 = xs.min(), ys.min(), xs.max() + 1, ys.max() + 1
        rgba = np.dstack([rgb, (a * (m > 0)).clip(0, 1) * 255]).astype(np.uint8)[y0:y1, x0:x1]
        Image.fromarray(rgba).save(out / f"{name}.png")
        parts[name] = {"file": f"{name}.png", "x": int(x0), "y": int(y0), "w": int(x1 - x0), "h": int(y1 - y0),
                       "pivot": [float(pivot[0]), float(pivot[1])], "parent": parent}

    out = folder / f"rig_{args.cid}"
    out.mkdir(exist_ok=True)
    used = np.zeros_like(A)

    # 腿：近腿在躯干前，远腿在躯干后
    for tag, s in zip(("near", "far"), legs):
        h_, kn, an, toe = k[f"hip_{s}"], k[f"kn_{s}"], k[f"an_{s}"], k[f"toe_{s}"]
        r_th = float(np.clip(width_at(a, h_, kn, 0.6) * 0.55, 16, np.linalg.norm(kn - h_) * 0.22))
        r_sh = float(np.clip(width_at(a, kn, an, 0.5) * 0.62, 12, np.linalg.norm(an - kn) * 0.2))
        foot = an + (toe - an) * 1.4
        shin = capsule(A.shape, [kn, an, foot], r_sh)
        if args.dress:
            take(f"shin_{tag}", shin, kn, "torso")
        else:
            thigh = capsule(A.shape, [h_, kn], r_th)
            thigh[: int(h_[1] + r_th * 0.2)] = 0  # 只要髋部以下，不带走躯干
            take(f"thigh_{tag}", cv2.bitwise_and(thigh, cv2.bitwise_not(shin)), h_, "torso")
            take(f"shin_{tag}", shin, kn, f"thigh_{tag}")
            used |= thigh
        used |= shin

    # 近侧手臂：大臂 + 小臂（含手）
    s = near_arm
    sh_, el, wr = k[f"sh_{s}"], k[f"el_{s}"], k[f"wr_{s}"]
    r_ua = float(np.clip(width_at(a, sh_, el) * 0.5, 14, np.linalg.norm(el - sh_) * 0.24))
    hand = wr + (wr - el) * 0.35
    fore = capsule(A.shape, [el, wr, hand], r_ua * 0.9)
    upper = cv2.bitwise_and(capsule(A.shape, [sh_, el], r_ua), cv2.bitwise_not(fore))
    take("uarm", upper, sh_, "torso")
    take("farm", fore, el, "uarm")
    arm_mask = upper | fore

    # 头：以耳朵为中心的圆，截到脖子以上
    head_r = np.linalg.norm(face - neck) * 1.05
    head = np.zeros_like(A)
    cv2.circle(head, tuple(map(int, face)), int(head_r), 255, -1)
    cut = np.zeros_like(A)
    cut[: int(neck[1] - head_r * 0.15)] = 255
    head &= cut
    neck_pt = neck + (face - neck) * 0.25
    take("head", head, neck_pt, "torso")

    # 躯干：剩下的部分；被手臂、腿挡住的区域用周围颜色补上（部件转开时不露洞）
    body = cv2.bitwise_and(A, cv2.bitwise_not(head))
    legs_only = used.copy()
    legs_only[: int(hip[1] + 10)] = 0
    body = cv2.bitwise_and(body, cv2.bitwise_not(legs_only))
    body = cv2.bitwise_and(body, cv2.bitwise_not(cv2.bitwise_and(arm_mask, cv2.bitwise_not(capsule(A.shape, [neck, hip], np.linalg.norm(neck - hip) * 0.22)))))
    hole = cv2.bitwise_and(arm_mask, body)
    filled = cv2.inpaint(rgb, hole, 15, cv2.INPAINT_TELEA)
    ys, xs = np.where(body > 0)
    x0, y0, x1, y1 = xs.min(), ys.min(), xs.max() + 1, ys.max() + 1
    rgba = np.dstack([filled, (body > 0) * 255]).astype(np.uint8)[y0:y1, x0:x1]
    Image.fromarray(rgba).save(out / "torso.png")
    parts["torso"] = {"file": "torso.png", "x": int(x0), "y": int(y0), "w": int(x1 - x0), "h": int(y1 - y0), "pivot": [float(hip[0]), float(hip[1])], "parent": None}

    feet_y = float(max(k["an_l"][1], k["an_r"][1]) + 25)
    order = ["thigh_far", "shin_far", "torso", "head", "thigh_near", "shin_near", "uarm", "farm"]
    rig = {"size": list(raw.size), "facing": facing, "ground": feet_y, "order": [o for o in order if o in parts], "parts": parts,
           "keypoints": {kk: [float(v[0]), float(v[1])] for kk, v in k.items()},
           "hand": [float(wr[0]), float(wr[1])]}
    (out / "rig.json").write_text(json.dumps(rig, ensure_ascii=False, indent=1))
    print(f"{args.cid}: 部件 {rig['order']}，近侧手臂={near_arm}，朝向={'右' if facing > 0 else '左'}")


if __name__ == "__main__":
    main()
