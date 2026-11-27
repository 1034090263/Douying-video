import React, {useEffect, useLayoutEffect, useRef, useState} from 'react';
import {continueRender, delayRender, staticFile} from 'remotion';
import {TIMELINE} from './lib';

/**
 * 网格变形人偶（Live2D / Spine 的做法）：
 *   每个部件铺一张三角网格，网格顶点按「属于上段还是下段骨骼」加权（关节附近两边混合），
 *   骨骼转动时图片平滑弯折——肘、膝能弯，弯折处没有接缝。头、躯干、四肢仍然是 6 张图。
 *
 * 姿势用直观的量描述（与朝向无关，正值 = 往前）：
 *   lean 身体前倾 · chest 上身再前弯 · head 低头
 *   arm / arm_far: {swing 手臂往前抬的角度（0 = 自然下垂，180 = 举过头顶）, bend 肘弯曲}
 *   leg_near / leg_far: {swing 大腿往前抬, bend 膝弯曲}
 *   face: 表情（rig 里有 head_<face>.png 时生效）
 */

type V2 = [number, number];
type Part = {file: string; x: number; y: number; w: number; h: number; pivot: V2; parent: string | null; base?: {dx: number; dy: number; rot: number; pivot: V2}; shade?: number};
export type MeshRig = {
  size: V2;
  facing: 1 | -1;
  ground: number;
  order: string[];
  parts: Record<string, Part>;
  chains: Record<string, V2[]>;
  widths: Record<string, number>;
  spine: [V2, V2];
  hand?: V2;
  faces?: string[];
};
export type Limb = {swing?: number; bend?: number};
export type Body = {lean?: number; chest?: number; head?: number; arm?: Limb; arm_far?: Limb; leg_near?: Limb; leg_far?: Limb; face?: string};

const IMGSET = (TIMELINE.theme as {images?: string} | undefined)?.images ?? TIMELINE.id;
const RIGS = ((TIMELINE as unknown as {rigs?: Record<string, MeshRig>}).rigs ?? {}) as Record<string, MeshRig>;
export const meshRig = (id: string) => RIGS[id];

// ---------------------------------------------------------------- 2D 仿射
type M = [number, number, number, number, number, number]; // a b c d e f：x' = a x + c y + e，y' = b x + d y + f
const I: M = [1, 0, 0, 1, 0, 0];
const mul = (p: M, q: M): M => [p[0] * q[0] + p[2] * q[1], p[1] * q[0] + p[3] * q[1], p[0] * q[2] + p[2] * q[3], p[1] * q[2] + p[3] * q[3], p[0] * q[4] + p[2] * q[5] + p[4], p[1] * q[4] + p[3] * q[5] + p[5]];
const rotAt = (deg: number, c: V2): M => {
  const r = (deg * Math.PI) / 180;
  const cs = Math.cos(r);
  const sn = Math.sin(r);
  return [cs, sn, -sn, cs, c[0] - cs * c[0] + sn * c[1], c[1] - sn * c[0] - cs * c[1]];
};
const tr = (dx: number, dy: number): M => [1, 0, 0, 1, dx, dy];
const ap = (m: M, v: V2): V2 => [m[0] * v[0] + m[2] * v[1] + m[4], m[1] * v[0] + m[3] * v[1] + m[5]];
const ang = (a: V2, b: V2) => (Math.atan2(b[1] - a[1], b[0] - a[0]) * 180) / Math.PI;
const smooth = (e0: number, e1: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
};

