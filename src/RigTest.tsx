import React from 'react';
import {AbsoluteFill} from 'remotion';
import {TIMELINE} from './lib';
import {Rig, RigPose, RigPuppet, armTo, standPose, walkPose} from './rig';

/** 关节压力测试：每个骨骼角色摆几个极端姿势，检查关节处有没有断开 */
const RIGS = ((TIMELINE as unknown as {rigs?: Record<string, Rig>}).rigs ?? {}) as Record<string, Rig>;

const poses = (rig: Rig): RigPose[] => [
  {},
  standPose(rig),
  walkPose(rig, Math.PI),
  {...armTo(rig, -75), arm_far: 50},
  {arm: 80, arm_far: -80, leg_near: -35, leg_far: 35, head: 22, lean: 8},
];

export const RigTest: React.FC = () => (
  <AbsoluteFill style={{background: '#3cc46a'}}>
    {Object.keys(RIGS).map((id, row) => (
      <div key={id} style={{position: 'absolute', top: 40 + row * 620, left: 0, width: 1080, height: 600}}>
        <svg width={1080} height={600}>
          {poses(RIGS[id]).map((p, i) => (
            <g key={i} transform={`translate(${110 + i * 215}, 580)`}>
              <RigPuppet id={id} pose={p} height={520} />
            </g>
          ))}
        </svg>
      </div>
    ))}
  </AbsoluteFill>
);
