import React from 'react';
import {AbsoluteFill, Easing, Img, interpolate, random, staticFile, useCurrentFrame} from 'remotion';
import {DISPLAY, SCENE_STARTS, SceneData, TIMELINE, beatPulse, cueFrame, prog} from './lib';
import {Sfx} from './ui';
import {Rig, RigPose, RigPuppet, armTo, standPose, walkPose} from './rig';
import {FocusLines, Glint, Ink, Insert, RgbDefs, Shards, Slam, heartK} from './climax';

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
type Actor = {who: string; x: number; y?: number; scale?: number; facing?: 1 | -1; enter?: string; exit?: string; steps?: Step[]; z?: number; silhouette?: boolean};

const RIG_OF: Record<string, string> = {man: 'yosuke', girl: 'yukiho_kid', boy: 'ryoji_kid'};
const RIG_H: Record<string, number> = {man: 560, girl: 430, boy: 445};
const RIGS = ((TIMELINE as unknown as {rigs?: Record<string, Rig>}).rigs ?? {}) as Record<string, Rig>;

const easeOutBack = Easing.bezier(0.34, 1.56, 0.64, 1);
const add = (a: RigPose, b: RigPose): RigPose => {
  const o: RigPose = {...a};
  for (const k of Object.keys(b) as (keyof RigPose)[]) o[k] = (o[k] ?? 0) + (b[k] ?? 0);
  return o;
};
const lerpPose = (a: RigPose, b: RigPose, t: number): RigPose => {
  const o: RigPose = {};
  for (const k of new Set([...Object.keys(a), ...Object.keys(b)]) as Set<keyof RigPose>) o[k] = (a[k] ?? 0) + ((b[k] ?? 0) - (a[k] ?? 0)) * t;
  return o;
};

/**
 * 某个姿势在开始后第 k 帧的样子（带预备动作和余势）：
 *   stand 站立 · raise 举起 · shock 先一缩再猛地后仰、发抖 · strike 举高→猛刺下去→停住→收回
 *   recoil 被击中后仰 · down 低头 · fall 倒下时手臂甩起 · reach 伸手
 * 角度在人偶自己的坐标里：f = rig.facing，正值 = 往前（顺时针）
 */
const poseAt = (rig: Rig, pose: string, walking: boolean, frame: number, k: number): RigPose => {
  const f = rig.facing;
  const base: RigPose = walking ? walkPose(rig, frame / 4.5) : standPose(rig);
  const up = -90 + 20 * f; // 朝前上方
  const fwdDown = 25 * f > 0 ? 25 : 155; // 朝前下方
  const decay = (tau: number) => Math.exp(-k / tau);
  switch (pose) {
    case 'raise':
      return {...base, ...armTo(rig, up + 5 * f), lean: -3 * f};
    case 'shock': {
      const pre = k < 4 ? k / 4 : Math.max(0, 1 - (k - 4) / 3); // 先往里缩
      const jolt = k < 4 ? 0 : 1;
      return {...base, ...armTo(rig, up + 45 * f), lean: (4 * pre - 10 * jolt) * f + Math.sin(k * 2.6) * 1.6 * decay(30), head: -12 * jolt * f + Math.sin(k * 3.1) * 2 * decay(25)};
    }
    case 'strike': {
      // 0-4 举高 · 4-8 猛刺下去 · 8-18 停住 · 18-30 收回到举起
      const hi = armTo(rig, up - 15 * f).arm ?? 0;
      const lo = armTo(rig, fwdDown).arm ?? 0;
      const rs = armTo(rig, up + 5 * f).arm ?? 0;
      const arm = k < 4 ? rs + (hi - rs) * (k / 4) : k < 8 ? hi + (lo - hi) * Easing.in(Easing.quad)((k - 4) / 4) : k < 18 ? lo : lo + (rs - lo) * Easing.inOut(Easing.cubic)(Math.min(1, (k - 18) / 12));
      const lean = (k < 4 ? -6 * (k / 4) : k < 18 ? 10 : 10 - 13 * Math.min(1, (k - 18) / 12)) * f;
      return {...base, arm, lean, head: (k >= 4 && k < 18 ? 8 : 0) * f};
    }
    case 'recoil': {
      const r = k < 5 ? k / 5 : 0.55 + 0.45 * decay(8);
      return {...base, lean: -14 * r * f, head: -20 * r * f + Math.sin(k * 2.2) * 2 * decay(20), ...armTo(rig, up + 70 * f)};
    }
    case 'down':
      return {...base, head: 18 * f, lean: 5 * f};
    case 'fall':
      return {...base, ...armTo(rig, up + 20 * f), arm_far: -40 * f, head: -25 * f, leg_near: 18 * f, leg_far: -10 * f};
    case 'reach':
      return {...base, ...armTo(rig, f > 0 ? -10 : 190)};
    default:
      return base;
  }
};

