import React from 'react';
import {AbsoluteFill, Easing, Img, interpolate, random, spring, staticFile, useCurrentFrame} from 'remotion';
import {C, DISPLAY, FPS, SANS, SCENE_STARTS, SceneData, TIMELINE, beatPulse, cueFrame, prog} from './lib';
import {Flash, Sfx} from './ui';

/**
 * 插画镜头（叙事类）：
 *  - 背景 2.5D 视差：原图 + 中景/近景遮罩（scripts/depth.py 生成），随镜头以不同速度移动
 *  - 镜头：起止推拉 + cue 触发的推近 + 手持晃动（随情绪）+ 鼓点微震 + 重音冲击
 *  - 人物表演：持续情绪 mood + cue 触发动作 acts（发抖、下沉、后跳、前倾、摇头、转身、换姿势…）
 *  - 氛围特效 fx：rain / snow / dust / fog / smoke / flicker / headlights / heartbeat
 *
 * data: {
 *   bg, caption?, title?,
 *   mood?: 'calm'|'tense'|'fear'|'sad'|'cold',          // 整个镜头的情绪，决定晃动幅度、心跳
 *   camera?: {from: [缩放, x, y], to: [缩放, x, y]},
 *   cam?: [{cue, to: [缩放, x, y], dur?}],                 // 剧情推镜
 *   hits?: [cue],                                         // 重音：推近+震动+压暗脉冲（配乐同步落重音）
 *   fx?: [...], dark?: {cue, to}, flash?: [cue], sfx?: [...],
 *   layers: [{img, x, y, h, z?, glow?, flip?, mood?, enter?, exit?, move?, dim?,
 *             acts?: [{cue, do, amount?, dur?, img?, x?}]}]
 * }
 */

type Act = {cue: string; do: 'tremble' | 'sink' | 'jump' | 'lean' | 'shake' | 'nod' | 'turn' | 'step' | 'swap' | 'rise' | 'calm'; amount?: number; dur?: number; img?: string; x?: number};
type Layer = {
  img: string;
  x: number;
  y: number;
  h: number;
  flip?: boolean;
  glow?: boolean;
  z?: number;
  mood?: string;
  enter?: {cue?: string; type?: 'fade' | 'left' | 'right' | 'up' | 'pop'};
  exit?: {cue: string; type?: 'fade' | 'left' | 'right'};
  move?: {cue: string; x?: number; y?: number; dur?: number}[];
  dim?: {cue: string; to: number};
  acts?: Act[];
};

