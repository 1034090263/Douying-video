"""把一张 AI 生成的「侧面迈步全身像」拆成 6 个可动部件（头、躯干、两臂、两腿），输出骨骼描述。

  思路：让生图模型自己画出「被挡住的部分」，而不是靠猜。
    1. 原图 O：MediaPipe 关节 + BiRefNet 抠图 + SegFormer 部位分割（只用来认头）
    2. 图层 A：同一张图「去掉两只手臂」（FLUX.2 klein 参考图编辑，像素级对齐）
       → O 与 A 的差异 = 两只手臂的精确轮廓；A 里躯干的侧面、肩膀是完整画出来的
    3. 图层 B：A 再「去掉两条腿」→ A 与 B 的差异 = 两条腿；B 就是完整的躯干（含衣服下摆、裤裙）
    4. 组装：头、近侧手臂、近侧腿用原图像素；躯干在原图可见处用原图像素，被四肢/头挡住处用 B 的像素
       前面的肢体以关节为圆心带一个与肢体等宽的圆头，转动时永远盖住关节
       远侧手臂/腿在原图里大半被挡住，直接用近侧肢体的拷贝（转到远侧原来的角度、压暗），保证完整
    5. 自检：静止姿势与原图一致（最上层的部件一律用原图像素；远侧肢体除外）
  每个编辑生成几张候选，按「其他部位没被改动 + 该去掉的确实去掉了」自动打分挑最好的，结果缓存为
  raw_<角色>_noarms.png / raw_<角色>_nolimbs.png（加 --regen 重新生成）。
  底图请先用 scripts/rigbase.py 挑选（头部严格侧面、四肢彼此分开）。

用法：~/imggen/.venv/bin/python scripts/rig.py <图片目录> <角色id> [--dress] [--regen] [--n 3]
  读取 <目录>/raw_<角色>_walk.png，写出 <目录>/rig_<角色>/*.png、rig.json 和检查图 debug.jpg
"""
import argparse
import json
import sys
from pathlib import Path

import cv2
import mediapipe as mp
import numpy as np
import torch
from mediapipe.tasks.python import BaseOptions, vision
from PIL import Image
from scipy.ndimage import binary_fill_holes, distance_transform_edt

MODELS = Path.home() / "imggen" / "models"
IDX = {"nose": 0, "eye_l": 2, "eye_r": 5, "ear_l": 7, "ear_r": 8, "sh_l": 11, "sh_r": 12, "el_l": 13, "el_r": 14, "wr_l": 15, "wr_r": 16,
       "hip_l": 23, "hip_r": 24, "kn_l": 25, "kn_r": 26, "an_l": 27, "an_r": 28, "toe_l": 31, "toe_r": 32}
HEAD_LABELS = [1, 2, 3, 11]  # SegFormer clothes：帽子 头发 墨镜 脸

NOARMS = ("Edit the image: remove both arms of the person completely, so the whole side of the torso and clothes is visible "
          "with a clean shoulder. Keep everything else exactly the same: same pose, same head, same legs, same position, "
          "same background, same art style.")
NOLEGS = ("Edit the image: erase the person's legs, socks and shoes and paint the background there instead. "
          "Do not change anything else: the head, upper body and clothes stay exactly in the same place and look the same.")

_birefnet = None


def alpha_of(img: Image.Image):
    global _birefnet
    from torchvision import transforms
    from transformers import AutoModelForImageSegmentation

    if _birefnet is None:
        _birefnet = AutoModelForImageSegmentation.from_pretrained(MODELS / "birefnet", trust_remote_code=True).to("cuda").eval().half()
    tf = transforms.Compose([transforms.Resize((1024, 1024)), transforms.ToTensor(), transforms.Normalize([0.485, 0.456, 0.406], [0.229, 0.224, 0.225])])
    with torch.no_grad():
        m = _birefnet(tf(img).unsqueeze(0).to("cuda").half())[-1].sigmoid().cpu()[0, 0].float().numpy()
    a = cv2.resize(m, img.size, interpolation=cv2.INTER_LINEAR)
    fg = binary_fill_holes(a > 0.5)  # 抠图偶尔会把眼白之类的封闭区域抠透：轮廓内的洞全部补实
    return np.where(fg & (a <= 0.5), 1.0, a), fg


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


