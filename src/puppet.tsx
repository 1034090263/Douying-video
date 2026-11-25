import React from 'react';
import {AbsoluteFill, Easing, interpolate, random, useCurrentFrame} from 'remotion';
import {DISPLAY, SCENE_STARTS, SceneData, TIMELINE, beatPulse, cueFrame, prog} from './lib';
import {Sfx} from './ui';
import {Rig, RigPose, RigPuppet, armTo, strideOf, walkPose} from './rig';

/**
 * 皮影戏舞台（借鉴 vendor/sy-style-new20/styles/30-shadow 的做法，竖屏重写）：
 *  - 幕布：幕后油灯的暖光透过纸面，纤维纹理、灯焰闪烁、四周压暗
 *  - 人偶：半透明彩色「牛皮」+ 深色雕刻描边 + 透光镂空花纹，头/躯干/大小臂/大小腿分件，绕关节转动
 *  - 操纵杆：手和颈部连到幕布下沿的细杆影子
 *
 * data: {
 *   scenery?: ['building', 'duct', 'lamp'],
 *   actors: [{who: 'man'|'girl'|'boy', x, y?, scale?, facing?: 1|-1, enter?: cue, exit?: cue,
 *             steps: [{cue, walk?: x, to?: y, dur?, pose?: 'stand'|'walk'|'shock'|'raise'|'crawl'|'fall'|'reach'|'down', hide?: true}]}],
 *   light?: [{cue, to, dur?}],          // 灯光亮度 0~1
 *   slashes?: [cue],                    // 红色剪痕划过幕布（配乐同步落重音）
 *   split?: cue,                        // 结尾：右半幕变亮（白天）、左半幕变暗（黑夜）
 *   title?: {cue?, text, sub?}
 * }
 */

