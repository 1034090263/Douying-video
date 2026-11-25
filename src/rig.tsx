import React from 'react';
import {Img, staticFile, useCurrentFrame} from 'remotion';
import {TIMELINE} from './lib';

/**
 * 骨骼人偶：scripts/rig.py 把一张侧面全身像拆成部件 + 关节，这里按关节逐级旋转后按前后层次绘制。
 * 原图就是「静止姿势」，所有角度都是相对原图的增量（度，顺时针为正）。
 */

/** base：远侧肢体复用近侧肢体的图，先绕近侧关节转到远侧原来的角度、再平移到远侧关节；shade：压暗显得在后面 */
type Part = {file: string; x: number; y: number; w: number; h: number; pivot: [number, number]; parent: string | null; base?: {dx: number; dy: number; rot: number; pivot: [number, number]}; shade?: number};
export type Rig = {size: [number, number]; facing: 1 | -1; ground: number; order: string[]; parts: Record<string, Part>; keypoints: Record<string, [number, number]>; hand?: [number, number]; feet?: {near: [number, number]; far: [number, number]}};
export type RigPose = Partial<Record<'lean' | 'head' | 'arm' | 'arm_far' | 'leg_near' | 'leg_far', number>>;

const RIGS = ((TIMELINE as unknown as {rigs?: Record<string, Rig>}).rigs ?? {}) as Record<string, Rig>;
const IMGSET = (TIMELINE.theme as {images?: string} | undefined)?.images ?? TIMELINE.id;

const deg = (a: [number, number], b: [number, number]) => (Math.atan2(b[1] - a[1], b[0] - a[0]) * 180) / Math.PI;

/** 两腿在原图里张开的角度（走路时在这个幅度内来回摆） */
export const strideOf = (rig: Rig) => {
  const L = rig.parts.leg_near;
  if (!L || !rig.feet) return 30;
  return Math.abs(deg(L.pivot, rig.feet.near) - deg(L.pivot, rig.feet.far));
};

/** 原图里近腿在前（朝向那一侧）为 1，否则 -1 */
export const nearFront = (rig: Rig) => (rig.feet && rig.feet.near[0] * rig.facing > rig.feet.far[0] * rig.facing ? 1 : -1);

/** 两腿并拢、双臂自然下垂的站姿 */
export const standPose = (rig: Rig): RigPose => {
  const sw = (strideOf(rig) / 2) * rig.facing * nearFront(rig);
  return {leg_near: sw, leg_far: -sw, arm: -sw * 0.5, arm_far: sw * 0.5};
};

/** 走路周期：整条腿绕髋在张开幅度内交替前后摆，手臂绕肩反向摆 */
export const walkPose = (rig: Rig, phase: number): RigPose => {
  const swing = strideOf(rig) * ((1 - Math.cos(phase)) / 2) * rig.facing * nearFront(rig);
  return {leg_near: swing, leg_far: -swing, arm: -swing * 0.55, arm_far: swing * 0.55};
};

/** 让近侧整条手臂指向某个绝对方向（度，0=向右，-90=向上） */
export const armTo = (rig: Rig, targetDeg: number): RigPose => {
  const A = rig.parts.arm;
  if (!A || !rig.hand) return {};
  return {arm: targetDeg - deg(A.pivot, rig.hand)};
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
    const a = name === 'torso' ? pose.lean ?? 0 : (pose as Record<string, number>)[name] ?? 0;
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
            <g
              transform={p.base ? `translate(${p.base.dx} ${p.base.dy}) rotate(${p.base.rot} ${p.base.pivot[0]} ${p.base.pivot[1]})` : undefined}
              style={{filter: p.shade ? `brightness(${p.shade})` : undefined}}
            >
              <image href={staticFile(`images/${IMGSET}/rig_${id}/${p.file}`)} x={p.x} y={p.y} width={p.w} height={p.h} />
            </g>
            {name === 'arm' && prop && wrist && (
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
