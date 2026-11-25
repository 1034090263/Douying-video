import React from 'react';
import {useCurrentFrame} from 'remotion';
import {SANS} from './lib';

/** Q 版贴纸小人：用 SVG 分部件绘制，局部坐标以脚底中心为原点、向上为负 */

export type Expression = 'normal' | 'smile' | 'cold' | 'shocked' | 'sad' | 'angry' | 'thinking' | 'dark' | 'closed';
export type Pose = 'idle' | 'wave' | 'point' | 'shock' | 'think' | 'hold' | 'cover' | 'down';
export type Emote = '!' | '?' | 'sweat' | 'anger' | 'tears' | '...' | 'heart' | 'dark' | 'sparkle' | null;

export type CharSpec = {
  name: string;
  age?: 'kid' | 'adult' | 'old';
  skin?: string;
  hair: 'messy' | 'long' | 'side' | 'bald' | 'bob' | 'bun' | 'short' | 'ponytail';
  hairColor: string;
  outfit: string; // 上衣颜色
  outfit2?: string; // 下装颜色
  dress?: boolean; // 连衣裙
  hat?: 'fedora' | 'cap' | 'santa' | null;
  hatColor?: string;
  glasses?: boolean;
  tie?: string;
  apron?: string;
  coat?: string; // 外套/风衣颜色
  necklace?: boolean;
  mustache?: boolean;
  blush?: boolean;
  prop?: Prop | null;
};
export type Prop = 'scissors' | 'lighter' | 'paper' | 'book' | 'notebook' | 'cigarette' | 'bag' | 'money' | null;

const INK = '#2a2230';

const capsule = (x1: number, y1: number, x2: number, y2: number, w: number, color: string, key?: string) => (
  <line key={key} x1={x1} y1={y1} x2={x2} y2={y2} stroke={color} strokeWidth={w} strokeLinecap="round" />
);

/** 两段式手臂：shoulder 角度 a1（度，0=向下，正=朝身体外侧），肘部再弯 a2 */
const arm = (sx: number, sy: number, a1: number, a2: number, len: number, side: 1 | -1, sleeve: string, skin: string) => {
  const r1 = ((a1 * side) * Math.PI) / 180;
  const ex = sx + Math.sin(r1) * len * 0.5;
  const ey = sy + Math.cos(r1) * len * 0.5;
  const r2 = (((a1 + a2) * side) * Math.PI) / 180;
  const hx = ex + Math.sin(r2) * len * 0.5;
  const hy = ey + Math.cos(r2) * len * 0.5;
  return {
    el: (
      <g>
        {capsule(sx, sy, ex, ey, 30, sleeve)}
        {capsule(ex, ey, hx, hy, 26, sleeve)}
        <circle cx={hx} cy={hy} r={15} fill={skin} />
      </g>
    ),
    hand: [hx, hy] as [number, number],
  };
};

const POSES: Record<Pose, {r: [number, number]; l: [number, number]}> = {
  // [肩角度, 肘弯] 右臂 r / 左臂 l
  idle: {r: [14, -4], l: [14, -4]},
  wave: {r: [150, 25], l: [14, -4]},
  point: {r: [95, 0], l: [14, -4]},
  shock: {r: [140, 30], l: [140, 30]},
  think: {r: [40, 120], l: [20, 60]},
  hold: {r: [50, 50], l: [14, -4]},
  cover: {r: [60, 120], l: [60, 120]},
  down: {r: [4, 0], l: [4, 0]},
};

