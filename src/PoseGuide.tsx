import React from 'react';
import {AbsoluteFill} from 'remotion';
import {mixBody, poseBody, walkBody} from './acting';
import {Body, MeshPuppet, meshRig} from './mesh';

/**
 * 姿势草稿：用网格人偶摆出姿势，按原图同样的位置和大小画在浅灰底上，给生图模型当姿势参考（模型会把它重画成完整人物）。
 * pose/k/phase 指定一个姿势；再给 from + t，就是从 from 过渡到它的中间姿势（动作之间的衔接帧）。
 */
type Spec = {pose: string; k?: number; phase?: number};
const bodyOf = (s: Spec): Body => (s.pose === 'walk' ? walkBody(s.phase ?? 0).body : s.pose === 'rest' ? {} : poseBody(s.pose, s.k ?? 99));

export const PoseGuide: React.FC<Spec & {id: string; from?: Spec; t?: number}> = ({id, from, t = 1, ...spec}) => {
  const rig = meshRig(id);
  if (!rig) return null;
  const body = from ? mixBody(bodyOf(from), bodyOf(spec), t) : bodyOf(spec);
  const top = Math.min(...Object.values(rig.parts).map((p) => p.y));
  return (
    <AbsoluteFill style={{background: '#d9dadc'}}>
      <div style={{position: 'absolute', left: rig.spine[0][0], top: rig.ground}}>
        <MeshPuppet id={id} body={{...body, face: undefined}} height={rig.ground - top} flip={1} frameKey={0} />
      </div>
    </AbsoluteFill>
  );
};
