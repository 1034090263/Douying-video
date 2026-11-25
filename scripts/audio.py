"""程序化生成原创配乐 + 音效（无版权问题）

  public/bgm.wav        按 timeline.json 的场景结构生成的配乐（五声音阶 · 太鼓 · 古筝 · 编钟 · 弦乐铺底）
  public/sfx/*.wav      转场呼啸、重击、盖章、弹出、蓄力等音效

用法: npm run audio   （在 npm run tts 之后运行）
"""
import json
from pathlib import Path

import numpy as np
from scipy.io import wavfile
from scipy.signal import butter, fftconvolve, sosfilt

ROOT = Path(__file__).resolve().parent.parent
PUBLIC = ROOT / "public"
SR = 44100
RNG = np.random.default_rng(7)

BPM = 96
BEAT = 60 / BPM

# 各场景类型的激烈程度 0~1（驱动鼓点密度、古筝 ostinato、音量）
INTENSITY = {"hook": 0.35, "timeline": 0.6, "stats": 0.75, "quote": 0.8, "chain": 1.0, "wall": 0.85, "summary": 0.55, "shot": 0.5}

# A 羽调式五声音阶：A C D E G
def midi_hz(m):
    return 440.0 * 2 ** ((m - 69) / 12)

PENTA = [57, 60, 62, 64, 67, 69, 72, 74, 76, 79, 81]  # A3..A5
# 和弦进行（每两小节换一次）：Am  F  G  Em
CHORDS = [[45, 57, 60, 64], [41, 57, 60, 65], [43, 55, 59, 62], [40, 55, 59, 64]]


# ---------------------------------------------------------------- 基础工具
def t_axis(dur):
    return np.arange(int(dur * SR)) / SR


def lp(x, hz, order=2):
    return sosfilt(butter(order, hz, "low", fs=SR, output="sos"), x)


def hp(x, hz, order=2):
    return sosfilt(butter(order, hz, "high", fs=SR, output="sos"), x)


def bp(x, lo, hi, order=2):
    return sosfilt(butter(order, [lo, hi], "band", fs=SR, output="sos"), x)


def place(buf, sig, at, gain=1.0):
    i = int(at * SR)
    if i >= len(buf) or i < 0:
        return
    n = min(len(sig), len(buf) - i)
    buf[i : i + n] += sig[:n] * gain


def reverb(x, secs=2.4, wet=0.3, seed=0):
    r = np.random.default_rng(seed)
    t = t_axis(secs)
    ir = r.standard_normal(len(t)) * np.exp(-t * 3.2 / secs * 2)
    ir = lp(ir, 6000)
    ir /= np.sqrt(np.sum(ir**2))
    y = fftconvolve(x, ir)[: len(x)]
    return x * (1 - wet) + y * wet


def to_stereo(x, width=0.0, seed=1):
    """单声道 → 立体声，width>0 时左右略微错开增加空间感"""
    d = int(SR * 0.011 * width)
    left, right = x.copy(), np.roll(x, d)
    return np.stack([left, right], axis=1)


def write(path, stereo, peak=0.89):
    path.parent.mkdir(parents=True, exist_ok=True)
    m = np.max(np.abs(stereo)) or 1
    wavfile.write(path, SR, (stereo / m * peak * 32767).astype(np.int16))


# ---------------------------------------------------------------- 乐器
def taiko(big=1.0, dur=1.6):
    t = t_axis(dur)
    f = 48 + 90 * np.exp(-t * 28)
    body = np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t * (4.5 / big))
    skin = lp(RNG.standard_normal(len(t)), 900) * np.exp(-t * 40) * 0.6
    return np.tanh((body + skin) * 1.6) * big


def rim(dur=0.12):
    t = t_axis(dur)
    return bp(RNG.standard_normal(len(t)), 1800, 5000) * np.exp(-t * 60) * 0.5


def shaker(dur=0.08):
    t = t_axis(dur)
    return hp(RNG.standard_normal(len(t)), 6000) * np.exp(-t * 70) * 0.25