const PropShape: React.FC<{p: Prop; x: number; y: number}> = ({p, x, y}) => {
  if (!p) return null;
  switch (p) {
    case 'scissors':
      return (
        <g transform={`translate(${x},${y}) rotate(-35)`}>
          <circle cx={-10} cy={14} r={10} fill="none" stroke="#c0392b" strokeWidth={6} />
          <circle cx={10} cy={14} r={10} fill="none" stroke="#c0392b" strokeWidth={6} />
          <path d="M -4 4 L 6 -46 L 10 -46 L 4 4 Z" fill="#cfd6dd" stroke={INK} strokeWidth={2} />
          <path d="M 4 4 L -6 -46 L -10 -46 L -4 4 Z" fill="#e8edf1" stroke={INK} strokeWidth={2} />
        </g>
      );
    case 'lighter':
      return (
        <g transform={`translate(${x},${y})`}>
          <rect x={-12} y={-30} width={24} height={36} rx={4} fill="#d4af37" stroke={INK} strokeWidth={2} />
          <rect x={-12} y={-30} width={24} height={9} fill="#b8962e" />
        </g>
      );
    case 'paper':
      // 剪纸：一张带镂空花纹的红纸
      return (
        <g transform={`translate(${x},${y}) rotate(-8)`}>
          <rect x={-34} y={-58} width={68} height={68} fill="#e74c3c" stroke={INK} strokeWidth={2} />
          <path d="M 0 -48 L 10 -24 L 0 0 L -10 -24 Z M -24 -24 L 0 -30 L 24 -24 L 0 -18 Z" fill="#fff6e8" />
        </g>
      );
    case 'book':
      return (
        <g transform={`translate(${x},${y}) rotate(-10)`}>
          <rect x={-30} y={-44} width={60} height={46} rx={3} fill="#3a6ea5" stroke={INK} strokeWidth={2} />
          <line x1={0} y1={-44} x2={0} y2={2} stroke={INK} strokeWidth={2} />
        </g>
      );
    case 'notebook':
      return (
        <g transform={`translate(${x},${y}) rotate(-6)`}>
          <rect x={-22} y={-40} width={44} height={50} rx={3} fill="#f5ecd2" stroke={INK} strokeWidth={2} />
          {[0, 1, 2].map((i) => (
            <line key={i} x1={-14} y1={-28 + i * 12} x2={14} y2={-28 + i * 12} stroke="#9a8f78" strokeWidth={2} />
          ))}
        </g>
      );
    case 'cigarette':
      return (
        <g transform={`translate(${x},${y}) rotate(-20)`}>
          <rect x={-3} y={-30} width={7} height={30} fill="#fff" stroke={INK} strokeWidth={1.5} />
          <rect x={-3} y={-30} width={7} height={6} fill="#e67e22" />
        </g>
      );
    case 'bag':
      return (
        <g transform={`translate(${x},${y})`}>
          <rect x={-26} y={-8} width={52} height={40} rx={6} fill="#6d4c41" stroke={INK} strokeWidth={2} />
          <path d="M -14 -8 Q 0 -30 14 -8" fill="none" stroke={INK} strokeWidth={4} />
        </g>
      );
    case 'money':
      return (
        <g transform={`translate(${x},${y}) rotate(-12)`}>
          <rect x={-34} y={-22} width={68} height={36} rx={3} fill="#9ccc65" stroke={INK} strokeWidth={2} />
          <circle cx={0} cy={-4} r={9} fill="none" stroke="#33691e" strokeWidth={3} />
        </g>
      );
  }
  return null;
};

const Eyes: React.FC<{e: Expression; blink: boolean; look: number}> = ({e, blink, look}) => {
  const xs = [-34, 34];
  if (blink || e === 'closed') {
    return <>{xs.map((x) => <path key={x} d={`M ${x - 13} 6 Q ${x} 12 ${x + 13} 6`} stroke={INK} strokeWidth={5} fill="none" strokeLinecap="round" />)}</>;
  }
  if (e === 'smile') {
    return <>{xs.map((x) => <path key={x} d={`M ${x - 13} 10 Q ${x} -6 ${x + 13} 10`} stroke={INK} strokeWidth={5} fill="none" strokeLinecap="round" />)}</>;
  }
  if (e === 'shocked') {
    return (
      <>
        {xs.map((x) => (
          <g key={x}>
            <circle cx={x} cy={4} r={15} fill="#fff" stroke={INK} strokeWidth={3} />
            <circle cx={x} cy={4} r={5} fill={INK} />
          </g>
        ))}
      </>
    );
  }
  return (
    <>
      {xs.map((x) => (
        <g key={x}>
          <ellipse cx={x + look} cy={6} rx={11} ry={15} fill={INK} />
          <circle cx={x + look + 4} cy={0} r={4} fill="#fff" />
          {e === 'cold' && <rect x={x - 16} y={-14} width={32} height={14} fill="var(--skin)" />}
          {e === 'cold' && <line x1={x - 15} y1={0} x2={x + 15} y2={0} stroke={INK} strokeWidth={4} strokeLinecap="round" />}
        </g>
      ))}
    </>
  );
};

