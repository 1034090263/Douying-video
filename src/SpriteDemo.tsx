import React from 'react';
import {AbsoluteFill, Img, interpolate, staticFile, useCurrentFrame} from 'remotion';
import sprites from '../public/images/byakuya/pose_ryoji_kid/sprites.json';

/** 逐帧精灵演示（动态漫做法）：走路 4 帧循环 → 站住 → 惊吓 → 举剪刀 → 引臂、刺下（两次）→ 低头 */
type Sp = {file: string; w: number; h: number; ax: number; ay: number; unit: number};
const S = sprites as Record<string, Sp>;
const H = 640; // 角色身高（画面像素）

const Sprite: React.FC<{name: string; x: number; y: number; opacity?: number; extra?: string; filter?: string}> = ({name, x, y, opacity = 1, extra = '', filter}) => {
  const sp = S[name];
  if (!sp) return null;
  const k = H / sp.unit;
  return (
    <Img
      src={staticFile(`images/byakuya/pose_ryoji_kid/${sp.file}`)}
      style={{position: 'absolute', left: x - sp.ax * k, top: y - sp.ay * k, width: sp.w * k, height: sp.h * k, opacity, transformOrigin: `${sp.ax * k}px ${sp.ay * k}px`, transform: extra, filter}}
    />
  );
};

// 时间轴：[开始帧, 画稿, 进场方式]
const TL: [number, string, 'cut' | 'fade' | 'smear'][] = [
  [0, 'walk', 'cut'],
  [48, 'stand', 'fade'],
  [100, 'shock20', 'smear'],
  [150, 'raise99', 'fade'],
  [182, 'strike3', 'cut'],
  [187, 'strike12', 'smear'],
  [214, 'strike3', 'fade'],
  [222, 'strike12', 'smear'],
  [260, 'raise99', 'fade'],
  [290, 'down99', 'fade'],
];

export const SpriteDemo: React.FC = () => {
  const frame = useCurrentFrame();
  const ground = 1560;
  let i = 0;
  while (i + 1 < TL.length && frame >= TL[i + 1][0]) i++;
  const [start, name0, how] = TL[i];
  const k = frame - start;
  // 走路：每张画稿停 6 帧（一拍六），人匀速前进
  const walking = name0 === 'walk';
  const name = walking ? `walk_${(Math.floor(frame / 6) % 4) + 1}` : name0;
  const x = walking ? -150 + frame * 11 : -150 + 48 * 11;
  const bob = walking ? (Math.floor(frame / 6) % 2) * -6 : 0;
  // 呼吸：停着时身体微微起伏
  const breath = walking ? '' : `scaleY(${1 + Math.sin(frame / 14) * 0.006}) rotate(${Math.sin(frame / 37) * 0.4}deg)`;
  const prev = i > 0 ? TL[i - 1][1] : null;
  const fadeIn = how === 'fade' ? interpolate(k, [0, 4], [0, 1], {extrapolateRight: 'clamp'}) : 1;
  const smear = how === 'smear' && k < 3 ? `blur(${(3 - k) * 3}px)` : undefined;
  const punch = how === 'smear' ? 1 + 0.04 * Math.exp(-k / 3) : 1;
  return (
    <AbsoluteFill style={{background: '#111'}}>
      <Img src={staticFile('images/byakuya/bg_ruins_room.png')} style={{position: 'absolute', left: -300, top: -720, width: 1080 * 1.55, filter: 'brightness(0.85)'}} />
      <div style={{position: 'absolute', left: x - H * 0.22, top: ground - 18, width: H * 0.44, height: 40, borderRadius: '50%', background: 'radial-gradient(ellipse, rgba(0,0,0,0.55), rgba(0,0,0,0) 70%)'}} />
      {prev && fadeIn < 1 && <Sprite name={prev === 'walk' ? 'walk_1' : prev} x={x} y={ground} opacity={1 - fadeIn} />}
      <Sprite name={name} x={x} y={ground + bob} opacity={fadeIn} extra={`${breath} scale(${punch})`} filter={smear} />
    </AbsoluteFill>
  );
};
