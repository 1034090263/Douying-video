"""人物动作 = 模型按剧情一次画出的连续帧 + 插帧补出中间帧（人物始终是完整的一张图，不拆件）。

  1. 参考图（角色侧身定妆照）+ 动作描述 → FLUX.2 klein 画一张「连续动作图」（几帧左右排开）
     生成 n 张候选，按「人数对、每帧都朝右、身高一致」自动挑
  2. 切成单帧，按脚底对齐到同一张画布（保留原灰底，插帧更稳）
  3. RIFE v4.26（MIT）在相邻两帧之间补 m 张中间帧；循环动作（走路）首尾也补
  4. 每帧 BiRefNet 抠图，写出 public/images/<图集>/seq_<角色>/<动作>/NNN.png 和 seq.json

用法：~/imggen/.venv/bin/python scripts/seqgen.py <图集目录> <角色> <动作名> "<逐帧描述>" [--frames 4] [--n 3] [--mid 3] [--loop] [--ref 文件]
"""
import argparse
import json
import sys
from pathlib import Path

import cv2
import mediapipe as mp
import numpy as np
import torch
import torch.nn.functional as F
from mediapipe.tasks.python import BaseOptions, vision
from PIL import Image

sys.path.insert(0, str(Path(__file__).parent))
from rig import MODELS, alpha_of  # noqa: E402

RIFE_DIR = MODELS / "rife" / "RIFEv4.26_0921"

STYLE = (
    "Every frame shows the whole body in strict side view facing right (the nose points to the right edge), the same size, "
    "feet on the same ground line, evenly spaced, the arm nearer to the viewer is the left arm. Keep exactly the same character as the reference image: "
    "same face, hairstyle, clothes, colors and soft painterly art style. Plain flat light gray background, no panel borders, no text, no shadows."
)


# ---------------------------------------------------------------- RIFE
def _warp(x, flow, grid={}):
    k = (str(flow.device), tuple(flow.shape))
    if k not in grid:
        h = torch.linspace(-1, 1, flow.shape[3], device=flow.device).view(1, 1, 1, -1).expand(flow.shape[0], -1, flow.shape[2], -1)
        v = torch.linspace(-1, 1, flow.shape[2], device=flow.device).view(1, 1, -1, 1).expand(flow.shape[0], -1, -1, flow.shape[3])
        grid[k] = torch.cat([h, v], 1)
    f = torch.cat([flow[:, 0:1] / ((x.shape[3] - 1) / 2), flow[:, 1:2] / ((x.shape[2] - 1) / 2)], 1)
    return F.grid_sample(x, (grid[k] + f).permute(0, 2, 3, 1), mode="bilinear", padding_mode="border", align_corners=True)


def load_rife():
    import types

    pkg = types.ModuleType("model")
    wl = types.ModuleType("model.warplayer")
    wl.warp = _warp
    sys.modules["model"] = pkg
    sys.modules["model.warplayer"] = wl
    sys.path.insert(0, str(RIFE_DIR))
    import IFNet_HDv3  # noqa: E402

    net = IFNet_HDv3.IFNet()
    sd = torch.load(RIFE_DIR / "flownet.pkl", map_location="cpu")
    net.load_state_dict({k.replace("module.", ""): v for k, v in sd.items()}, strict=False)
    return net.cuda().eval()


@torch.no_grad()
def rife(net, a: np.ndarray, b: np.ndarray, t: float, scale=0.5) -> np.ndarray:
    """两张同尺寸 RGB（uint8）之间 t 时刻的中间帧；大动作用 scale=0.5 看得更远"""
    h, w = a.shape[:2]
    m = max(128, int(128 / scale))  # RIFE 要求边长是它的倍数
    ph, pw = (m - h % m) % m, (m - w % m) % m
    ta = torch.from_numpy(a).permute(2, 0, 1)[None].cuda().float() / 255
    tb = torch.from_numpy(b).permute(2, 0, 1)[None].cuda().float() / 255
    ta = F.pad(ta, (0, pw, 0, ph), mode="replicate")
    tb = F.pad(tb, (0, pw, 0, ph), mode="replicate")
    sl = [16 / scale, 8 / scale, 4 / scale, 2 / scale, 1 / scale]
    _, _, merged = net(torch.cat([ta, tb], 1), t, sl)
    out = merged[-1][0, :, :h, :w].float().clamp(0, 1)
    return (out.permute(1, 2, 0).cpu().numpy() * 255).astype(np.uint8)