const Brows: React.FC<{e: Expression}> = ({e}) => {
  const tilt = e === 'angry' ? 10 : e === 'sad' ? -9 : e === 'shocked' ? 0 : e === 'thinking' ? -4 : 0;
  const y = e === 'shocked' ? -30 : -22;
  if (e === 'normal' || e === 'smile' || e === 'closed' || e === 'dark') return null;
  return (
    <>
      <line x1={-48} y1={y - tilt / 2} x2={-20} y2={y + tilt / 2} stroke={INK} strokeWidth={5} strokeLinecap="round" />
      <line x1={48} y1={y - tilt / 2} x2={20} y2={y + tilt / 2} stroke={INK} strokeWidth={5} strokeLinecap="round" />
    </>
  );
};

const Mouth: React.FC<{e: Expression; talk: number}> = ({e, talk}) => {
  const y = 42;
  if (talk > 0.15) return <ellipse cx={0} cy={y} rx={10} ry={4 + talk * 9} fill="#7a2e2e" stroke={INK} strokeWidth={3} />;
  switch (e) {
    case 'smile':
      return <path d={`M -14 ${y - 3} Q 0 ${y + 12} 14 ${y - 3}`} fill="#7a2e2e" stroke={INK} strokeWidth={3} />;
    case 'cold':
      return <path d={`M -10 ${y + 2} Q 4 ${y + 4} 13 ${y - 4}`} fill="none" stroke={INK} strokeWidth={4} strokeLinecap="round" />;
    case 'shocked':
      return <ellipse cx={0} cy={y + 2} rx={9} ry={12} fill="#7a2e2e" stroke={INK} strokeWidth={3} />;
    case 'sad':
    case 'angry':
      return <path d={`M -12 ${y + 6} Q 0 ${y - 6} 12 ${y + 6}`} fill="none" stroke={INK} strokeWidth={4} strokeLinecap="round" />;
    case 'thinking':
      return <path d={`M -10 ${y} L 10 ${y + 3}`} stroke={INK} strokeWidth={4} strokeLinecap="round" />;
    case 'dark':
      return <path d={`M -10 ${y + 2} L 10 ${y + 2}`} stroke={INK} strokeWidth={4} strokeLinecap="round" />;
    default:
      return <path d={`M -9 ${y} Q 0 ${y + 7} 9 ${y}`} fill="none" stroke={INK} strokeWidth={4} strokeLinecap="round" />;
  }
};