// ---------------------------------------------------------------- 图片与网格（按 URL 缓存）
type Mesh = {verts: V2[]; tris: [number, number, number][]};
const imgCache = new Map<string, Promise<HTMLImageElement>>();
const meshCache = new Map<string, Mesh>();
const loadImg = (url: string) => {
  if (!imgCache.has(url)) {
    imgCache.set(
      url,
      new Promise((res, rej) => {
        const im = new Image();
        im.onload = () => res(im);
        im.onerror = rej;
        im.src = url;
      }),
    );
  }
  return imgCache.get(url)!;
};
/** 在不透明像素上铺正方形网格（每格两个三角形），顶点坐标是部件图内的像素坐标 */
const buildMesh = (url: string, im: HTMLImageElement, cell: number): Mesh => {
  const key = `${url}@${cell}`;
  const hit = meshCache.get(key);
  if (hit) return hit;
  const cv = document.createElement('canvas');
  cv.width = im.width;
  cv.height = im.height;
  const cx = cv.getContext('2d')!;
  cx.drawImage(im, 0, 0);
  const a = cx.getImageData(0, 0, im.width, im.height).data;
  const nx = Math.ceil(im.width / cell);
  const ny = Math.ceil(im.height / cell);
  const idx = new Map<number, number>();
  const verts: V2[] = [];
  const vid = (i: number, j: number) => {
    const k = j * (nx + 1) + i;
    if (!idx.has(k)) {
      idx.set(k, verts.length);
      verts.push([Math.min(i * cell, im.width), Math.min(j * cell, im.height)]);
    }
    return idx.get(k)!;
  };
  const tris: [number, number, number][] = [];
  for (let j = 0; j < ny; j++) {
    for (let i = 0; i < nx; i++) {
      let any = false;
      for (let y = j * cell; y < Math.min((j + 1) * cell, im.height) && !any; y += 3) {
        for (let x = i * cell; x < Math.min((i + 1) * cell, im.width); x += 3) {
          if (a[(y * im.width + x) * 4 + 3] > 6) {
            any = true;
            break;
          }
        }
      }
      if (!any) continue;
      const v00 = vid(i, j);
      const v10 = vid(i + 1, j);
      const v01 = vid(i, j + 1);
      const v11 = vid(i + 1, j + 1);
      tris.push([v00, v10, v11], [v00, v11, v01]);
    }
  }
  const m = {verts, tris};
  meshCache.set(key, m);
  return m;
};

/** 把源三角形 s 贴到目标三角形 d（目标往外扩 0.7px，消除三角形之间的细缝） */
const drawTri = (ctx: CanvasRenderingContext2D, im: HTMLImageElement, s: V2[], d: V2[]) => {
  const [x0, y0] = s[0];
  const [x1, y1] = s[1];
  const [x2, y2] = s[2];
  const den = x0 * (y2 - y1) - x1 * y2 + x2 * y1 + (x1 - x2) * y0;
  if (Math.abs(den) < 1e-6) return;
  const m11 = -(y0 * (d[2][0] - d[1][0]) - y1 * d[2][0] + y2 * d[1][0] + (y1 - y2) * d[0][0]) / den;
  const m12 = (y1 * d[2][1] + y0 * (d[1][1] - d[2][1]) - y2 * d[1][1] + (y2 - y1) * d[0][1]) / den;
  const m21 = (x0 * (d[2][0] - d[1][0]) - x1 * d[2][0] + x2 * d[1][0] + (x1 - x2) * d[0][0]) / den;
  const m22 = -(x1 * d[2][1] + x0 * (d[1][1] - d[2][1]) - x2 * d[1][1] + (x2 - x1) * d[0][1]) / den;
  const dx = (x0 * (y2 * d[1][0] - y1 * d[2][0]) + y0 * (x1 * d[2][0] - x2 * d[1][0]) + (x2 * y1 - x1 * y2) * d[0][0]) / den;
  const dy = (x0 * (y2 * d[1][1] - y1 * d[2][1]) + y0 * (x1 * d[2][1] - x2 * d[1][1]) + (x2 * y1 - x1 * y2) * d[0][1]) / den;
  const cxm = (d[0][0] + d[1][0] + d[2][0]) / 3;
  const cym = (d[0][1] + d[1][1] + d[2][1]) / 3;
  ctx.save();
  ctx.beginPath();
  d.forEach((p, i) => {
    const vx = p[0] - cxm;
    const vy = p[1] - cym;
    const L = Math.hypot(vx, vy) || 1;
    const q: V2 = [p[0] + (vx / L) * 0.7, p[1] + (vy / L) * 0.7];
    if (i === 0) ctx.moveTo(q[0], q[1]);
    else ctx.lineTo(q[0], q[1]);
  });
  ctx.closePath();
  ctx.clip();
  ctx.transform(m11, m12, m21, m22, dx, dy);
  ctx.drawImage(im, 0, 0);
  ctx.restore();
};

// ---------------------------------------------------------------- 骨骼求解
const COPY_OF: Record<string, string> = {arm_far: 'arm', leg_far: 'leg_near'};

