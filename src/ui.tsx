import React from 'react';
import {AbsoluteFill, Html5Audio, Img, Sequence, interpolate, random, spring, staticFile, useCurrentFrame, useVideoConfig} from 'remotion';
import {C, DISPLAY, FPS, LAYOUT, SANS, SceneData, Sticker, THEME, beatPulse, cueFrame, energyAt, prog} from './lib';

/** 在第 at 帧播放 public/sfx/<name>.wav */
export const Sfx: React.FC<{at: number; name: string; volume?: number}> = ({at, name, volume = 1}) => (
  <Sequence from={Math.max(0, Math.round(at))} layout="none">
    <Html5Audio src={staticFile(`sfx/${name}.wav`)} volume={volume} />
  </Sequence>
);

/** 全片常驻背景，按主题切换风格 */
export const Background: React.FC = () =>
  THEME.style === 'hextech' ? <HextechBackground /> : THEME.style === 'plain' ? <AbsoluteFill style={{background: '#05070d'}} /> : <InkBackground mark={THEME.mark ?? '秦'} />;

/** 火星/光点粒子：鼓点越强飘得越快，两层视差 */
const Particles: React.FC<{count: number; color: string; glow: string}> = ({count, color, glow}) => {
  const frame = useCurrentFrame();
  const {width, height} = useVideoConfig();
  const pulse = beatPulse(frame);
  const energy = energyAt(frame);
  return (
    <>
      {Array.from({length: count}).map((_, i) => {
        const layer = i % 3 === 0 ? 1.8 : 1;
        const speed = (0.8 + random(`s${i}`) * 1.8) * layer;
        const travel = frame * speed * (1 + energy * 1.2);
        const y = (random(`y${i}`) * height - travel + height * 20) % height;
        const x = random(`x${i}`) * width + Math.sin(frame / 40 + i) * 26;
        const size = (2 + random(`r${i}`) * 5) * layer;
        const flicker = 0.35 + 0.65 * Math.abs(Math.sin(frame / (12 + (i % 7)) + i));
        return (
          <div
            key={i}
            style={{
              position: 'absolute',
              left: x,
              top: y,
              width: size,
              height: size,
              borderRadius: '50%',
              background: color,
              boxShadow: `0 0 ${size * 3}px ${glow}`,
              opacity: Math.min(1, flicker * (0.45 + pulse * 0.6)),
              filter: layer > 1 ? 'blur(1.5px)' : undefined,
            }}
          />
        );
      })}
    </>
  );
};

const Grain: React.FC = () => {
  const frame = useCurrentFrame();
  const {width, height} = useVideoConfig();
  return (
    <svg width={width} height={height} style={{position: 'absolute', opacity: 0.5}}>
      <filter id="grain">
        <feTurbulence type="fractalNoise" baseFrequency="0.85" numOctaves="2" seed={frame % 6} stitchTiles="stitch" />
        <feColorMatrix values="0 0 0 0 0.9  0 0 0 0 0.8  0 0 0 0 0.6  0 0 0 0.12 0" />
      </filter>
      <rect width="100%" height="100%" filter="url(#grain)" />
    </svg>
  );
};

/** 历史题材：暗色宣纸 + 流动烟雾 + 火星 + 巨大水印字 */
const InkBackground: React.FC<{mark: string}> = ({mark}) => {
  const frame = useCurrentFrame();
  const pulse = beatPulse(frame);
  return (
    <AbsoluteFill style={{background: `radial-gradient(ellipse at 50% 38%, #2b1f16 0%, ${C.bg} 55%, #070504 100%)`}}>
      {[0, 1, 2, 3].map((i) => {
        const x = 540 + Math.sin(frame / (140 + i * 37) + i * 2) * 420;
        const y = 300 + i * 420 + Math.cos(frame / (170 + i * 23) + i) * 160;
        const sz = 700 + i * 120;
        return (
          <div
            key={i}
            style={{
              position: 'absolute',
              left: x - sz / 2,
              top: y - sz / 2,
              width: sz,
              height: sz,
              borderRadius: '50%',
              background: i % 2 ? '#5a2a14' : '#3a2a1a',
              filter: 'blur(120px)',
              opacity: 0.16 + pulse * 0.22,
            }}
          />
        );
      })}
      <AbsoluteFill style={{alignItems: 'center', justifyContent: 'center'}}>
        <div
          style={{
            fontFamily: DISPLAY,
            fontWeight: 900,
            fontSize: 980,
            color: C.gold,
            opacity: 0.035 + pulse * 0.03,
            transform: `translateY(${-120 + Math.sin(frame / 90) * 12}px) scale(${1 + frame / 30000 + pulse * 0.015})`,
          }}
        >
          {mark}
        </div>
      </AbsoluteFill>
      <Particles count={70} color={C.accent} glow="#e07a2a" />
      <Grain />
      <AbsoluteFill style={{boxShadow: `inset 0 0 ${260 - pulse * 80}px ${60 - pulse * 20}px #000`}} />
    </AbsoluteFill>
  );
};

