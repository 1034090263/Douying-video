import React from 'react';
import {AbsoluteFill} from 'remotion';
import {poseBody, walkBody} from './acting';
import {Body, MeshPuppet, meshRig} from './mesh';

/** 姿势草稿：用网格人偶摆出姿势，按原图同样的位置和大小画在浅灰底上，给生图模型当姿势参考 */
export const PoseGuide: React.FC<{id: string; pose: string; k?: number; phase?: number}> = ({id, pose, k = 99, phase = 0}) => {
  const rig = meshRig(id);
  if (!rig) return null;
  const body: Body = pose === 'walk' ? walkBody(phase).body : pose === 'rest' ? {} : poseBody(pose, k);
  const top = Math.min(...Object.values(rig.parts).map((p) => p.y));
  return (
    <AbsoluteFill style={{background: '#d9dadc'}}>
      <div style={{position: 'absolute', left: rig.spine[0][0], top: rig.ground}}>
        <MeshPuppet id={id} body={{...body, face: undefined}} height={rig.ground - top} flip={1} frameKey={0} />
      </div>
    </AbsoluteFill>
  );
};