# ---------------------------------------------------------------- 切帧、打分
def split(sheet: Image.Image, frames: int):
    a, fg = alpha_of(sheet)
    fg = cv2.morphologyEx(fg.astype(np.uint8), cv2.MORPH_CLOSE, np.ones((9, 9), np.uint8))
    cnt, lab, st, _ = cv2.connectedComponentsWithStats(fg)
    comps = [i for i in range(1, cnt) if st[i, cv2.CC_STAT_AREA] > fg.size * 0.008]
    # 阅读顺序：先按行（脚底所在的那一半），再从左到右
    rows = sheet.height // 1024 if sheet.height >= 2048 else 1
    comps.sort(key=lambda i: (min(rows - 1, int((st[i, 1] + st[i, 3]) / (sheet.height / rows))), st[i, 0]))
    out = []
    for i in comps:
        m = lab == i
        ys, xs = np.where(m)
        top, bottom = ys.min(), ys.max()
        # 水平基准用躯干中心（头顶往下 20%~50% 那一段的平均 x），不用两脚中点——走路时两脚前后交替，脚的中点会来回跳
        band = (ys > top + (bottom - top) * 0.2) & (ys < top + (bottom - top) * 0.5)
        cx = float(xs[band].mean()) if band.any() else float(xs.mean())
        out.append({"box": st[i, :4].tolist(), "foot": (cx, float(bottom)), "height": int(st[i, cv2.CC_STAT_HEIGHT]), "width": int(st[i, cv2.CC_STAT_WIDTH]), "mask": m})
    return out, a


def motion(comps):
    """相邻两帧轮廓（按脚底对齐）的平均差异：0 = 一模一样"""
    if len(comps) < 2 or max(c["box"][2] for c in comps) > 1300:
        return 0.0
    vals = []
    for c0, c1 in zip(comps[:-1], comps[1:]):
        can = []
        for c in (c0, c1):
            x0, y0, w, h = c["box"]
            m = np.zeros((2200, 2600), bool)
            ox, oy = int(1300 - (c["foot"][0] - x0)), int(2100 - (c["foot"][1] - y0))
            m[oy:oy + h, ox:ox + w] = c["mask"][y0:y0 + h, x0:x0 + w]
            can.append(m)
        vals.append(1 - (can[0] & can[1]).sum() / max(1, (can[0] | can[1]).sum()))
    return float(np.mean(vals))