/** 游戏题材：深蓝底 + 漂移的六边形网格 + 扫描光 + 青色光点 */
const HextechBackground: React.FC = () => {
  const frame = useCurrentFrame();
  const {width, height} = useVideoConfig();
  const pulse = beatPulse(frame);
  const R = 54; // 六边形外接圆半径
  const w = Math.sqrt(3) * R;
  const h = 1.5 * R;
  const pts = (cx: number, cy: number) =>
    Array.from({length: 6}, (_, k) => {
      const a = (Math.PI / 3) * k + Math.PI / 6;
      return `${cx + R * Math.cos(a)},${cy + R * Math.sin(a)}`;
    }).join(' ');
  const drift = (frame * 0.6) % (h * 2);
  const sweepY = ((frame * 9) % (height + 600)) - 300;
  return (
    <AbsoluteFill style={{background: `radial-gradient(ellipse at 50% 35%, #0e2a3f 0%, ${C.bg} 60%, #01060c 100%)`}}>
      <svg width={width} height={height} style={{position: 'absolute', opacity: 0.55 + pulse * 0.35}}>
        <defs>
          <linearGradient id="hexfade" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor={C.accent} stopOpacity="0.05" />
            <stop offset="0.45" stopColor={C.accent} stopOpacity="0.22" />
            <stop offset="1" stopColor={C.accent} stopOpacity="0.03" />
          </linearGradient>
        </defs>
        <g transform={`translate(0, ${-drift})`}>
          {Array.from({length: Math.ceil(height / h) + 4}).map((_, row) =>
            Array.from({length: Math.ceil(width / w) + 2}).map((__, col) => {
              const cx = col * w + (row % 2 ? w / 2 : 0);
              const cy = row * h;
              const lit = random(`hx${row}-${col}`) < 0.06 ? 0.25 + 0.25 * Math.sin(frame / 15 + row + col) : 0;
              return (
                <polygon key={`${row}-${col}`} points={pts(cx, cy)} fill={lit > 0 ? C.accent : 'none'} fillOpacity={lit * 0.35} stroke="url(#hexfade)" strokeWidth={1.5} />
              );
            }),
          )}
        </g>
      </svg>
      <div style={{position: 'absolute', left: 0, right: 0, top: sweepY, height: 300, background: `linear-gradient(180deg, transparent, ${C.accent}18, transparent)`}} />
      <AbsoluteFill style={{alignItems: 'center', justifyContent: 'center'}}>
        <div style={{fontFamily: SANS, fontWeight: 900, fontSize: 520, color: C.gold, opacity: 0.04 + pulse * 0.03, transform: `translateY(-120px) scale(${1 + pulse * 0.015})`}}>
          {THEME.mark ?? ''}
        </div>
      </AbsoluteFill>
      <Particles count={50} color={C.accent} glow={C.accent} />
      <AbsoluteFill style={{boxShadow: `inset 0 0 ${240 - pulse * 80}px ${50 - pulse * 20}px #000`}} />
    </AbsoluteFill>
  );
};

/** 红色方印 */
export const Seal: React.FC<{text: string; size?: number; style?: React.CSSProperties}> = ({text, size = 96, style}) => (
  <div
    style={{
      width: size,
      height: size,
      background: C.red,
      color: '#f7e9d8',
      fontFamily: DISPLAY,
      fontWeight: 900,
      fontSize: text.length > 1 ? size * 0.4 : size * 0.66,
      lineHeight: 1.05,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      writingMode: text.length > 1 ? 'vertical-rl' : undefined,
      borderRadius: size * 0.08,
      boxShadow: `inset 0 0 0 ${size * 0.05}px #f7e9d855, 0 6px 20px #0008`,
      ...style,
    }}
  >
    {text}
  </div>
);

/** 金属扫光文字 */
export const Shine: React.FC<{children: React.ReactNode; at?: number; every?: number; color?: string; style?: React.CSSProperties}> = ({
  children,
  at = 0,
  every = 90,
  color = C.gold,
  style,
}) => {
  const frame = useCurrentFrame();
  const k = frame - at;
  const pos = k < 0 ? -100 : ((k % every) / 28) * 200 - 50;
  return (
    <span
      style={{
        backgroundImage: `linear-gradient(105deg, ${color} 0%, ${color} ${pos - 12}%, #fff8e0 ${pos}%, ${color} ${pos + 12}%, ${color} 100%)`,
        WebkitBackgroundClip: 'text',
        backgroundClip: 'text',
        color: 'transparent',
        ...style,
      }}
    >
      {children}
    </span>
  );
};

