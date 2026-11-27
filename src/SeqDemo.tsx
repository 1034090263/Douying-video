import React from 'react';
import {AbsoluteFill, Img, staticFile, useCurrentFrame} from 'remotion';
import seqs from '../public/images/byakuya/seq_ryoji_kid/seq.json';
import {FocusLines} from './climax';

/**
 * 连续帧演示：每个动作都是模型重画的完整人物 + RIFE 补帧，按「一拍二」播放。
 * 普通动作（走路、停下、举起、低头）不加任何特效；只有关键动作（惊吓、刺下）加冲击帧、集中线、红闪、震动。
 */
type Seq = {frames: string[]; w: number; h: number; ax: number; ay: number; unit: number; loop: boolean};
const S = seqs as unknown as Record<string, Seq>;
const H = 640;
const HOLD = 2; // 一拍二

// [开始帧, 动作, 关键动作的「命中」画稿序号]
const TL: [number, string, number?][] = [
  [0, 'walk'],
  [72, 'stop'],
  [112, 'shock', 3],
  [158, 'raise'],
  [192, 'strike', 10],
  [244, 'down'],
];

export const SeqDemo: React.FC = () => {
  const frame = useCurrentFrame();
  let i = 0;
  while (i + 1 < TL.length && frame >= TL[i + 1][0]) i++;
  const [start, action, hitIdx] = TL[i];
  const sq = S[action];
  const n = Math.floor((frame - start) / HOLD);
  const idx = sq.loop ? n % sq.frames.length : Math.min(n, sq.frames.length - 1);
  const k = H / sq.unit;
  const ground = 1560;
  const x = Math.min(-120 + frame * 6.5, -120 + 72 * 6.5);
  // 关键动作：命中那一帧起冲击帧 + 红闪 + 震动
  const hitAt = hitIdx !== undefined ? start + hitIdx * HOLD : -999;
  const hk = frame - hitAt;
  const impact = hk >= 0 && hk < 2;
  const shake = hk >= 0 && hk < 12 ? Math.sin(hk * 2.6) * (12 - hk) * 1.6 : 0;
  const red = action === 'strike' && hk >= 0 && hk < 16 ? Math.exp(-hk / 5) : 0;
  return (
    <AbsoluteFill style={{background: '#111', filter: impact ? 'grayscale(1) contrast(3) invert(1)' : undefined}}>
      <AbsoluteFill style={{transform: `translateX(${shake}px)`}}>
        <Img src={staticFile('images/byakuya/bg_ruins_room.png')} style={{position: 'absolute', left: -300, top: -720, width: 1080 * 1.55, filter: 'brightness(0.85)'}} />
        <div style={{position: 'absolute', left: x - H * 0.22, top: ground - 18, width: H * 0.44, height: 40, borderRadius: '50%', background: 'radial-gradient(ellipse, rgba(0,0,0,0.55), rgba(0,0,0,0) 70%)'}} />
        <Img
          src={staticFile(`images/byakuya/seq_ryoji_kid/${action}/${sq.frames[idx]}`)}
          style={{position: 'absolute', left: x - sq.ax * k, top: ground - sq.ay * k, width: sq.w * k, height: sq.h * k}}
        />
      </AbsoluteFill>
      {red > 0 && <AbsoluteFill style={{background: '#c01010', mixBlendMode: 'multiply', opacity: red * 0.45}} />}
      {hitIdx !== undefined && <FocusLines at={hitAt} x={x + 40} y={ground - H * 0.75} dur={18} />}
    </AbsoluteFill>
  );
};
