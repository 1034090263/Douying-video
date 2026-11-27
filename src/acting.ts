import {Easing} from 'remotion';
import type {Body, Limb} from './mesh';

/**
 * 人偶表演：把「姿势名 + 开始后的帧数」变成网格人偶的身体参数。
 * 角度都与朝向无关：正值 = 往前（大腿前摆、手臂前抬、身体前倾、低头），bend = 肘/膝弯曲。
 */

const clamp01 = (x: number) => Math.max(0, Math.min(1, x));
const outBack = Easing.bezier(0.34, 1.56, 0.64, 1);
const io = Easing.inOut(Easing.cubic);

const L = (swing: number, bend: number): Limb => ({swing, bend});

const mixLimb = (a: Limb = {}, b: Limb = {}, t: number): Limb => ({
  swing: (a.swing ?? 0) + ((b.swing ?? 0) - (a.swing ?? 0)) * t,
  bend: (a.bend ?? 0) + ((b.bend ?? 0) - (a.bend ?? 0)) * t,
});
export const mixBody = (a: Body, b: Body, t: number): Body => ({
  lean: (a.lean ?? 0) + ((b.lean ?? 0) - (a.lean ?? 0)) * t,
  chest: (a.chest ?? 0) + ((b.chest ?? 0) - (a.chest ?? 0)) * t,
  head: (a.head ?? 0) + ((b.head ?? 0) - (a.head ?? 0)) * t,
  arm: mixLimb(a.arm, b.arm, t),
  arm_far: mixLimb(a.arm_far, b.arm_far, t),
  leg_near: mixLimb(a.leg_near, b.leg_near, t),
  leg_far: mixLimb(a.leg_far, b.leg_far, t),
  face: t < 0.5 ? a.face : b.face,
});

/** 走路一个周期（phase 弧度）：摆动腿屈膝、支撑腿伸直；手臂反向摆、前摆时多弯肘；返回身体起伏 lift（原图像素） */
export const walkBody = (phase: number): {body: Body; lift: number} => {
  const s = Math.sin(phase);
  const c = Math.cos(phase);
  return {
    body: {
      lean: 5,
      chest: 2,
      head: -2 + Math.sin(phase * 2) * 1.5,
      leg_near: L(24 * s, 6 + 50 * Math.pow(Math.max(0, c), 1.6)),
      leg_far: L(-24 * s, 6 + 50 * Math.pow(Math.max(0, -c), 1.6)),
      arm: L(-20 * s, 14 + 16 * Math.max(0, -s)),
      arm_far: L(20 * s, 14 + 16 * Math.max(0, s)),
    },
    lift: 10 * (1 - Math.abs(s)), // 两腿交错时最高，跨步时最低
  };
};

const STAND: Body = {lean: 1, chest: 0, head: 0, leg_near: L(3, 4), leg_far: L(-3, 4), arm: L(-4, 10), arm_far: L(4, 10)};
const RAISE: Body = {lean: -2, chest: -5, head: -8, leg_near: L(10, 10), leg_far: L(-8, 8), arm: L(160, 25), arm_far: L(25, 35), face: 'cold'};
const DOWN: Body = {lean: 4, chest: 10, head: 22, leg_near: L(3, 6), leg_far: L(-3, 6), arm: L(-2, 8), arm_far: L(2, 8), face: 'sad'};