def img_diff(a: np.ndarray, b: np.ndarray) -> np.ndarray:
    """两张图的逐像素差异（先轻微模糊，忽略编辑带来的细小噪点）"""
    fa = cv2.GaussianBlur(a.astype(np.float32), (0, 0), 1.5)
    fb = cv2.GaussianBlur(b.astype(np.float32), (0, 0), 1.5)
    return np.abs(fa - fb).mean(-1)


def kern(r):
    return cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (2 * r + 1, 2 * r + 1))


def nn_color(img: np.ndarray, mask: np.ndarray) -> np.ndarray:
    """每个像素取「最近的 mask 内部像素」的颜色（先去掉 6px 边缘，避开深色描边）"""
    inner = cv2.erode(mask.astype(np.uint8), kern(6)) > 0
    if inner.sum() < 50:
        inner = mask
    idx = distance_transform_edt(~inner, return_distances=False, return_indices=True)
    return img[idx[0], idx[1]]


def removed_mask(before, after, fg_before, fg_after, zone, bone_core) -> np.ndarray:
    """编辑前后消失的部分：差异大或从前景变成背景；只看指定区域，只留碰到骨骼中心线的块，补洞、去毛刺"""
    m = ((img_diff(before, after) > 28) | (fg_before & ~fg_after)) & fg_before & zone
    m = cv2.morphologyEx(m.astype(np.uint8), cv2.MORPH_CLOSE, kern(5)) > 0
    m = binary_fill_holes(m)
    m = cv2.morphologyEx(m.astype(np.uint8), cv2.MORPH_OPEN, kern(3)) > 0
    cnt, lab = cv2.connectedComponents(m.astype(np.uint8))
    keep = set(np.unique(lab[bone_core & m])) - {0}
    return np.isin(lab, list(keep)) & fg_before


