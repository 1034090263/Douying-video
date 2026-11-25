"""按 videos/<名字>/art.json 生成插画素材 → public/images/<名字>/

  角色：先出「定妆照」（全身、纯色底）→ BiRefNet 抠图成透明 PNG；
        其他姿势以定妆照为参考图生成，保证同一个人长相一致
  背景：竖版 9:16 场景图（不含人物）

在 ~/imggen 的虚拟环境里运行：
  ~/imggen/.venv/bin/python scripts/imagegen.py byakuya [--only 角色或背景id ...] [--seed N]
描述没变的图会跳过（缓存按 prompt+seed 计算）。
"""
import argparse
import hashlib
import json
from pathlib import Path

import numpy as np
import torch
from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
MODELS = Path.home() / "imggen" / "models"
CHAR_SIZE = (832, 1216)  # 宽 × 高，全身像
BG_SIZE = (768, 1344)  # 9:16 背景，渲染时放大到 1080×1920
STEPS = 4  # klein 是蒸馏模型，4 步即可


def key_of(*parts) -> str:
    return hashlib.md5("|".join(map(str, parts)).encode()).hexdigest()[:12]


class Gen:
    def __init__(self):
        from diffusers import Flux2KleinPipeline

        self.pipe = Flux2KleinPipeline.from_pretrained(MODELS / "flux2-klein-4b", torch_dtype=torch.bfloat16)
        self.pipe.enable_model_cpu_offload()
        self._seg = None

    def image(self, prompt: str, size, seed: int, refs=None) -> Image.Image:
        g = torch.Generator("cpu").manual_seed(seed)
        kw = dict(prompt=prompt, width=size[0], height=size[1], num_inference_steps=STEPS, generator=g)
        if refs:
            kw["image"] = refs
        return self.pipe(**kw).images[0]

    def cutout(self, img: Image.Image) -> Image.Image:
        """BiRefNet 抠图，返回 RGBA"""
        from torchvision import transforms
        from transformers import AutoModelForImageSegmentation

        if self._seg is None:
            self._seg = AutoModelForImageSegmentation.from_pretrained(MODELS / "birefnet", trust_remote_code=True).to("cuda").eval().half()
        tf = transforms.Compose([transforms.Resize((1024, 1024)), transforms.ToTensor(), transforms.Normalize([0.485, 0.456, 0.406], [0.229, 0.224, 0.225])])
        x = tf(img.convert("RGB")).unsqueeze(0).to("cuda").half()
        with torch.no_grad():
            mask = self._seg(x)[-1].sigmoid().cpu()[0, 0].float().numpy()
        m = Image.fromarray((mask * 255).astype(np.uint8)).resize(img.size, Image.LANCZOS)
        out = img.convert("RGBA")
        out.putalpha(m)
        return out.crop(out.getbbox())  # 裁掉透明边


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("video")
    ap.add_argument("--only", nargs="*", default=None)
    ap.add_argument("--seed", type=int, default=7)
    args = ap.parse_args()

    art = json.loads((ROOT / "videos" / args.video / "art.json").read_text())
    out = ROOT / "public" / "images" / args.video
    out.mkdir(parents=True, exist_ok=True)
    cache_file = out / ".cache.json"
    cache = json.loads(cache_file.read_text()) if cache_file.exists() else {}
    style, cstyle = art["style"], art.get("character_style", "")
    gen = None

    def want(i):
        return args.only is None or i in args.only

    def done(name, k):
        return cache.get(name) == k and (out / name).exists()

    for cid, c in art.get("characters", {}).items():
        if not want(cid):
            continue
        base_prompt = f"{c['prompt']}, {cstyle}, {style}"
        base_name = f"char_{cid}_stand.png"
        raw_name = f"raw_{cid}_stand.png"
        k = key_of(base_prompt, args.seed)
        # ref：以另一个角色的定妆照为参考（同一个人的不同年龄），保证长相延续
        ref_id = c.get("ref")
        if ref_id:
            base_prompt = f"The same person as the reference image, now {c['prompt']}. Keep the same face shape and hairstyle features. {cstyle}, {style}"
            k = key_of(base_prompt, args.seed, ref_id)
        if not done(base_name, k):
            gen = gen or Gen()
            refs = [Image.open(out / f"raw_{ref_id}_stand.png").convert("RGB")] if ref_id else None
            img = gen.image(base_prompt, CHAR_SIZE, args.seed, refs=refs)
            img.save(out / raw_name)
            gen.cutout(img).save(out / base_name)
            cache[base_name] = k
            print("角色", base_name, flush=True)
        ref = Image.open(out / raw_name).convert("RGB")
        for pid, pp in c.get("poses", {}).items():
            if pid == "stand" or not pp:
                continue
            name = f"char_{cid}_{pid}.png"
            prompt = f"{pp}. Keep exactly the same person, face, hairstyle, clothes and art style as the reference image. {cstyle}, {style}"
            k2 = key_of(prompt, args.seed, k)
            if done(name, k2):
                continue
            gen = gen or Gen()
            img = gen.image(prompt, CHAR_SIZE, args.seed, refs=[ref])
            img.save(out / f"raw_{cid}_{pid}.png")
            gen.cutout(img).save(out / name)
            cache[name] = k2
            print("姿势", name, flush=True)

    for pid, p in art.get("props", {}).items():
        if not want(pid):
            continue
        name = f"prop_{pid}.png"
        prompt = f"{p}, {art.get('prop_style', '')}, {art.get('prop_art_style', style)}"
        k = key_of(prompt, args.seed)
        if done(name, k):
            continue
        gen = gen or Gen()
        gen.cutout(gen.image(prompt, (1024, 1024), args.seed)).save(out / name)
        cache[name] = k
        print("道具", name, flush=True)

    for bid, p in art.get("backgrounds", {}).items():
        if not want(bid):
            continue
        name = f"bg_{bid}.png"
        prompt = f"{p}, vertical composition, {style}"
        k = key_of(prompt, args.seed)
        if done(name, k):
            continue
        gen = gen or Gen()
        gen.image(prompt, BG_SIZE, args.seed).resize((1080, 1890), Image.LANCZOS).save(out / name)
        cache[name] = k
        print("背景", name, flush=True)

    cache_file.write_text(json.dumps(cache, indent=1))
    print("完成 →", out.relative_to(ROOT))


if __name__ == "__main__":
    main()