/** 某个姿势开始后第 k 帧的身体（带预备动作和余势） */
export const poseBody = (pose: string, k: number): Body => {
  switch (pose) {
    case 'raise':
      return RAISE;
    case 'down':
      return DOWN;
    case 'reach':
      return {...STAND, lean: 6, arm: L(80, 10)};
    case 'strike': {
      // 0-5 引臂到脑后 · 5-9 猛刺出去、跨一步 · 9-20 停住 · 20-32 收回到举起
      const wind: Body = {...RAISE, lean: -5, chest: -9, arm: L(158, 45), face: 'cold'};
      const hit: Body = {lean: 10, chest: 12, head: 8, leg_near: L(20, 22), leg_far: L(-12, 10), arm: L(38, 4), arm_far: L(-25, 30), face: 'cold'};
      if (k < 5) return mixBody(RAISE, wind, io(k / 5));
      if (k < 9) return mixBody(wind, hit, Easing.in(Easing.quad)((k - 5) / 4));
      if (k < 20) return hit;
      return mixBody(hit, RAISE, io(clamp01((k - 20) / 12)));
    }
    case 'shock': {
      // 先一缩（屈膝、含胸）→ 猛地后仰、双手护到脸前 → 一直发抖
      const flinch: Body = {...STAND, chest: 6, leg_near: L(8, 22), leg_far: L(-6, 20), arm: L(30, 60), arm_far: L(25, 60), face: 'shock'};
      const jolt: Body = {lean: -10, chest: -8, head: -12, leg_near: L(12, 14), leg_far: L(-10, 12), arm: L(70, 75), arm_far: L(60, 70), face: 'shock'};
      const tremble = Math.sin(k * 2.7) * 2 * Math.exp(-k / 40);
      const b = k < 4 ? mixBody(STAND, flinch, k / 4) : mixBody(flinch, jolt, outBack(clamp01((k - 4) / 6)));
      return {...b, lean: (b.lean ?? 0) + tremble, head: (b.head ?? 0) + tremble * 1.3};
    }
    case 'recoil': {
      const hitBack: Body = {lean: -14, chest: -12, head: -22, leg_near: L(14, 16), leg_far: L(-10, 14), arm: L(80, 40), arm_far: L(60, 45), face: 'shock'};
      const settle: Body = {...hitBack, lean: -7, chest: -5, head: -10};
      return k < 5 ? mixBody(STAND, hitBack, k / 5) : mixBody(hitBack, settle, clamp01((k - 5) / 20));
    }
    case 'fall':
      return {lean: -4, chest: -6, head: -25, leg_near: L(28, 45), leg_far: L(8, 30), arm: L(130, 40), arm_far: L(100, 35), face: 'shock'};
    default:
      return STAND;
  }
};

/** 站着时的生命感：呼吸、重心轻移、头部微动、手臂轻摆 */
const idle = (b: Body, frame: number, seed: number): Body => ({
  ...b,
  chest: (b.chest ?? 0) + Math.sin(frame / 40 + seed) * 1.5,
  lean: (b.lean ?? 0) + Math.sin(frame / 63 + seed * 2) * 1,
  head: (b.head ?? 0) + Math.sin(frame / 53 + seed * 3) * 2 + Math.sin(frame / 17 + seed) * 0.5,
  arm: {...b.arm, swing: (b.arm?.swing ?? 0) + Math.sin(frame / 34 + seed) * 2, bend: (b.arm?.bend ?? 0) + Math.sin(frame / 29 + seed) * 2},
  arm_far: {...b.arm_far, swing: (b.arm_far?.swing ?? 0) - Math.sin(frame / 34 + seed) * 2},
});

/** 眨眼：大约每 3 秒一次，每次 4 帧；有表情时不眨 */
const blinkAt = (frame: number, seed: number) => {
  const period = 95 + Math.floor((seed * 37) % 30);
  return (frame + Math.floor(seed * 50)) % period < 4;
};

export type ActorPose = {pose: string; prevPose: string; poseStart: number; walking: boolean};

/** 当前帧的身体：上一个姿势 → 当前姿势带回弹过渡；走路叠加步态；站着叠加呼吸；自动眨眼 */
export const actorBody = (st: ActorPose, frame: number, seed: number): {body: Body; lift: number} => {
  const k = frame - st.poseStart;
  const cur = poseBody(st.pose, k);
  const prev = poseBody(st.prevPose, 999);
  const instant = st.pose === 'strike' || st.pose === 'shock' || st.pose === 'recoil';
  let body = instant ? cur : mixBody(prev, cur, Math.min(1.15, outBack(clamp01(k / 9))));
  let lift = 0;
  if (st.walking) {
    const w = walkBody(frame / 4.5);
    // 走路时上半身的动作（举着剪刀、低头）保留，腿和没在做动作的手用步态
    const keepArm = st.pose === 'raise' || st.pose === 'strike';
    body = {...w.body, head: (w.body.head ?? 0) + (st.pose === 'down' ? 20 : 0), arm: keepArm ? body.arm : w.body.arm, face: body.face};
    lift = w.lift;
  } else {
    body = idle(body, frame, seed);
  }
  if (!body.face && blinkAt(frame, seed)) body = {...body, face: 'blink'};
  return {body, lift};
};
