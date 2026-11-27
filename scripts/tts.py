"""读取 script.json → 生成每个场景的配音 + 字幕/逐字时间轴 → src/generated/timeline.json

两种配音引擎（script.json 的 "engine"）：
  index  本地 IndexTTS2，语气自然、可按场景设情绪（默认）
  edge   微软 edge-tts，免安装、速度快，但语气偏平

用法: npm run tts -- lol   （videos/lol/script.json；省略则沿用上次的视频）
     文案/情绪没变的句子会复用缓存
"""
import asyncio
import hashlib
import json
import math
import os
import re
import subprocess
import sys
from pathlib import Path

import numpy as np
from scipy.io import wavfile

ROOT = Path(__file__).resolve().parent.parent
PUBLIC = ROOT / "public"
AUDIO_DIR = PUBLIC / "audio"
CACHE = ROOT / ".cache" / "tts"
OUT = ROOT / "src" / "generated" / "timeline.json"
CURRENT = ROOT / ".cache" / "current_video"

FPS = 30
SR = 24000
TAIL_PAD = 0.3  # 每个场景配音结束后留白（秒）
SENT_GAP = 0.2  # 句与句之间的停顿（秒）
SPLIT = "，。？！：；、,.?!:;"
SENT_END = "。？！?!"
STRIP = "“”\"'"

# IndexTTS2 情绪向量的 8 个维度；script.json 里 emotion 可写 {"angry": 0.4} 这样的字典，也可写一段文字描述
EMO_KEYS = ["happy", "angry", "sad", "afraid", "disgusted", "melancholic", "surprised", "calm"]
DEFAULT_EMO = {"calm": 0.4}


def sh(cmd, **kw):
    return subprocess.run(cmd, check=True, capture_output=True, text=True, **kw).stdout