def best_edit(gen, src: Image.Image, prompt: str, n: int, zone_change, zone_keep, fg_mask):
    """生成 n 张编辑候选：要去掉的区域差异越大、其余区域越不变越好"""
    srcA = np.array(src)
    best = None
    for seed in range(1, n + 1):
        im = gen.image(prompt, src.size, seed, refs=[src])
        d = img_diff(srcA, np.array(im))
        removed = float((d[zone_change & fg_mask] > 28).mean())
        drift = float(d[zone_keep & fg_mask].mean())
        score = removed * 100 - drift * 2
        print(f"    候选 {seed}: 去掉 {removed:.0%}，其余改动 {drift:.1f} → {score:.1f}", flush=True)
        if best is None or score > best[0]:
            best = (score, im)
    return best[1]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("folder")
    ap.add_argument("cid")
    ap.add_argument("--dress", action="store_true", help="穿裙子：两条腿都画在裙子后面")
    ap.add_argument("--regen", action="store_true", help="重新生成去手臂/去腿图层")
    ap.add_argument("--n", type=int, default=3, help="每个编辑生成几张候选")
    args = ap.parse_args()
    folder = Path(args.folder)
    raw = Image.open(folder / f"raw_{args.cid}_walk.png").convert("RGB")
    O = np.array(raw)
    k, z = keypoints(O)
    H, W = O.shape[:2]
    Y, X = np.mgrid[0:H, 0:W].astype(np.float32)

    # ---------- 骨骼 ----------
    near = "l" if z["sh_l"] < z["sh_r"] else "r"
    far = "r" if near == "l" else "l"
    legs = sorted(["l", "r"], key=lambda s: z[f"hip_{s}"] + z[f"kn_{s}"] + z[f"an_{s}"])  # [近, 远]
    hip = (k["hip_l"] + k["hip_r"]) / 2
    neck = (k["sh_l"] + k["sh_r"]) / 2
    face = (k["ear_l"] + k["ear_r"] + k["nose"]) / 3
    facing = 1 if k["nose"][0] > (k["ear_l"][0] + k["ear_r"][0]) / 2 else -1
    head_pivot = neck + (face - neck) * 0.2
    neck_r = np.linalg.norm(face - neck) * 0.45
    # 肢体：名称 → (关节链 [关节, 中间关节, 末端], 半宽占上段长度的比例范围)
    limbs = {}
    for tag, s in (("arm", near), ("arm_far", far)):
        sh, el, wr = k[f"sh_{s}"], k[f"el_{s}"], k[f"wr_{s}"]
        limbs[tag] = ([sh, el, wr + (wr - el) * 0.35], (0.13, 0.22))
    for tag, s in zip(("leg_near", "leg_far"), legs):
        hp, kn, an, toe = k[f"hip_{s}"], k[f"kn_{s}"], k[f"an_{s}"], k[f"toe_{s}"]
        limbs[tag] = ([hp, kn, an + (toe - an) * 1.5], (0.17, 0.30))
    # 小腿段：膝 → 踝 → 脚尖（直接膝连脚尖会斜着漏掉小腿后侧和脚跟）
    lower = {n: [c[1], c[2]] for n, (c, _) in limbs.items()}
    for tag, s in zip(("leg_near", "leg_far"), legs):
        lower[tag] = [k[f"kn_{s}"], k[f"an_{s}"], limbs[tag][0][2]]

    def lower_dist(n, upto=None):
        pts = lower[n] if upto is None else lower[n][:upto]
        return np.min(np.stack([seg_dist(X, Y, a, b) for a, b in zip(pts[:-1], pts[1:])]), axis=0)

    chain_dist = {n: np.minimum(seg_dist(X, Y, c[0], c[1]), lower_dist(n)) for n, (c, _) in limbs.items()}
    rough_w = {n: np.linalg.norm(c[1] - c[0]) * (lo + hi) / 2 for n, (c, (lo, hi)) in limbs.items()}
    arm_zone = (chain_dist["arm"] < rough_w["arm"] * 2.2) | (chain_dist["arm_far"] < rough_w["arm_far"] * 2.2)
    leg_zone = (chain_dist["leg_near"] < rough_w["leg_near"] * 2.2) | (chain_dist["leg_far"] < rough_w["leg_far"] * 2.2)

    def core(n):
        return chain_dist[n] < rough_w[n] * 0.5

    # ---------- 图层：去手臂 / 去腿 ----------
    a_O, fg_O = alpha_of(raw)
    pA, pB = folder / f"raw_{args.cid}_noarms.png", folder / f"raw_{args.cid}_nolimbs.png"
    if args.regen or not pA.exists() or not pB.exists():
        sys.path.insert(0, str(Path(__file__).parent))
        from imagegen import Gen  # noqa: E402

        gen = Gen()
        print("  生成去手臂图层…")
        imA = best_edit(gen, raw, NOARMS, args.n, core("arm") | core("arm_far"), ~arm_zone, fg_O)
        imA.save(pA)
        print("  生成去腿图层…")
        imB = best_edit(gen, imA, NOLEGS, args.n, (core("leg_near") | core("leg_far")) & ~arm_zone, ~leg_zone, fg_O)
        imB.save(pB)
        del gen
        torch.cuda.empty_cache()
    A = np.array(Image.open(pA).convert("RGB"))
    B = np.array(Image.open(pB).convert("RGB"))
    _, fg_A = alpha_of(Image.fromarray(A))
    a_B, fg_B = alpha_of(Image.fromarray(B))
    label = parse(raw)
    # 手、脚往往伸出骨骼线较远（鞋子横着、手掌张开）：按部位分割把它们也划进检测范围
    arm_zone |= np.isin(label, [14, 15]) & (np.minimum(chain_dist["arm"], chain_dist["arm_far"]) < rough_w["arm"] * 4)
    leg_zone |= np.isin(label, [9, 10, 12, 13]) & (np.minimum(chain_dist["leg_near"], chain_dist["leg_far"]) < rough_w["leg_near"] * 4)
    knee_y = min(k["kn_l"][1], k["kn_r"][1])
    leg_zone |= Y > hip[1] + (knee_y - hip[1]) * 0.4  # 大腿以下只可能是腿（喇叭裤脚、鞋跟都算）

    # ---------- 各部位轮廓 ----------
    arms = removed_mask(O, A, fg_O, fg_A, arm_zone, core("arm") | core("arm_far"))
    legs_m = removed_mask(A, B, fg_A, fg_B, leg_zone, core("leg_near") | core("leg_far")) & fg_O & ~arms
    head = binary_fill_holes(np.isin(label, HEAD_LABELS) & fg_O)
    cnt, lab = cv2.connectedComponents(head.astype(np.uint8))
    if cnt > 2:
        head = lab == 1 + int(np.argmax(np.bincount(lab.ravel())[1:]))
    head &= ~arms & ~legs_m
    # 两只手臂/两条腿按离哪根骨骼近来分
    part = {}
    part["arm"] = arms & (chain_dist["arm"] / rough_w["arm"] <= chain_dist["arm_far"] / rough_w["arm_far"])
    part["arm_far"] = arms & ~part["arm"]
    part["leg_near"] = legs_m & (chain_dist["leg_near"] / rough_w["leg_near"] <= chain_dist["leg_far"] / rough_w["leg_far"])
    part["leg_far"] = legs_m & ~part["leg_near"]
    # 编辑时模型会顺手改动肢体旁边的衣服明暗：肢体轮廓限制在骨骼两侧一定宽度内（手、鞋按部位分割放宽）
    for n in limbs:
        if n.startswith("arm"):  # 腿不限制：裤脚、鞋跟本来就伸得远，腿的差异区域也不受躯干改动影响
            band = chain_dist[n] < rough_w[n] * 1.6
            ext = np.isin(label, [14, 15]) & (chain_dist[n] < rough_w[n] * 4)
            part[n] &= band | ext
    # 每条肢体只留主体；分出来的小块交给同一对里离得更近的那条肢体的主体（不丢，丢了就成了躯干上的破洞）
    for a_, b_ in (("arm", "arm_far"), ("leg_near", "leg_far")):
        both = part[a_] | part[b_]
        mains = {}
        for n in (a_, b_):
            cnt, lab = cv2.connectedComponents(part[n].astype(np.uint8))
            if cnt > 2:
                sizes = np.bincount(lab.ravel())[1:]
                mains[n] = np.isin(lab, 1 + np.where(sizes >= sizes.max() * 0.15)[0])
            else:
                mains[n] = part[n]
        if mains[a_].any() and mains[b_].any():
            da = distance_transform_edt(~mains[a_])
            db = distance_transform_edt(~mains[b_])
            part[a_] = both & (da <= db)
            part[b_] = both & ~part[a_]
    # 抠图边缘那一圈半透明像素：归给紧挨着的头/肢体，不留在躯干上（否则肢体一动躯干上留一道描边）
    owned = np.full((H, W), -1, np.int32)
    names_ = ["head"] + list(limbs)
    owned[head] = 0
    for i, n in enumerate(limbs, 1):
        owned[part[n]] = i
    ring = (cv2.dilate((owned >= 0).astype(np.uint8), kern(3)) > 0) & fg_O & (owned < 0)
    idx = distance_transform_edt(owned < 0, return_distances=False, return_indices=True)
    nearest = owned[idx[0], idx[1]]
    head |= ring & (nearest == 0)
    for i, n in enumerate(limbs, 1):
        part[n] |= ring & (nearest == i)
    if part["arm_far"].sum() < part["arm"].sum() * 0.15:
        print("  远侧手臂几乎被身体挡住，不单独拆")
        del limbs["arm_far"]

    # ---------- 肢体半宽：沿骨骼垂直方向量厚度，按人体比例夹住 ----------
    def sil_width(m, p, q):
        d = q - p
        L = np.linalg.norm(d) + 1e-6
        nv = np.array([-d[1], d[0]]) / L
        vals = []
        for t in (0.3, 0.45, 0.6, 0.75):
            c = p + d * t
            run = 0
            for sgn in (1, -1):
                for s_ in range(1, 400):
                    x_, y_ = (c + nv * s_ * sgn).astype(int)
                    if not (0 <= x_ < W and 0 <= y_ < H) or not m[y_, x_]:
                        run += s_
                        break
            vals.append(run / 2)
        return float(np.median(vals))

    widths, capsule = {}, {}
    for n, (c, (lo, hi)) in limbs.items():
        L1 = float(np.linalg.norm(c[1] - c[0]))
        src = part[n] if part[n].sum() > 500 else fg_O & ~head
        w2 = float(np.clip(sil_width(src, lower[n][0], lower[n][1]), lo * L1 * 0.85, hi * L1 * 0.85))
        w1 = float(np.clip(sil_width(src, c[0], c[1]), w2 * 1.1, max(w2 * 1.1, min(hi * L1, w2 * 1.4))))
        if args.dress and n.startswith("leg"):
            w1 = w2 * 1.05  # 裙子里的大腿和小腿一样细，迈步时不从裙摆后面鼓出来
        widths[n] = w1
        if n.startswith("arm"):  # 手臂胶囊只到手腕
            low = seg_dist(X, Y, c[1], c[1] + (c[2] - c[1]) / 1.35)
        else:
            low = lower_dist(n)
        capsule[n] = (seg_dist(X, Y, c[0], c[1]) < w1 * 1.1) | (low < w2 * 1.15)
        print(f"  {n}: 半宽 {w1:.0f}/{w2:.0f}px，轮廓 {int(part[n].sum())} px")

    order = ["arm_far", "leg_far", "torso", "head", "leg_near", "arm"]
    if args.dress:
        order = ["arm_far", "leg_far", "leg_near", "torso", "head", "arm"]
    order = [o for o in order if o in limbs or o in ("torso", "head")]
    rank = {n: i for i, n in enumerate(order)}
    none = np.zeros((H, W), bool)

    # ---------- 组装：每个部件 = 掩码 + 颜色画布 ----------
    rgb_of = {n: O.copy() for n in order}
    mask = {n: none.copy() for n in order}
    mask["head"] = head.copy()
    for n in limbs:
        mask[n] = part[n].copy()
    # 前面的肢体：从关节到肘/膝整段按肢体宽度切下（关节端是圆头，原图像素），转动时盖住关节、上下不断开
    for n in sorted(limbs, key=lambda n: -rank[n]):
        if rank[n] > rank["torso"]:
            c = limbs[n][0]
            cap = (seg_dist(X, Y, c[0], c[1]) < widths[n] * 1.05) & fg_O & ~head
            mask[n] |= cap & ~np.logical_or.reduce([mask[o] for o in limbs if rank[o] > rank[n]] + [none])
    # 躯干：原图里可见的躯干用原图像素，其余（被四肢、头挡住的）用去掉四肢的图层 B
    limbs_any = np.logical_or.reduce([part[n] for n in limbs])
    vis_torso = fg_O & ~limbs_any & ~head
    far_vis = np.logical_or.reduce([mask[n] for n in limbs if rank[n] < rank["torso"]] + [none])
    torso_m = (vis_torso | (fg_B & (cv2.dilate(fg_O.astype(np.uint8), kern(2)) > 0))) & ~(far_vis & ~vis_torso)
    neck_zone = np.hypot(X - head_pivot[0], Y - head_pivot[1]) < neck_r
    torso_m &= ~(head & ~neck_zone)  # 头归头，脖子一圈留在躯干上垫底
    rgb_of["torso"] = np.where(vis_torso[..., None], O, B)
    # 胯部：两条腿的关节处垫一块（裤子/短裤颜色），迈腿时裆部不露空
    if not args.dress:
        pel = np.zeros((H, W), np.uint8)
        for n in ("leg_near", "leg_far"):
            j, kn_ = limbs[n][0][0], limbs[n][0][1]
            cv2.circle(pel, (int(j[0]), int(j[1])), int(widths[n] * 1.15), 1, -1)
            c_ = j + (kn_ - j) * 0.3
            cv2.circle(pel, (int(c_[0]), int(c_[1])), int(widths[n]), 1, -1)
        pelvis = (pel > 0) & ~torso_m & ~head
        if pelvis.any():
            src = (part["leg_near"] | part["leg_far"]) & ~np.isin(label, [9, 10, 12, 13])  # 裤子部分（不要皮肤和鞋）
            if src.sum() < 200:
                src = part["leg_near"] | part["leg_far"]
            rgb_of["torso"] = np.where(pelvis[..., None], cv2.GaussianBlur(nn_color(O, src), (0, 0), 6), rgb_of["torso"])
            torso_m |= pelvis
    mask["torso"] = torso_m

    # 肢体被挡住的部分（在其它部件下面）用自己的颜色补齐：胶囊范围内、原图前景里
    lum = O.mean(-1)
    for n in limbs:
        if rank[n] > rank["torso"]:
            continue  # 前面的肢体整条可见，不用补
        hidden = capsule[n] & fg_O & ~mask[n] & ~head
        own = part[n] if part[n].sum() > 200 else mask[n]
        if own.sum() > 50 and hidden.any():
            src = own & (lum >= np.percentile(lum[own], 20))  # 描边、阴影不拿来补色
            rgb_of[n] = np.where(hidden[..., None], cv2.GaussianBlur(nn_color(O, src), (0, 0), 6), rgb_of[n])
            mask[n] |= hidden

    # ---------- 自检：静止姿势必须和原图一样 ----------
    extra = ~(cv2.dilate(fg_O.astype(np.uint8), kern(1)) > 0)
    for n in order:  # 超出原图轮廓的不要
        mask[n] &= ~extra
    top = np.full((H, W), -1, np.int32)
    for n in order:
        top[mask[n]] = rank[n]
    missing = fg_O & (top < 0)
    if missing.any():  # 没有任何部件覆盖的像素：交给最近的部件
        idx = distance_transform_edt(top < 0, return_distances=False, return_indices=True)
        nl = top[idx[0], idx[1]]
        for n in order:
            mask[n] |= missing & (nl == rank[n])
        top = np.where(missing, nl, top)
        print(f"  补回无主像素 {int(missing.sum())} 个")
    for n in order:  # 最上层的部件一律用原图像素
        sel = top == rank[n]
        rgb_of[n][sel] = O[sel]

    # ---------- 输出 ----------
    out = folder / f"rig_{args.cid}"
    out.mkdir(exist_ok=True)
    for f in out.glob("*.png"):
        f.unlink()
    pivots = {n: limbs[n][0][0] for n in limbs}
    pivots["torso"], pivots["head"] = hip, head_pivot
    parts = {}
    colors = np.random.default_rng(1).integers(60, 255, (len(order), 3))
    debug = (O * 0.35).astype(np.uint8)
    COPY = {"arm_far": "arm", "leg_far": "leg_near"}  # 远侧肢体 = 近侧肢体的拷贝（转到原图远侧肢体的角度、压暗一点）
    ang = lambda c: float(np.degrees(np.arctan2(c[2][1] - c[0][1], c[2][0] - c[0][0])))
    for i, n in enumerate(order):
        m = mask[n]
        if n in COPY and COPY[n] in limbs:
            continue
        if not m.any():
            continue
        debug[m & (top == rank[n])] = (O[m & (top == rank[n])] * 0.4 + colors[i] * 0.6).astype(np.uint8)
        alpha = np.where(top == rank[n], a_O, 1.0) * m  # 原图轮廓边缘保留抗锯齿
        ys, xs = np.where(m)
        x0, y0, x1, y1 = xs.min(), ys.min(), xs.max() + 1, ys.max() + 1
        rgba = np.dstack([rgb_of[n], (alpha * 255).clip(0, 255)]).astype(np.uint8)[y0:y1, x0:x1]
        Image.fromarray(rgba).save(out / f"{n}.png")
        j = pivots[n]
        parts[n] = {"file": f"{n}.png", "x": int(x0), "y": int(y0), "w": int(x1 - x0), "h": int(y1 - y0),
                    "pivot": [float(j[0]), float(j[1])], "parent": None if n == "torso" else "torso"}
    for n, src_n in COPY.items():
        if n in limbs and src_n in parts:
            sp, fp = limbs[src_n][0][0], limbs[n][0][0]
            # 拷贝时把近侧肢体顶端带的那圈衣服（肩头/胯部圆头）削到肢体本身的宽度，免得在远侧鼓出一块
            c = limbs[src_n][0]
            trim = (seg_dist(X, Y, c[0] + (c[1] - c[0]) * 0.12, c[1]) < widths[src_n] * 0.95) | (lower_dist(src_n) < widths[src_n] * 1.6)
            m = mask[src_n] & trim
            alpha = np.where(top == rank[src_n], a_O, 1.0) * m
            ys, xs = np.where(m)
            x0, y0, x1, y1 = xs.min(), ys.min(), xs.max() + 1, ys.max() + 1
            Image.fromarray(np.dstack([rgb_of[src_n], (alpha * 255).clip(0, 255)]).astype(np.uint8)[y0:y1, x0:x1]).save(out / f"{n}.png")
            parts[n] = {"file": f"{n}.png", "x": int(x0), "y": int(y0), "w": int(x1 - x0), "h": int(y1 - y0),
                        "parent": "torso", "pivot": [float(fp[0]), float(fp[1])],
                        "base": {"dx": float(fp[0] - sp[0]), "dy": float(fp[1] - sp[1]), "rot": ang(limbs[n][0]) - ang(limbs[src_n][0]),
                                 "pivot": [float(sp[0]), float(sp[1])]}, "shade": 0.8}
    Image.fromarray(debug).save(out / "debug.jpg")
    hand = limbs["arm"][0][2]
    rig = {"size": [W, H], "facing": facing, "ground": float(max(k["an_l"][1], k["an_r"][1]) + 25),
           "order": [o for o in order if o in parts], "parts": parts,
           "keypoints": {kk: [float(v[0]), float(v[1])] for kk, v in k.items()}, "hand": [float(hand[0]), float(hand[1])],
           "feet": {t: [float(v) for v in limbs[f"leg_{t}"][0][2]] for t in ("near", "far")}}
    (out / "rig.json").write_text(json.dumps(rig, ensure_ascii=False, indent=1))
    print(f"{args.cid}: 部件 {rig['order']}，朝向={'右' if facing > 0 else '左'}")


if __name__ == "__main__":
    main()