/** 顶部常驻栏目头 */
export const Header: React.FC<{title: string}> = ({title}) => {
  const frame = useCurrentFrame();
  const p = prog(frame, 0, 20);
  return (
    <div
      style={{
        position: 'absolute',
        top: 190,
        left: 0,
        right: 0,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 24,
        opacity: p,
        transform: `translateY(${(1 - p) * -30}px)`,
      }}
    >
      <Seal text={THEME.seal ?? '史'} size={84} style={{transform: `scale(${1 + beatPulse(frame) * 0.08})`}} />
      <div style={{fontFamily: DISPLAY, fontWeight: 700, fontSize: 56, letterSpacing: 6}}>
        <Shine every={150}>{title}</Shine>
      </div>
    </div>
  );
};

/** 每个场景顶部的红底小标签，如「原因一 · 民力耗尽」 */
export const Label: React.FC<{text: string; start?: number}> = ({text, start = 0}) => {
  const frame = useCurrentFrame();
  const p = prog(frame, start + 4, 14);
  return (
    <div style={{display: 'flex', justifyContent: 'center', marginBottom: 56}}>
      <Sfx at={start + 4} name="stamp" volume={0.5} />
      <div
        style={{
          fontFamily: DISPLAY,
          fontWeight: 900,
          fontSize: 54,
          color: '#f7e9d8',
          background: `linear-gradient(90deg, transparent, ${C.red} 12%, ${C.red} 88%, transparent)`,
          padding: '14px 90px',
          letterSpacing: 6 + (1 - p) * 30,
          clipPath: `inset(0 ${(1 - p) * 50}% 0 ${(1 - p) * 50}%)`,
          transform: `scale(${1.3 - 0.3 * p})`,
        }}
      >
        {text}
      </div>
    </div>
  );
};

/** 全屏闪光 */
export const Flash: React.FC<{at: number; color?: string; strength?: number; dur?: number}> = ({at, color = '#fff6df', strength = 0.7, dur = 10}) => {
  const frame = useCurrentFrame();
  const k = frame - at;
  if (k < 0 || k > dur) return null;
  return <AbsoluteFill style={{background: color, opacity: strength * Math.pow(1 - k / dur, 2), mixBlendMode: 'screen'}} />;
};

/** 冲击波圆环 */
export const Ring: React.FC<{at: number; x: number; y: number; color?: string; size?: number}> = ({at, x, y, color = C.gold, size = 900}) => {
  const frame = useCurrentFrame();
  const k = frame - at;
  if (k < 0 || k > 24) return null;
  const p = prog(frame, at, 24);
  const r = 40 + p * size;
  return (
    <div
      style={{
        position: 'absolute',
        left: x - r / 2,
        top: y - r / 2,
        width: r,
        height: r,
        borderRadius: '50%',
        border: `${14 * (1 - p) + 2}px solid ${color}`,
        opacity: 1 - p,
        boxShadow: `0 0 40px ${color}`,
        pointerEvents: 'none',
      }}
    />
  );
};

/** 粒子迸发 */
export const Burst: React.FC<{at: number; x: number; y: number; color?: string; count?: number; spread?: number}> = ({
  at,
  x,
  y,
  color = '#ffb34d',
  count = 36,
  spread = 520,
}) => {
  const frame = useCurrentFrame();
  const k = frame - at;
  if (k < 0 || k > 40) return null;
  return (
    <>
      {Array.from({length: count}).map((_, i) => {
        const ang = random(`a${at}${i}`) * Math.PI * 2;
        const dist = (0.3 + random(`d${at}${i}`) * 0.7) * spread * (1 - Math.exp(-k / 7));
        const s = 4 + random(`s${at}${i}`) * 9;
        return (
          <div
            key={i}
            style={{
              position: 'absolute',
              left: x + Math.cos(ang) * dist,
              top: y + Math.sin(ang) * dist + k * k * 0.12,
              width: s,
              height: s,
              borderRadius: '50%',
              background: color,
              boxShadow: `0 0 ${s * 2}px ${color}`,
              opacity: 1 - k / 40,
            }}
          />
        );
      })}
    </>
  );
};

