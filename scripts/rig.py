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
    4: ("torso", "arm"),  # 上衣（含袖子）
    5: ("torso", "leg"), 6: ("torso", "leg"), 7: ("torso", "arm"), 8: ("torso",),  # 裙子 裤子 连衣裙（含袖子） 腰带
    9: ("leg",), 10: ("leg",),  # 鞋
    12: ("leg",), 13: ("leg",),  # 腿
    14: ("arm",), 15: ("arm",),  # 手臂皮肤/手
    16: ("torso", "arm"),  # 包
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
    bones["torso"] = ([neck, hip], torso_len * 0.36, hip, None)
    bones["head"] = ([neck + (face - neck) * 0.35, head_top], np.linalg.norm(face - neck) * 0.9, neck + (face - neck) * 0.2, "torso")
    axis = (hip - neck) / (torso_len + 1e-6)
    nrm = np.array([-axis[1], axis[0]])
    off = lambda p: abs(float(np.dot(p - neck, nrm))) / torso_len  # 离躯干中线多远
    for tag, s in (("", near), ("_far", far)):
        sh, el, wr = k[f"sh_{s}"], k[f"el_{s}"], k[f"wr_{s}"]
        if tag == "_far" and (off(el) + off(wr)) / 2 < 0.3:
            print("远侧手臂被身体挡住，不单独拆")
            continue
        arm_r = np.linalg.norm(el - sh) * 0.17
        # 骨骼从肩关节往外挪一点：肩膀附近的衣服留给躯干，关节靠圆头重叠盖住
        bones[f"arm{tag}"] = ([sh + (el - sh) * 0.15, el, wr + (wr - el) * 0.4], arm_r, sh, "torso")
    for tag, s in zip(("near", "far"), legs):
        hp, kn, an, toe = k[f"hip_{s}"], k[f"kn_{s}"], k[f"an_{s}"], k[f"toe_{s}"]
        leg_r = np.linalg.norm(kn - hp) * 0.2
        bones[f"leg_{tag}"] = ([hp, kn, an + (toe - an) * 1.5], leg_r, hp, "torso")

    names = list(bones)
    def poly_dist(pts):
        return np.min(np.stack([seg_dist(X, Y, p, q) for p, q in zip(pts[:-1], pts[1:])]), axis=0)

    D = np.stack([poly_dist(b[0]) / b[1] for b in bones.values()])
    # 按部位类别限制可选骨骼：不允许的骨骼距离设为无穷大
    for lab_id, prefixes in LABEL_BONES.items():
        sel = label == lab_id
        if not sel.any():
            continue
        for i, n in enumerate(names):
            if not n.startswith(prefixes):
                D[i][sel] = np.inf
    owner = np.argmin(D, axis=0)
    # 部位分割在同一块布料上会出现斑点状的类别跳变：按邻域多数票平滑一下归属
    vote = np.stack([cv2.GaussianBlur((owner == i).astype(np.float32), (0, 0), 5) for i in range(len(names))])
    owner = np.where(np.isinf(D).all(0), owner, np.argmax(np.where(np.isinf(D), -1, vote), axis=0))
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
        pts = bones[n][0]
        probe = [(p + (q - p) * t).astype(int) for p, q in zip(pts[:-1], pts[1:]) for t in (0.3, 0.6)]
        keep = {lab[min(max(p[1], 0), H - 1), min(max(p[0], 0), W - 1)] for p in probe} - {0}
        if not keep:
            sizes = [(lab == j).sum() for j in range(1, cnt)]
            keep = {int(np.argmax(sizes)) + 1}
        owner[(m > 0) & ~np.isin(lab, list(keep))] = -2  # 碎片：稍后交给最近的部件

    # 去掉部件边缘的细刺：开运算后被去掉的像素交给相邻像素最多的部件
    kern = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (9, 9))
    for i, n in enumerate(names):
        if n == "torso":
            continue
        m = (owner == i).astype(np.uint8)
        thin = (m > 0) & (cv2.morphologyEx(m, cv2.MORPH_OPEN, kern) == 0)
        owner[thin] = -2

    # 碎片和细刺交给离它最近的已归属像素所在的部件（不再一律给躯干，免得躯干被拉到脚边）
    from scipy.ndimage import distance_transform_edt as _edt
    loose = owner == -2
    if loose.any():
        idx = _edt(owner < 0, return_distances=False, return_indices=True)
        owner[loose] = owner[idx[0][loose], idx[1][loose]]

    out = folder / f"rig_{args.cid}"
    out.mkdir(exist_ok=True)
    for f in out.glob("*.png"):
        f.unlink()
    from scipy.ndimage import binary_fill_holes, distance_transform_edt

    def nn_fill(mask):
        """把 mask 以外的像素填成「最近的 mask 内部像素」的颜色（先去掉 6px 边缘，避开深色描边）"""
        inner = cv2.erode(mask.astype(np.uint8), cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (13, 13))) > 0
        if inner.sum() < 50:
            inner = mask
        idx = distance_transform_edt(~inner, return_distances=False, return_indices=True)
        return rgb[idx[0], idx[1]]

    order = ["arm_far", "leg_far", "torso", "head", "leg_near", "arm"]
    if args.dress:  # 腿的上半段藏在裙子里：两条腿都画在裙子后面
        order = ["arm_far", "leg_far", "leg_near", "torso", "head", "arm"]
    order = [o for o in order if o in names]
    rank = {n: i for i, n in enumerate(order)}
    masks = {n: owner == i for i, n in enumerate(names)}
    edt = {n: distance_transform_edt(masks[n]) for n in names}
    torso_len_ = torso_len

    def seg_width(n, p, q):
        """沿骨骼中段量部件半宽（距离变换取中位数）"""
        vals = []
        for t in (0.35, 0.5, 0.65, 0.8):
            c = (p + (q - p) * t).astype(int)
            if 0 <= c[0] < W and 0 <= c[1] < H and edt[n][c[1], c[0]] > 2:
                vals.append(edt[n][c[1], c[0]])
        return float(np.median(vals)) if vals else None

    # 四肢「胶囊」：从关节点出发沿骨骼的圆头长条，半径 = 量到的肢体半宽。
    # 前面的肢体用它从躯干上把肩/胯处的布料整块切走（圆头 → 转动时关节永远被盖住）；
    # 后面的肢体用它把被遮住的部分补齐（转出来时不缺块）
    capsule = {}
    for n in names:
        if n in ("torso", "head"):
            continue
        pts, r0, j = bones[n][0], bones[n][1], bones[n][2]
        chain = [j] + list(pts[1:])
        if n.startswith("arm"):  # 手臂的胶囊只到手腕，手掌本身已经归手臂，免得把衣服拖出一截尖角
            chain[2] = (pts[1] + (pts[2] - pts[1]) / 1.4)
        w2 = seg_width(n, chain[1], chain[2]) or r0
        w1 = float(np.clip(seg_width(n, chain[0], chain[1]) or r0, w2 * 1.15, w2 * 1.3))
        if args.dress and n.startswith("leg"):
            w1 = w2 * 1.05  # 裙子里的大腿：和小腿一样细，迈步时不从裙摆后面鼓出来
        capsule[n] = (seg_dist(X, Y, chain[0], chain[1]) < w1 * 1.1) | (seg_dist(X, Y, chain[1], chain[2]) < w2 * 1.15)
        # 离骨骼太远的零碎像素不要（多半是相邻部位的描边）
        wide = (seg_dist(X, Y, chain[0], chain[1]) < w1 * 1.6) | (seg_dist(X, Y, chain[1], pts[2]) < w2 * 1.8)
        if n.startswith("arm"):
            masks[n] &= wide
            # 手腕以外只要皮肤（手），衣服归躯干
            el_, wr_ = pts[1], chain[2]
            d_ = wr_ - el_
            beyond = ((X - wr_[0]) * d_[0] + (Y - wr_[1]) * d_[1]) > 0
            stray = masks[n] & beyond & ~np.isin(label, [14, 15])
            masks[n] &= ~stray
            masks["torso"] |= stray
        print(f"  {n}: 半宽 {w1:.0f}/{w2:.0f}px")

    keep_rgb = {n: masks[n].copy() for n in names}  # 用原图像素
    fill = {n: np.zeros_like(fg) for n in names}  # 用补色像素
    torso_m = masks["torso"].copy()
    for n, cap in capsule.items():  # 前面的肢体先从躯干上整块切走
        if rank[n] > rank["torso"]:
            from_torso = cap & fg & masks["torso"]
            keep_rgb[n] |= from_torso
            torso_m &= ~from_torso
    # 躯干主体：大核开运算，去掉夹在肢体之间的尖角
    ksz = int(torso_len_ * 0.2) | 1
    core = cv2.morphologyEx(torso_m.astype(np.uint8), cv2.MORPH_OPEN, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (ksz, ksz))) > 0
    for n, cap in capsule.items():
        if rank[n] < rank["torso"]:
            from_torso = cap & fg & masks["torso"]
            fill[n] |= from_torso
            torso_m &= ~(from_torso & ~core)  # 躯干尖角其实是这条肢体
    for n, cap in capsule.items():
        front_of_n = np.zeros_like(fg)
        for o in names:  # 被画在它前面的部件（含头发）挡住的部分：用本肢体的颜色补
            if o != n and rank[o] > rank[n]:
                front_of_n |= masks[o]
                if o != "torso":
                    fill[n] |= cap & fg & masks[o]
        # 紧贴前面部件的一圈多半是对方的描边/阴影：也换成肢体自己的颜色，转出来时没有黑边
        band = cv2.dilate(front_of_n.astype(np.uint8), cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (11, 11))) > 0
        moved = keep_rgb[n] & band & cap
        keep_rgb[n] &= ~moved
        fill[n] |= moved
    # 头：脖子附近的像素复制一份给躯干垫在头下面，低头/抬头时不露缝
    hj = bones["head"][2]
    neck_r = np.linalg.norm(face - neck) * 0.45
    torso_extra = masks["head"] & (np.hypot(X - hj[0], Y - hj[1]) < neck_r) & np.isin(label, [11, 14, 15])
    # 躯干：被前面肢体切走的地方在躯干轮廓范围内补满
    # 去掉主体以外的细刺和碎片
    torso_m &= cv2.dilate(core.astype(np.uint8), cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (ksz // 3 | 1, ksz // 3 | 1))) > 0
    cnt, lab = cv2.connectedComponents(torso_m.astype(np.uint8))
    if cnt > 2:
        sizes = np.bincount(lab.ravel())[1:]
        torso_m = np.isin(lab, 1 + np.where(sizes > sizes.max() * 0.03)[0])
    hull = np.zeros(fg.shape, np.uint8)
    cv2.fillConvexPoly(hull, cv2.convexHull(cv2.findNonZero(core.astype(np.uint8))), 1)
    cut = np.zeros_like(fg)
    for n in capsule:
        if rank[n] > rank["torso"]:
            cut |= keep_rgb[n]
    fill["torso"] = ((hull > 0) & fg & cut) | (binary_fill_holes(torso_m | torso_extra) & ~torso_m & ~torso_extra)
    keep_rgb["torso"] = torso_m | torso_extra

    parts = {}
    colors = np.random.default_rng(1).integers(60, 255, (len(names), 3))
    debug = (rgb * 0.35).astype(np.uint8)
    for i, n in enumerate(names):
        m = keep_rgb[n]
        f = fill[n] & ~m
        full = m | f
        if not full.any():
            continue
        debug[m] = (debug[m] + colors[i] * 0.65).astype(np.uint8)
        debug[f] = (debug[f] + colors[i] * 0.35).astype(np.uint8)
        src_m = masks[n] & ~np.isin(label, [2, 11, 12, 13, 14, 15]) if n == "torso" else masks[n]
        src_m = src_m if src_m.sum() > 200 else masks[n]
        lum = rgb.mean(-1)
        if src_m.sum() > 200:  # 描边、阴影这类最暗的像素不拿来补色
            src_m = src_m & (lum >= np.percentile(lum[src_m], 20))
        color = nn_fill(src_m)
        color = cv2.GaussianBlur(color, (0, 0), 6)  # 补出来的部分柔化，去掉拉丝
        col = np.where(m[..., None], rgb, color)
        own = masks[n] | (n == "torso") & torso_extra
        alpha = np.where(own, a, 1.0) * full
        ys, xs = np.where(full)
        x0, y0, x1, y1 = xs.min(), ys.min(), xs.max() + 1, ys.max() + 1
        rgba = np.dstack([col, (alpha * 255).clip(0, 255)]).astype(np.uint8)[y0:y1, x0:x1]
        Image.fromarray(rgba).save(out / f"{n}.png")
        j = bones[n][2]
        parts[n] = {"file": f"{n}.png", "x": int(x0), "y": int(y0), "w": int(x1 - x0), "h": int(y1 - y0), "pivot": [float(j[0]), float(j[1])], "parent": bones[n][3]}
    Image.fromarray(debug).save(out / "debug.jpg")

    hand = bones["arm"][0][-1]
    rig = {"size": list(raw.size), "facing": facing, "ground": float(max(k["an_l"][1], k["an_r"][1]) + 25),
           "order": [o for o in order if o in parts], "parts": parts,
           "keypoints": {kk: [float(v[0]), float(v[1])] for kk, v in k.items()}, "hand": [float(hand[0]), float(hand[1])],
           "feet": {t: [float(v) for v in bones[f"leg_{t}"][0][-1]] for t in ("near", "far")}}
    (out / "rig.json").write_text(json.dumps(rig, ensure_ascii=False, indent=1))
    print(f"{args.cid}: 部件 {rig['order']}，朝向={'右' if facing > 0 else '左'}")


if __name__ == "__main__":
    main()