/** 人偶姿势：上一个姿势 → 当前姿势用带回弹的缓动过渡；再叠加呼吸、走路时的前倾和头部反向晃动 */
const rigPose = (rig: Rig, st: {pose: string; prevPose: string; poseStart: number; walking: boolean}, frame: number, seed: number): RigPose => {
  const k = frame - st.poseStart;
  const cur = poseAt(rig, st.pose, st.walking, frame, k);
  const prev = poseAt(rig, st.prevPose, st.walking, frame, 999);
  const t = st.pose === 'strike' || st.pose === 'shock' ? 1 : easeOutBack(Math.min(1, k / 9));
  const f = rig.facing;
  const life: RigPose = st.walking
    ? {lean: 4 * f + Math.sin((frame / 4.5) * 2) * 1.2 * f, head: -Math.sin((frame / 4.5) * 2) * 2.5 * f}
    : {
        lean: Math.sin(frame / 38 + seed) * 1.3 * f,
        head: Math.sin(frame / 53 + seed * 2) * 2.4 * f + Math.sin(frame / 17 + seed) * 0.6,
        arm: Math.sin(frame / 34 + seed) * 2.5,
        arm_far: -Math.sin(frame / 34 + seed) * 2.5,
      };
  return add(lerpPose(prev, cur, Math.max(0, Math.min(1.2, t))), life);
};

type Light = {x: number; y: number; color?: string};

/** 人物在某一帧的状态（位置、朝向、姿势），镜头跟拍和特效定位都用它 */
const actorState = (scene: SceneData, ac: Actor, frame: number, ground: number) => {
  const enterAt = ac.enter ? cueFrame(scene, ac.enter, 0) : -1;
  let x = ac.x;
  let y = ac.y ?? ground;
  let facing = ac.facing ?? 1;
  let walking = false;
  let rot = 0;
  let pose = 'stand';
  let prevPose = 'stand';
  let poseStart = -999;
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
      prevPose = pose;
      pose = s.pose;
      poseStart = s.at;
      if (s.pose === 'fall') {
        // 先被打得一顿，膝盖一软，越倒越快，落地弹一下
        const k = frame - s.at;
        const a = k < 5 ? -6 * (k / 5) : k < 19 ? -6 + 90 * Easing.in(Easing.quad)((k - 5) / 14) : 84 + 7 * Math.exp(-(k - 19) / 4) * Math.cos((k - 19) * 0.9);
        rot = -facing * a;
      }
    }
  }
  const h = (RIG_H[ac.who] ?? 450) * (ac.scale ?? 1);
  const alpha = (enterAt >= 0 ? prog(frame, enterAt, 14) : 1) * (1 - (ac.exit ? prog(frame, cueFrame(scene, ac.exit, 999), 20) : 0));
  return {x, y, facing, walking, rot, pose, prevPose, poseStart, h, alpha, visible: frame >= enterAt};
};