def guzheng(midi, dur=1.8, bright=0.5):
    """Karplus-Strong 拨弦 + 轻微颤音"""
    f = midi_hz(midi)
    n = int(SR / f)
    total = int(dur * SR)
    buf = RNG.uniform(-1, 1, n) * (0.6 + bright * 0.4)
    out = np.zeros(total)
    damp = 0.996 - (1 - bright) * 0.004
    for i in range(total):
        v = buf[i % n]
        out[i] = v
        buf[i % n] = damp * 0.5 * (v + buf[(i + 1) % n])
    t = t_axis(dur)
    vib = 1 + 0.004 * np.sin(2 * np.pi * 5.5 * t) * np.clip(t * 3 - 0.5, 0, 1)
    idx = np.clip(np.cumsum(vib).astype(int), 0, total - 1)
    return lp(out[idx], 5500) * np.exp(-t * 1.2)


def bianzhong(midi, dur=4.0):
    """编钟：非谐波泛音，长衰减"""
    f = midi_hz(midi)
    t = t_axis(dur)
    out = np.zeros_like(t)
    for ratio, amp, decay in [(1, 1, 1.1), (2.41, 0.55, 1.8), (3.86, 0.35, 2.6), (5.37, 0.2, 3.5), (0.5, 0.25, 0.8)]:
        out += amp * np.sin(2 * np.pi * f * ratio * t + RNG.uniform(0, 6)) * np.exp(-t * decay)
    strike = bp(RNG.standard_normal(len(t)), 1500, 6000) * np.exp(-t * 80) * 0.3
    return (out + strike) * 0.5


def pad(chord, dur):
    t = t_axis(dur)
    out = np.zeros_like(t)
    for m in chord:
        for det in (-0.12, 0, 0.11):
            ph = 2 * np.pi * midi_hz(m + det) * t
            out += (2 * ((ph / (2 * np.pi)) % 1) - 1) * 0.12  # 锯齿波
    env = np.minimum(1, t / 1.2) * np.minimum(1, (dur - t) / 0.8 + 0.001)
    return lp(out, 1100) * np.clip(env, 0, 1)


def sub_bass(midi, dur):
    t = t_axis(dur)
    return np.sin(2 * np.pi * midi_hz(midi) * t) * np.exp(-t * 1.5) * 0.7


# ---------------------------------------------------------------- 电子风乐器（游戏题材）
CHORDS_MINOR = [[45, 57, 60, 64], [41, 57, 60, 65], [48, 55, 60, 64], [43, 55, 59, 62]]  # Am F C G
CHORDS_DARK = [[45, 57, 60, 64], [41, 53, 57, 60], [38, 50, 53, 57], [40, 52, 56, 59]]  # Am F Dm E


def saw(freq, t):
    return 2 * ((freq * t) % 1) - 1


def kick(gain=1.0):
    t = t_axis(0.45)
    body = np.sin(2 * np.pi * np.cumsum(45 + 120 * np.exp(-t * 32)) / SR) * np.exp(-t * 8)
    click = hp(RNG.standard_normal(len(t)), 3000) * np.exp(-t * 300) * 0.4
    return np.tanh((body + click) * 1.8) * gain


def snare():
    t = t_axis(0.3)
    noise = bp(RNG.standard_normal(len(t)), 1500, 7000) * np.exp(-t * 20) * 0.7
    tone = np.sin(2 * np.pi * 190 * t) * np.exp(-t * 28) * 0.5
    return noise + tone


def hat(open_=False):
    t = t_axis(0.25 if open_ else 0.06)
    return hp(RNG.standard_normal(len(t)), 7500) * np.exp(-t * (12 if open_ else 80)) * 0.3


