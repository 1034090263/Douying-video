import React from 'react';
import {AbsoluteFill, Easing, Img, interpolate, random, staticFile, useCurrentFrame} from 'remotion';
import {DISPLAY, SCENE_STARTS, SceneData, TIMELINE, beatPulse, cueFrame, prog} from './lib';
import {Sfx} from './ui';
import {Rig, RigPose, RigPuppet, armTo, standPose, walkPose} from './rig';

/**
 * 多层景深舞台：骨骼人偶在插画场景里表演。
 *
 * 由远到近（括号里是视差倍率，镜头移动时越近移动越多）：
 *   背景远景 (0.45) → 背景中景 (0.75) → 背景近地面 (1.0) → 人物后的布景 → 人物 (1.0，带投影/接触阴影/轮廓光)
 *   → 前景遮挡物 (1.3~1.7，放大、虚化、压暗) → 光束、浮尘、雾 → 调色、暗角、颗粒
 *
 * data: {
 *   bg, frame?: [缩放, x, y],                 // 背景图摆放（让地面落在人物脚下）
 *   ground?: y,                               // 人物脚底所在的画面 y
 *   camera?: {from: [缩放, x, y], to: [缩放, x, y]}, cam?: [{cue, to, dur?}], hits?: [cue],
 *   sprites?: [{img, x, y, h, z, flip?, sway?, enter?: cue, fly?: [x1, y1]}],   // y 为底边；z<=1 在人物后，z>1 在前
 *   actors: [{who, x, y?, scale?, facing?, enter?, exit?, steps: [{cue, walk?, to?, dur?, pose?}]}],
 *   light?: {x, y, color?},                   // 主光源位置：决定光束、投影方向、轮廓光
 *   grade?: {color, amount?, bright?, sat?},  // 整体调色
 *   dim?: [{cue, to, dur?}], dimFrom?,        // 压暗（0~1）
 *   fx?: ['rays', 'dust', 'fog', 'flicker'],
 *   slashes?: [cue], split?: cue, title?: {cue?, text, sub?, out?}, sfx?: [...]
 * }
 */