/** 每个部件：两组骨骼变换（上段 A、下段 B，部件图坐标 → 角色坐标）+ 每个顶点属于 B 的权重 */
const solve = (rig: MeshRig, body: Body) => {
  const F = rig.facing;
  const [hip, neck] = rig.spine;
  const chestPt: V2 = [hip[0] + (neck[0] - hip[0]) * 0.5, hip[1] + (neck[1] - hip[1]) * 0.5];
  const Tlean = rotAt((body.lean ?? 0) * F, hip);
  const Tchest = mul(Tlean, rotAt((body.chest ?? 0) * F, chestPt));
  const hp = rig.parts.head?.pivot ?? neck;
  const Thead = mul(Tchest, rotAt((body.head ?? 0) * F, hp));
  const limb = (n: 'arm' | 'arm_far' | 'leg_near' | 'leg_far') => {
    const p = rig.parts[n];
    const src = rig.chains[COPY_OF[n] && p?.base ? COPY_OF[n] : n] ?? rig.chains[n];
    const tgt = rig.chains[n] ?? src;
    if (!p || !src) return null;
    const isLeg = n.startsWith('leg');
    const L = (body[n] ?? {}) as Limb;
    const upRest = ang(src[0], src[1]);
    const loRest = ang(src[1], src[2]);
    const upNat = ang(tgt[0], tgt[1]); // 原图里这条肢体（远侧就是远侧原来的）方向
    const upT = L.swing !== undefined ? 90 - L.swing * F : upNat;
    const relRest = loRest - upRest;
    const loT = L.bend !== undefined ? upT + (isLeg ? L.bend : -L.bend) * F : upT + relRest;
    // 上段：绕源关节转到目标角度，再平移到目标关节；下段：在上段基础上绕肘/膝再转
    const A0 = mul(tr(tgt[0][0] - src[0][0], tgt[0][1] - src[0][1]), rotAt(upT - upRest, src[0]));
    const B0 = mul(A0, rotAt(loT - upT - relRest, src[1]));
    const parent = isLeg ? Tlean : Tchest;
    const off = tr(p.x, p.y); // 部件图像素 → 角色坐标
    const A = mul(mul(parent, A0), off);
    const B = mul(mul(parent, B0), off);
    const du: V2 = [src[1][0] - src[0][0], src[1][1] - src[0][1]];
    const dl: V2 = [src[2][0] - src[1][0], src[2][1] - src[1][1]];
    const nu = Math.hypot(...du) || 1;
    const nl = Math.hypot(...dl) || 1;
    const blend = (rig.widths[COPY_OF[n] && p.base ? COPY_OF[n] : n] ?? 30) * 0.7;
    const w = (v: V2) => {
      const q: V2 = [v[0] + p.x - src[1][0], v[1] + p.y - src[1][1]];
      const s = ((q[0] * du[0] + q[1] * du[1]) / nu + (q[0] * dl[0] + q[1] * dl[1]) / nl) / 2;
      return smooth(-blend, blend, s);
    };
    const hand: V2 | null = n === 'arm' ? [(rig.hand ?? src[2])[0] - p.x, (rig.hand ?? src[2])[1] - p.y] : null;
    return {A, B, w, hand};
  };
  const torso = (() => {
    const p = rig.parts.torso;
    const off = tr(p.x, p.y);
    const sd: V2 = [neck[0] - hip[0], neck[1] - hip[1]];
    const L2 = sd[0] * sd[0] + sd[1] * sd[1] || 1;
    return {
      A: mul(Tlean, off),
      B: mul(Tchest, off),
      w: (v: V2) => smooth(0.3, 0.7, ((v[0] + p.x - hip[0]) * sd[0] + (v[1] + p.y - hip[1]) * sd[1]) / L2),
      hand: null,
    };
  })();
  const head = (() => {
    const p = rig.parts.head;
    const off = tr(p.x, p.y);
    const A = mul(Thead, off);
    return {A, B: A, w: () => 0, hand: null};
  })();
  return {torso, head, arm: limb('arm'), arm_far: limb('arm_far'), leg_near: limb('leg_near'), leg_far: limb('leg_far')} as Record<string, ReturnType<typeof limb> | typeof torso>;
};

// ---------------------------------------------------------------- 组件
export type MeshShadow = {skew: number; len: number; opacity?: number};

/**
 * 画一个人偶。坐标：组件的左上角对齐角色脚底（x, ground）；画布向四周留出足够余量。
 * rot：整个人绕脚底转（倒地）；flip：-1 = 朝向与原图相反。
 */