const STAGE = {x: 50, y: 330, w: 980, h: 960};
const GROUND = STAGE.y + STAGE.h - 70;
const INK = '#2a160b';
const clamp = {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'} as const;
const ease = Easing.bezier(0.45, 0, 0.25, 1);

// ---------------------------------------------------------------- 人偶部件（局部坐标，关节在原点）
type Pal = {leather: string; deep: string; accent: string};
const PAL: Record<string, Pal> = {
  man: {leather: 'rgba(150,40,26,0.85)', deep: 'rgba(40,90,60,0.88)', accent: 'rgba(214,170,110,0.9)'},
  girl: {leather: 'rgba(244,232,214,0.9)', deep: 'rgba(196,70,90,0.85)', accent: 'rgba(250,238,222,0.95)'},
  boy: {leather: 'rgba(46,58,118,0.88)', deep: 'rgba(24,30,64,0.92)', accent: 'rgba(214,180,140,0.9)'},
};

/** 镂空花纹：在部件上打一串透光的小孔 */
const Holes: React.FC<{pts: [number, number, number][]}> = ({pts}) => (
  <>
    {pts.map(([x, y, r], i) => (
      <ellipse key={i} cx={x} cy={y} rx={r} ry={r * 0.7} fill="rgba(255,226,160,0.75)" />
    ))}
  </>
);

const part = (d: string, fill: string, extra?: React.ReactNode) => (
  <>
    <path d={d} fill={fill} stroke={INK} strokeWidth={3} strokeLinejoin="round" />
    {extra}
  </>
);

type Angles = {lean: number; head: number; ua: number; fa: number; ua2: number; fa2: number; th: number; sh: number; th2: number; sh2: number};
const ZERO: Angles = {lean: 0, head: 0, ua: 8, fa: -12, ua2: -4, fa2: -8, th: 0, sh: 0, th2: 0, sh2: 0};

const POSES: Record<string, Partial<Angles>> = {
  stand: {},
  shock: {lean: -10, head: -18, ua: 150, fa: 20, ua2: 120, fa2: 30},
  raise: {lean: 6, head: 6, ua: 165, fa: 10, ua2: 20, fa2: -20},
  reach: {ua: 80, fa: 0, ua2: 70, fa2: 10},
  down: {lean: 12, head: 26, ua: 4, fa: 0, ua2: 4, fa2: 0},
  fall: {lean: 0, head: 30, ua: 60, fa: 30, ua2: 80, fa2: 30, th: 20, sh: -30, th2: -10, sh2: -20},
  crawl: {lean: 75, head: -60, ua: 80, fa: -10, ua2: 100, fa2: -10, th: 70, sh: -90, th2: 50, sh2: -80},
};

/** 一个人偶：按角度组合各部件 */
const Puppet: React.FC<{who: string; a: Angles; scale: number}> = ({who, a, scale}) => {
  const p = PAL[who];
  const kid = who !== 'man';
  const H = kid ? 0.78 : 1; // 孩子整体小一号
  const R = (deg: number) => `rotate(${deg})`;
  // 躯干（髋部在原点，向上为负）
  const torsoLen = 150 * H;
  const torso =
    who === 'girl'
      ? part(`M -26 ${-torsoLen} Q 0 ${-torsoLen - 10} 26 ${-torsoLen} L 34 -40 L 70 40 Q 0 58 -70 40 L -34 -40 Z`, p.leather, <Holes pts={[[0, -100, 6], [-14, -70, 5], [14, -70, 5], [0, -40, 7], [-30, 20, 6], [0, 26, 6], [30, 20, 6]]} />)
      : who === 'man'
        ? part(`M -40 ${-torsoLen} Q 0 ${-torsoLen - 14} 40 ${-torsoLen} L 46 -10 Q 0 6 -46 -10 Z`, p.leather, <Holes pts={[[0, -120, 7], [-20, -90, 6], [20, -90, 6], [0, -60, 8], [-22, -30, 6], [22, -30, 6]]} />)
        : part(`M -28 ${-torsoLen} Q 0 ${-torsoLen - 10} 28 ${-torsoLen} L 32 -6 Q 0 6 -32 -6 Z`, p.leather, <Holes pts={[[0, -90, 6], [-12, -60, 5], [12, -60, 5], [0, -32, 6]]} />);
  // 头（侧脸，朝右）
  const head =
    who === 'man' ? (
      <g>
        {part('M -30 -10 Q -34 -66 6 -70 Q 34 -66 36 -34 L 46 -22 L 36 -16 Q 40 0 24 6 L -20 6 Q -32 2 -30 -10 Z', p.accent)}
        <circle cx={18} cy={-36} r={11} fill="none" stroke={INK} strokeWidth={3} />
        <ellipse cx={-4} cy={-40} rx={9} ry={6} fill="rgba(255,226,160,0.7)" />
      </g>
    ) : who === 'girl' ? (
      <g>
        <path d="M -34 -60 Q -44 -10 -40 70 L -14 70 Q -10 20 -8 -4 Z" fill="rgba(30,22,26,0.9)" stroke={INK} strokeWidth={3} />
        {part('M -26 -8 Q -30 -60 4 -62 Q 30 -58 30 -30 L 38 -20 L 30 -16 Q 32 -2 20 4 L -18 4 Q -28 0 -26 -8 Z', p.accent)}
        <path d="M -30 -40 Q -26 -70 6 -66 Q 30 -62 32 -40 Q 10 -52 -30 -40 Z" fill="rgba(30,22,26,0.92)" stroke={INK} strokeWidth={3} />
        <ellipse cx={12} cy={-30} rx={4} ry={2.6} fill={INK} />
      </g>
    ) : (
      <g>
        {part('M -26 -8 Q -30 -58 4 -60 Q 30 -56 30 -30 L 38 -20 L 30 -16 Q 32 -2 20 4 L -18 4 Q -28 0 -26 -8 Z', 'rgba(70,74,100,0.92)')}
        <path d="M -32 -30 L -30 -60 L -10 -70 L 6 -62 L 20 -70 L 30 -52 L 34 -34 L 20 -44 L 8 -36 L -6 -46 L -18 -32 Z" fill="rgba(14,14,24,0.95)" stroke={INK} strokeWidth={3} />
        <rect x={6} y={-32} width={16} height={3} fill="rgba(255,90,70,0.8)" />
      </g>
    );
  const limb = (len: number, w: number, fill: string) => part(`M ${-w / 2} 0 L ${w / 2} 0 L ${w / 2 - 2} ${len} L ${-w / 2 + 2} ${len} Z`, fill);
  const armLen = kid ? 118 : 150;
  const legLen = kid ? 150 : 190;
  const hand = <circle cx={0} cy={armLen} r={9} fill={p.leather} stroke={INK} strokeWidth={3} />;
  const foot = <path d={`M -10 ${legLen} L 22 ${legLen} L 20 ${legLen - 12} L -8 ${legLen - 14} Z`} fill={p.deep} stroke={INK} strokeWidth={3} />;
  const scissors =
    who === 'boy' ? (
      <g transform={`translate(0, ${armLen + 6}) rotate(180)`}>
        <circle cx={-6} cy={-6} r={7} fill="none" stroke="#d1261b" strokeWidth={4} />
        <circle cx={6} cy={-6} r={7} fill="none" stroke="#d1261b" strokeWidth={4} />
        <path d="M -2 0 L 3 40 L -3 40 Z M 2 0 L 6 38 L 0 40 Z" fill="#e8402e" stroke={INK} strokeWidth={1.5} />
      </g>
    ) : null;
  const shoulderY = -torsoLen + 14;
  return (
    <g transform={`scale(${scale * H})`}>
      {/* 远侧手臂/腿（颜色更深） */}
      <g transform={`translate(-8, 0) ${R(a.th2)}`}>
        {limb(legLen * 0.55, 22, p.deep)}
        <g transform={`translate(0, ${legLen * 0.55}) ${R(a.sh2)}`}>{limb(legLen * 0.5, 18, p.deep)}<g transform={`translate(0, ${-legLen * 0.5})`}>{foot}</g></g>
      </g>
      <g transform={`translate(-6, ${shoulderY}) ${R(-a.ua2)}`}>
        {limb(armLen * 0.5, 18, p.deep)}
        <g transform={`translate(0, ${armLen * 0.5}) ${R(-a.fa2)}`}>{limb(armLen * 0.5, 15, p.deep)}<g transform={`translate(0, ${-armLen * 0.5})`}>{hand}</g></g>
      </g>
      {/* 躯干 + 头 */}
      <g transform={R(a.lean)}>
        {torso}
        {who === 'man' && part(`M -46 -20 L 46 -20 L 62 ${legLen * 0.75} Q 0 ${legLen * 0.82} -62 ${legLen * 0.75} Z`, p.leather, <Holes pts={[[-30, 40, 7], [0, 50, 8], [30, 40, 7], [-36, 100, 6], [0, 112, 7], [36, 100, 6]]} />)}
        {who === 'man' && <path d={`M -62 ${legLen * 0.75} Q 0 ${legLen * 0.82} 62 ${legLen * 0.75} L 58 ${legLen * 0.62} Q 0 ${legLen * 0.69} -58 ${legLen * 0.62} Z`} fill={p.deep} stroke={INK} strokeWidth={3} />}
        {who === 'boy' && part('M -34 -14 L 34 -14 L 40 44 L -40 44 Z', p.deep, <Holes pts={[[-18, 14, 5], [18, 14, 5]]} />)}
        <g transform={`translate(4, ${-torsoLen + 2}) ${R(a.head)}`}>{head}</g>
      </g>
      {/* 近侧手臂/腿 */}
      <g transform={`translate(8, 0) ${R(a.th)}`}>
        {limb(legLen * 0.55, 24, p.leather)}
        <g transform={`translate(0, ${legLen * 0.55}) ${R(a.sh)}`}>{limb(legLen * 0.5, 20, p.leather)}<g transform={`translate(0, ${-legLen * 0.5})`}>{foot}</g></g>
      </g>
      <g transform={`translate(10, ${shoulderY}) ${R(-a.ua)}`}>
        {limb(armLen * 0.5, 20, p.leather)}
        <g transform={`translate(0, ${armLen * 0.5}) ${R(-a.fa)}`}>
          {limb(armLen * 0.5, 16, p.leather)}
          <g transform={`translate(0, ${-armLen * 0.5})`}>{hand}</g>
          {scissors}
        </g>
      </g>
    </g>
  );
};

// ---------------------------------------------------------------- 角色调度
type Step = {cue: string; walk?: number; to?: number | 'duct' | 'ground'; dur?: number; pose?: string; hide?: boolean};
type Actor = {who: string; x: number; y?: number | 'duct' | 'ground'; scale?: number; facing?: 1 | -1; enter?: string; exit?: string; steps?: Step[]};

const mix = (a: Angles, b: Partial<Angles>, t: number): Angles => {
  const o = {...a};
  for (const k of Object.keys(ZERO) as (keyof Angles)[]) o[k] = a[k] + ((b[k] ?? ZERO[k]) - a[k]) * t;
  return o;
};

const RIG_OF: Record<string, string> = {man: 'yosuke', girl: 'yukiho_kid', boy: 'ryoji_kid'};
const RIG_H: Record<string, number> = {man: 560, girl: 430, boy: 445};
const RIGS = ((TIMELINE as unknown as {rigs?: Record<string, Rig>}).rigs ?? {}) as Record<string, Rig>;

/** 骨骼人偶的姿势：站立=两腿并拢；走路=交替摆腿；举手、惊吓、低头 */
const rigPose = (rig: Rig, pose: string, walking: boolean, frame: number): RigPose => {
  const st = strideOf(rig);
  const nf = (rig.parts.shin_near?.pivot[0] ?? 0) * rig.facing > (rig.parts.shin_far?.pivot[0] ?? 0) * rig.facing ? 1 : -1;
  const together: RigPose = {thigh_near: (st / 2) * rig.facing * nf, thigh_far: (-st / 2) * rig.facing * nf, shin: 0};
  let p: RigPose = walking ? walkPose(rig, frame / 4.5) : {...together, uarm: 0};
  if (!rig.parts.thigh_near) p = {...p, shin_near: p.thigh_near, shin_far: p.thigh_far};
  const up = -90 + 20 * rig.facing; // 朝前上方
  if (pose === 'raise') p = {...p, ...armTo(rig, up + 5 * rig.facing), lean: -3 * rig.facing};
  if (pose === 'shock') p = {...p, ...armTo(rig, up + 45 * rig.facing), lean: -8 * rig.facing, head: -10 * rig.facing};
  if (pose === 'down') p = {...p, head: 18 * rig.facing, lean: 5 * rig.facing};
  if (pose === 'reach') p = {...p, ...armTo(rig, rig.facing > 0 ? -10 : 190)};
  return p;
};

const ActorView: React.FC<{scene: SceneData; ac: Actor}> = ({scene, ac}) => {
  const frame = useCurrentFrame();
  const enterAt = ac.enter ? cueFrame(scene, ac.enter, 0) : -1;
  if (frame < enterAt) return null;
  let x = ac.x;
  const Y = (v: number | string | undefined, d: number) => (v === 'duct' ? GROUND - 258 : v === 'ground' || v === undefined ? d : Number(v));
  let y = Y(ac.y, GROUND);
  let facing = ac.facing ?? 1;
  let pose: Angles = {...ZERO, ...POSES.stand};
  let walking = false;
  let hidden = false;
  let rot = 0;
  let curPose = 'stand';
  const steps = (ac.steps ?? []).map((s) => ({...s, at: cueFrame(scene, s.cue, 0)})).sort((p, q) => p.at - q.at);
  for (const s of steps) {
    if (frame < s.at) break;
    const dur = s.dur ?? 45;
    const p = interpolate(frame, [s.at, s.at + dur], [0, 1], {...clamp, easing: ease});
    if (s.walk !== undefined || s.to !== undefined) {
      const nx = s.walk ?? x;
      const ny = s.to === undefined ? y : Y(s.to, GROUND);
      if (p < 1) {
        walking = true;
        if (nx !== x) facing = nx > x ? 1 : -1;
      }
      x = x + (nx - x) * p;
      y = y + (ny - y) * p;
    }
    if (s.pose) {
      curPose = s.pose;
      const target = POSES[s.pose] ?? {};
      pose = mix(pose, target, prog(frame, s.at, 14));
      if (s.pose === 'fall') rot = 84 * prog(frame, s.at, 22);
      if (s.pose === 'crawl') walking = walking || p < 1;
    }
    if (s.hide !== undefined && frame >= s.at) hidden = s.hide;
  }
  // 走路：腿和手臂摆动
  if (walking) {
    const w = Math.sin(frame / 4.5);
    pose = {...pose, th: pose.th + w * 26, th2: pose.th2 - w * 26, sh: pose.sh + Math.max(0, -w) * -30, sh2: pose.sh2 + Math.max(0, w) * -30, ua: pose.ua + (pose.ua < 60 ? -w * 18 : 0), ua2: pose.ua2 + (pose.ua2 < 60 ? w * 18 : 0)};
  }
  // 皮影人偶特有的轻微颤动（操纵杆）
  const jitter = Math.sin(frame / 3.1 + ac.x) * 0.8;
  const bob = walking ? -Math.abs(Math.sin(frame / 4.5)) * 8 : Math.sin(frame / 20 + ac.x) * 2;
  const exitP = ac.exit ? prog(frame, cueFrame(scene, ac.exit, 999), 20) : 0;
  const enterP = enterAt >= 0 ? prog(frame, enterAt, 16) : 1;
  if (hidden) return null;
  const sc = ac.scale ?? 1;
  return (
    <g opacity={enterP * (1 - exitP)} transform={`translate(${x}, ${y + bob}) rotate(${rot + jitter * 0.3}) scale(${facing}, 1)`}>
      {/* 操纵杆 */}
      <line x1={0} y1={-(RIG_H[ac.who] ?? 300) * sc * 0.72} x2={50} y2={460} stroke="rgba(40,20,8,0.45)" strokeWidth={3} />
      <line x1={10} y1={-(RIG_H[ac.who] ?? 300) * sc * 0.45} x2={90} y2={460} stroke="rgba(40,20,8,0.4)" strokeWidth={2.5} />
      {RIGS[RIG_OF[ac.who]] ? (
        <RigPuppet id={RIG_OF[ac.who]} pose={rigPose(RIGS[RIG_OF[ac.who]], curPose, walking, frame)} height={RIG_H[ac.who] * sc} prop={ac.who === 'boy' && curPose === 'raise' ? 'prop_scissors.png' : undefined} />
      ) : (
        <g transform={`translate(0, ${-(ac.who === 'man' ? 190 : 150 * 0.78) * sc})`}>
          <Puppet who={ac.who} a={pose} scale={sc} />
        </g>
      )}
    </g>
  );
};

// ---------------------------------------------------------------- 布景（雕花牛皮）
const Building: React.FC = () => (
  <g>
    <path d={`M 470 ${GROUND} L 470 500 L 760 470 L 900 500 L 900 ${GROUND} Z`} fill="rgba(90,70,56,0.85)" stroke={INK} strokeWidth={4} />
    {[0, 1, 2].map((r) =>
      [0, 1].map((c) => <rect key={`${r}${c}`} x={520 + c * 200} y={560 + r * 190} width={110} height={110} fill="rgba(255,214,150,0.55)" stroke={INK} strokeWidth={4} />),
    )}
    {[...Array(8)].map((_, i) => (
      <line key={i} x1={480 + i * 55} y1={470 - (i % 2) * 30} x2={490 + i * 55} y2={430 - (i % 3) * 20} stroke={INK} strokeWidth={6} />
    ))}
    <rect x={600} y={GROUND - 200} width={120} height={200} fill="rgba(20,10,4,0.8)" stroke={INK} strokeWidth={4} />
  </g>
);

const Duct: React.FC = () => (
  <g>
    <path d={`M 120 ${GROUND - 330} L 900 ${GROUND - 330} L 900 ${GROUND - 250} L 120 ${GROUND - 250} Z`} fill="rgba(110,110,120,0.5)" stroke={INK} strokeWidth={4} />
    {[...Array(9)].map((_, i) => (
      <line key={i} x1={160 + i * 90} y1={GROUND - 330} x2={160 + i * 90} y2={GROUND - 250} stroke={INK} strokeWidth={3} />
    ))}
  </g>
);

const Lamp: React.FC<{f: number}> = ({f}) => (
  <g transform={`translate(160, ${GROUND - 40})`}>
    <rect x={-6} y={-260} width={12} height={260} fill={INK} />
    <path d="M -40 -260 L 40 -260 L 24 -300 L -24 -300 Z" fill="rgba(60,40,20,0.9)" stroke={INK} strokeWidth={3} />
    <ellipse cx={0} cy={-250} rx={26 + Math.sin(f / 3) * 2} ry={14} fill="rgba(255,220,140,0.9)" />
  </g>
);

export const PuppetScene: React.FC<{scene: SceneData}> = ({scene}) => {
  const frame = useCurrentFrame();
  const idx = TIMELINE.scenes.indexOf(scene as (typeof TIMELINE.scenes)[number]);
  const gf = frame + (SCENE_STARTS[idx] ?? 0);
  const d = scene.data;
  // 灯光：默认全亮，可按 cue 变化；油灯闪烁
  let light = d.lightFrom ?? 1;
  for (const l of (d.light ?? []) as {cue: string; to: number; dur?: number}[]) {
    light = light + (l.to - light) * prog(frame, cueFrame(scene, l.cue, 0), l.dur ?? 24);
  }
  const flick = 0.92 + 0.08 * Math.sin(frame / 2.7) * Math.sin(frame / 7.3) + (random(`fl${Math.floor(frame / 4)}`) < 0.05 ? -0.15 : 0);
  const lum = Math.max(0, light * flick + beatPulse(gf) * 0.05);
  const slashes = ((d.slashes ?? []) as string[]).map((c) => cueFrame(scene, c, 0));
  const splitAt = d.split ? cueFrame(scene, d.split, 999) : 999999;
  const sp = prog(frame, splitAt, 60);
  const scenery = (d.scenery ?? []) as string[];
  const shake = slashes.reduce((s, at) => (frame >= at && frame < at + 12 ? s + Math.sin((frame - at) * 2.3) * (12 - (frame - at)) : s), 0);
  return (
    <>
      {((d.sfx ?? []) as {cue: string; name: string; volume?: number}[]).map((s, i) => (
        <Sfx key={i} at={cueFrame(scene, s.cue, 0)} name={s.name} volume={s.volume ?? 0.6} />
      ))}
      <AbsoluteFill style={{background: 'radial-gradient(ellipse at 50% 40%, #2a1a10 0%, #0a0604 75%)'}} />
      {/* 戏台木框 */}
      <div style={{position: 'absolute', left: STAGE.x - 26, top: STAGE.y - 26, width: STAGE.w + 52, height: STAGE.h + 52, borderRadius: 10, background: 'linear-gradient(#5a2c16, #3a1a0c)', boxShadow: '0 20px 60px #000, inset 0 0 0 4px #8a5a2a'}} />
      <div style={{position: 'absolute', left: STAGE.x, top: STAGE.y, width: STAGE.w, height: STAGE.h, overflow: 'hidden', transform: `translateX(${shake}px)`}}>
        {/* 幕布：幕后灯光 */}
        <AbsoluteFill style={{background: `radial-gradient(ellipse at 45% 55%, rgba(255,214,140,${lum}) 0%, rgba(236,160,80,${lum * 0.85}) 45%, rgba(90,40,14,${0.6 + lum * 0.2}) 100%)`}} />
        {/* 结尾：一半白昼、一半黑夜 */}
        <AbsoluteFill style={{background: `linear-gradient(90deg, rgba(0,0,0,${sp * 0.75}) 0%, rgba(0,0,0,${sp * 0.6}) 45%, rgba(255,250,235,${sp * 0.35}) 60%, rgba(255,255,245,${sp * 0.5}) 100%)`}} />
        <svg width={STAGE.w} height={STAGE.h} style={{position: 'absolute', filter: 'saturate(1.25) contrast(1.08) drop-shadow(0 0 6px rgba(40,16,4,0.5))', mixBlendMode: 'multiply'}}>
          <g transform={`translate(${-STAGE.x}, ${-STAGE.y})`}>
            {scenery.includes('building') && <Building />}
            {scenery.includes('lamp') && <Lamp f={frame} />}
            {((d.actors ?? []) as Actor[]).map((ac, i) => (
              <ActorView key={i} scene={scene} ac={ac} />
            ))}
            {/* 通风管画在人偶前面：人在管道里走时只露出上半身 */}
            {scenery.includes('duct') && <Duct />}
          </g>
        </svg>
        {/* 红色剪痕 */}
        {slashes.map((at, i) => {
          const k = frame - at;
          if (k < 0) return null;
          const draw = Math.min(1, k / 6);
          const fade = k > 60 ? Math.max(0, 1 - (k - 60) / 30) : 1;
          const y0 = 260 + i * 240;
          return (
            <svg key={i} width={STAGE.w} height={STAGE.h} style={{position: 'absolute', opacity: fade}}>
              <path d={`M ${-40} ${y0} L ${STAGE.w * draw + 20} ${y0 + 180 * draw}`} stroke="#b3150c" strokeWidth={26 - i * 4} strokeLinecap="round" style={{filter: 'drop-shadow(0 0 12px #ff3a1a)'}} />
            </svg>
          );
        })}
        {/* 纸面纤维纹理 + 暗角 */}
        <svg width={STAGE.w} height={STAGE.h} style={{position: 'absolute', opacity: 0.35, mixBlendMode: 'multiply'}}>
          <filter id="paperfiber">
            <feTurbulence type="fractalNoise" baseFrequency="0.012 0.18" numOctaves="3" seed={3} />
            <feColorMatrix values="0 0 0 0 0.45  0 0 0 0 0.3  0 0 0 0 0.18  0 0 0 0.7 0" />
          </filter>
          <rect width="100%" height="100%" filter="url(#paperfiber)" />
        </svg>
        <AbsoluteFill style={{boxShadow: `inset 0 0 ${160 + (1 - lum) * 200}px ${40 + (1 - lum) * 80}px rgba(10,4,0,0.85)`}} />
      </div>
      {d.title && (
        <div
          style={{
            position: 'absolute',
            left: 0,
            right: 0,
            top: STAGE.y + 160,
            textAlign: 'center',
            fontFamily: DISPLAY,
            fontWeight: 900,
            fontSize: 150,
            color: '#2a1208',
            letterSpacing: 30,
            paddingLeft: 30,
            opacity: prog(frame, cueFrame(scene, d.title.cue, 0.3), 30) * (d.title.out ? 1 - prog(frame, cueFrame(scene, d.title.out, 999), 20) : 1),
            textShadow: '0 0 30px rgba(255,200,120,0.6)',
          }}
        >
          {d.title.text}
          {d.title.sub && <div style={{fontSize: 52, letterSpacing: 14, marginTop: 6}}>{d.title.sub}</div>}
        </div>
      )}
    </>
  );
};