def facing_right(det, crop: np.ndarray):
    r = det.detect(mp.Image(image_format=mp.ImageFormat.SRGB, data=np.ascontiguousarray(crop)))
    if not r.pose_landmarks:
        return None
    lm = r.pose_landmarks[0]
    return lm[0].x > (lm[7].x + lm[8].x) / 2  # 鼻子在耳朵右边 = 朝右


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("folder")
    ap.add_argument("cid")
    ap.add_argument("action")
    ap.add_argument("desc")
    ap.add_argument("--frames", type=int, default=4)
    ap.add_argument("--n", type=int, default=3)
    ap.add_argument("--mid", type=int, default=3, help="相邻两帧之间补几张")
    ap.add_argument("--loop", action="store_true")
    ap.add_argument("--ref")
    ap.add_argument("--seed0", type=int, default=1)
    ap.add_argument("--poses", help="火柴人姿势图（同样的排版），作为第二张参考图约束每一帧的姿势")
    ap.add_argument("--cell", type=int, default=512, help="每帧格子宽度（躺着的人用 1024）")
    ap.add_argument("--unit-width", action="store_true", help="身高单位按人物宽度算（躺着的人）")
    ap.add_argument("--any-facing", action="store_true", help="不要求每帧都朝右（转头看镜头之类）")
    ap.add_argument("--tag", default="", help="输出到 seq_<角色>_<tag>（对比不同生成方法用）")
    ap.add_argument("--guides", help="姿势草稿目录（按文件名排序）：每张草稿让模型重画成完整人物，作为关键帧（不再画连续图）")
    args = ap.parse_args()
    folder = Path(args.folder)
    ref = Image.open(args.ref or folder / f"raw_{args.cid}_walk.png").convert("RGB")
    sub = f"seq_{args.cid}" + (f"_{args.tag}" if args.tag else "")
    out = folder / sub / args.action
    out.mkdir(parents=True, exist_ok=True)
    for f in out.glob("*.png"):
        f.unlink()
    det = vision.PoseLandmarker.create_from_options(
        vision.PoseLandmarkerOptions(base_options=BaseOptions(model_asset_path=str(MODELS / "mediapipe" / "pose_landmarker_heavy.task")), running_mode=vision.RunningMode.IMAGE)
    )
    sys.path.insert(0, str(Path(__file__).parent))
    from imagegen import Gen  # noqa: E402

    gen = Gen()
    if args.guides:
        keys = guided_keys(gen, Path(args.guides), out)
        del gen
        torch.cuda.empty_cache()
        rig = json.loads((folder / f"rig_{args.cid}" / "rig.json").read_text())
        rest = np.asarray(Image.open(folder / f"char_{args.cid}_walk.png"))[..., 3] > 128 if (folder / f"char_{args.cid}_walk.png").exists() else None
        ys = np.where(rest)[0] if rest is not None else np.array([0, rig["ground"]])
        finish(args, folder, out, keys, float(rig["spine"][0][0]), float(ys.max()), float(ys.max() - ys.min()))
        return
    if args.frames <= 4 or args.cell > 512:
        size = (min(2048, args.cell * args.frames), 1024)
        layout = f"{args.frames} frames of the same character side by side in one row, read from left to right"
    else:  # 多帧排成两行，避免挤在一起粘连
        cols = (args.frames + 1) // 2
        size = (512 * cols, 2048)
        layout = f"{args.frames} frames of the same character in two rows of {cols}, read left to right along the top row, then left to right along the bottom row, every frame well separated"
    style = STYLE if not args.any_facing else (
        "Every frame shows the whole body at the same size with the feet on the same ground line, evenly spaced. Keep exactly the same character as the reference image: "
        "same face, hairstyle, clothes, colors and soft painterly art style. Plain flat light gray background, no panel borders, no text, no shadows.")
    prompt = f"A character animation sequence sheet: {layout}, showing one continuous action. {args.desc} {style}"
    refs = [ref]
    if args.poses:
        refs.append(Image.open(args.poses).convert("RGB"))
        prompt = ("Image 2 is only a pose guide: it shows the pose of every frame as stick figures (dark lines = the arm and leg nearer to the viewer, gray lines = the farther arm and leg). "
                  "Draw the character from image 1 in exactly those poses, one character per stick figure, at the same positions. "
                  "Do not draw the stick figures, lines or circles themselves; only the fully drawn character must appear. " + prompt)
    best = None
    for seed in range(args.seed0, args.seed0 + args.n):
        sheet = gen.image(prompt, size, seed, refs=refs)
        comps, a = split(sheet, args.frames)
        rgb = np.asarray(sheet)
        faces = [facing_right(det, rgb[c["box"][1]:c["box"][1] + c["box"][3], c["box"][0]:c["box"][0] + c["box"][2]]) for c in comps]
        hs = np.array([c["height"] for c in comps]) if comps else np.array([1])
        change = motion(comps)
        face_score = 0 if args.any_facing else 15 * sum(f is True for f in faces) - 30 * sum(f is False for f in faces)
        score = (60 if len(comps) == args.frames else -60 * abs(len(comps) - args.frames)) + face_score - 200 * float(hs.std() / hs.mean())
        score += 80 * min(change, 0.25) - 120 * max(0, change - 0.45)  # 相邻帧要有变化，但不能跳太大
        print(f"  候选 {seed}: {len(comps)} 人，朝右 {faces}，身高差 {hs.std() / hs.mean():.2f}，相邻变化 {change:.2f} → {score:.0f}", flush=True)
        sheet.save(out / f"_sheet_{seed}.jpg")
        if best is None or score > best[0]:
            best = (score, sheet, comps, a)
    _, sheet, comps, a = best
    del gen
    torch.cuda.empty_cache()
    rgb = np.asarray(sheet)
    bg = np.median(np.concatenate([rgb[:20].reshape(-1, 3), rgb[-20:].reshape(-1, 3)]), axis=0).astype(np.uint8)
    # 统一画布：所有帧按脚底对齐
    L = max(c["foot"][0] - c["box"][0] for c in comps) + 30
    R = max(c["box"][0] + c["box"][2] - c["foot"][0] for c in comps) + 30
    U = max(c["foot"][1] - c["box"][1] for c in comps) + 30
    cw, ch = int(L + R) + 60, int(U + 20)  # 多留一点边距，四舍五入不会越界
    keys = []
    for c in comps:
        can = np.zeros((ch, cw, 3), np.uint8) + bg
        x0, y0, w, h = c["box"]
        m = c["mask"][y0:y0 + h, x0:x0 + w]
        m = cv2.dilate(m.astype(np.uint8), np.ones((7, 7), np.uint8)) > 0
        ox, oy = int(round(L - (c["foot"][0] - x0))), int(round(U - (c["foot"][1] - y0)))
        hh, ww = min(h, ch - oy), min(w, cw - ox)  # 裁到画布范围内
        region = can[oy:oy + hh, ox:ox + ww]
        mm = m[:hh, :ww]
        region[mm] = rgb[y0:y0 + hh, x0:x0 + ww][mm]
        keys.append(can)
    unit = float(np.median([c["width"] for c in comps])) * 0.95 if args.unit_width else float(np.median([c["height"] for c in comps]))
    finish(args, folder, out, keys, float(L), float(U), unit, cw, ch)


