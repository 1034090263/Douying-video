import React from 'react';
import {Img, staticFile, useCurrentFrame} from 'remotion';
import {TIMELINE} from './lib';

/**
 * 骨骼人偶：scripts/rig.py 把一张侧面全身像拆成部件 + 关节，这里按关节逐级旋转后按前后层次绘制。
 * 原图就是「静止姿势」，所有角度都是相对原图的增量（度，顺时针为正）。
 */

type Part = {file: string; x: number; y: number; w: number; h: number; pivot: [number, number]; parent: string | null};
export type Rig = {size: [number, number]; facing: 1 | -1; ground: number; order: string[]; parts: Record<string, Part>; keypoints: Record<string, [number, number]>; hand?: [number, number]};
export type RigPose = Partial<Record<'lean' | 'head' | 'uarm' | 'farm' | 'uarm_far' | 'farm_far' | 'thigh_near' | 'shin_near' | 'thigh_far' | 'shin_far' | 'shin', number>>;

const RIGS = ((TIMELINE as unknown as {rigs?: Record<string, Rig>}).rigs ?? {}) as Record<string, Rig>;
const IMGSET = (TIMELINE.theme as {images?: string} | undefined)?.images ?? TIMELINE.id;

const deg = (a: [number, number], b: [number, number]) => (Math.atan2(b[1] - a[1], b[0] - a[0]) * 180) / Math.PI;

/** 两腿在原图里张开的角度（走路时在这个幅度内来回摆） */
export const strideOf = (rig: Rig) => {
  const k = rig.keypoints;
  const near = rig.parts.thigh_near ?? rig.parts.shin_near;
  const far = rig.parts.thigh_far ?? rig.parts.shin_far;
  if (!near || !far) return 30;
  const hip: [number, number] = [(k.hip_l[0] + k.hip_r[0]) / 2, (k.hip_l[1] + k.hip_r[1]) / 2];
  const a1 = deg(hip, k.an_l);
  const a2 = deg(hip, k.an_r);
  return Math.abs(a1 - a2);
};

/** 走路周期：phase 每一步 +π，两腿在张开幅度内交替；摆到后方的腿弯膝，手臂反向摆 */
export const walkPose = (rig: Rig, phase: number): RigPose => {
  const st = strideOf(rig);
  const s = (1 - Math.cos(phase)) / 2; // 0 → 1 → 0
  // 原图里近腿在前还是在后：用脚踝 x 和朝向判断
  const k = rig.keypoints;
  const nearFront = (rig.parts.shin_near?.pivot[0] ?? 0) * rig.facing > (rig.parts.shin_far?.pivot[0] ?? 0) * rig.facing ? 1 : -1;
  const swing = st * s * rig.facing * nearFront;
  const bend = Math.max(0, Math.sin(phase)) * 22;
  void k;
  return {
    thigh_near: swing,
    thigh_far: -swing,
    shin_near: rig.facing * (s > 0.5 ? bend : 0),
    shin_far: rig.facing * (s <= 0.5 ? bend : 0),
    // 手臂与同侧腿反向摆：原图里近手在前，所以随近腿往后摆时近手往前收
    uarm: -swing * 0.55,
    uarm_far: swing * 0.55,
    farm: -Math.max(0, Math.sin(phase)) * 10 * rig.facing,
  };
};

/** 让近侧手臂指向某个绝对方向（度，0=向右，-90=向上） */
export const armTo = (rig: Rig, targetDeg: number): RigPose => {
  const u = rig.parts.uarm;
  const f = rig.parts.farm;
  if (!u || !f) return {};
  const cur = deg(u.pivot, f.pivot);
  const fk = rig.keypoints;
  void fk;
  return {uarm: targetDeg - cur, farm: 0};
};

export const RigPuppet: React.FC<{id: string; pose: RigPose; height: number; facing?: 1 | -1; prop?: string; glow?: boolean}> = ({id, pose, height, facing = 1, prop, glow}) => {
  useCurrentFrame();
  const rig = RIGS[id];
  if (!rig) return null;
  const P = rig.parts;
  const top = Math.min(...Object.values(P).map((p) => p.y));
  const scale = height / (rig.ground - top);
  const hip = P.torso.pivot;
  // 关节链：每个部件的变换 = 父链 + 自己绕关节旋转
  const rot = (name: string): string => {
    const p = P[name];
    if (!p) return '';
    const a = name === 'torso' ? pose.lean ?? 0 : (pose as Record<string, number>)[name] ?? (name.startsWith('shin') && !P.thigh_near ? pose.shin ?? 0 : 0);
    const own = `rotate(${a} ${p.pivot[0]} ${p.pivot[1]})`;
    return p.parent ? `${rot(p.parent)} ${own}` : own;
  };
  const flip = facing * rig.facing;
  const wrist = rig.hand ?? null;
  return (
    <g transform={`scale(${scale * flip}, ${scale}) translate(${-hip[0]}, ${-rig.ground})`} style={{filter: glow ? 'drop-shadow(0 0 20px #fff)' : undefined}}>
      {rig.order.map((name) => {
        const p = P[name];
        return (
          <g key={name} transform={rot(name)}>
            <image href={staticFile(`images/${IMGSET}/rig_${id}/${p.file}`)} x={p.x} y={p.y} width={p.w} height={p.h} />
            {name === 'farm' && prop && wrist && (
              <g transform={`translate(${wrist[0]}, ${wrist[1]})`}>
                <image href={staticFile(`images/${IMGSET}/${prop}`)} x={-60} y={-150} width={120} height={160} />
              </g>
            )}
          </g>
        );
      })}
    </g>
  );
};

export {Img};
