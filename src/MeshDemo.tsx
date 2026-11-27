import React from 'react';
import {AbsoluteFill, Easing, Img, interpolate, staticFile, useCurrentFrame} from 'remotion';
import {actorBody} from './acting';
import {MeshPuppet} from './mesh';

/** 网格人偶演示：亮司走进来 → 站着（呼吸、眨眼）→ 惊吓 → 举剪刀 → 刺两下 → 低头；洋介被刺后仰、倒下 */
const BOY: [number, string][] = [[0, 'stand'], [100, 'shock'], [150, 'raise'], [180, 'strike'], [215, 'strike'], [290, 'down']];
const MAN: [number, string][] = [[0, 'stand'], [189, 'recoil'], [224, 'recoil'], [255, 'fall']];

const track = (seq: [number, string][], frame: number) => {
  let i = 0;
  while (i + 1 < seq.length && frame >= seq[i + 1][0]) i++;
  return {pose: seq[i][1], prevPose: i > 0 ? seq[i - 1][1] : 'stand', poseStart: seq[i][0]};
};

export const MeshDemo: React.FC = () => {
  const frame = useCurrentFrame();
  const ground = 1560;
  const bx = interpolate(frame, [0, 90], [-120, 330], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: Easing.out(Easing.quad)});
  const boy = actorBody({...track(BOY, frame), walking: frame < 90}, frame, 0.7);
  const man = actorBody({...track(MAN, frame), walking: false}, frame, 2.1);
  const fk = frame - 255;
  const fall = fk < 0 ? 0 : fk < 5 ? -6 * (fk / 5) : fk < 19 ? -6 + 90 * Easing.in(Easing.quad)((fk - 5) / 14) : 84 + 7 * Math.exp(-(fk - 19) / 4) * Math.cos((fk - 19) * 0.9);
  const sh = {skew: 30, len: 0.3, opacity: 0.3};
  return (
    <AbsoluteFill style={{background: '#111'}}>
      <Img src={staticFile('images/byakuya/bg_ruins_room.png')} style={{position: 'absolute', left: -300, top: -720, width: 1080 * 1.55, filter: 'brightness(0.85)'}} />
      <div style={{position: 'absolute', left: bx, top: ground}}>
        <MeshPuppet id="ryoji_kid" body={boy.body} height={640} flip={1} lift={boy.lift} shadow={sh} prop={boy.body.arm && (boy.body.arm.swing ?? 0) > 30 ? 'prop_scissors.png' : undefined} frameKey={frame} />
      </div>
      <div style={{position: 'absolute', left: 760, top: ground}}>
        <MeshPuppet id="yosuke" body={man.body} height={760} flip={-1} rot={fall} lift={man.lift} shadow={sh} frameKey={frame} />
      </div>
    </AbsoluteFill>
  );
};