/** 可选的 AI 配图：缓慢推镜 + 压暗，保证上面的文字可读 */
export const SceneImage: React.FC<{src: string; duration: number}> = ({src, duration}) => {
  const frame = useCurrentFrame();
  const scale = interpolate(frame, [0, duration], [1.02, 1.14]);
  return (
    <AbsoluteFill>
      <Img src={staticFile(src)} style={{width: '100%', height: '100%', objectFit: 'cover', transform: `scale(${scale})`}} />
      <AbsoluteFill style={{background: 'linear-gradient(180deg, #000c 0%, #0008 30%, #0009 60%, #000e 100%)'}} />
    </AbsoluteFill>
  );
};

const escapeRe = (x: string) => x.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const KEYWORDS = (THEME.keywords ?? []).map(escapeRe);
const HIGHLIGHT = new RegExp(`(前?\\d+年|[\\d一二三四五六七八九十两百千万]+[万年世冠届个]${KEYWORDS.map((k) => '|' + k).join('')})`, 'g');

/** 抖音风字幕：整句出现（轻微淡入上移），关键词金色 */
export const Subtitles: React.FC<{scene: SceneData}> = ({scene}) => {
  const frame = useCurrentFrame();
  const t = frame / FPS;
  const cur = scene.subtitles.find((s) => t >= s.start - 0.05 && t < s.end);
  if (!cur) return null;
  const k = frame - Math.round((cur.start - 0.05) * FPS);
  const p = prog(frame, frame - k, 4);
  const parts = cur.text.split(HIGHLIGHT);
  return (
    <div
      style={{
        position: 'absolute',
        top: LAYOUT.subtitleTop + 20,
        left: 80,
        right: 80,
        textAlign: 'center',
        fontFamily: SANS,
        fontWeight: 900,
        fontSize: cur.text.length > 10 ? 56 : 62,
        lineHeight: 1.45,
        letterSpacing: 3,
        color: '#fff',
        WebkitTextStroke: '7px #000',
        paintOrder: 'stroke fill',
        textShadow: '0 4px 12px #000c',
        opacity: p,
        transform: `translateY(${(1 - p) * 10}px)`,
      }}
    >
      {parts.map((part, i) =>
        i % 2 === 1 ? (
          <span key={i} style={{color: C.highlight}}>
            {part}
          </span>
        ) : (
          <React.Fragment key={i}>{part}</React.Fragment>
        ),
      )}
    </div>
  );
};

/** 抽象梗贴纸：念到 cue 时歪着弹出来，漫画描边 + 轻微晃动 */
export const Stickers: React.FC<{scene: SceneData & {stickers?: Sticker[]}}> = ({scene}) => {
  const frame = useCurrentFrame();
  return (
    <>
      {(scene.stickers ?? []).map((st, i) => {
        const at = cueFrame(scene, st.cue, 1 + i);
        const k = frame - at;
        const pop = spring({frame: k, fps: FPS, config: {damping: 9, stiffness: 240, mass: 0.6}});
        const rot = st.rot ?? (i % 2 ? 6 : -7);
        // 估算贴纸宽度，靠右时不超出右侧安全区（右 90px）
        const em = Array.from(st.text).reduce((w, ch) => w + (/[\u0000-\u00ff]/.test(ch) ? 0.6 : 1), 0);
        const width = em * 46 + 62;
        const left = Math.max(40, Math.min(st.x ?? (i % 2 ? 560 : 90), 1080 - 90 - width));
        return (
          <React.Fragment key={i}>
            <Sfx at={at} name="pop" volume={0.7} />
            <div
              style={{
                position: 'absolute',
                left,
                top: st.y ?? 1150,
                padding: '10px 26px',
                fontFamily: SANS,
                fontWeight: 900,
                fontSize: 46,
                color: '#111',
                background: st.color ?? '#ffe14d',
                border: '5px solid #111',
                borderRadius: 14,
                boxShadow: '8px 8px 0 #111',
                whiteSpace: 'nowrap',
                opacity: k < 0 ? 0 : 1,
                transform: `rotate(${rot + Math.sin(frame / 7 + i) * 1.5}deg) scale(${pop})`,
              }}
            >
              {st.text}
            </div>
          </React.Fragment>
        );
      })}
    </>
  );
};

/** 内容区容器 */
export const Content: React.FC<{children: React.ReactNode; style?: React.CSSProperties}> = ({children, style}) => (
  <div
    style={{
      position: 'absolute',
      top: LAYOUT.contentTop,
      height: LAYOUT.contentHeight,
      left: 60,
      right: 60,
      display: 'flex',
      flexDirection: 'column',
      ...style,
    }}
  >
    {children}
  </div>
);