GUIDE_PROMPT = (
    "Edit the image: repaint this character so the body looks natural and clean. Keep exactly the same pose, position, size, face, "
    "hairstyle, clothes, colors and soft painterly art style. Fix the shoulders, elbows, hips and knees so the arms and legs connect "
    "smoothly and look anatomically correct, remove any seams, smears, gaps or duplicated parts. Full body, plain flat light gray background, no text."
)


def guided_keys(gen, gdir: Path, out: Path):
    """每张姿势草稿 → 模型重画成完整人物（同一个种子，帧与帧之间更统一）"""
    keys = []
    for g in sorted(gdir.glob("*.png")):
        guide = Image.open(g).convert("RGB")
        im = gen.image(GUIDE_PROMPT, guide.size, 1, refs=[guide])
        keys.append(np.asarray(im.convert("RGB")))
        im.save(out / f"_key_{g.stem}.jpg")
        print(f"  关键帧 {g.stem}", flush=True)
    return keys


def finish(args, folder, out, keys, ax, ay, unit, cw=None, ch=None):
    # 插帧
    net = load_rife()
    seq = []
    pairs = len(keys) if args.loop else len(keys) - 1
    for i in range(len(keys)):
        seq.append(("key", keys[i]))
        if i < pairs:
            nxt = keys[(i + 1) % len(keys)]
            for j in range(1, args.mid + 1):
                seq.append(("mid", rife(net, keys[i], nxt, j / (args.mid + 1))))
    names, kinds = [], []
    key_area = []
    alphas = []
    for kind, im in seq:
        a2, _ = alpha_of(Image.fromarray(im))
        alphas.append(a2)
        if kind == "key":
            key_area.append(float((a2 > 0.5).sum()))
    ref_area = float(np.median(key_area))
    dropped = 0
    for (kind, im), a2 in zip(seq, alphas):
        solid = float((a2 > 0.5).sum())
        soft = float(((a2 > 0.1) & (a2 < 0.7)).sum())
        if kind == "mid" and (solid < ref_area * 0.92 or soft > ref_area * 0.08):
            dropped += 1
            continue
        n = len(names)
        Image.fromarray(np.dstack([im, (a2 * 255).astype(np.uint8)])).save(out / f"{n:03d}.png")
        names.append(f"{n:03d}.png")
        kinds.append(kind)
    if dropped:
        print(f"  丢掉 {dropped} 张有残影的中间帧")
    meta_f = out.parent / "seq.json"
    meta = json.loads(meta_f.read_text()) if meta_f.exists() else {}
    ch, cw = keys[0].shape[:2]
    meta[args.action] = {"frames": names, "keys": [i for i, k in enumerate(kinds) if k == "key"], "w": cw, "h": ch, "ax": ax, "ay": ay, "unit": unit, "loop": args.loop}
    meta_f.write_text(json.dumps(meta, ensure_ascii=False, indent=1))
    print(f"{args.action}: {len(keys)} 张关键帧 + 插帧 → 共 {len(names)} 帧，画布 {cw}x{ch}")




if __name__ == "__main__":
    main()
