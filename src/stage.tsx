import React from 'react';
import {AbsoluteFill, interpolate, random, spring, useCurrentFrame} from 'remotion';
import {CharSpec, Chibi, ChibiState, Emote, Expression, Pose, Prop} from './chibi';
import {C, DISPLAY, FPS, SANS, SceneData, THEME, cueFrame, prog, shake} from './lib';
import {Flash, Sfx} from './ui';

/**
 * 舞台模板：一格「漫画分镜」，里面有背景 + 若干小人，
 * 小人的入场、走位、表情、动作、符号都按旁白 cue 触发。
 *
 * data: {
 *   bg: 背景名, caption: "1973 · 大阪 · 废楼",
 *   actors: [{who, x, enter?: cue|null, exit?: cue, from?: 'left'|'right'|'pop', size?, facing?,
 *             steps: [{cue, expr?, pose?, emote?, walk?: x, face?: 1|-1, prop?, talk?: 秒, lie?: true, shake?: true}]}],
 *   props: [{kind, x, y, cue, size?}]   // 场景里的大号道具（如打火机、剪刀）
 *   dark?: 0~1                            // 压暗（用于暗示类镜头）
 *   zoom?: {cue, to, x, y}                // 镜头推近
 * }
 */

const GROUND = 1240; // 脚底所在的 y
const PANEL = {x: 30, y: 340, w: 1020, h: 980};

type Step = {cue?: string; at?: number; expr?: Expression; pose?: Pose; emote?: Emote; walk?: number; face?: 1 | -1; prop?: Prop; talk?: number; lie?: boolean; shake?: boolean; sfx?: string};
type Actor = {who: string; x: number; enter?: string | null; exit?: string; from?: 'left' | 'right' | 'pop'; size?: number; facing?: 1 | -1; steps?: Step[]; expr?: Expression; pose?: Pose; prop?: Prop};

const WALK_FRAMES = 30;