/** 人物身上的部位（画面世界坐标） */
const partPos = (st: ReturnType<typeof actorState>, part: string): [number, number] => {
  if (part === 'head') return [st.x + st.facing * st.h * 0.04, st.y - st.h * 0.86];
  if (part === 'hand') return st.pose === 'raise' || st.pose === 'strike' ? [st.x + st.facing * st.h * 0.12, st.y - st.h * 1.05] : [st.x + st.facing * st.h * 0.2, st.y - st.h * 0.5];
  if (part === 'feet') return [st.x, st.y - st.h * 0.05];
  return [st.x, st.y - st.h * 0.5];
};

const ActorView: React.FC<{scene: SceneData; ac: Actor & {silhouette?: boolean}; ground: number; light: Light; tint: string}> = ({scene, ac, ground, light, tint}) => {
  const frame = useCurrentFrame();
  const st = actorState(scene, ac, frame, ground);
  if (!st.visible) return null;
  const rigId = RIG_OF[ac.who];
  const rig = RIGS[rigId];
  if (!rig) return null;
  const {x, y, facing, rot, h} = st;
  const bob = st.walking ? -Math.abs(Math.sin(frame / 4.5)) * 7 : Math.sin(frame / 20 + ac.x) * 1.5;
  const pose = rigPose(rig, st, frame, ac.x * 0.013);
  const prop = ac.who === 'boy' && (st.pose === 'raise' || st.pose === 'strike') ? 'prop_scissors.png' : undefined;
  // 投影：朝光源的反方向倒在地上；光源越低影子越长
  const dir = x > light.x ? 1 : -1;
  const len = Math.min(0.75, Math.max(0.22, 260 / Math.max(80, ground - light.y)));
  const skew = dir * Math.min(55, Math.abs(x - light.x) / 12 + 18);
  const lift = Math.max(0, -bob);
  const look = ac.silhouette ? 'brightness(0.06) drop-shadow(0 0 3px rgba(255,170,110,0.55))' : `${tint} drop-shadow(${(light.x > x ? 1 : -1) * facing * 4}px -1px 1px rgba(255,205,150,0.32))`;
  return (
    <g opacity={st.alpha}>
      <g transform={`translate(${x}, ${ground}) skewX(${skew}) scale(${facing}, ${-len}) rotate(${rot})`} style={{filter: 'brightness(0) blur(5px)'}} opacity={0.32}>
        <RigPuppet id={rigId} pose={pose} height={h} />
      </g>
      <ellipse cx={x} cy={ground + 4} rx={h * 0.2 * (1 - lift / 60)} ry={h * 0.028} fill="rgba(0,0,0,0.5)" style={{filter: 'blur(6px)'}} />
      <g transform={`translate(${x}, ${y + bob}) rotate(${rot}) scale(${facing}, 1)`} style={{filter: look}}>
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
type Look = {who?: string; part?: string; x?: number; y?: number; s: number; at?: [number, number]; r?: number};
type CamKey = {cue?: string; t?: number; to?: number[]; look?: Look; cut?: boolean; dur?: number};
type Beat = {cue: string; fx: string; who?: string; part?: string; x?: number; y?: number; text?: string; size?: number; color?: string; rot?: number; dur?: number; power?: number};
const O: [number, number] = [540, 1190.4]; // 图层变换原点（50% 62%）

export const PuppetScene: React.FC<{scene: SceneData}> = ({scene}) => {
  const frame = useCurrentFrame();
  const idx = TIMELINE.scenes.indexOf(scene as (typeof TIMELINE.scenes)[number]);
  const gf = frame + (SCENE_STARTS[idx] ?? 0);
  const d = scene.data;
  const dur = scene.durationInFrames;
  const ground: number = d.ground ?? 1330;
  const light: Light = d.light ?? {x: 980, y: 520};
  const fx = (d.fx ?? []) as string[];
  const actors = (d.actors ?? []) as (Actor & {silhouette?: boolean})[];
  const whoState = (who: string) => {
    const ac = actors.find((q) => q.who === who);
    return ac ? actorState(scene, ac, frame, ground) : null;
  };
  const kAt = (k: {cue?: string; t?: number}) => (k.cue ? cueFrame(scene, k.cue, 0) : Math.round((k.t ?? 0) * 30));

  // ---------- 镜头：基础运动 → 剧情镜头（可硬切、可锁定人物部位按构图摆放、可倾斜）→ 重音 → 手持
  const cam = (d.camera ?? {from: [1.1, 40, 0], to: [1.0, -40, 0]}) as {from: number[]; to: number[]};
  const t = interpolate(frame, [0, dur], [0, 1], {...clamp, easing: ease});
  let sc = cam.from[0] + (cam.to[0] - cam.from[0]) * t;
  let cx = cam.from[1] + (cam.to[1] - cam.from[1]) * t;
  let cy = cam.from[2] + (cam.to[2] - cam.from[2]) * t;
  let cr = 0;
  const keys = ((d.cam ?? []) as CamKey[]).map((k) => ({...k, at: kAt(k)})).sort((p, q) => p.at - q.at);
  for (const k of keys) {
    if (frame < k.at) break;
    let target: number[];
    if (k.look) {
      const L = k.look;
      const st = L.who ? whoState(L.who) : null;
      const P = st ? partPos(st, L.part ?? 'body') : [L.x ?? 540, L.y ?? 1000];
      const A = L.at ?? [540, 900];
      const r = ((L.r ?? 0) * Math.PI) / 180;
      const vx = P[0] - O[0];
      const vy = P[1] - O[1];
      target = [L.s, A[0] - O[0] - L.s * (vx * Math.cos(r) - vy * Math.sin(r)), A[1] - O[1] - L.s * (vx * Math.sin(r) + vy * Math.cos(r)), L.r ?? 0];
    } else {
      target = [...(k.to ?? [sc, cx, cy]), k.to?.[3] ?? cr];
    }
    const p = k.cut ? 1 : interpolate(frame, [k.at, k.at + (k.dur ?? 18)], [0, 1], {...clamp, easing: ease});
    sc += (target[0] - sc) * p;
    cx += (target[1] - cx) * p;
    cy += (target[2] - cy) * p;
    cr += (target[3] - cr) * p;
  }
  const beats = ((d.beats ?? []) as Beat[]).map((b) => ({...b, at: cueFrame(scene, b.cue, 0)}));
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
  // 心跳：镜头随心跳一胀一缩，四周泛红
  const pulse = d.pulse ? heartK(frame, cueFrame(scene, d.pulse.from, 0), cueFrame(scene, d.pulse.to, dur)) : 0;
  sc *= 1 + hitK * 0.07 + beatPulse(gf) * 0.006 + pulse * 0.025;
  cx += noise(frame, 1.3) * 5 + shake;
  cy += noise(frame, 4.1) * 3.5;
  const rot = cr + noise(frame, 7.7) * 0.12;
  /** 深度 z 的图层变换：越近的层随镜头移动、缩放得越多 */
  const at = (z: number): React.CSSProperties => ({
    transform: `translate(${cx * z}px, ${cy * z}px) scale(${1 + (sc - 1) * z}) rotate(${rot * z}deg)`,
    transformOrigin: '50% 62%',
  });
  /** 世界坐标 → 屏幕坐标（人物所在的 z=1 层） */
  const toScreen = (P: [number, number]): [number, number] => {
    const r = (rot * Math.PI) / 180;
    const vx = P[0] - O[0];
    const vy = P[1] - O[1];
    return [O[0] + cx + sc * (vx * Math.cos(r) - vy * Math.sin(r)), O[1] + cy + sc * (vx * Math.sin(r) + vy * Math.cos(r))];
  };
  const beatPos = (b: Beat): [number, number] => {
    if (b.who) {
      const st = whoState(b.who);
      if (st) return toScreen(partPos(st, b.part ?? 'body'));
    }
    return [b.x ?? 540, b.y ?? 900];
  };

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
  const back = sprites.filter((q) => q.z <= 1).sort((p, q) => p.z - q.z);
  const front = sprites.filter((q) => q.z > 1).sort((p, q) => p.z - q.z);
  // 人物按深度分层：默认 1；>1 的是镜头前的大剪影
  const actorLayers = [...new Set(actors.map((q) => q.z ?? 1))].sort((p, q) => p - q);
  const grade = (d.grade ?? {color: '#ff9a50', amount: 0.14}) as {color: string; amount?: number; bright?: number; sat?: number};
  let dim: number = d.dimFrom ?? 0;
  for (const l of (d.dim ?? []) as {cue: string; to: number; dur?: number}[]) dim += (l.to - dim) * prog(frame, cueFrame(scene, l.cue, 0), l.dur ?? 24);
  const flick = fx.includes('flicker') && random(`fl${Math.floor(frame / 3)}`) < 0.08 ? 0.25 : 0;
  const tint = `brightness(${grade.bright ?? 1}) saturate(${grade.sat ?? 1})`;
  const slashes = ((d.slashes ?? []) as string[]).map((c) => cueFrame(scene, c, 0));
  const splitAt = d.split ? cueFrame(scene, d.split, 999) : 999999;
  const sp = prog(frame, splitAt, 50);
  // 整个画面的滤镜：冲击帧（黑白反相）、色散、褪色
  let stageFilter = '';
  let rgb = 0;
  let redFlash = 0;
  for (const b of beats) {
    const k = frame - b.at;
    if (k < 0) continue;
    if (b.fx === 'impact' && k < 3) stageFilter += k < 1 ? ' grayscale(1) contrast(4) invert(1)' : ' grayscale(1) contrast(2.2)';
    if (b.fx === 'rgb' && k < 18) rgb = Math.max(rgb, (b.power ?? 1) * 22 * Math.exp(-k / 5));
    if (b.fx === 'redflash' && k < 20) redFlash = Math.max(redFlash, Math.exp(-k / 5));
  }
  const mono = d.mono ? prog(frame, cueFrame(scene, d.mono.from, 999), 20) * (d.mono.to ? 1 - prog(frame, cueFrame(scene, d.mono.to, 999), 30) : 1) : 0;
  if (mono > 0) stageFilter += ` saturate(${1 - mono * 0.85}) contrast(${1 + mono * 0.15})`;
  if (rgb > 0.5) stageFilter += ' url(#rgbsplit)';
  return (
    <>
      {((d.sfx ?? []) as {cue: string; name: string; volume?: number}[]).map((q, i) => (
        <Sfx key={i} at={cueFrame(scene, q.cue, 0)} name={q.name} volume={q.volume ?? 0.6} />
      ))}
      <RgbDefs d={rgb} />
      <AbsoluteFill style={{overflow: 'hidden', background: '#07080d', filter: stageFilter.trim() || undefined}}>
        <AbsoluteFill style={{filter: tint}}>
          {/* 远景：轻微虚化 */}
          <AbsoluteFill style={at(0.45)}>
            <Img src={src(d.bg)} style={{...bgStyle, filter: 'blur(1.2px) saturate(0.9)'}} />
          </AbsoluteFill>
          {masked('_m1', 0.75)}
          {masked('_m2', 1.0)}
          {back.map((q, i) => (
            <AbsoluteFill key={i} style={at(q.z)}>
              <SpriteView scene={scene} s={q} />
            </AbsoluteFill>
          ))}
          {fx.includes('fog') && (
            <AbsoluteFill style={at(0.9)}>
              <GroundFog y={ground} />
            </AbsoluteFill>
          )}
        </AbsoluteFill>
        {/* 人物（按深度分层） + 前景遮挡物 */}
        {[...actorLayers.map((z) => ({kind: 'actors' as const, z})), ...front.map((q) => ({kind: 'sprite' as const, z: q.z, q}))]
          .sort((p, q) => p.z - q.z)
          .map((L, i) =>
            L.kind === 'actors' ? (
              <AbsoluteFill key={`a${i}`} style={{...at(L.z), filter: L.z > 1.12 ? depthLook(L.z) : undefined}}>
                {/* 地上晕开的一滩暗色（透视压扁） */}
                {L.z === 1 &&
                  beats
                    .filter((b) => b.fx === 'ink')
                    .map((b, j) => {
                      const st = b.who ? whoState(b.who) : null;
                      const x = st ? st.x - st.facing * st.h * 0.45 : b.x ?? 540;
                      const y = st ? st.y : ground;
                      return (
                        <div key={j} style={{position: 'absolute', inset: 0, transformOrigin: `${x}px ${y}px`, transform: 'scaleY(0.28)'}}>
                          <Ink at={b.at} x={x} y={y} dur={b.dur} r={b.size ?? 560} color="#1a0306" />
                        </div>
                      );
                    })}
                <svg width={1080} height={1920} style={{position: 'absolute', overflow: 'visible'}}>
                  {actors
                    .filter((ac) => (ac.z ?? 1) === L.z)
                    .map((ac, j) => (
                      <ActorView key={j} scene={scene} ac={ac} ground={ground} light={light} tint={tint} />
                    ))}
                </svg>
              </AbsoluteFill>
            ) : (
              <AbsoluteFill key={`s${i}`} style={at(L.z)}>
                <SpriteView scene={scene} s={L.q} />
              </AbsoluteFill>
            ),
          )}
        {/* 氛围 */}
        {fx.includes('rays') && <Rays light={light} strength={0.85 * (1 - dim)} />}
        {fx.includes('dust') && <Motes light={light} />}
        <AbsoluteFill style={{background: grade.color, mixBlendMode: 'soft-light', opacity: grade.amount ?? 0.14}} />
        <AbsoluteFill
          style={{background: `radial-gradient(circle at ${light.x}px ${light.y}px, ${light.color ?? 'rgba(255,190,120,0.35)'} 0%, rgba(0,0,0,0) 55%)`, mixBlendMode: 'screen', opacity: 0.6 * (1 - dim)}}
        />
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
        <AbsoluteFill style={{boxShadow: 'inset 0 0 260px 60px rgba(0,0,0,0.75)'}} />
        <AbsoluteFill style={{background: 'linear-gradient(180deg, rgba(0,0,0,0.72) 0%, rgba(0,0,0,0) 18%, rgba(0,0,0,0) 66%, rgba(0,0,0,0.42) 78%, rgba(0,0,0,0.72) 100%)'}} />
      </AbsoluteFill>
      {/* 高潮特效 */}
      {pulse > 0 && <AbsoluteFill style={{boxShadow: `inset 0 0 ${240 + pulse * 200}px ${60 + pulse * 120}px rgba(150,0,8,${0.35 + pulse * 0.45})`}} />}
      {redFlash > 0 && <AbsoluteFill style={{background: '#c01010', mixBlendMode: 'multiply', opacity: redFlash * 0.45}} />}
      {beats.map((b, i) => {
        const [x, y] = beatPos(b);
        if (b.fx === 'focus') return <FocusLines key={i} at={b.at} x={x} y={y} dur={b.dur} color={b.color} />;
        if (b.fx === 'shards') return <Shards key={i} at={b.at} x={x} y={y} power={b.power} color={b.color} />;
        if (b.fx === 'slam') return <Slam key={i} at={b.at} text={b.text ?? ''} x={x} y={y} size={b.size} color={b.color} rot={b.rot} dur={b.dur} />;
        if (b.fx === 'glint') return <Glint key={i} at={b.at} x={x} y={y} dur={b.dur} />;
        return null;
      })}
      {((d.inserts ?? []) as {cue: string; until: string; img: string; caption?: string}[]).map((q, i) => (
        <Insert key={i} at={cueFrame(scene, q.cue, 0)} until={cueFrame(scene, q.until, dur)} img={src(q.img)} caption={q.caption} />
      ))}
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