def synth_pluck(midi, dur=0.4, bright=0.6):
    t = t_axis(dur)
    f = midi_hz(midi)
    x = saw(f, t) + saw(f * 1.006, t) * 0.7 + saw(f * 0.994, t) * 0.7
    bright_part = lp(x, 1500 + 3500 * bright) * np.exp(-t * 14)
    body = lp(x, 900) * np.exp(-t * 6)
    return (bright_part + body) * 0.3


def synth_bass(midi, dur):
    t = t_axis(dur)
    f = midi_hz(midi)
    x = saw(f, t) * 0.6 + np.sin(2 * np.pi * f * t)
    return lp(x, 380) * np.exp(-t * 3) * 0.8


def synth_pad(chord, dur):
    t = t_axis(dur)
    out = np.zeros_like(t)
    for m in chord:
        for det in (-0.08, 0, 0.07):
            out += saw(midi_hz(m + det), t) * 0.1
    env = np.minimum(1, t / 0.8) * np.clip((dur - t) / 0.6, 0, 1)
    return lp(out, 1800) * env


def piano(midi, dur=2.6, vel=1.0):
    """加法合成钢琴：略带不谐和的泛音 + 琴槌噪声"""
    t = t_axis(dur)
    f = midi_hz(midi)
    out = np.zeros_like(t)
    for k, amp, dec in [(1, 1.0, 1.6), (2.003, 0.5, 2.4), (3.01, 0.22, 3.2), (4.03, 0.1, 4.2), (5.06, 0.05, 5.0)]:
        out += amp * np.sin(2 * np.pi * f * k * t) * np.exp(-t * dec)
    hammer = lp(RNG.standard_normal(len(t)), 2500) * np.exp(-t * 90) * 0.15
    env = np.minimum(1, t / 0.004)
    return (out * env + hammer) * 0.35 * vel


def stinger():
    """剧情重音：反向蓄力 0.8s → 低音钢琴簇 + 次低频冲击（返回信号和蓄力时长）"""
    pre = 0.8
    t = t_axis(pre)
    swell = hp(RNG.standard_normal(len(t)), 1500) * (t / pre) ** 3 * 0.25
    swell += np.sin(2 * np.pi * np.cumsum(80 + 300 * (t / pre) ** 2) / SR) * (t / pre) ** 2 * 0.15
    body = np.zeros(int(4.0 * SR))
    for m in (33, 40, 45, 46):  # A1 E2 A2 Bb2：带不和谐的低音簇
        place(body, piano(m, 4.0, 1.2), 0)
    tt = t_axis(2.0)
    place(body, np.sin(2 * np.pi * np.cumsum(30 + 50 * np.exp(-tt * 6)) / SR) * np.exp(-tt * 2.2) * 0.9, 0)
    return np.concatenate([swell, body]), pre


def heartbeat():
    """一声心跳（咚-咚）"""
    t = t_axis(0.5)
    thump = lambda: np.sin(2 * np.pi * np.cumsum(45 + 40 * np.exp(-t * 30)) / SR) * np.exp(-t * 14)
    out = np.zeros(int(0.7 * SR))
    place(out, thump(), 0, 0.9)
    place(out, thump(), 0.22, 0.6)
    return lp(out, 300)