/** 头发：back 画在头后面，front 画在脸前面 */
const Hair: React.FC<{s: CharSpec; layer: 'back' | 'front'; R: number}> = ({s, layer, R}) => {
  const c = s.hairColor;
  const st = {fill: c, stroke: INK, strokeWidth: 3, strokeLinejoin: 'round' as const};
  switch (s.hair) {
    case 'messy':
      return layer === 'back' ? (
        <ellipse cx={0} cy={-14} rx={R + 10} ry={R} {...st} />
      ) : (
        <path
          d={`M ${-R - 8} 0 L ${-R + 4} -50 L ${-R + 30} -${R - 4} L -20 -${R + 18} L 10 -${R + 6} L 40 -${R + 16} L ${R - 10} -60 L ${R + 10} -6 L ${R - 14} -18 L 52 6 L 40 -16 L 22 8 L 6 -18 L -14 10 L -26 -14 L -46 8 L -54 -18 Z`}
          {...st}
        />
      );
    case 'long':
      return layer === 'back' ? (
        <path d={`M ${-R - 6} -10 Q ${-R - 14} 150 ${-R + 6} 200 L ${R - 6} 200 Q ${R + 14} 150 ${R + 6} -10 Q ${R} ${-R - 20} 0 ${-R - 16} Q ${-R} ${-R - 20} ${-R - 6} -10 Z`} {...st} />
      ) : (
        <path d={`M ${-R - 4} 30 L ${-R} -40 Q -30 ${-R - 22} 0 ${-R - 16} Q 30 ${-R - 22} ${R} -40 L ${R + 4} 30 L ${R - 16} 30 L ${R - 18} -22 L ${-R + 18} -22 L ${-R + 16} 30 Z`} {...st} />
      );
    case 'bob':
      return layer === 'back' ? (
        <path d={`M ${-R - 12} 60 Q ${-R - 18} ${-R} 0 ${-R - 14} Q ${R + 18} ${-R} ${R + 12} 60 Z`} {...st} />
      ) : (
        <path d={`M ${-R - 6} 20 Q ${-R} ${-R - 6} 0 ${-R - 12} Q ${R} ${-R - 6} ${R + 6} 20 L ${R - 14} -8 Q 10 -40 -30 -18 L ${-R + 12} 10 Z`} {...st} />
      );
    case 'bun':
      return layer === 'back' ? (
        <g>
          <circle cx={0} cy={-R - 22} r={30} {...st} />
          <ellipse cx={0} cy={-18} rx={R + 6} ry={R - 2} {...st} />
        </g>
      ) : (
        <path d={`M ${-R - 2} 0 Q ${-R + 4} ${-R - 6} 0 ${-R - 8} Q ${R - 4} ${-R - 6} ${R + 2} 0 Q 40 -50 0 -46 Q -40 -50 ${-R - 2} 0 Z`} {...st} />
      );
    case 'side':
      return layer === 'back' ? (
        <ellipse cx={0} cy={-16} rx={R + 6} ry={R - 4} {...st} />
      ) : (
        <path d={`M ${-R - 4} -4 Q ${-R} ${-R - 4} 0 ${-R - 8} Q ${R} ${-R - 4} ${R + 4} -4 L ${R - 10} -40 Q -10 -30 -40 -60 Q ${-R + 10} -40 ${-R - 4} -4 Z`} {...st} />
      );
    case 'bald':
      return layer === 'back' ? null : (
        <g>
          <path d={`M ${-R - 4} 10 Q ${-R - 6} -40 ${-R + 22} -50 L ${-R + 26} -20 Z`} {...st} />
          <path d={`M ${R + 4} 10 Q ${R + 6} -40 ${R - 22} -50 L ${R - 26} -20 Z`} {...st} />
          <ellipse cx={-26} cy={-62} rx={16} ry={7} fill="#fff" opacity={0.6} />
        </g>
      );
    case 'short':
      return layer === 'back' ? (
        <ellipse cx={0} cy={-18} rx={R + 4} ry={R - 6} {...st} />
      ) : (
        <path d={`M ${-R - 2} -6 Q ${-R} ${-R - 2} 0 ${-R - 6} Q ${R} ${-R - 2} ${R + 2} -6 Q 50 -46 0 -40 Q -50 -46 ${-R - 2} -6 Z`} {...st} />
      );
    case 'ponytail':
      return layer === 'back' ? (
        <g>
          <path d={`M ${R - 10} -40 Q ${R + 60} 0 ${R + 30} 110 Q ${R + 10} 40 ${R - 20} 0 Z`} {...st} />
          <ellipse cx={0} cy={-16} rx={R + 6} ry={R - 2} {...st} />
        </g>
      ) : (
        <path d={`M ${-R - 4} 0 Q ${-R} ${-R - 6} 0 ${-R - 8} Q ${R} ${-R - 6} ${R + 4} 0 L ${R - 14} -30 Q 0 -44 ${-R + 14} -30 Z`} {...st} />
      );
  }
};

const Hat: React.FC<{s: CharSpec; R: number}> = ({s, R}) => {
  if (!s.hat) return null;
  const c = s.hatColor ?? '#5d4037';
  if (s.hat === 'fedora')
    return (
      <g>
        <ellipse cx={0} cy={-R + 18} rx={R + 34} ry={16} fill={c} stroke={INK} strokeWidth={3} />
        <path d={`M ${-R + 14} ${-R + 18} Q ${-R + 10} ${-R - 50} 0 ${-R - 46} Q ${R - 10} ${-R - 50} ${R - 14} ${-R + 18} Z`} fill={c} stroke={INK} strokeWidth={3} />
        <rect x={-R + 14} y={-R + 2} width={(R - 14) * 2} height={12} fill="#2b1d16" />
      </g>
    );
  if (s.hat === 'cap')
    return (
      <g>
        <path d={`M ${-R + 4} ${-R + 30} Q 0 ${-R - 40} ${R - 4} ${-R + 30} Z`} fill={c} stroke={INK} strokeWidth={3} />
        <path d={`M ${R - 30} ${-R + 26} Q ${R + 40} ${-R + 22} ${R + 44} ${-R + 40} L ${R - 20} ${-R + 40} Z`} fill={c} stroke={INK} strokeWidth={3} />
      </g>
    );
  return (
    <g>
      <path d={`M ${-R} ${-R + 28} Q 10 ${-R - 70} ${R + 50} ${-R - 10} L ${R} ${-R + 28} Z`} fill="#d32f2f" stroke={INK} strokeWidth={3} />
      <rect x={-R - 6} y={-R + 18} width={(R + 6) * 2} height={24} rx={12} fill="#fff" stroke={INK} strokeWidth={3} />
      <circle cx={R + 50} cy={-R - 10} r={14} fill="#fff" stroke={INK} strokeWidth={3} />
    </g>
  );
};

