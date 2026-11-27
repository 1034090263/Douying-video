import React from 'react';
import {AbsoluteFill, Img, staticFile, useCurrentFrame} from 'remotion';
import {DISPLAY} from './lib';
import {FocusLines} from './climax';
import A from '../public/images/byakuya/seq_ryoji_kid_text/seq.json';
import B from '../public/images/byakuya/seq_ryoji_kid_stick/seq.json';
import C from '../public/images/byakuya/seq_ryoji_kid/seq.json';

/** 三种人物动作生成方法对比：同一套动作、同样的补帧和特效规则，上中下三栏同步播放 */
type Seq = {frames: string[]; keys: number[]; w: number; h: number; ax: number; ay: number; unit: number; loop: boolean};
type Set = {dir: string; label: string; data: Record<string, Seq>; hit: Record<string, number>};
const SETS: Set[] = [
  {dir: 'seq_ryoji_kid_text', label: 'A 纯文字描述', data: A as unknown as Record<string, Seq>, hit: {shock: 2, strike: 3}},
  {dir: 'seq_ryoji_kid_stick', label: 'B 文字 + 火柴人参考', data: B as unknown as Record<string, Seq>, hit: {shock: 2, strike: 3}},
  {dir: 'seq_ryoji_kid', label: 'C 姿势草稿逐帧重画', data: C as unknown as Record<string, Seq>, hit: {shock: 2, strike: 6}},
];
const SLOTS: [number, string][] = [[0, 'walk'], [72, 'stop'], [112, 'shock'], [158, 'raise'], [192, 'strike'], [244, 'down']];
const HOLD = 2;
const RH = 640; // 每栏高度
const H = 460; // 人物身高

const Row: React.FC<{s: Set; top: number}> = ({s, top}) => {
  const frame = useCurrentFrame();
  let i = 0;
  while (i + 1 < SLOTS.length && frame >= SLOTS[i + 1][0]) i++;
  const [start, action] = SLOTS[i];
  const sq = s.data[action];
  if (!sq) return null;
  const n = Math.floor((frame - start) / HOLD);
  const idx = sq.loop ? n % sq.frames.length : Math.min(n, sq.frames.length - 1);
  const k = H / sq.unit;
  const ground = RH - 50;
  const x = Math.min(60 + frame * 4.5, 60 + 72 * 4.5);
  const hk = s.hit[action] !== undefined ? frame - (start + (sq.keys[s.hit[action]] ?? 0) * HOLD) : -999;
  const impact = hk >= 0 && hk < 2;
  const shake = hk >= 0 && hk < 12 ? Math.sin(hk * 2.6) * (12 - hk) * 1.4 : 0;
  const red = action === 'strike' && hk >= 0 && hk < 16 ? Math.exp(-hk / 5) : 0;
  return (
    <div style={{position: 'absolute', left: 0, top, width: 1080, height: RH, overflow: 'hidden', filter: impact ? 'grayscale(1) contrast(3) invert(1)' : undefined}}>
      <div style={{position: 'absolute', inset: 0, transform: `translateX(${shake}px)`}}>
        <Img src={staticFile('images/byakuya/bg_ruins_room.png')} style={{position: 'absolute', left: -200, top: -1150, width: 1080 * 1.4, filter: 'brightness(0.85)'}} />
        <div style={{position: 'absolute', left: x - H * 0.22, top: ground - 14, width: H * 0.44, height: 30, borderRadius: '50%', background: 'radial-gradient(ellipse, rgba(0,0,0,0.55), rgba(0,0,0,0) 70%)'}} />
        <Img src={staticFile(`images/byakuya/${s.dir}/${action}/${sq.frames[idx]}`)} style={{position: 'absolute', left: x - sq.ax * k, top: ground - sq.ay * k, width: sq.w * k, height: sq.h * k}} />
      </div>
      {red > 0 && <div style={{position: 'absolute', inset: 0, background: '#c01010', mixBlendMode: 'multiply', opacity: red * 0.45}} />}
      {hk > -999 && <FocusLines at={frame - hk} x={x + 30} y={ground - H * 0.75} dur={18} r={160} />}
      <div style={{position: 'absolute', left: 24, top: 18, padding: '6px 18px', background: '#000a', color: '#fff', fontFamily: DISPLAY, fontSize: 40, fontWeight: 900}}>{s.label}</div>
    </div>
  );
};

export const CompareDemo: React.FC = () => (
  <AbsoluteFill style={{background: '#000'}}>
    {SETS.map((s, i) => (
      <Row key={s.dir} s={s} top={i * RH} />
    ))}
  </AbsoluteFill>
);