def audio_duration(path: Path) -> float:
    return float(sh(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", str(path)]).strip())


def key_of(*parts) -> str:
    return hashlib.md5("|".join(map(str, parts)).encode()).hexdigest()[:16]


# ---------------------------------------------------------------- 字幕/对齐（两种引擎共用）
def clause_spans(text: str):
    spans, start = [], 0
    for i, ch in enumerate(text + "。"):
        if ch in SPLIT or ch == "\n":
            if i > start:
                spans.append((start, i))
            start = i + 1
    return spans


def subtitles(text: str, times: list, total: float) -> list[dict]:
    """按标点切成短句字幕，每句的显示时间取该句第一个字的发音时间。"""
    subs = []
    for a, b in clause_spans(text):
        line = "".join(c for c in text[a:b] if c not in STRIP).strip()
        t = next((times[i] for i in range(a, b) if times[i] is not None), None)
        if line and t is not None:
            subs.append({"text": line, "start": round(t, 3)})
    for i, s in enumerate(subs):
        s["end"] = subs[i + 1]["start"] if i + 1 < len(subs) else total
    return subs


# ---------------------------------------------------------------- edge-tts
async def edge_scene(text, voice, rate, out_mp3: Path):
    import edge_tts

    meta = out_mp3.with_suffix(".json")
    key = key_of("edge", voice, rate, text)
    if out_mp3.exists() and meta.exists() and json.loads(meta.read_text()).get("key") == key:
        words = json.loads(meta.read_text())["words"]
    else:
        words = []
        comm = edge_tts.Communicate(text, voice, rate=rate, boundary="WordBoundary")
        with open(out_mp3, "wb") as f:
            async for chunk in comm.stream():
                if chunk["type"] == "audio":
                    f.write(chunk["data"])
                elif chunk["type"] == "WordBoundary":
                    st = chunk["offset"] / 1e7
                    words.append({"text": chunk["text"], "start": st, "end": st + chunk["duration"] / 1e7})
        meta.write_text(json.dumps({"key": key, "words": words}, ensure_ascii=False))

    times = [None] * len(text)
    cursor = 0
    for w in words:
        idx = text.find(w["text"], cursor)
        if idx < 0:
            continue
        n = len(w["text"])
        for k in range(n):
            times[idx + k] = w["start"] + (w["end"] - w["start"]) * k / n
        cursor = idx + n
    last = 0.0
    for i, t in enumerate(times):
        if t is None and text[i] not in SPLIT:
            times[i] = last
        elif t is not None:
            last = t
    return times


# ---------------------------------------------------------------- IndexTTS2
def sentences(text: str):
    """切成整句（保留句末标点），返回 [(起点, 终点)]"""
    out, start = [], 0
    for i, ch in enumerate(text):
        if ch in SENT_END:
            out.append((start, i + 1))
            start = i + 1
    if start < len(text):
        out.append((start, len(text)))
    return [(a, b) for a, b in out if text[a:b].strip()]


def load_mono(path: Path):
    sr, x = wavfile.read(path)
    x = x.astype(np.float32)
    if x.ndim > 1:
        x = x.mean(axis=1)
    x /= 32768.0 if np.abs(x).max() > 2 else 1.0
    if sr != SR:
        n = int(len(x) * SR / sr)
        x = np.interp(np.linspace(0, len(x) - 1, n), np.arange(len(x)), x)
    return x


def voiced_regions(x, hop=0.01, thr_db=-38, min_gap=0.09):
    """返回 (语音起点, 语音终点, [句内停顿 (开始, 结束)])，单位秒"""
    h = int(SR * hop)
    n = len(x) // h
    rms = np.sqrt(np.mean(x[: n * h].reshape(n, h) ** 2, axis=1) + 1e-12)
    db = 20 * np.log10(rms / (rms.max() + 1e-9))
    voiced = db > thr_db
    idx = np.where(voiced)[0]
    if len(idx) == 0:
        return 0.0, len(x) / SR, []
    v0, v1 = idx[0], idx[-1] + 1
    gaps, k = [], v0
    while k < v1:
        if not voiced[k]:
            j = k
            while j < v1 and not voiced[j]:
                j += 1
            if (j - k) * hop >= min_gap:
                gaps.append((k * hop, j * hop))
            k = j
        else:
            k += 1
    return v0 * hop, v1 * hop, gaps


def align_sentence(sent: str, x) -> list:
    """把句子里的每个字对到音频时间上：逗号处取最长的若干停顿，短句内按字数线性分配。"""
    v0, v1, gaps = voiced_regions(x)
    spans = clause_spans(sent)
    k = len(spans) - 1
    # 每个短句的期望位置（按字数比例），在附近挑最长的停顿
    lens = [b - a for a, b in spans]
    total_chars = sum(lens) or 1
    expected, acc = [], 0
    for L in lens[:-1]:
        acc += L
        expected.append(v0 + (v1 - v0) * acc / total_chars)
    chosen = []
    pool = list(gaps)
    for e in expected:
        if not pool:
            chosen.append((e, e))
            continue
        best = max(pool, key=lambda g: (g[1] - g[0]) - 0.35 * abs((g[0] + g[1]) / 2 - e))
        if abs((best[0] + best[1]) / 2 - e) > 1.2:
            chosen.append((e, e))
        else:
            chosen.append(best)
            pool.remove(best)
    chosen.sort()
    bounds = [v0] + [t for g in chosen for t in g] + [v1]
    times = [None] * len(sent)
    for ci, (a, b) in enumerate(spans):
        st, en = bounds[ci * 2], bounds[ci * 2 + 1]
        n = b - a
        for j in range(n):
            times[a + j] = st + (en - st) * j / max(n, 1)
    return times


def index_scenes(script, scenes_src):
    cfg = script.get("indextts", {})
    home = Path(os.path.expanduser(cfg.get("home", "~/tts/index-tts")))
    voice = (ROOT / cfg.get("voice", "voices/narrator.wav")).resolve()
    speed = float(cfg.get("speed", 1.0))
    alpha = float(cfg.get("emo_alpha", 0.6))
    vkey = key_of(voice.read_bytes().__len__(), voice.stat().st_mtime)
    # 多音字读音表，如 {"阿房宫": "<阿|E1><房|PANG2>宫"}；只影响送给模型的文本，字幕仍用原文
    pron = script.get("pronounce", {})
    CACHE.mkdir(parents=True, exist_ok=True)

    plan, jobs = [], []
    for sc in scenes_src:
        text = sc["narration"]
        emo = sc.get("emotion", DEFAULT_EMO)
        emo_job = {"emo_vector": [float(emo.get(k, 0)) for k in EMO_KEYS], "emo_alpha": 1.0} if isinstance(emo, dict) else {"emo_text": emo, "emo_alpha": alpha}
        items = []
        for a, b in sentences(text):
            s = text[a:b]
            for word, rep in pron.items():
                s = s.replace(word, rep)
            wav = CACHE / f"{key_of(vkey, s, json.dumps(emo, ensure_ascii=False), alpha)}.wav"
            if not wav.exists() and not any(j["out"] == str(wav) for j in jobs):
                jobs.append({"text": s, "out": str(wav), **emo_job})
            items.append((a, b, wav))
        plan.append(items)

    if jobs:
        jp = CACHE / "jobs.json"
        jp.write_text(json.dumps(jobs, ensure_ascii=False))
        print(f"IndexTTS2 合成 {len(jobs)} 句…")
        proc = subprocess.Popen(
            [str(home / ".venv/bin/python"), str(ROOT / "scripts/index_worker.py"), str(jp), str(voice)],
            cwd=home,
            env={**os.environ, "HF_ENDPOINT": os.environ.get("HF_ENDPOINT", "https://hf-mirror.com")},
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            text=True,
        )
        log = []
        for line in proc.stdout:
            log.append(line.rstrip())
            if line.startswith("["):
                print("  " + line.rstrip(), flush=True)
        if proc.wait() != 0:
            print("\n".join(log[-30:]))
            raise SystemExit("IndexTTS2 合成失败，见上面的报错")

    results = []
    for sc, items in zip(scenes_src, plan):
        text = sc["narration"]
        times = [None] * len(text)
        pieces, t = [], 0.0
        for a, b, wav in items:
            x = load_mono(wav)
            if speed != 1.0:
                tmp = wav.with_suffix(f".x{speed}.wav")
                if not tmp.exists():
                    sh(["ffmpeg", "-v", "error", "-y", "-i", str(wav), "-filter:a", f"atempo={speed}", "-ar", str(SR), "-ac", "1", str(tmp)])
                x = load_mono(tmp)
            v0, v1, _ = voiced_regions(x)
            x = x[max(0, int((v0 - 0.03) * SR)) : int((v1 + 0.05) * SR)]
            for j, tt in enumerate(align_sentence(text[a:b], x)):
                if tt is not None:
                    times[a + j] = round(t + tt, 3)
            pieces.append(x)
            pieces.append(np.zeros(int(SENT_GAP * SR)))
            t += len(x) / SR + SENT_GAP
        audio = np.concatenate(pieces[:-1]) if pieces else np.zeros(SR)
        audio = audio / (np.abs(audio).max() + 1e-9) * 0.9
        results.append((audio, times))
    return results


# ---------------------------------------------------------------- 主流程
def find_image(vid: str, idx: int):
    for ext in ("png", "jpg", "jpeg", "webp"):
        p = PUBLIC / "images" / vid / f"s{idx:02d}.{ext}"
        if p.exists():
            return f"images/{vid}/{p.name}"
    return None


def pick_video() -> str:
    vid = sys.argv[1] if len(sys.argv) > 1 else os.environ.get("VIDEO") or (CURRENT.read_text().strip() if CURRENT.exists() else "")
    available = sorted(p.parent.name for p in (ROOT / "videos").glob("*/script.json"))
    if vid not in available:
        raise SystemExit(f"请指定视频：npm run tts -- <名字>，可选 {available}")
    CURRENT.parent.mkdir(parents=True, exist_ok=True)
    CURRENT.write_text(vid)
    return vid


def main():
    vid = pick_video()
    script = json.loads((ROOT / "videos" / vid / "script.json").read_text())
    engine = script.get("engine", "index")
    AUDIO_DIR.mkdir(parents=True, exist_ok=True)
    OUT.parent.mkdir(parents=True, exist_ok=True)
    src = script["scenes"]

    rendered = []  # (音频相对路径, 时长, 逐字时间)
    if engine == "index":
        for i, (audio, times) in enumerate(index_scenes(script, src)):
            path = AUDIO_DIR / f"s{i:02d}.wav"
            wavfile.write(path, SR, (audio * 32767).astype(np.int16))
            rendered.append((f"audio/{path.name}", len(audio) / SR, times))
    else:
        voice, rate = script.get("voice", "zh-CN-YunjianNeural"), script.get("rate", "+0%")
        for i, sc in enumerate(src):
            path = AUDIO_DIR / f"s{i:02d}.mp3"
            times = asyncio.run(edge_scene(sc["narration"], sc.get("voice", voice), sc.get("rate", rate), path))
            rendered.append((f"audio/{path.name}", audio_duration(path), times))

    # 清理另一种引擎留下的旧文件
    keep = {r[0].split("/")[-1] for r in rendered}
    for f in AUDIO_DIR.glob("s*.*"):
        if f.suffix in (".wav", ".mp3") and f.name not in keep:
            f.unlink()

    scenes = []
    for i, (sc, (rel, dur, times)) in enumerate(zip(src, rendered)):
        text = sc["narration"]
        scenes.append({
            "type": sc["type"],
            "data": sc.get("data", {}),
            "narration": text,
            "audio": rel,
            "image": find_image(vid, i),
            "stickers": sc.get("stickers", []),
            "intensity": sc.get("intensity"),
            "audioDuration": round(dur, 3),
            # hold：念完后额外停留的秒数（如开场大字落定后让观众看清）
            "durationInFrames": math.ceil((dur + TAIL_PAD + sc.get("hold", 0)) * FPS),
            "charTimes": [None if t is None else round(t, 3) for t in times],
            "subtitles": subtitles(text, times, dur),
        })
        print(f"s{i:02d} {sc['type']:<9} {dur:5.1f}s  {scenes[-1]['image'] or ''}")

    # 最后一个场景多留 1 秒，给收尾重击和配乐淡出
    if scenes:
        scenes[-1]["durationInFrames"] += FPS
    bgm = next((p.name for p in sorted(PUBLIC.glob("bgm.*"))), None)
    # 骨骼人偶：把 scripts/rig.py 生成的 rig.json 嵌进时间轴
    theme = script.get("theme", {})
    img_set = theme.get("images", vid)
    rigs = {}
    for rid in theme.get("rigs", []):
        f = PUBLIC / "images" / img_set / f"rig_{rid}" / "rig.json"
        if f.exists():
            rigs[rid] = json.loads(f.read_text())
    # 连续帧人物：scripts/seqgen.py 生成的 seq_<角色>/seq.json（每个动作的帧列表、锚点、身高单位）
    seqs = {}
    for cid in theme.get("cast", {}):
        f = PUBLIC / "images" / img_set / f"seq_{cid}" / "seq.json"
        if f.exists():
            seqs[cid] = json.loads(f.read_text())
    timeline = {"id": vid, "title": script["title"], "fps": FPS, "bgm": bgm, "theme": theme, "cover": script.get("cover", {}), "rigs": rigs, "seqs": seqs, "scenes": scenes}
    OUT.write_text(json.dumps(timeline, ensure_ascii=False, indent=1))
    total = sum(s["durationInFrames"] for s in scenes) / FPS
    print(f"[{vid} · {engine}] 总时长 {total:.1f}s → {OUT.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