const EmoteShape: React.FC<{e: Emote; t: number}> = ({e, t}) => {
  if (!e) return null;
  const bob = Math.sin(t / 5) * 4;
  const box = (child: React.ReactNode) => <g transform={`translate(70, ${-470 + bob})`}>{child}</g>;
  switch (e) {
    case '!':
      return box(<text x={0} y={0} fontSize={84} fontWeight={900} fontFamily={SANS} fill="#e53935" stroke="#fff" strokeWidth={6} paintOrder="stroke">!</text>);
    case '?':
      return box(<text x={0} y={0} fontSize={84} fontWeight={900} fontFamily={SANS} fill="#1e88e5" stroke="#fff" strokeWidth={6} paintOrder="stroke">?</text>);
    case '...':
      return box(<text x={-20} y={0} fontSize={60} fontWeight={900} fontFamily={SANS} fill={INK} stroke="#fff" strokeWidth={6} paintOrder="stroke">…</text>);
    case 'sweat':
      return <path transform={`translate(78, ${-380 + (t % 30)})`} d="M 0 -18 Q 12 0 0 10 Q -12 0 0 -18 Z" fill="#7ec8f2" stroke="#fff" strokeWidth={4} />;
    case 'anger':
      return box(
        <g stroke="#e53935" strokeWidth={8} strokeLinecap="round" fill="none">
          <path d="M -18 -30 Q -6 -18 -18 -6" />
          <path d="M 18 -30 Q 6 -18 18 -6" />
          <path d="M -30 -18 Q -18 -6 -6 -18" />
          <path d="M 30 -18 Q 18 -6 6 -18" />
        </g>,
      );
    case 'tears':
      return (
        <g fill="#7ec8f2" stroke="#fff" strokeWidth={3}>
          <path transform={`translate(-34, ${-280 + (t % 20) * 2})`} d="M 0 -10 Q 8 2 0 8 Q -8 2 0 -10 Z" />
          <path transform={`translate(34, ${-280 + ((t + 10) % 20) * 2})`} d="M 0 -10 Q 8 2 0 8 Q -8 2 0 -10 Z" />
        </g>
      );
    case 'heart':
      return box(<path d="M 0 0 C -30 -24 -24 -50 0 -36 C 24 -50 30 -24 0 0 Z" fill="#e91e63" stroke="#fff" strokeWidth={5} />);
    case 'dark':
      return (
        <g opacity={0.55}>
          {[0, 1, 2, 3, 4].map((i) => (
            <circle key={i} cx={-80 + i * 40 + Math.sin(t / 8 + i) * 6} cy={-430 + Math.cos(t / 7 + i) * 6} r={24} fill="#3b2f4a" />
          ))}
        </g>
      );
    case 'sparkle':
      return box(<path d="M 0 -36 L 8 -8 L 36 0 L 8 8 L 0 36 L -8 8 L -36 0 L -8 -8 Z" fill="#ffd54f" stroke="#fff" strokeWidth={4} />);
  }
  return null;
};

export type ChibiState = {
  expr?: Expression;
  pose?: Pose;
  emote?: Emote;
  facing?: 1 | -1;
  walking?: boolean;
  talk?: boolean;
  lying?: boolean; // 倒地
  prop?: Prop;
};