const IMG = (TIMELINE.theme as {images?: string} | undefined)?.images ?? TIMELINE.id;
const src = (f: string) => staticFile(`images/${IMG}/${f}`);
const clamp = {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'} as const;
const ease = Easing.bezier(0.45, 0, 0.25, 1);
const noise = (f: number, s: number) => Math.sin(f / 23 + s) * 0.6 + Math.sin(f / 11.3 + s * 2.1) * 0.3 + Math.sin(f / 5.7 + s * 3.7) * 0.1;

// ---------------------------------------------------------------- 人物
type Step = {cue: string; walk?: number; to?: number; dur?: number; pose?: string};
type Actor = {who: string; x: number; y?: number; scale?: number; facing?: 1 | -1; enter?: string; exit?: string; steps?: Step[]};

const RIG_OF: Record<string, string> = {man: 'yosuke', girl: 'yukiho_kid', boy: 'ryoji_kid'};
const RIG_H: Record<string, number> = {man: 560, girl: 430, boy: 445};
const RIGS = ((TIMELINE as unknown as {rigs?: Record<string, Rig>}).rigs ?? {}) as Record<string, Rig>;

/** 骨骼人偶的姿势：站立=两腿并拢；走路=交替摆腿；举手、惊吓、低头 */
const rigPose = (rig: Rig, pose: string, walking: boolean, frame: number): RigPose => {
  let p: RigPose = walking ? walkPose(rig, frame / 4.5) : standPose(rig);
  const up = -90 + 20 * rig.facing; // 朝前上方
  if (pose === 'raise') p = {...p, ...armTo(rig, up + 5 * rig.facing), lean: -3 * rig.facing};
  if (pose === 'shock') p = {...p, ...armTo(rig, up + 45 * rig.facing), lean: -8 * rig.facing, head: -10 * rig.facing};
  if (pose === 'down') p = {...p, head: 18 * rig.facing, lean: 5 * rig.facing};
  if (pose === 'reach') p = {...p, ...armTo(rig, rig.facing > 0 ? -10 : 190)};
  return p;
};

type Light = {x: number; y: number; color?: string};

const ActorView: React.FC<{scene: SceneData; ac: Actor; ground: number; light: Light; tint: string}> = ({scene, ac, ground, light, tint}) => {
  const frame = useCurrentFrame();
  const enterAt = ac.enter ? cueFrame(scene, ac.enter, 0) : -1;
  if (frame < enterAt) return null;
  let x = ac.x;
  let y = ac.y ?? ground;
  let facing = ac.facing ?? 1;
  let walking = false;
  let rot = 0;
  let curPose = 'stand';
  const steps = (ac.steps ?? []).map((s) => ({...s, at: cueFrame(scene, s.cue, 0)})).sort((p, q) => p.at - q.at);
  for (const s of steps) {
    if (frame < s.at) break;
    const p = interpolate(frame, [s.at, s.at + (s.dur ?? 45)], [0, 1], {...clamp, easing: ease});
    if (s.walk !== undefined || s.to !== undefined) {
      const nx = s.walk ?? x;
      if (p < 1) {
        walking = true;
        if (nx !== x) facing = nx > x ? 1 : -1;
      }
      x += (nx - x) * p;
      y += ((s.to ?? y) - y) * p;
    }
    if (s.pose) {
      curPose = s.pose;
      if (s.pose === 'fall') rot = 84 * prog(frame, s.at, 22);
    }
  }
  const bob = walking ? -Math.abs(Math.sin(frame / 4.5)) * 7 : Math.sin(frame / 20 + ac.x) * 1.5;
  const exitP = ac.exit ? prog(frame, cueFrame(scene, ac.exit, 999), 20) : 0;
  const enterP = enterAt >= 0 ? prog(frame, enterAt, 14) : 1;
  const sc = ac.scale ?? 1;
  const rigId = RIG_OF[ac.who];
  const rig = RIGS[rigId];
  if (!rig) return null;
  const h = RIG_H[ac.who] * sc;
  const pose = rigPose(rig, curPose, walking, frame);
  const prop = ac.who === 'boy' && curPose === 'raise' ? 'prop_scissors.png' : undefined;
  // 投影：朝光源的反方向倒在地上；光源越低影子越长
  const dir = x > light.x ? 1 : -1;
  const len = Math.min(0.75, Math.max(0.22, 260 / Math.max(80, ground - light.y)));
  const skew = dir * Math.min(55, Math.abs(x - light.x) / 12 + 18);
  const lift = Math.max(0, -bob);
  return (
    <g opacity={enterP * (1 - exitP)}>
      {/* 投影 */}
      <g transform={`translate(${x}, ${ground}) skewX(${skew}) scale(${facing}, ${-len}) rotate(${rot})`} style={{filter: 'brightness(0) blur(5px)'}} opacity={0.32}>
        <RigPuppet id={rigId} pose={pose} height={h} />
      </g>
      {/* 接触阴影 */}
      <ellipse cx={x} cy={ground + 4} rx={h * 0.2 * (1 - lift / 60)} ry={h * 0.028} fill="rgba(0,0,0,0.5)" style={{filter: 'blur(6px)'}} />
      {/* 人物：随场景调色 + 光源一侧的轮廓光 */}
      <g
        transform={`translate(${x}, ${y + bob}) rotate(${rot}) scale(${facing}, 1)`}
        style={{filter: `${tint} drop-shadow(${(light.x > x ? 1 : -1) * facing * 4}px -1px 1px rgba(255,205,150,0.32))`}}
      >
        <RigPuppet id={rigId} pose={pose} height={h} prop={prop} />
      </g>
    </g>
  );
};

// ---------------------------------------------------------------- 布景贴图（前景/中景）
type Sprite = {img: string; x: number; y: number; h: number; z: number; flip?: boolean; sway?: number; enter?: string; fly?: [number, number]; w?: number};

/** 景深：远处偏雾、偏灰；近处放大、虚化、压暗（像镜头前的遮挡物） */
const depthLook = (z: number) => {
  if (z > 1.12) {
    const k = Math.min(1, (z - 1.12) / 0.5);
    return `blur(${2 + k * 9}px) brightness(${0.62 - k * 0.22}) saturate(0.85)`;
  }
  if (z < 0.95) {
    const k = Math.min(1, (0.95 - z) / 0.5);
    return `blur(${k * 1.6}px) contrast(${1 - k * 0.25}) brightness(${1 + k * 0.08}) saturate(${1 - k * 0.3})`;
  }
  return 'none';
};

const SpriteView: React.FC<{scene: SceneData; s: Sprite}> = ({scene, s}) => {
  const frame = useCurrentFrame();
  const at = s.enter ? cueFrame(scene, s.enter, 0) : 0;
  if (frame < at) return null;
  let x = s.x;
  let y = s.y;
  let flap = 1;
  if (s.fly) {
    // 乌鸦之类：飞过画面
    const p = interpolate(frame - at, [0, 150], [0, 1], clamp);
    x += (s.fly[0] - s.x) * p;
    y += (s.fly[1] - s.y) * p + Math.sin(frame / 6) * 10;
    flap = 0.55 + 0.45 * Math.abs(Math.sin(frame / 3.2));
  }
  const sway = s.sway ? Math.sin(frame / 18 + s.x) * s.sway : 0;
  return (
    <Img
      src={src(s.img)}
      style={{
        position: 'absolute',
        left: x - (s.w ?? s.h) / 2,
        top: y - s.h,
        height: s.h,
        width: s.w,
        transformOrigin: '50% 100%',
        transform: `scaleX(${s.flip ? -1 : 1}) scaleY(${flap}) rotate(${sway}deg)`,
        filter: depthLook(s.z),
        opacity: s.enter ? prog(frame, at, 10) : 1,
      }}
    />
  );
};

// ---------------------------------------------------------------- 氛围
const Rays: React.FC<{light: Light; strength: number}> = ({light, strength}) => {
  const frame = useCurrentFrame();
  return (
    <AbsoluteFill style={{mixBlendMode: 'screen', opacity: strength}}>
      {[...Array(6)].map((_, i) => {
        const ang = (light.x > 540 ? 150 : 30) + (i - 2.5) * 9 + Math.sin(frame / 60 + i) * 2;
        return (
          <div
            key={i}
            style={{
              position: 'absolute',
              left: light.x,
              top: light.y,
              width: 2600,
              height: 60 + i * 26,
              transformOrigin: '0 50%',
              transform: `rotate(${ang}deg)`,
              background: `linear-gradient(90deg, ${light.color ?? 'rgba(255,200,140,0.5)'} 0%, rgba(255,200,140,0) 70%)`,
              filter: 'blur(18px)',
              opacity: 0.35 + 0.25 * Math.sin(frame / 25 + i * 1.7),
            }}
          />
        );
      })}
    </AbsoluteFill>
  );
};

const Motes: React.FC<{light: Light}> = ({light}) => {
  const frame = useCurrentFrame();
  return (
    <>
      {[...Array(55)].map((_, i) => {
        const near = random(`mz${i}`) > 0.8;
        const size = near ? 10 + random(`ms${i}`) * 12 : 3 + random(`ms${i}`) * 4;
        return (
          <div
            key={i}
            style={{
              position: 'absolute',
              left: ((random(`mx${i}`) * 1200 + frame * (near ? 1.4 : 0.35) + Math.sin(frame / (40 + i) + i) * 30) % 1200) - 60,
              top: random(`my${i}`) * 1500 + 200 + Math.cos(frame / (50 + i) + i) * 40 - frame * 0.15,
              width: size,
              height: size,
              borderRadius: '50%',
              background: light.color ?? '#ffe3b8',
              opacity: (near ? 0.18 : 0.3) + 0.3 * Math.abs(Math.sin(frame / 30 + i)),
              filter: near ? 'blur(5px)' : 'blur(0.6px)',
              boxShadow: '0 0 8px #fff3d8',
            }}
          />
        );
      })}
    </>
  );
};

const GroundFog: React.FC<{y: number}> = ({y}) => {
  const frame = useCurrentFrame();
  return (
    <>
      {[0, 1, 2, 3].map((i) => (
        <div
          key={i}
          style={{
            position: 'absolute',
            left: ((frame * (0.5 + i * 0.25) + i * 520) % 2400) - 1100,
            top: y - 220 + i * 60,
            width: 1500,
            height: 360,
            borderRadius: '50%',
            background: 'radial-gradient(ellipse, rgba(210,220,255,0.32) 0%, rgba(210,220,255,0) 70%)',
            filter: 'blur(24px)',
          }}
        />
      ))}
    </>
  );
};

const Grain: React.FC = () => {
  const frame = useCurrentFrame();
  return (
    <svg width={1080} height={1920} style={{position: 'absolute', inset: 0, opacity: 0.11, mixBlendMode: 'overlay', pointerEvents: 'none'}}>
      <filter id={`grain${frame % 6}`}>
        <feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="2" seed={frame % 6} />
        <feColorMatrix values="0 0 0 0 0.5  0 0 0 0 0.5  0 0 0 0 0.5  0 0 0 1.4 -0.2" />
      </filter>
      <rect width="100%" height="100%" filter={`url(#grain${frame % 6})`} />
    </svg>
  );
};

// ---------------------------------------------------------------- 场景
export const PuppetScene: React.FC<{scene: SceneData}> = ({scene}) => {
  const frame = useCurrentFrame();
  const idx = TIMELINE.scenes.indexOf(scene as (typeof TIMELINE.scenes)[number]);
  const gf = frame + (SCENE_STARTS[idx] ?? 0);
  const d = scene.data;
  const dur = scene.durationInFrames;
  const ground: number = d.ground ?? 1330;
  const light: Light = d.light ?? {x: 980, y: 520};
  const fx = (d.fx ?? []) as string[];
  // 镜头：基础运动 + 剧情推镜 + 重音 + 手持
  const cam = (d.camera ?? {from: [1.1, 40, 0], to: [1.0, -40, 0]}) as {from: number[]; to: number[]};
  const t = interpolate(frame, [0, dur], [0, 1], {...clamp, easing: ease});
  let sc = cam.from[0] + (cam.to[0] - cam.from[0]) * t;
  let cx = cam.from[1] + (cam.to[1] - cam.from[1]) * t;
  let cy = cam.from[2] + (cam.to[2] - cam.from[2]) * t;
  for (const m of (d.cam ?? []) as {cue: string; to: number[]; dur?: number}[]) {
    const p = interpolate(frame, [cueFrame(scene, m.cue, 0), cueFrame(scene, m.cue, 0) + (m.dur ?? 18)], [0, 1], {...clamp, easing: ease});
    sc += (m.to[0] - sc) * p;
    cx += (m.to[1] - cx) * p;
    cy += (m.to[2] - cy) * p;
  }
  const hitsAt = [...((d.hits ?? []) as string[]), ...((d.slashes ?? []) as string[])].map((c) => cueFrame(scene, c, 0));
  let hitK = 0;
  let shake = 0;
  for (const a of hitsAt) {
    const k = frame - a;
    if (k >= 0 && k < 40) {
      hitK = Math.max(hitK, Math.exp(-k / 9));
      if (k < 12) shake += Math.sin(k * 2.4) * (12 - k) * 1.8;
    }
  }
  sc *= 1 + hitK * 0.07 + beatPulse(gf) * 0.006;
  cx += noise(frame, 1.3) * 5 + shake;
  cy += noise(frame, 4.1) * 3.5;
  const rot = noise(frame, 7.7) * 0.12;
  /** 深度 z 的图层变换：越近的层随镜头移动、缩放得越多 */
  const at = (z: number): React.CSSProperties => ({
    transform: `translate(${cx * z}px, ${cy * z}px) scale(${1 + (sc - 1) * z}) rotate(${rot * z}deg)`,
    transformOrigin: '50% 62%',
  });

  // 背景三层（同一张图按深度遮罩切开）
  const [fs, fx0, fy0] = (d.frame ?? [1, 0, 0]) as number[];
  const bgStyle: React.CSSProperties = {position: 'absolute', left: (1080 - 1080 * fs) / 2 + fx0, top: fy0, width: 1080 * fs, height: 1890 * fs};
  const masked = (suffix: string, z: number) => {
    const m = `url(${src(d.bg.replace('.png', `${suffix}.png`))})`;
    return (
      <AbsoluteFill style={at(z)}>
        <div style={{...bgStyle, WebkitMaskImage: m, maskImage: m, WebkitMaskSize: '100% 100%', maskSize: '100% 100%'}}>
          <Img src={src(d.bg)} style={{width: '100%', height: '100%'}} />
        </div>
      </AbsoluteFill>
    );
  };
  const sprites = (d.sprites ?? []) as Sprite[];
  const back = sprites.filter((s) => s.z <= 1).sort((a, b) => a.z - b.z);
  const front = sprites.filter((s) => s.z > 1).sort((a, b) => a.z - b.z);
  // 调色、压暗
  const grade = (d.grade ?? {color: '#ff9a50', amount: 0.14}) as {color: string; amount?: number; bright?: number; sat?: number};
  let dim: number = d.dimFrom ?? 0;
  for (const l of (d.dim ?? []) as {cue: string; to: number; dur?: number}[]) dim += (l.to - dim) * prog(frame, cueFrame(scene, l.cue, 0), l.dur ?? 24);
  const flick = fx.includes('flicker') && random(`fl${Math.floor(frame / 3)}`) < 0.08 ? 0.25 : 0;
  const tint = `brightness(${grade.bright ?? 1}) saturate(${grade.sat ?? 1})`;
  const slashes = ((d.slashes ?? []) as string[]).map((c) => cueFrame(scene, c, 0));
  const splitAt = d.split ? cueFrame(scene, d.split, 999) : 999999;
  const sp = prog(frame, splitAt, 50);
  return (
    <>
      {((d.sfx ?? []) as {cue: string; name: string; volume?: number}[]).map((s, i) => (
        <Sfx key={i} at={cueFrame(scene, s.cue, 0)} name={s.name} volume={s.volume ?? 0.6} />
      ))}
      <AbsoluteFill style={{overflow: 'hidden', background: '#07080d'}}>
        <AbsoluteFill style={{filter: tint}}>
          {/* 远景：轻微虚化 */}
          <AbsoluteFill style={at(0.45)}>
            <Img src={src(d.bg)} style={{...bgStyle, filter: 'blur(1.2px) saturate(0.9)'}} />
          </AbsoluteFill>
          {masked('_m1', 0.75)}
          {masked('_m2', 1.0)}
          {/* 人物后面的布景 */}
          {back.map((s, i) => (
            <AbsoluteFill key={i} style={at(s.z)}>
              <SpriteView scene={scene} s={s} />
            </AbsoluteFill>
          ))}
          {fx.includes('fog') && (
            <AbsoluteFill style={at(0.9)}>
              <GroundFog y={ground} />
            </AbsoluteFill>
          )}
        </AbsoluteFill>
        {/* 人物 */}
        <AbsoluteFill style={at(1.0)}>
          <svg width={1080} height={1920} style={{position: 'absolute', overflow: 'visible'}}>
            {((d.actors ?? []) as Actor[]).map((ac, i) => (
              <ActorView key={i} scene={scene} ac={ac} ground={ground} light={light} tint={tint} />
            ))}
          </svg>
        </AbsoluteFill>
        {/* 前景遮挡物：放大、虚化、压暗 */}
        {front.map((s, i) => (
          <AbsoluteFill key={i} style={at(s.z)}>
            <SpriteView scene={scene} s={s} />
          </AbsoluteFill>
        ))}
        {/* 氛围 */}
        {fx.includes('rays') && <Rays light={light} strength={0.85 * (1 - dim)} />}
        {fx.includes('dust') && <Motes light={light} />}
        {/* 调色：整体色温 + 光源方向的暖光 */}
        <AbsoluteFill style={{background: grade.color, mixBlendMode: 'soft-light', opacity: grade.amount ?? 0.14}} />
        <AbsoluteFill
          style={{background: `radial-gradient(circle at ${light.x}px ${light.y}px, ${light.color ?? 'rgba(255,190,120,0.35)'} 0%, rgba(0,0,0,0) 55%)`, mixBlendMode: 'screen', opacity: 0.6 * (1 - dim)}}
        />
        {/* 结尾：一半白昼、一半黑夜 */}
        {sp > 0 && (
          <>
            <AbsoluteFill style={{background: 'linear-gradient(90deg, rgba(8,14,40,0.85) 0%, rgba(8,14,40,0.7) 42%, rgba(8,14,40,0) 56%)', opacity: sp}} />
            <AbsoluteFill style={{background: 'linear-gradient(90deg, rgba(255,246,225,0) 44%, rgba(255,236,205,0.22) 70%, rgba(255,240,220,0.32) 100%)', mixBlendMode: 'screen', opacity: sp}} />
          </>
        )}
        <AbsoluteFill style={{background: '#000', opacity: Math.min(0.92, dim + flick + hitK * 0.2)}} />
        {/* 红色剪痕 */}
        {slashes.map((s0, i) => {
          const k = frame - s0;
          if (k < 0) return null;
          const draw = Math.min(1, k / 5);
          const fade = k > 50 ? Math.max(0, 1 - (k - 50) / 25) : 1;
          const y0 = 620 + i * 300;
          return (
            <svg key={i} width={1080} height={1920} style={{position: 'absolute', opacity: fade}}>
              <path d={`M -40 ${y0} L ${1120 * draw} ${y0 + 260 * draw}`} stroke="#c0160c" strokeWidth={22 - i * 4} strokeLinecap="round" style={{filter: 'drop-shadow(0 0 14px #ff3a1a)'}} />
            </svg>
          );
        })}
        <Grain />
        {/* 暗角 + 上下压暗（栏目头、字幕清楚） */}
        <AbsoluteFill style={{boxShadow: 'inset 0 0 260px 60px rgba(0,0,0,0.75)'}} />
        <AbsoluteFill style={{background: 'linear-gradient(180deg, rgba(0,0,0,0.72) 0%, rgba(0,0,0,0) 18%, rgba(0,0,0,0) 66%, rgba(0,0,0,0.42) 78%, rgba(0,0,0,0.72) 100%)'}} />
      </AbsoluteFill>
      {d.title && (
        <div
          style={{
            position: 'absolute',
            left: 0,
            right: 0,
            top: 560,
            textAlign: 'center',
            fontFamily: DISPLAY,
            fontWeight: 900,
            fontSize: 170,
            color: '#f4ede2',
            letterSpacing: 34,
            paddingLeft: 34,
            opacity: prog(frame, cueFrame(scene, d.title.cue, 0.3), 26) * (d.title.out ? 1 - prog(frame, cueFrame(scene, d.title.out, 999), 18) : 1),
            transform: `scale(${1.15 - 0.15 * prog(frame, cueFrame(scene, d.title.cue, 0.3), 40)})`,
            textShadow: '0 0 40px rgba(255,170,90,0.55), 0 6px 30px #000',
          }}
        >
          {d.title.text}
          {d.title.sub && <div style={{fontSize: 56, letterSpacing: 18, marginTop: 10, color: '#e9c9a0'}}>{d.title.sub}</div>}
        </div>
      )}
    </>
  );
};