# ---------------------------------------------------------------- 音效
def sfx_library():
    lib = {}
    # 转场呼啸：带通噪声扫频
    d = 0.55
    t = t_axis(d)
    n = RNG.standard_normal(len(t))
    sweep = np.zeros_like(t)
    for k in range(0, len(t), 512):
        frac = k / len(t)
        lo = 250 + 2500 * frac**1.5
        seg = n[k : k + 2048]
        if len(seg) > 64:
            sweep[k : k + 512] = bp(seg, lo, lo * 2.2)[:512][: len(sweep[k : k + 512])]
    env = np.sin(np.pi * np.clip(t / d, 0, 1)) ** 2
    lib["whoosh"] = to_stereo(reverb(sweep * env, 1.0, 0.25), 1)

    # 重击：太鼓 + 次低频 + 镲片噪声 + 混响
    t = t_axis(3.0)
    sub = np.sin(2 * np.pi * np.cumsum(38 + 40 * np.exp(-t * 8)) / SR) * np.exp(-t * 1.6)
    crash = hp(RNG.standard_normal(len(t)), 3000) * np.exp(-t * 3) * 0.25
    hit = np.zeros_like(t)
    place(hit, taiko(1.4, 2.0), 0)
    lib["boom"] = to_stereo(reverb(np.tanh((hit + sub * 1.2 + crash) * 1.3), 2.8, 0.35), 1)

    # 盖章：闷响 + 木质咔嗒
    t = t_axis(0.5)
    thud = np.sin(2 * np.pi * np.cumsum(90 + 120 * np.exp(-t * 50)) / SR) * np.exp(-t * 14)
    click = bp(RNG.standard_normal(len(t)), 800, 3500) * np.exp(-t * 90) * 0.7
    lib["stamp"] = to_stereo(reverb(thud + click, 0.6, 0.15), 0.5)

    # 弹出：短促下滑音
    t = t_axis(0.25)
    pop = np.sin(2 * np.pi * np.cumsum(900 * np.exp(-t * 9) + 250) / SR) * np.exp(-t * 22)
    lib["pop"] = to_stereo(reverb(pop * 0.6 + rim(0.25) * 0.4, 0.5, 0.2), 0.5)

    # 卡片落下：小鼓
    lib["thump"] = to_stereo(reverb(taiko(0.7, 0.8) + rim(0.8) * 0.5, 1.2, 0.25), 0.5)

    # 蓄力：上扬噪声 + 上滑音，在重击前 1.5s 播放
    d = 1.5
    t = t_axis(d)
    rise = np.sin(2 * np.pi * np.cumsum(120 + 500 * (t / d) ** 2) / SR) * (t / d) ** 2 * 0.5
    air = hp(RNG.standard_normal(len(t)), 2000) * (t / d) ** 3 * 0.4
    lib["riser"] = to_stereo(reverb(rise + air, 1.0, 0.3), 1)

    # 编钟一击
    lib["bell"] = to_stereo(reverb(bianzhong(57, 4.5), 3.0, 0.35), 1)

    # 数字滚动的嘀嗒（单击，组件里按节奏重复）
    t = t_axis(0.05)
    lib["tick"] = to_stereo(bp(RNG.standard_normal(len(t)), 2500, 7000) * np.exp(-t * 120) * 0.5)
    return lib


# ---------------------------------------------------------------- 配乐
def scene_kind(sc):
    if sc["type"] == "quote" and "总结" in sc["data"].get("label", ""):
        return "summary"
    return sc["type"]