const useActorState = (scene: SceneData, a: Actor, frame: number) => {
  const enterAt = a.enter === null || a.enter === undefined ? -999 : cueFrame(scene, a.enter, 0);
  const exitAt = a.exit ? cueFrame(scene, a.exit, 999) : 1e9;
  let x = a.x;
  let facing: 1 | -1 = a.facing ?? 1;
  let walking = false;
  const st: ChibiState = {expr: a.expr ?? 'normal', pose: a.pose ?? 'idle', prop: a.prop};
  let shakeAt = -999;
  const steps = (a.steps ?? []).map((s) => ({...s, at: s.at ?? cueFrame(scene, s.cue, 0)})).sort((p, q) => p.at - q.at);
  for (const s of steps) {
    if (frame < s.at) break;
    if (s.expr) st.expr = s.expr;
    if (s.pose) st.pose = s.pose;
    if (s.prop !== undefined) st.prop = s.prop;
    if (s.face) facing = s.face;
    if (s.lie !== undefined) st.lying = s.lie;
    if (s.shake) shakeAt = s.at;
    if (s.emote !== undefined) st.emote = frame - s.at < 50 ? s.emote : null;
    if (s.talk) st.talk = frame - s.at < s.talk * FPS;
    if (s.walk !== undefined) {
      const p = interpolate(frame, [s.at, s.at + WALK_FRAMES], [0, 1], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'});
      const from = x;
      x = from + (s.walk - from) * p;
      if (p < 1) {
        walking = true;
        facing = s.walk >= from ? 1 : -1;
      }
    }
  }
  // 入场：从左右走进来或弹出
  let opacity = 1;
  let scale = 1;
  if (frame < enterAt) opacity = 0;
  else if (enterAt > 0) {
    const k = frame - enterAt;
    if (a.from === 'left' || a.from === 'right') {
      const p = Math.min(1, k / WALK_FRAMES);
      const start = a.from === 'left' ? -200 : 1280;
      if (p < 1) {
        x = start + (x - start) * p;
        walking = true;
        facing = a.from === 'left' ? 1 : -1;
      }
    } else {
      scale = spring({frame: k, fps: FPS, config: {damping: 10, stiffness: 200}});
    }
  }
  if (frame >= exitAt) opacity = Math.max(0, 1 - (frame - exitAt) / 10);
  return {x, facing, walking, st, opacity, scale, shakeAt};
};

const ActorView: React.FC<{scene: SceneData; a: Actor; spec: CharSpec; seed: number}> = ({scene, a, spec, seed}) => {
  const frame = useCurrentFrame();
  const s = useActorState(scene, a, frame);
  const size = a.size ?? (spec.age === 'kid' ? 380 : 440);
  const w = 360 * (size / 460);
  const h = 560 * (size / 460);
  return (
    <div
      style={{
        position: 'absolute',
        left: s.x - w / 2,
        top: GROUND - h + 40 * (size / 460),
        opacity: s.opacity,
        transform: `${shake(frame, [s.shakeAt], 14)} scale(${s.scale})`,
        transformOrigin: '50% 100%',
      }}
    >
      <Chibi spec={spec} state={{...s.st, facing: s.facing, walking: s.walking}} size={size} seed={seed} />
    </div>
  );
};

/** 场景里的大号道具（特写用） */
const BigProp: React.FC<{scene: SceneData; p: {kind: string; x: number; y: number; cue?: string; size?: number; label?: string}}> = ({scene, p}) => {
  const frame = useCurrentFrame();
  const at = cueFrame(scene, p.cue, 0);
  if (frame < at) return null;
  const pop = spring({frame: frame - at, fps: FPS, config: {damping: 9, stiffness: 180}});
  const sz = p.size ?? 1;
  const icon: Record<string, React.ReactNode> = {
    lighter: (
      <g>
        <rect x={-40} y={-90} width={80} height={120} rx={12} fill="#d4af37" stroke="#2a2230" strokeWidth={5} />
        <rect x={-40} y={-90} width={80} height={30} fill="#b8962e" stroke="#2a2230" strokeWidth={5} />
        <text x={0} y={0} textAnchor="middle" fontSize={22} fontFamily={SANS} fontWeight={900} fill="#5a4410">dunhill</text>
      </g>
    ),
    belt: (
      <g>
        <rect x={-150} y={-22} width={300} height={44} rx={10} fill="#5d4037" stroke="#2a2230" strokeWidth={5} />
        <rect x={-170} y={-34} width={50} height={68} rx={6} fill="none" stroke="#c9a227" strokeWidth={10} />
        {[0, 1, 2, 3, 4].map((i) => (
          <circle key={i} cx={-60 + i * 40} cy={0} r={7} fill="#2a2230" />
        ))}
        <circle cx={-20} cy={0} r={16} fill="none" stroke="#e53935" strokeWidth={5} />
      </g>
    ),
    money: (
      <g>
        {[0, 1, 2].map((i) => (
          <rect key={i} x={-90 + i * 8} y={-50 - i * 10} width={180} height={90} rx={6} fill="#a5d6a7" stroke="#2a2230" strokeWidth={5} />
        ))}
        <text x={14} y={6} textAnchor="middle" fontSize={44} fontFamily={SANS} fontWeight={900} fill="#1b5e20">¥100万</text>
      </g>
    ),
    pudding: (
      <g>
        <path d="M -60 40 L -44 -40 L 44 -40 L 60 40 Z" fill="#ffe082" stroke="#2a2230" strokeWidth={5} />
        <path d="M -44 -40 Q 0 -70 44 -40 Z" fill="#8d4e1e" stroke="#2a2230" strokeWidth={5} />
        <circle cx={0} cy={-62} r={12} fill="#e53935" stroke="#2a2230" strokeWidth={4} />
      </g>
    ),
    scissors: (
      <g transform="rotate(-30)">
        <circle cx={-30} cy={50} r={28} fill="none" stroke="#c0392b" strokeWidth={14} />
        <circle cx={30} cy={50} r={28} fill="none" stroke="#c0392b" strokeWidth={14} />
        <path d="M -12 20 L 16 -130 L 28 -130 L 12 20 Z" fill="#cfd6dd" stroke="#2a2230" strokeWidth={5} />
        <path d="M 12 20 L -16 -130 L -28 -130 L -12 20 Z" fill="#e8edf1" stroke="#2a2230" strokeWidth={5} />
      </g>
    ),
    papercut: (
      <g>
        <rect x={-90} y={-90} width={180} height={180} fill="#d32f2f" stroke="#2a2230" strokeWidth={5} />
        <path d="M 0 -70 L 22 -22 L 70 0 L 22 22 L 0 70 L -22 22 L -70 0 L -22 -22 Z" fill="#fff5e6" />
        <circle cx={0} cy={0} r={18} fill="#d32f2f" />
      </g>
    ),
    gas: (
      <g>
        <rect x={-110} y={-20} width={220} height={60} rx={8} fill="#9e9e9e" stroke="#2a2230" strokeWidth={5} />
        <circle cx={-50} cy={-20} r={30} fill="#616161" stroke="#2a2230" strokeWidth={5} />
        <path d="M -90 -60 L -10 -60 L -20 -20 L -80 -20 Z" fill="#8d6e63" stroke="#2a2230" strokeWidth={5} />
        {[0, 1, 2].map((i) => (
          <path key={i} d={`M ${40 + i * 24} -40 Q ${30 + i * 24} -80 ${44 + i * 24} -120`} fill="none" stroke="#9ccc65" strokeWidth={8} opacity={0.6 + 0.3 * Math.sin(frame / 6 + i)} />
        ))}
      </g>
    ),
    key: (
      <g>
        <circle cx={-50} cy={0} r={30} fill="none" stroke="#c9a227" strokeWidth={14} />
        <rect x={-22} y={-8} width={110} height={16} fill="#c9a227" />
        <rect x={60} y={8} width={12} height={22} fill="#c9a227" />
        <rect x={80} y={8} width={12} height={16} fill="#c9a227" />
      </g>
    ),
    book: (
      <g>
        <rect x={-80} y={-100} width={160} height={200} rx={8} fill="#7b1f1f" stroke="#2a2230" strokeWidth={5} />
        <text x={0} y={10} textAnchor="middle" fontSize={44} fontFamily={DISPLAY} fontWeight={900} fill="#f5d77a">飘</text>
      </g>
    ),
  };
  return (
    <svg
      width={400 * sz}
      height={400 * sz}
      viewBox="-200 -200 400 400"
      style={{position: 'absolute', left: p.x - 200 * sz, top: p.y - 200 * sz, transform: `scale(${pop}) rotate(${Math.sin(frame / 12) * 3}deg)`, filter: 'drop-shadow(0 0 0 #fff) drop-shadow(0 10px 14px #0008)'}}
    >
      <g style={{filter: 'url(#propOutline)'}}>{icon[p.kind]}</g>
      <defs>
        <filter id="propOutline">
          <feMorphology in="SourceAlpha" operator="dilate" radius={8} result="d" />
          <feFlood floodColor="#fff" />
          <feComposite in2="d" operator="in" result="o" />
          <feMerge>
            <feMergeNode in="o" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      </defs>
      {p.label && (
        <text x={0} y={170} textAnchor="middle" fontSize={40} fontFamily={SANS} fontWeight={900} fill="#fff" stroke="#000" strokeWidth={8} paintOrder="stroke">
          {p.label}
        </text>
      )}
    </svg>
  );
};

// ---------------------------------------------------------------- 背景（平涂插画，统一偏冷的暮色调）
const Win: React.FC<{x: number; y: number; w: number; h: number; lit?: boolean; broken?: boolean}> = ({x, y, w, h, lit, broken}) => (
  <g>
    <rect x={x} y={y} width={w} height={h} fill={lit ? '#ffe9a8' : broken ? '#1d1b26' : '#3c4a66'} stroke="#2a2230" strokeWidth={4} />
    {!broken && <line x1={x + w / 2} y1={y} x2={x + w / 2} y2={y + h} stroke="#2a2230" strokeWidth={3} />}
  </g>
);

const BACKGROUNDS: Record<string, (f: number) => React.ReactNode> = {
  ruins: (f) => (
    <>
      <defs>
        <linearGradient id="dusk" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#3b2f5c" />
          <stop offset="0.6" stopColor="#c0605a" />
          <stop offset="1" stopColor="#f0a868" />
        </linearGradient>
      </defs>
      <rect width={1020} height={980} fill="url(#dusk)" />
      <circle cx={820} cy={330} r={70} fill="#ffd28a" opacity={0.8} />
      {/* 烂尾楼 */}
      <rect x={160} y={180} width={520} height={720} fill="#7d7b83" stroke="#2a2230" strokeWidth={6} />
      {[0, 1, 2, 3].map((r) => [0, 1, 2].map((c) => <Win key={`${r}${c}`} x={200 + c * 160} y={230 + r * 160} w={110} h={100} broken />))}
      <path d="M 160 180 L 220 130 L 300 180 L 380 120 L 460 180 L 560 140 L 680 180" fill="none" stroke="#2a2230" strokeWidth={6} />
      {[0, 1, 2, 3, 4].map((i) => <line key={i} x1={190 + i * 110} y1={180} x2={200 + i * 110} y2={110 + (i % 2) * 30} stroke="#555" strokeWidth={8} />)}
      {/* 通风管 */}
      <rect x={690} y={560} width={260} height={70} fill="#9aa3ad" stroke="#2a2230" strokeWidth={5} />
      <rect x={890} y={560} width={70} height={340} fill="#9aa3ad" stroke="#2a2230" strokeWidth={5} />
      <rect x={0} y={890} width={1020} height={90} fill="#5b5148" />
      {[...Array(8)].map((_, i) => <ellipse key={i} cx={80 + i * 130} cy={905} rx={40} ry={14} fill="#6e6258" />)}
      {/* 警戒线 */}
      <path d="M 0 840 L 1020 800" stroke="#f9d71c" strokeWidth={22} />
      <path d="M 0 840 L 1020 800" stroke="#2a2230" strokeWidth={22} strokeDasharray="40 40" opacity={0.7} />
    </>
  ),
  police: () => (
    <>
      <rect width={1020} height={980} fill="#d8d2c4" />
      <rect x={0} y={640} width={1020} height={340} fill="#8a7563" />
      <rect x={80} y={120} width={300} height={220} fill="#f5f0e1" stroke="#2a2230" strokeWidth={5} />
      <text x={230} y={200} textAnchor="middle" fontSize={40} fontFamily={DISPLAY} fontWeight={900} fill="#2a2230">搜查本部</text>
      {[0, 1, 2].map((i) => <rect key={i} x={110 + i * 90} y={240} width={70} height={80} fill="#fff" stroke="#999" strokeWidth={3} transform={`rotate(${(i - 1) * 5} ${145 + i * 90} 280)`} />)}
      <path d="M 150 270 L 240 300 L 330 260" stroke="#e53935" strokeWidth={4} fill="none" />
      <rect x={560} y={560} width={400} height={30} fill="#6d4c41" stroke="#2a2230" strokeWidth={5} />
      <rect x={600} y={480} width={120} height={80} fill="#ececec" stroke="#2a2230" strokeWidth={4} />
      <path d="M 880 420 L 900 560 M 860 420 L 940 420" stroke="#2a2230" strokeWidth={8} />
      <path d="M 840 380 L 960 380 L 920 420 L 880 420 Z" fill="#558b2f" stroke="#2a2230" strokeWidth={4} />
      <circle cx={760} cy={180} r={70} fill="#fff" stroke="#2a2230" strokeWidth={6} />
      <line x1={760} y1={180} x2={760} y2={130} stroke="#2a2230" strokeWidth={6} />
      <line x1={760} y1={180} x2={795} y2={195} stroke="#2a2230" strokeWidth={6} />
    </>
  ),
  apartment: (f) => (
    <>
      <rect width={1020} height={980} fill="#c9b79c" />
      <rect x={0} y={700} width={1020} height={280} fill="#b9a36a" />
      {[...Array(6)].map((_, i) => <line key={i} x1={i * 170} y1={700} x2={i * 170} y2={980} stroke="#8d7a48" strokeWidth={4} />)}
      <rect x={620} y={150} width={300} height={260} fill="#7f9cbf" stroke="#2a2230" strokeWidth={6} />
      <line x1={770} y1={150} x2={770} y2={410} stroke="#2a2230" strokeWidth={5} />
      <rect x={60} y={460} width={320} height={240} fill="#9e9e9e" stroke="#2a2230" strokeWidth={5} />
      <circle cx={150} cy={460} r={34} fill="#616161" stroke="#2a2230" strokeWidth={5} />
      <path d="M 100 410 L 200 410 L 186 460 L 114 460 Z" fill="#8d6e63" stroke="#2a2230" strokeWidth={5} />
      <rect x={440} y={600} width={150} height={100} fill="#d7ccc8" stroke="#2a2230" strokeWidth={4} />
      <ellipse cx={470} cy={600} rx={26} ry={8} fill="#fff" stroke="#2a2230" strokeWidth={3} />
    </>
  ),
  library: () => (
    <>
      <rect width={1020} height={980} fill="#e8dcc0" />
      {[0, 1].map((s) => (
        <g key={s} transform={`translate(${60 + s * 520}, 100)`}>
          <rect width={380} height={600} fill="#8b5a2b" stroke="#2a2230" strokeWidth={6} />
          {[0, 1, 2, 3].map((r) => (
            <g key={r}>
              <rect x={14} y={20 + r * 145} width={352} height={120} fill="#6d4321" />
              {[...Array(11)].map((_, i) => (
                <rect key={i} x={20 + i * 31} y={30 + r * 145 + (i % 3) * 6} width={26} height={110 - (i % 3) * 6} fill={['#c0392b', '#2980b9', '#27ae60', '#f1c40f', '#8e44ad', '#e67e22'][(i + r + s) % 6]} stroke="#2a2230" strokeWidth={2} />
              ))}
            </g>
          ))}
        </g>
      ))}
      <rect x={0} y={760} width={1020} height={220} fill="#a1887f" />
      <rect x={260} y={700} width={500} height={40} fill="#6d4c41" stroke="#2a2230" strokeWidth={5} />
      {[0, 1].map((i) => <rect key={i} x={290 + i * 400} y={740} width={20} height={150} fill="#5d4037" />)}
    </>
  ),
  pawnshop: () => (
    <>
      <rect width={1020} height={980} fill="#4a5568" />
      <rect x={120} y={200} width={780} height={700} fill="#8d6e63" stroke="#2a2230" strokeWidth={6} />
      <path d="M 80 200 L 510 80 L 940 200 Z" fill="#3e2723" stroke="#2a2230" strokeWidth={6} />
      <rect x={340} y={230} width={340} height={110} fill="#f5ecd2" stroke="#2a2230" strokeWidth={5} />
      <text x={510} y={310} textAnchor="middle" fontSize={70} fontFamily={DISPLAY} fontWeight={900} fill="#2a2230">桐原当铺</text>
      <rect x={300} y={400} width={420} height={300} fill="#263238" stroke="#2a2230" strokeWidth={5} />
      {[0, 1, 2, 3].map((i) => <rect key={i} x={300 + i * 105} y={400} width={100} height={150} fill="#1565c0" stroke="#0d47a1" strokeWidth={3} />)}
      <text x={510} y={500} textAnchor="middle" fontSize={64} fontFamily={DISPLAY} fontWeight={900} fill="#fff">質</text>
      <rect x={0} y={900} width={1020} height={80} fill="#37474f" />
    </>
  ),
  mansion: () => (
    <>
      <rect width={1020} height={980} fill="#cfe3d8" />
      <rect x={0} y={760} width={1020} height={220} fill="#8fae8b" />
      <rect x={150} y={260} width={720} height={500} fill="#f5f0e6" stroke="#2a2230" strokeWidth={6} />
      <path d="M 100 270 L 510 100 L 920 270 Z" fill="#455a64" stroke="#2a2230" strokeWidth={6} />
      {[0, 1, 2].map((i) => <Win key={i} x={210 + i * 230} y={340} w={150} h={150} lit />)}
      <rect x={440} y={560} width={140} height={200} fill="#6d4c41" stroke="#2a2230" strokeWidth={5} />
      {[0, 1, 2, 3, 4].map((i) => <circle key={i} cx={80 + i * 210} cy={790} r={46} fill="#5f8f5b" stroke="#2a2230" strokeWidth={4} />)}
      <text x={510} y={230} textAnchor="middle" fontSize={44} fontFamily={DISPLAY} fontWeight={900} fill="#fff">唐泽家</text>
    </>
  ),
  black: () => <rect width={1020} height={980} fill="#0b0b12" />,
};

export const StageScene: React.FC<{scene: SceneData}> = ({scene}) => {
  const frame = useCurrentFrame();
  const d = scene.data;
  const cast = (THEME as {cast?: Record<string, CharSpec>}).cast ?? {};
  const actors = (d.actors ?? []) as Actor[];
  const zoom = d.zoom as {cue: string; to: number; x: number; y: number} | undefined;
  const zp = zoom ? prog(frame, cueFrame(scene, zoom.cue, 0), 24) : 0;
  const z = 1 + (zoom ? (zoom.to - 1) * zp : 0);
  const darkAt = d.darkCue ? cueFrame(scene, d.darkCue, 0) : 0;
  const dark = (d.dark ?? 0) * (d.darkCue ? prog(frame, darkAt, 20) : 1);
  const bg = BACKGROUNDS[d.bg] ?? BACKGROUNDS.black;
  const flashes = ((d.flash ?? []) as string[]).map((c) => cueFrame(scene, c, 0));
  return (
    <>
      {(d.sfx ?? []).map((s: {cue: string; name: string; volume?: number}, i: number) => (
        <Sfx key={i} at={cueFrame(scene, s.cue, 0)} name={s.name} volume={s.volume ?? 0.7} />
      ))}
      <div
        style={{
          position: 'absolute',
          left: PANEL.x,
          top: PANEL.y,
          width: PANEL.w,
          height: PANEL.h,
          borderRadius: 28,
          overflow: 'hidden',
          border: '8px solid #fff',
          boxShadow: '0 20px 50px #000a',
        }}
      >
        <div style={{position: 'absolute', inset: 0, transform: `scale(${z})`, transformOrigin: zoom ? `${zoom.x - PANEL.x}px ${zoom.y - PANEL.y}px` : '50% 50%'}}>
          <svg width={PANEL.w} height={PANEL.h} style={{position: 'absolute'}}>
            {bg(frame)}
          </svg>
          <div style={{position: 'absolute', left: -PANEL.x, top: -PANEL.y, width: 1080, height: 1920}}>
            {actors.map((a, i) => (cast[a.who] ? <ActorView key={i} scene={scene} a={a} spec={cast[a.who]} seed={i} /> : null))}
            {((d.props ?? []) as {kind: string; x: number; y: number; cue?: string; size?: number; label?: string}[]).map((p, i) => (
              <BigProp key={i} scene={scene} p={p} />
            ))}
          </div>
        </div>
        <AbsoluteFill style={{background: '#05040c', opacity: dark}} />
        {/* 雪花般的白色微粒：「白夜」 */}
        {[...Array(26)].map((_, i) => (
          <div
            key={i}
            style={{
              position: 'absolute',
              left: (random(`sx${i}`) * PANEL.w + Math.sin(frame / 30 + i) * 20) % PANEL.w,
              top: (random(`sy${i}`) * PANEL.h + frame * (0.6 + random(`sv${i}`))) % PANEL.h,
              width: 5,
              height: 5,
              borderRadius: '50%',
              background: '#fff',
              opacity: 0.35,
            }}
          />
        ))}
      </div>
      {d.caption && (
        <div
          style={{
            position: 'absolute',
            left: PANEL.x + 30,
            top: PANEL.y - 34,
            padding: '8px 26px',
            background: C.red,
            color: '#fff',
            fontFamily: SANS,
            fontWeight: 900,
            fontSize: 42,
            borderRadius: 12,
            border: '5px solid #fff',
            transform: `rotate(-2deg) scale(${spring({frame, fps: FPS, config: {damping: 12}})})`,
          }}
        >
          {d.caption}
        </div>
      )}
      {flashes.map((at, i) => (
        <Flash key={i} at={at} color="#fff" strength={0.7} dur={10} />
      ))}
    </>
  );
};