/** 渲染一个小人；size = 头顶到脚底的大致像素高度 */
export const Chibi: React.FC<{spec: CharSpec; state?: ChibiState; size?: number; seed?: number; showName?: boolean}> = ({
  spec,
  state = {},
  size = 460,
  seed = 0,
  showName = true,
}) => {
  const frame = useCurrentFrame() + seed * 37;
  const kid = spec.age === 'kid';
  const R = kid ? 86 : 90;
  const headY = kid ? -270 : -320;
  const torsoTop = kid ? -190 : -235;
  const hip = kid ? -62 : -78;
  const skin = spec.skin ?? '#ffe0c8';
  const pose = state.pose ?? 'idle';
  const expr = state.expr ?? 'normal';
  const walking = !!state.walking;
  const bob = walking ? Math.abs(Math.sin(frame / 4)) * -10 : Math.sin(frame / 18) * 3;
  const legSwing = walking ? Math.sin(frame / 4) * 22 : 0;
  const blink = frame % 97 < 4 && expr !== 'closed';
  const talk = state.talk ? Math.abs(Math.sin(frame / 2.6)) : 0;
  const look = expr === 'thinking' ? 6 : 0;
  const p = POSES[pose];
  const wave = pose === 'wave' ? Math.sin(frame / 3) * 15 : 0;
  const shoulderY = torsoTop + 22;
  const sleeve = spec.coat ?? spec.outfit;
  const right = arm(48, shoulderY, p.r[0] + wave, p.r[1], kid ? 90 : 104, 1, sleeve, skin);
  const left = arm(-48, shoulderY, p.l[0], p.l[1], kid ? 90 : 104, -1, sleeve, skin);
  const prop = state.prop !== undefined ? state.prop : spec.prop ?? null;
  const scale = size / 460;
  const hipW = spec.dress ? 78 : 58;

  const body = (
    <g transform={`translate(0, ${bob})`}>
      {/* 后发（长发在身体后面） */}
      <g transform={`translate(0, ${headY})`}>
        <Hair s={spec} layer="back" R={R} />
      </g>
      {/* 腿 */}
      {!spec.dress || kid ? (
        <>
          <g transform={`rotate(${legSwing}, -20, ${hip})`}>
            {capsule(-20, hip, -20, -14, 30, spec.outfit2 ?? '#3d4458')}
            <ellipse cx={-22} cy={-8} rx={22} ry={12} fill="#2b2b2b" />
          </g>
          <g transform={`rotate(${-legSwing}, 20, ${hip})`}>
            {capsule(20, hip, 20, -14, 30, spec.outfit2 ?? '#3d4458')}
            <ellipse cx={22} cy={-8} rx={22} ry={12} fill="#2b2b2b" />
          </g>
        </>
      ) : (
        <>
          {capsule(-18, hip + 20, -18, -14, 24, skin)}
          {capsule(18, hip + 20, 18, -14, 24, skin)}
          <ellipse cx={-20} cy={-8} rx={18} ry={10} fill="#2b2b2b" />
          <ellipse cx={20} cy={-8} rx={18} ry={10} fill="#2b2b2b" />
        </>
      )}
      {/* 躯干 */}
      <path
        d={`M -46 ${torsoTop} Q 0 ${torsoTop - 14} 46 ${torsoTop} L ${hipW} ${spec.dress ? hip + 40 : hip + 6} Q 0 ${spec.dress ? hip + 56 : hip + 16} ${-hipW} ${spec.dress ? hip + 40 : hip + 6} Z`}
        fill={spec.coat ?? spec.outfit}
        stroke={INK}
        strokeWidth={3}
        strokeLinejoin="round"
      />
      {spec.coat && <path d={`M -14 ${torsoTop - 6} L 0 ${torsoTop + 40} L 14 ${torsoTop - 6} Z`} fill={spec.outfit} stroke={INK} strokeWidth={2} />}
      {spec.coat && <line x1={0} y1={torsoTop + 40} x2={0} y2={hip + 6} stroke={INK} strokeWidth={3} />}
      {spec.tie && <path d={`M 0 ${torsoTop} L 8 ${torsoTop + 16} L 0 ${torsoTop + 56} L -8 ${torsoTop + 16} Z`} fill={spec.tie} stroke={INK} strokeWidth={2} />}
      {spec.apron && <path d={`M -32 ${torsoTop + 30} L 32 ${torsoTop + 30} L 40 ${hip + 8} L -40 ${hip + 8} Z`} fill={spec.apron} stroke={INK} strokeWidth={2} />}
      {spec.necklace && [...Array(7)].map((_, i) => <circle key={i} cx={-24 + i * 8} cy={torsoTop + 6 + Math.sin((i / 6) * Math.PI) * 12} r={4} fill="#fff" stroke="#bbb" />)}
      {/* 手臂 + 道具 */}
      {left.el}
      {right.el}
      {prop && <PropShape p={prop} x={right.hand[0]} y={right.hand[1]} />}
      {/* 头 */}
      <g transform={`translate(0, ${headY}) rotate(${walking ? Math.sin(frame / 4) * 3 : Math.sin(frame / 30) * 2})`} style={{['--skin' as string]: skin}}>
        <ellipse cx={0} cy={0} rx={R} ry={R - 6} fill={skin} stroke={INK} strokeWidth={3} />
        {(spec.blush ?? true) && expr !== 'dark' && (
          <>
            <ellipse cx={-52} cy={28} rx={14} ry={7} fill="#ff8a80" opacity={0.45} />
            <ellipse cx={52} cy={28} rx={14} ry={7} fill="#ff8a80" opacity={0.45} />
          </>
        )}
        <Eyes e={expr} blink={blink} look={look} />
        <Brows e={expr} />
        {spec.glasses && (
          <g fill="none" stroke={INK} strokeWidth={4}>
            <circle cx={-34} cy={6} r={22} />
            <circle cx={34} cy={6} r={22} />
            <line x1={-12} y1={6} x2={12} y2={6} />
          </g>
        )}
        {spec.mustache && <path d="M -26 30 Q -12 20 0 28 Q 12 20 26 30 Q 12 36 0 32 Q -12 36 -26 30 Z" fill={spec.hairColor} stroke={INK} strokeWidth={2} />}
        <Mouth e={expr} talk={talk} />
        <Hair s={spec} layer="front" R={R} />
        {expr === 'dark' && <rect x={-R} y={-30} width={R * 2} height={50} fill="#1a1426" opacity={0.55} />}
        {expr === 'dark' && (
          <>
            <circle cx={-34} cy={4} r={4} fill="#fff" />
            <circle cx={34} cy={4} r={4} fill="#fff" />
          </>
        )}
        <Hat s={spec} R={R} />
      </g>
      {pose === 'shock' && <g stroke={INK} strokeWidth={5} strokeLinecap="round">{[-1, 1].map((d) => <line key={d} x1={d * 120} y1={headY - 60} x2={d * 150} y2={headY - 90} />)}</g>}
      <EmoteShape e={state.emote ?? null} t={frame} />
    </g>
  );

  return (
    <div style={{position: 'relative', width: 360 * scale, height: 560 * scale}}>
      <svg width={360 * scale} height={560 * scale} viewBox="-180 -520 360 560" style={{overflow: 'visible'}}>
        <defs>
          <filter id="sticker" x="-30%" y="-30%" width="160%" height="160%">
            <feMorphology in="SourceAlpha" operator="dilate" radius={9} result="dil" />
            <feGaussianBlur in="dil" stdDeviation={7} result="blur" />
            <feOffset in="blur" dx={0} dy={10} result="off" />
            <feFlood floodColor="#000" floodOpacity={0.35} />
            <feComposite in2="off" operator="in" result="shadow" />
            <feFlood floodColor="#ffffff" />
            <feComposite in2="dil" operator="in" result="outline" />
            <feMerge>
              <feMergeNode in="shadow" />
              <feMergeNode in="outline" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>
        <g filter="url(#sticker)" transform={`scale(${state.facing ?? 1}, 1) ${state.lying ? 'translate(0,-10) rotate(-88)' : ''}`}>
          {body}
        </g>
      </svg>
      {showName && (
        <div
          style={{
            position: 'absolute',
            left: '50%',
            bottom: -10 * scale,
            transform: 'translateX(-50%)',
            fontFamily: SANS,
            fontWeight: 900,
            fontSize: 34 * Math.max(scale, 0.8),
            color: '#fff',
            background: '#1b1b26cc',
            padding: '2px 16px',
            borderRadius: 10,
            whiteSpace: 'nowrap',
          }}
        >
          {spec.name}
        </div>
      )}
    </div>
  );
};
