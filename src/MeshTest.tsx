import React from 'react';
import {AbsoluteFill, useCurrentFrame} from 'remotion';
import {poseBody, walkBody} from './acting';
import {Body, MeshPuppet} from './mesh';

/** 网格人偶自检：每个角色 5 个姿势（原图不变形 / 站立 / 迈步 / 举起 / 后仰），绿底看缺口 */
const IDS = ['yosuke', 'yukiho_kid', 'ryoji_kid'];
const poses: Body[] = [{}, poseBody('stand', 99), walkBody(Math.PI / 2).body, poseBody('raise', 99), poseBody('recoil', 99)];

export const MeshTest: React.FC = () => {
  const frame = useCurrentFrame();
  return (
    <AbsoluteFill style={{background: '#3cc46a'}}>
      {IDS.map((id, r) =>
        poses.map((b, i) => (
          <div key={`${id}${i}`} style={{position: 'absolute', left: 110 + i * 215, top: 600 + r * 620}}>
            <MeshPuppet id={id} body={b} height={520} flip={1} frameKey={frame} />
          </div>
        )),
      )}
    </AbsoluteFill>
  );
};