const src = (f: string) => staticFile(`images/${TIMELINE.id}/${f}`);
const clamp = {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'} as const;
const ease = Easing.bezier(0.45, 0, 0.25, 1);
const noise = (f: number, seed: number) => Math.sin(f / 23 + seed) * 0.6 + Math.sin(f / 11.3 + seed * 2.1) * 0.3 + Math.sin(f / 5.7 + seed * 3.7) * 0.1;

/** 计算人物在当前帧的表演变换 */
const acting = (scene: SceneData, l: Layer, frame: number, gf: number) => {
  let dx = 0;
  let dy = 0;
  let rot = 0;
  let sx = 1;
  let sy = 1;
  let flip = l.flip ? -1 : 1;
  let swapImg: string | null = null;
  let swapP = 0;
  let mood = l.mood ?? 'calm';
  let x = l.x;
  const acts = (l.acts ?? []).map((a) => ({...a, at: cueFrame(scene, a.cue, 0)})).sort((a, b) => a.at - b.at);
  for (const a of acts) {
    const k = frame - a.at;
    if (k < 0) break;
    const amt = a.amount ?? 1;
    const p = prog(frame, a.at, a.dur ?? 20);
    switch (a.do) {
      case 'jump': {
        // 受惊后跳：快速上弹再落回，身体略后仰
        const j = k < 18 ? Math.sin((k / 18) * Math.PI) : 0;
        dy -= j * 50 * amt;
        rot -= j * 3 * amt * flip;
        sx *= 1 + j * 0.03;
        break;
      }
      case 'shake':
        if (k < 16) dx += Math.sin(k * 1.9) * (16 - k) * 0.9 * amt;
        break;
      case 'nod':
        if (k < 24) dy += Math.abs(Math.sin((k / 24) * Math.PI * 2)) * 10 * amt;
        break;
      case 'sink':
        dy += p * 36 * amt;
        sy *= 1 - p * 0.025 * amt;
        mood = 'sad';
        break;
      case 'rise':
        dy -= p * 24 * amt;
        break;
      case 'lean':
        rot += p * 4 * amt * flip;
        dx += p * 18 * amt * flip;
        break;
      case 'turn':
        flip = (l.flip ? -1 : 1) * (k < 10 ? 1 - 2 * prog(frame, a.at, 10) : -1);
        break;
      case 'step':
        x = x + ((a.x ?? x) - x) * prog(frame, a.at, a.dur ?? 36);
        break;
      case 'swap':
        swapImg = a.img ?? null;
        swapP = prog(frame, a.at, 12);
        break;
      case 'tremble':
        mood = 'fear';
        break;
      case 'calm':
        mood = 'calm';
        break;
    }
  }
  // 持续情绪
  const seed = l.x * 0.01;
  if (mood === 'fear') {
    dx += Math.sin(frame * 1.7 + seed) * 2.6;
    rot += Math.sin(frame * 2.3 + seed) * 0.5;
    sy *= 1 + Math.sin(frame / 3) * 0.006;
  } else if (mood === 'sad') {
    rot += Math.sin(frame / 40 + seed) * 1.0;
    dy += 6 + Math.sin(frame / 30) * 3;
  } else if (mood === 'tense') {
    sy *= 1 + Math.sin(frame / 9) * 0.01 + beatPulse(gf) * 0.012;
    dx += noise(frame, seed) * 2;
  } else if (mood === 'cold') {
    sy *= 1 + Math.sin(frame / 40) * 0.003;
  } else {
    sy *= 1 + Math.sin(frame / 22 + seed) * 0.006;
    rot += Math.sin(frame / 55 + seed) * 0.4;
  }
  return {dx, dy, rot, sx: sx * flip, sy, x, swapImg, swapP};
};

const LayerView: React.FC<{scene: SceneData; l: Layer; gf: number}> = ({scene, l, gf}) => {
  const frame = useCurrentFrame();
  const enterAt = l.enter?.cue ? cueFrame(scene, l.enter.cue, 0) : 0;
  const type = l.enter?.type ?? 'fade';
  const k = frame - enterAt;
  if (k < 0) return null;
  const a = acting(scene, l, frame, gf);
  let x = a.x;
  let y = l.y;
  for (const m of l.move ?? []) {
    const at = cueFrame(scene, m.cue, 0);
    const p = interpolate(frame, [at, at + (m.dur ?? 40)], [0, 1], {...clamp, easing: ease});
    x = x + ((m.x ?? x) - x) * p;
    y = y + ((m.y ?? y) - y) * p;
  }
  const walkIn = type === 'left' || type === 'right';
  const ep = prog(frame, enterAt, walkIn ? 40 : 20);
  let opacity = ep;
  let dx = 0;
  let dy = 0;
  let s = 1;
  if (type === 'left') dx = (1 - ep) * -760;
  if (type === 'right') dx = (1 - ep) * 760;
  if (type === 'up') dy = (1 - ep) * 160;
  if (type === 'fade') dy = (1 - ep) * 30;
  if (type === 'pop') s = spring({frame: k, fps: FPS, config: {damping: 11, stiffness: 170}});
  const walking = walkIn && ep < 1;
  const bob = walking ? -Math.abs(Math.sin(frame / 4.2)) * 14 : 0;
  const sway = walking ? Math.sin(frame / 4.2) * 1.5 : 0;
  if (l.exit) {
    const xp = prog(frame, cueFrame(scene, l.exit.cue, 999), 24);
    opacity *= 1 - xp;
    if (l.exit.type === 'left') dx -= xp * 760;
    if (l.exit.type === 'right') dx += xp * 760;
  }
  const dim = l.dim ? interpolate(prog(frame, cueFrame(scene, l.dim.cue, 0), 20), [0, 1], [1, l.dim.to]) : 1;
  const filter = [
    l.glow ? 'brightness(1.6) saturate(0.2) drop-shadow(0 0 30px #fff) drop-shadow(0 0 60px #bcd4ff)' : 'drop-shadow(0 18px 26px #000a)',
    dim < 1 ? `brightness(${dim})` : '',
  ].join(' ');
  const imgStyle: React.CSSProperties = {position: 'absolute', left: 0, bottom: 0, height: l.h, transform: 'translateX(-50%)'};
  return (
    <div
      style={{
        position: 'absolute',
        left: x + dx + a.dx,
        top: y + dy + bob + a.dy,
        width: 0,
        height: 0,
        opacity,
        zIndex: l.z ?? 1,
        filter,
        transform: `rotate(${a.rot + sway}deg) scale(${a.sx * s}, ${a.sy * s})`,
        transformOrigin: '0 0',
      }}
    >
      <Img src={src(l.img)} style={{...imgStyle, opacity: a.swapImg ? 1 - a.swapP : 1}} />
      {a.swapImg && <Img src={src(a.swapImg)} style={{...imgStyle, opacity: a.swapP}} />}
    </div>
  );
};

// ---------------------------------------------------------------- 氛围特效
const Rain: React.FC<{heavy?: boolean}> = ({heavy}) => {
  const frame = useCurrentFrame();
  return (
    <>
      {[...Array(heavy ? 140 : 80)].map((_, i) => {
        const sp = 38 + random(`rv${i}`) * 26;
        const y = ((random(`ry${i}`) * 2200 + frame * sp) % 2200) - 200;
        const x = (((random(`rx${i}`) * 1300 - frame * sp * 0.18) % 1300) + 1300) % 1300;
        return (
          <div
            key={i}
            style={{position: 'absolute', left: x, top: y, width: 2, height: 46 + random(`rl${i}`) * 40, background: 'linear-gradient(#fff0, #dce8ffaa)', transform: 'rotate(10deg)', opacity: 0.55}}
          />
        );
      })}
    </>
  );
};

const Snow: React.FC = () => {
  const frame = useCurrentFrame();
  return (
    <>
      {[...Array(70)].map((_, i) => {
        const sp = 0.8 + random(`v${i}`) * 1.8;
        const size = 3 + random(`r${i}`) * 7;
        return (
          <div
            key={i}
            style={{
              position: 'absolute',
              left: (random(`x${i}`) * 1080 + Math.sin(frame / 40 + i) * 40 + 1080) % 1080,
              top: (random(`y${i}`) * 1920 + frame * sp) % 1920,
              width: size,
              height: size,
              borderRadius: '50%',
              background: '#fff',
              opacity: 0.3 + random(`o${i}`) * 0.5,
              filter: size > 7 ? 'blur(2px)' : undefined,
            }}
          />
        );
      })}
    </>
  );
};

const Dust: React.FC = () => {
  const frame = useCurrentFrame();
  return (
    <>
      {[...Array(40)].map((_, i) => (
        <div
          key={i}
          style={{
            position: 'absolute',
            left: random(`dx${i}`) * 1080 + Math.sin(frame / (50 + i) + i) * 40,
            top: random(`dy${i}`) * 1500 + 200 + Math.cos(frame / (60 + i) + i) * 30,
            width: 4,
            height: 4,
            borderRadius: '50%',
            background: '#fff6d8',
            opacity: 0.25 + 0.35 * Math.abs(Math.sin(frame / 30 + i)),
            boxShadow: '0 0 8px #fff6d8',
          }}
        />
      ))}
    </>
  );
};

const Fog: React.FC = () => {
  const frame = useCurrentFrame();
  return (
    <>
      {[0, 1, 2].map((i) => (
        <div
          key={i}
          style={{
            position: 'absolute',
            left: ((frame * (0.6 + i * 0.3) + i * 500) % 2200) - 900,
            top: 900 + i * 260,
            width: 1400,
            height: 420,
            borderRadius: '50%',
            background: 'radial-gradient(ellipse, #dfe7ff55 0%, #dfe7ff00 70%)',
            filter: 'blur(30px)',
          }}
        />
      ))}
    </>
  );
};

const Smoke: React.FC = () => {
  const frame = useCurrentFrame();
  return (
    <>
      {[...Array(8)].map((_, i) => {
        const k = (frame + i * 30) % 240;
        return (
          <div
            key={i}
            style={{
              position: 'absolute',
              left: 200 + Math.sin(k / 20 + i) * 60 + i * 20,
              top: 1300 - k * 3,
              width: 160 + k,
              height: 160 + k,
              borderRadius: '50%',
              background: 'radial-gradient(circle, #e8eef799 0%, #e8eef700 70%)',
              opacity: 0.5 * (1 - k / 240),
              filter: 'blur(16px)',
            }}
          />
        );
      })}
    </>
  );
};

const Headlights: React.FC = () => {
  const frame = useCurrentFrame();
  const p = ((frame % 150) / 150) * 1.6 - 0.3;
  return <AbsoluteFill style={{background: `linear-gradient(105deg, #fff0 ${p * 100 - 15}%, #fff4d655 ${p * 100}%, #fff0 ${p * 100 + 15}%)`, mixBlendMode: 'screen'}} />;
};

const Flicker: React.FC = () => {
  const frame = useCurrentFrame();
  const r = random(`fl${Math.floor(frame / 3)}`);
  const off = r < 0.08 ? 0.45 : r < 0.15 ? 0.2 : 0;
  return <AbsoluteFill style={{background: '#000', opacity: off}} />;
};

// ---------------------------------------------------------------- 大标题
const TitleCard: React.FC<{scene: SceneData; t: {cue?: string; out?: string; text: string; sub?: string; y?: number}}> = ({scene, t}) => {
  const frame = useCurrentFrame();
  const at = cueFrame(scene, t.cue, 0);
  const p = prog(frame, at, 30);
  const o = t.out ? 1 - prog(frame, cueFrame(scene, t.out, 999), 20) : 1;
  if (frame < at) return null;
  return (
    <div style={{position: 'absolute', left: 0, right: 0, top: t.y ?? 700, textAlign: 'center', opacity: p * o}}>
      <div
        style={{
          fontFamily: DISPLAY,
          fontWeight: 900,
          fontSize: 200,
          color: '#f6f3ee',
          letterSpacing: 40 + (1 - p) * 60,
          paddingLeft: 40 + (1 - p) * 60,
          textShadow: '0 0 40px #9ec5ff, 0 0 90px #5b7fd1, 0 8px 20px #000',
        }}
      >
        {t.text}
      </div>
      {t.sub && <div style={{fontFamily: DISPLAY, fontSize: 48, color: '#d8e2f2', letterSpacing: 16, marginTop: 10, textShadow: '0 4px 12px #000'}}>{t.sub}</div>}
    </div>
  );
};

const SHAKE: Record<string, number> = {calm: 2, cold: 1, sad: 2.5, tense: 5, fear: 8};

export const ShotScene: React.FC<{scene: SceneData}> = ({scene}) => {
  const frame = useCurrentFrame();
  const idx = TIMELINE.scenes.indexOf(scene as (typeof TIMELINE.scenes)[number]);
  const gf = frame + (SCENE_STARTS[idx] ?? 0);
  const d = scene.data;
  const dur = scene.durationInFrames;
  const mood: string = d.mood ?? 'calm';
  const cam = (d.camera ?? {from: [1.12, 0, 20], to: [1.0, 0, 0]}) as {from: number[]; to: number[]};
  const t = interpolate(frame, [0, dur], [0, 1], {...clamp, easing: ease});
  let sc = cam.from[0] + (cam.to[0] - cam.from[0]) * t;
  let cx = cam.from[1] + (cam.to[1] - cam.from[1]) * t;
  let cy = cam.from[2] + (cam.to[2] - cam.from[2]) * t;
  // 剧情推镜：叠加在基础运动上
  for (const m of (d.cam ?? []) as {cue: string; to: number[]; dur?: number}[]) {
    const at = cueFrame(scene, m.cue, 0);
    const p = interpolate(frame, [at, at + (m.dur ?? 24)], [0, 1], {...clamp, easing: ease});
    sc += (m.to[0] - sc) * p;
    cx += (m.to[1] - cx) * p;
    cy += (m.to[2] - cy) * p;
  }
  // 重音：推近 + 震动 + 压暗脉冲
  const hits = ((d.hits ?? []) as string[]).map((c) => cueFrame(scene, c, 0));
  let hitK = 0;
  let hitShake = 0;
  for (const at of hits) {
    const k = frame - at;
    if (k >= 0 && k < 40) {
      hitK = Math.max(hitK, Math.exp(-k / 10));
      if (k < 12) hitShake += Math.sin(k * 2.4) * (12 - k) * 1.6;
    }
  }
  sc *= 1 + hitK * 0.06;
  // 手持晃动 + 鼓点微震
  const amp = SHAKE[mood] ?? 2;
  cx += noise(frame, 1.3) * amp * 2 + hitShake;
  cy += noise(frame, 4.1) * amp * 1.4;
  const rot = noise(frame, 7.7) * amp * 0.05;
  sc *= 1 + beatPulse(gf) * (mood === 'tense' || mood === 'fear' ? 0.012 : 0.005);
  const dark: number = d.dark ? prog(frame, cueFrame(scene, d.dark.cue, 0), 24) * Number(d.dark.to) : 0;
  const layers = (d.layers ?? []) as Layer[];
  const fx = (d.fx ?? []) as string[];
  const heartbeat = fx.includes('heartbeat') ? beatPulse(gf) : 0;
  const layerT = (k: number) => `scale(${1 + (sc - 1) * k + (k - 1) * 0.02}) translate(${cx * k}px, ${cy * k}px) rotate(${rot}deg)`;
  const bgImg = <Img src={src(d.bg)} style={{position: 'absolute', left: 0, top: 0, width: 1080, height: 1920, objectFit: 'cover'}} />;
  const masked = (suffix: string, k: number) => (
    <AbsoluteFill
      style={{
        transform: layerT(k),
        transformOrigin: '50% 55%',
        WebkitMaskImage: `url(${src(d.bg.replace('.png', `${suffix}.png`))})`,
        WebkitMaskSize: '100% 100%',
        maskImage: `url(${src(d.bg.replace('.png', `${suffix}.png`))})`,
        maskSize: '100% 100%',
      }}
    >
      {bgImg}
    </AbsoluteFill>
  );
  return (
    <>
      {((d.sfx ?? []) as {cue: string; name: string; volume?: number}[]).map((s, i) => (
        <Sfx key={i} at={cueFrame(scene, s.cue, 0)} name={s.name} volume={s.volume ?? 0.6} />
      ))}
      <AbsoluteFill style={{overflow: 'hidden', background: '#05070d'}}>
        {/* 远景 / 中景 / 近景：同一张图按深度遮罩分层，移动速度不同 */}
        <AbsoluteFill style={{transform: layerT(0.7), transformOrigin: '50% 55%'}}>{bgImg}</AbsoluteFill>
        {masked('_m1', 1.0)}
        {masked('_m2', 1.3)}
        {fx.includes('fog') && <Fog />}
        {fx.includes('smoke') && <Smoke />}
        {/* 人物：跟随中近景之间的速度 */}
        <AbsoluteFill style={{transform: layerT(1.15), transformOrigin: '50% 55%'}}>
          {layers.map((l, i) => (
            <LayerView key={i} scene={scene} l={l} gf={gf} />
          ))}
        </AbsoluteFill>
        {fx.includes('rain') && <Rain heavy={mood === 'fear' || mood === 'tense'} />}
        {fx.includes('snow') && <Snow />}
        {fx.includes('dust') && <Dust />}
        {fx.includes('headlights') && <Headlights />}
        {fx.includes('flicker') && <Flicker />}
        {/* 上下压暗，保证栏目头和字幕清楚 */}
        <AbsoluteFill style={{background: 'linear-gradient(180deg, #000c 0%, #0000 22%, #0000 62%, #000d 82%, #000f 100%)'}} />
        <AbsoluteFill style={{background: '#000', opacity: Math.min(0.9, dark + hitK * 0.25)}} />
        <AbsoluteFill style={{boxShadow: `inset 0 0 ${220 + heartbeat * 160}px ${40 + heartbeat * 60}px #000${heartbeat > 0.05 ? 'd' : 'a'}`}} />
      </AbsoluteFill>
      {d.caption && (
        <div
          style={{
            position: 'absolute',
            left: 60,
            top: 330,
            padding: '6px 22px',
            borderLeft: `6px solid ${C.red}`,
            background: '#0008',
            color: '#f3efe6',
            fontFamily: SANS,
            fontWeight: 700,
            fontSize: 40,
            letterSpacing: 6,
            opacity: prog(frame, 6, 16),
            transform: `translateX(${(1 - prog(frame, 6, 16)) * -40}px)`,
          }}
        >
          {d.caption}
        </div>
      )}
      {d.title && <TitleCard scene={scene} t={d.title} />}
      {((d.flash ?? []) as string[]).map((c, i) => (
        <Flash key={i} at={cueFrame(scene, c, 0)} color="#fff" strength={0.6} dur={10} />
      ))}
    </>
  );
};