def compose(timeline):
    global BPM, BEAT
    BPM = timeline.get("theme", {}).get("bpm", 96)
    BEAT = 60 / BPM
    fps = timeline["fps"]
    starts, a = [], 0
    for sc in timeline["scenes"]:
        starts.append(a / fps)
        a += sc["durationInFrames"]
    total = a / fps + 0.5
    n_beats = int(total / BEAT) + 1

    def intensity_at(t):
        for i in range(len(starts) - 1, -1, -1):
            if t >= starts[i]:
                sc = timeline["scenes"][i]
                return sc.get("intensity") or INTENSITY.get(scene_kind(sc), 0.6)
        return 0.3

    # 开场重击之前鼓不进（钩子段只有铺底和零星古筝）
    hook = timeline["scenes"][0]
    big_cue = hook["data"].get("bigCue")
    drums_from = 0.0
    if hook["type"] == "hook" and big_cue and big_cue in hook["narration"]:
        drums_from = hook["charTimes"][hook["narration"].index(big_cue)] or 0.0

    music = timeline.get("theme", {}).get("music", "guzheng")
    synth = music == "synth"
    pianist = music == "piano"
    chords = CHORDS_DARK if pianist else CHORDS_MINOR if synth else CHORDS
    drums = np.zeros(int(total * SR))
    pluck = np.zeros_like(drums)
    bed = np.zeros_like(drums)
    bells = np.zeros_like(drums)

    # 弦乐铺底 + 低音（每 2 小节换和弦）
    bar = BEAT * 4
    for k in range(int(total / (bar * 2)) + 1):
        t0 = k * bar * 2
        ch = chords[k % len(chords)]
        if pianist:
            place(bed, pad(ch[1:], bar * 2 + 1.0), t0, 0.35)
            place(bed, sub_bass(ch[0], bar * 2), t0, 0.35)
        elif synth:
            place(bed, synth_pad(ch[1:], bar * 2 + 0.6), t0, 0.8)
        else:
            place(bed, pad(ch[1:], bar * 2 + 1.0), t0, 0.9)
            place(bed, sub_bass(ch[0], bar * 2), t0, 0.6)

    melody_pos = 5
    for b in range(n_beats):
        t = b * BEAT
        x = intensity_at(t)
        in_bar = b % 4
        if pianist:
            # 钢琴：八分音符分解和弦（低→高→回落），强度高时加低音八度和高音旋律
            ch = chords[(b // 8) % len(chords)]
            arp = [ch[0] + 12, ch[1], ch[2], ch[3], ch[2] + 12, ch[3], ch[2], ch[1]]
            for s8 in range(2):
                n = arp[(in_bar * 2 + s8) % 8]
                place(pluck, piano(n, 2.4, 0.55 + 0.35 * x), t + s8 * BEAT / 2, 0.8)
            if in_bar == 0:
                place(pluck, piano(ch[0], 3.5, 0.7), t, 0.9)
            if in_bar == 2 and RNG.random() < 0.25 + 0.4 * x:
                place(pluck, piano(ch[3] + 12 + RNG.choice([0, 2, 3]), 3.0, 0.6), t, 0.7)
            if x >= 0.7:  # 紧张段落：心跳低鼓
                place(drums, heartbeat(), t, 0.5 + (x - 0.7) * 1.2)
            continue
        if synth:
            ch = chords[(b // 8) % len(chords)]
            on = t >= drums_from - 0.01
            if on:
                # 鼓：强度越高越密（半拍 → 四踩）
                if in_bar == 0 or (x >= 0.5 and in_bar == 2) or x >= 0.8:
                    place(drums, kick(), t, 0.9)
                if (x >= 0.55 and in_bar in (1, 3)) or (x < 0.55 and in_bar == 2):
                    place(drums, snare(), t, 0.6)
                for s8 in range(4 if x >= 0.75 else 2):
                    place(drums, hat(open_=(s8 == 2 and x >= 0.75)), t + s8 * BEAT / (4 if x >= 0.75 else 2), 0.5 * (0.5 + x * 0.5))
                # 低音：八分音符根音
                for s8 in range(2):
                    place(bed, synth_bass(ch[0] + 12 * (s8 % 2 if x >= 0.8 else 0), BEAT / 2), t + s8 * BEAT / 2, 0.55 * (0.5 + x * 0.5))
            # 琶音：低强度八分，高强度十六分
            sub = 4 if x >= 0.6 else 2
            arp = [ch[1] + 12, ch[2] + 12, ch[3] + 12, ch[2] + 12]
            for s16 in range(sub):
                place(pluck, synth_pluck(arp[(b * sub + s16) % 4], 0.35, 0.4 + x * 0.5), t + s16 * BEAT / sub, 0.3 * (0.5 + x * 0.5))
            continue
        # 鼓
        if t >= drums_from - 0.01:
            if in_bar == 0:
                place(drums, taiko(1.0), t, 0.9 * (0.5 + x * 0.5))
            if in_bar == 2 and x > 0.5:
                place(drums, taiko(0.8), t, 0.7 * x)
            if in_bar == 3 and x > 0.8:
                place(drums, taiko(0.6, 0.6), t + BEAT / 2, 0.5)
            if x > 0.45:
                place(drums, rim(), t + BEAT / 2, 0.5 * x)
            if x > 0.65:
                for s in range(4):
                    place(drums, shaker(), t + s * BEAT / 4, 0.35 * x * (1.0 if s % 2 else 0.6))
        # 古筝：低强度零星旋律，高强度八分/十六分 ostinato
        ch = chords[(b // 8) % len(chords)]
        if x < 0.5:
            if RNG.random() < 0.45:
                melody_pos = int(np.clip(melody_pos + RNG.choice([-2, -1, 1, 2]), 2, len(PENTA) - 1))
                place(pluck, guzheng(PENTA[melody_pos], 2.2, 0.4), t, 0.55)
        else:
            sub = 4 if x >= 0.9 else 2
            root = ch[1] + 12 if ch[1] + 12 in PENTA else PENTA[5]
            seq = [root, root + 7, root + 12, root + 7] if sub == 4 else [root, root + 7]
            for s in range(sub):
                m = seq[s % len(seq)]
                m = min(PENTA, key=lambda p: abs(p - m))
                place(pluck, guzheng(m, 0.9, 0.6), t + s * BEAT / sub, 0.32 * (0.6 + x * 0.4))
            if in_bar == 0 and RNG.random() < 0.6:
                melody_pos = int(np.clip(melody_pos + RNG.choice([-2, -1, 1, 2, 3]), 4, len(PENTA) - 1))
                place(pluck, guzheng(PENTA[melody_pos], 1.8, 0.7), t, 0.45)

    # 段落起点敲一下编钟（电子风不用）
    for i, sc in enumerate(timeline["scenes"]):
        if music == "guzheng" and scene_kind(sc) in ("quote", "summary", "chain"):
            place(bells, bianzhong(57 if scene_kind(sc) != "summary" else 52), starts[i], 0.5)

    # 剧情重音：场景 data.hits 里的 cue
    hits_track = np.zeros_like(drums)
    for i, sc in enumerate(timeline["scenes"]):
        for cue in sc["data"].get("hits", []) if isinstance(sc.get("data"), dict) else []:
            idx = sc["narration"].find(cue)
            ct = sc["charTimes"][idx] if idx >= 0 else None
            if ct is None:
                continue
            sig, pre = stinger()
            place(hits_track, sig, starts[i] + ct - pre, 0.9)

    # 音量走势：按强度起伏，结尾淡出
    t = np.arange(len(drums)) / SR
    curve = np.array([intensity_at(x) for x in t[:: SR // 20]])
    curve = np.interp(t, t[:: SR // 20], curve)
    curve = lp(curve, 0.8, 1)
    end = a / fps
    fade = np.clip((end - t) / 1.2, 0, 1)

    mix = (
        to_stereo(reverb(drums, 1.6, 0.2, 1), 0.3) * 1.0
        + to_stereo(reverb(pluck, 2.6, 0.35, 2), 1.0) * 0.9
        + to_stereo(reverb(bed, 3.0, 0.4, 3), 1.0) * (0.3 + 0.15 * (1 - curve))[:, None]
        + to_stereo(reverb(bells, 3.5, 0.45, 4), 1.0) * 0.8
        + to_stereo(reverb(hits_track, 3.0, 0.4, 5), 1.0) * 1.1
    )
    mix *= (0.6 + 0.4 * curve)[:, None] * fade[:, None]
    return np.tanh(mix / (np.max(np.abs(mix)) + 1e-9) * 1.4)


def main():
    timeline = json.loads((ROOT / "src" / "generated" / "timeline.json").read_text())
    for name, sig in sfx_library().items():
        write(PUBLIC / "sfx" / f"{name}.wav", sig)
    write(PUBLIC / "bgm.wav", compose(timeline), 0.8)
    for old in PUBLIC.glob("bgm.*"):
        if old.suffix != ".wav":
            old.unlink()
    print("生成 public/bgm.wav 和 public/sfx/*.wav")


if __name__ == "__main__":
    main()
