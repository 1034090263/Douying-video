import React from 'react';
import {AbsoluteFill, Easing, Img, interpolate, random, useCurrentFrame} from 'remotion';
import {DISPLAY} from './lib';

/**
 * 情节高潮特效（都用「本镜头内的帧号 at」触发，坐标是屏幕坐标）：
 *   FocusLines 漫画集中线 · Shards 红色剪纸碎片迸射 · Slam 大字砸屏 · Glint 金属闪光
 *   Ink 墨色晕开 · heartK 心跳脉冲 · Insert 特写插入镜头 · RgbDefs 色散滤镜
 */

const clamp = {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'} as const;
const outBack = Easing.bezier(0.2, 1.6, 0.4, 1);

/** 漫画集中线：从画面四周向焦点收拢的细三角，每 2 帧换一次排布 */
export const FocusLines: React.FC<{at: number; x: number; y: number; dur?: number; color?: string; r?: number}> = ({at, x, y, dur = 20, color = '#fff', r = 260}) => {
  const frame = useCurrentFrame();
  const k = frame - at;
  if (k < 0 || k > dur) return null;
  const op = k < 3 ? k / 3 : interpolate(k, [dur * 0.5, dur], [1, 0], clamp);
  const seed = Math.floor(k / 2);
  return (
    <svg width={1080} height={1920} style={{position: 'absolute', inset: 0, opacity: op}}>
      {[...Array(110)].map((_, i) => {
        const a = (i / 110) * Math.PI * 2 + random(`fa${i}-${seed}`) * 0.05;
        const inner = r + random(`fr${i}-${seed}`) * 260;
        const w = 0.006 + random(`fw${i}-${seed}`) * 0.014;
        const R = 2400;
        const p = (rad: number, ang: number) => `${x + Math.cos(ang) * rad},${y + Math.sin(ang) * rad}`;
        return <polygon key={i} points={`${p(inner, a)} ${p(R, a - w)} ${p(R, a + w)}`} fill={color} opacity={0.75} />;
      })}
    </svg>
  );
};

/** 红色剪纸碎片：从一点向外迸射、翻转、下坠（亮司的剪纸，暗示而不见血） */
export const Shards: React.FC<{at: number; x: number; y: number; count?: number; color?: string; power?: number}> = ({at, x, y, count = 28, color = '#c3161c', power = 1}) => {
  const frame = useCurrentFrame();
  const k = frame - at;
  if (k < 0 || k > 70) return null;
  return (
    <AbsoluteFill>
      {[...Array(count)].map((_, i) => {
        const ang = random(`sa${i}${at}`) * Math.PI * 2;
        const sp = (14 + random(`ss${i}${at}`) * 30) * power;
        const t = k;
        const px = x + Math.cos(ang) * sp * t * Math.exp(-t / 30) * 1.4;
        const py = y + Math.sin(ang) * sp * t * Math.exp(-t / 30) * 1.4 + 0.25 * t * t;
        const size = 18 + random(`sz${i}${at}`) * 46;
        const pts = [...Array(3 + Math.floor(random(`sp${i}`) * 3))].map((__, j) => `${random(`px${i}${j}`) * 100}% ${random(`py${i}${j}`) * 100}%`).join(',');
        return (
          <div
            key={i}
            style={{
              position: 'absolute',
              left: px,
              top: py,
              width: size,
              height: size * (0.5 + random(`sh${i}`)),
              background: color,
              clipPath: `polygon(${pts})`,
              transform: `rotate(${t * (random(`sr${i}`) * 24 - 12)}deg) rotateY(${t * 9}deg)`,
              opacity: interpolate(k, [45, 70], [1, 0], clamp),
              boxShadow: `0 0 12px ${color}`,
            }}
          />
        );
      })}
    </AbsoluteFill>
  );
};

/** 大字砸屏：从放大 2.6 倍砸下来、震一下、停住、淡出 */
export const Slam: React.FC<{at: number; text: string; x: number; y: number; size?: number; color?: string; rot?: number; dur?: number}> = ({at, text, x, y, size = 220, color = '#d0171c', rot = -6, dur = 45}) => {
  const frame = useCurrentFrame();
  const k = frame - at;
  if (k < 0 || k > dur) return null;
  const s = interpolate(k, [0, 5], [2.6, 1], {...clamp, easing: outBack});
  const shake = k < 12 ? Math.sin(k * 3.1) * (12 - k) * 1.2 : 0;
  const op = interpolate(k, [0, 2, dur - 10, dur], [0, 1, 1, 0], clamp);
  return (
    <div
      style={{
        position: 'absolute',
        left: x,
        top: y,
        transform: `translate(-50%, -50%) translate(${shake}px, ${-shake * 0.6}px) rotate(${rot}deg) scale(${s})`,
        fontFamily: DISPLAY,
        fontWeight: 900,
        fontSize: size,
        letterSpacing: 8,
        whiteSpace: 'nowrap',
        color,
        WebkitTextStroke: '6px #fff',
        paintOrder: 'stroke fill',
        textShadow: '10px 12px 0 #000, 0 0 40px rgba(255,40,30,0.6)',
        opacity: op,
      }}
    >
      {text}
    </div>
  );
};

/** 金属闪光：四角星 + 光晕，转一下就收 */
export const Glint: React.FC<{at: number; x: number; y: number; dur?: number; size?: number}> = ({at, x, y, dur = 22, size = 220}) => {
  const frame = useCurrentFrame();
  const k = frame - at;
  if (k < 0 || k > dur) return null;
  const s = Math.sin((k / dur) * Math.PI);
  return (
    <div style={{position: 'absolute', left: x, top: y, transform: `translate(-50%, -50%) rotate(${k * 4}deg) scale(${s})`, mixBlendMode: 'screen'}}>
      <div style={{position: 'absolute', left: -size / 2, top: -size / 2, width: size, height: size, borderRadius: '50%', background: 'radial-gradient(circle, rgba(255,255,255,0.9) 0%, rgba(255,230,200,0.35) 25%, rgba(255,255,255,0) 60%)'}} />
      {[0, 90, 45, 135].map((a, i) => (
        <div key={a} style={{position: 'absolute', left: -size * (i < 2 ? 0.9 : 0.45), top: -3, width: size * (i < 2 ? 1.8 : 0.9), height: 6, borderRadius: 3, background: 'linear-gradient(90deg, #fff0, #fff, #fff0)', transform: `rotate(${a}deg)`}} />
      ))}
    </div>
  );
};

/** 墨色晕开：从一点向外扩散的暗色，边缘被噪声扰动 */
export const Ink: React.FC<{at: number; x: number; y: number; dur?: number; r?: number; color?: string}> = ({at, x, y, dur = 70, r = 1300, color = '#06030a'}) => {
  const frame = useCurrentFrame();
  const k = frame - at;
  if (k < 0) return null;
  const p = interpolate(k, [0, dur], [0, 1], {...clamp, easing: Easing.out(Easing.cubic)});
  return (
    <svg width={1080} height={1920} style={{position: 'absolute', inset: 0}}>
      <filter id={`ink${at}`}>
        <feTurbulence type="fractalNoise" baseFrequency="0.012" numOctaves="3" seed={at % 97} />
        <feDisplacementMap in="SourceGraphic" scale={160} />
        <feGaussianBlur stdDeviation="6" />
      </filter>
      <g filter={`url(#ink${at})`} opacity={0.88}>
        {[0, 1, 2, 3].map((i) => (
          <circle key={i} cx={x + (random(`ix${i}${at}`) - 0.5) * 220} cy={y + (random(`iy${i}${at}`) - 0.5) * 120} r={r * p * (0.55 + i * 0.15)} fill={color} />
        ))}
      </g>
    </svg>
  );
};

/** 心跳强度（0~1）：咚-咚 两下一组，约每秒一组，从 from 到 to 帧之间越来越快 */
export const heartK = (frame: number, from: number, to: number) => {
  if (frame < from || frame > to + 20) return 0;
  const p = interpolate(frame, [from, to], [0, 1], clamp);
  const period = 30 - p * 12;
  const t = (frame - from) % period;
  const beat = Math.exp(-t / 3) + 0.6 * Math.exp(-Math.max(0, t - 7) / 3) * (t >= 7 ? 1 : 0);
  return Math.min(1, beat) * (0.5 + p * 0.5) * interpolate(frame, [to, to + 20], [1, 0], clamp);
};

/** 特写插入镜头：暗底上一件物品放大、发光、光泽扫过 */
export const Insert: React.FC<{at: number; until: number; img: string; caption?: string; glow?: string}> = ({at, until, img, caption, glow = 'rgba(255,200,120,0.55)'}) => {
  const frame = useCurrentFrame();
  if (frame < at || frame > until + 8) return null;
  const k = frame - at;
  const inP = interpolate(k, [0, 6], [0, 1], {...clamp, easing: Easing.out(Easing.cubic)});
  const outP = interpolate(frame, [until, until + 8], [0, 1], clamp);
  const zoom = 1 + (k / Math.max(1, until - at)) * 0.12;
  const sweep = interpolate(k, [8, 40], [-60, 160], clamp);
  return (
    <AbsoluteFill style={{opacity: inP * (1 - outP)}}>
      <AbsoluteFill style={{background: 'radial-gradient(ellipse at 50% 42%, #2a1e16 0%, #08060a 70%)'}} />
      <AbsoluteFill style={{alignItems: 'center', justifyContent: 'center', transform: `scale(${(0.85 + inP * 0.15) * zoom}) translateY(-120px)`}}>
        <div style={{position: 'relative', width: 820, height: 820}}>
          <Img src={img} style={{width: '100%', height: '100%', objectFit: 'contain', filter: `drop-shadow(0 0 40px ${glow}) drop-shadow(0 30px 40px #000)`}} />
          <div
            style={{
              position: 'absolute',
              inset: 0,
              background: `linear-gradient(110deg, rgba(255,255,255,0) ${sweep - 15}%, rgba(255,255,255,0.45) ${sweep}%, rgba(255,255,255,0) ${sweep + 15}%)`,
              WebkitMaskImage: `url(${img})`,
              WebkitMaskSize: 'contain',
              WebkitMaskRepeat: 'no-repeat',
              WebkitMaskPosition: 'center',
              mixBlendMode: 'screen',
            }}
          />
        </div>
        {caption && (
          <div style={{marginTop: -40, fontFamily: DISPLAY, fontWeight: 900, fontSize: 110, color: '#f2d39a', letterSpacing: 6, textShadow: '0 0 30px rgba(255,180,80,0.6), 0 6px 20px #000'}}>{caption}</div>
        )}
      </AbsoluteFill>
    </AbsoluteFill>
  );
};

/** 色散滤镜定义：红、蓝通道左右错开 d 像素（配合 CSS filter: url(#rgbsplit)） */
export const RgbDefs: React.FC<{d: number}> = ({d}) => (
  <svg width={0} height={0} style={{position: 'absolute'}}>
    <filter id="rgbsplit" x="-5%" y="-5%" width="110%" height="110%">
      <feColorMatrix in="SourceGraphic" type="matrix" values="1 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 1 0" result="r" />
      <feOffset in="r" dx={d} dy={0} result="r2" />
      <feColorMatrix in="SourceGraphic" type="matrix" values="0 0 0 0 0  0 1 0 0 0  0 0 0 0 0  0 0 0 1 0" result="g" />
      <feColorMatrix in="SourceGraphic" type="matrix" values="0 0 0 0 0  0 0 0 0 0  0 0 1 0 0  0 0 0 1 0" result="b" />
      <feOffset in="b" dx={-d} dy={d * 0.3} result="b2" />
      <feBlend in="r2" in2="g" mode="screen" result="rg" />
      <feBlend in="rg" in2="b2" mode="screen" />
    </filter>
  </svg>
);