export const MeshPuppet: React.FC<{
  id: string;
  body: Body;
  height: number;
  flip: 1 | -1;
  rot?: number;
  lift?: number;
  filter?: string;
  shadow?: MeshShadow;
  prop?: string;
  frameKey: number;
}> = ({id, body, height, flip, rot = 0, lift = 0, filter, shadow, prop, frameKey}) => {
  const rig = RIGS[id];
  const ref = useRef<HTMLCanvasElement>(null);
  const [imgs, setImgs] = useState<Record<string, HTMLImageElement> | null>(null);
  const [handle] = useState(() => delayRender(`mesh ${id}`));
  const top = rig ? Math.min(...Object.values(rig.parts).map((p) => p.y)) : 0;
  const scale = rig ? height / (rig.ground - top) : 1;
  const W = Math.ceil((rig?.size[0] ?? 800) * scale * 2.6);
  const H = Math.ceil((rig?.size[1] ?? 1200) * scale * 1.7);
  const ox = W / 2; // 脚底在画布里的位置
  const oy = H * 0.72;
  useEffect(() => {
    if (!rig) {
      continueRender(handle);
      return;
    }
    const files = new Set<string>(Object.values(rig.parts).map((p) => p.file));
    (rig.faces ?? []).forEach((f) => files.add(`head_${f}.png`));
    const urls = [...files].map((f) => [f, staticFile(`images/${IMGSET}/rig_${id}/${f}`)] as const);
    if (prop) urls.push([prop, staticFile(`images/${IMGSET}/${prop}`)] as const);
    Promise.all(urls.map(([f, u]) => loadImg(u).then((im) => [f, im] as const)))
      .then((list) => {
        setImgs(Object.fromEntries(list));
        continueRender(handle);
      })
      .catch(() => continueRender(handle));
  }, [id, prop, rig, handle]);

  useLayoutEffect(() => {
    const cv = ref.current;
    if (!cv || !imgs || !rig) return;
    const ctx = cv.getContext('2d')!;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, W, H);
    const S = solve(rig, body);
    // 角色坐标 → 画布：以胯部 x、地面 y 为原点，缩放、左右翻转、整体绕脚底转
    const hipX = rig.spine[0][0];
    const world: M = mul(mul(mul(tr(ox, oy - lift * scale), rotAt(rot, [0, 0])), [flip * scale, 0, 0, scale, 0, 0]), tr(-hipX, -rig.ground));
    const fig = document.createElement('canvas');
    fig.width = W;
    fig.height = H;
    const fc = fig.getContext('2d')!;
    for (const name of rig.order) {
      const p = rig.parts[name];
      const sk = S[name];
      if (!p || !sk) continue;
      const file = name === 'head' && body.face && imgs[`head_${body.face}.png`] ? `head_${body.face}.png` : p.file;
      const im = imgs[file];
      if (!im) continue;
      const A = mul(world, sk.A);
      const B = mul(world, sk.B);
      fc.save();
      if (p.shade) fc.filter = `brightness(${p.shade})`;
      if (name === 'head' || (sk.A === sk.B)) {
        fc.setTransform(...A);
        fc.drawImage(im, 0, 0);
      } else {
        const mesh = buildMesh(`${id}/${file}`, im, name === 'torso' ? 28 : 18);
        const pts = mesh.verts.map((v) => {
          const t = sk.w(v);
          const a = ap(A, v);
          const b = ap(B, v);
          return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t] as V2;
        });
        for (const [i, j, k] of mesh.tris) drawTri(fc, im, [mesh.verts[i], mesh.verts[j], mesh.verts[k]], [pts[i], pts[j], pts[k]]);
      }
      fc.restore();
      // 手里的道具：跟着前臂转
      if (name === 'arm' && prop && imgs[prop] && sk.hand) {
        fc.save();
        fc.setTransform(...mul(B, tr(sk.hand[0], sk.hand[1])));
        fc.drawImage(imgs[prop], -60, -150, 120, 160);
        fc.restore();
      }
    }
    // 投影：把人物剪影压扁、斜切到地面上
    if (shadow) {
      ctx.save();
      ctx.globalAlpha = shadow.opacity ?? 0.32;
      ctx.filter = 'brightness(0) blur(5px)';
      const k = Math.tan((shadow.skew * Math.PI) / 180);
      ctx.setTransform(1, 0, -k * shadow.len, -shadow.len, k * shadow.len * oy, oy * (1 + shadow.len));
      ctx.drawImage(fig, 0, 0);
      ctx.restore();
    }
    ctx.save();
    if (filter) ctx.filter = filter;
    ctx.drawImage(fig, 0, 0);
    ctx.restore();
  }, [imgs, rig, body, W, H, ox, oy, scale, flip, rot, lift, filter, shadow, prop, frameKey]);

  if (!rig) return null;
  return <canvas ref={ref} width={W} height={H} style={{position: 'absolute', left: -ox, top: -oy}} />;
};
