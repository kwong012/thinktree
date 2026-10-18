/**
 * physics.js — 拖动碰撞的轻量物理求解（无 React 依赖）。
 *
 * 拖拽节点作为 kinematic 刚体，其余节点为 dynamic：
 * 碰撞时按最小穿透轴分离，并按相对速度施加反弹冲量。
 *
 * mode:
 *   stay   — 被撞开的节点停在推开后的位置，靠阻尼滑停。
 *   return — 被撞开的节点带弹性回到拖动前的位置；拖拽节点留在落点。
 */

const clamp = (v, m) => (v > m ? m : v < -m ? -m : v);

export function createPhysics(opts = {}) {
  const mode = opts.mode || 'stay';
  const gap = opts.gap ?? 30;
  const restitution = opts.restitution ?? 0.34;
  const cell = opts.cell ?? 360;
  const iterations = opts.iterations ?? 2;
  const damping = opts.damping ?? (mode === 'return' ? 3 : 4.5);
  const springK = opts.springK ?? 90;
  const springC = opts.springC ?? 14;
  const maxSpeed = opts.maxSpeed ?? 1600;
  const stopSpeed = opts.stopSpeed ?? 4;
  const idleLimit = opts.idleMs ?? 130;

  const bodies = new Map();
  const touched = new Set();
  let lastTime = 0;
  let idleMs = 0;
  let released = false;

  function sync(items) {
    bodies.clear();
    touched.clear();
    for (const it of items) {
      bodies.set(it.id, {
        id: it.id,
        x: it.x,
        y: it.y,
        vx: 0,
        vy: 0,
        w: it.w,
        h: it.h,
        homeX: it.x,
        homeY: it.y,
        kinematic: false,
        spring: mode === 'return',
      });
    }
    lastTime = 0;
    idleMs = 0;
    released = false;
  }

  function setKinematic(ids) {
    released = false;
    for (const id of ids) {
      const b = bodies.get(id);
      if (!b) continue;
      b.kinematic = true;
      b.spring = false;
      b.vx = 0;
      b.vy = 0;
      touched.add(id);
    }
  }

  function moveKinematic(map) {
    for (const [id, p] of map) {
      const b = bodies.get(id);
      if (!b) continue;
      b.x = p.x;
      b.y = p.y;
      b.vx = p.vx || 0;
      b.vy = p.vy || 0;
      touched.add(id);
    }
  }

  function release(ids) {
    released = true;
    for (const id of ids) {
      const b = bodies.get(id);
      if (!b) continue;
      b.kinematic = false;
      b.spring = false;
      touched.add(id);
    }
    lastTime = 0;
    idleMs = 0;
  }

  function integrate(h) {
    for (const b of bodies.values()) {
      if (b.kinematic) continue;
      if (b.spring && released) {
        b.vx += (springK * (b.homeX - b.x) - springC * b.vx) * h;
        b.vy += (springK * (b.homeY - b.y) - springC * b.vy) * h;
      }
      const damp = Math.exp(-damping * h);
      b.vx = clamp(b.vx * damp, maxSpeed);
      b.vy = clamp(b.vy * damp, maxSpeed);
      b.x += b.vx * h;
      b.y += b.vy * h;
    }
  }

  function collide(applyImpulse) {
    const grid = new Map();
    for (const b of bodies.values()) {
      const x0 = Math.floor((b.x - gap) / cell);
      const x1 = Math.floor((b.x + b.w + gap) / cell);
      const y0 = Math.floor((b.y - gap) / cell);
      const y1 = Math.floor((b.y + b.h + gap) / cell);
      for (let cx = x0; cx <= x1; cx++) {
        for (let cy = y0; cy <= y1; cy++) {
          const k = cx + ',' + cy;
          let bucket = grid.get(k);
          if (!bucket) grid.set(k, (bucket = []));
          bucket.push(b);
        }
      }
    }

    const seen = new Set();
    for (const bucket of grid.values()) {
      for (let i = 0; i < bucket.length; i++) {
        for (let j = i + 1; j < bucket.length; j++) {
          const a = bucket[i];
          const b = bucket[j];
          if (a === b) continue;
          if (a.kinematic && b.kinematic) continue;
          const key = a.id < b.id ? a.id + '|' + b.id : b.id + '|' + a.id;
          if (seen.has(key)) continue;
          seen.add(key);

          const acx = a.x + a.w / 2;
          const acy = a.y + a.h / 2;
          const bcx = b.x + b.w / 2;
          const bcy = b.y + b.h / 2;
          const ox = (a.w + b.w) / 2 + gap - Math.abs(acx - bcx);
          const oy = (a.h + b.h) / 2 + gap - Math.abs(acy - bcy);
          if (ox <= 0 || oy <= 0) continue;

          let nx = 0;
          let ny = 0;
          let ov;
          if (ox < oy) {
            ov = ox;
            nx = acx < bcx ? 1 : -1;
          } else {
            ov = oy;
            ny = acy < bcy ? 1 : -1;
          }

          // 分离：kinematic 不动，dynamic 让位。
          if (b.kinematic) {
            a.x -= nx * ov;
            a.y -= ny * ov;
            touched.add(a.id);
          } else if (a.kinematic) {
            b.x += nx * ov;
            b.y += ny * ov;
            touched.add(b.id);
          } else {
            a.x -= (nx * ov) / 2;
            a.y -= (ny * ov) / 2;
            b.x += (nx * ov) / 2;
            b.y += (ny * ov) / 2;
            touched.add(a.id);
            touched.add(b.id);
          }

          if (applyImpulse) {
            const rv = (b.vx - a.vx) * nx + (b.vy - a.vy) * ny;
            if (rv < 0) {
              const j = -(1 + restitution) * rv;
              if (b.kinematic) {
                a.vx -= nx * j;
                a.vy -= ny * j;
              } else if (a.kinematic) {
                b.vx += nx * j;
                b.vy += ny * j;
              } else {
                a.vx -= (nx * j) / 2;
                a.vy -= (ny * j) / 2;
                b.vx += (nx * j) / 2;
                b.vy += (ny * j) / 2;
              }
            }
          }

          // 弹回途中撞上“不再弹回”的节点：放弃回家，避免反复抖动。
          if (released && mode === 'return') {
            if (a.spring && !b.spring) a.spring = false;
            if (b.spring && !a.spring) b.spring = false;
          }
        }
      }
    }
  }

  function step(now) {
    if (!bodies.size) return { moved: new Map(), settled: true, touched };

    let dt = lastTime ? (now - lastTime) / 1000 : 1 / 60;
    lastTime = now;
    if (!(dt > 0)) dt = 1 / 60;
    if (dt > 0.1) dt = 0.1;

    const before = new Map();
    for (const b of bodies.values()) {
      if (!b.kinematic) before.set(b.id, [b.x, b.y]);
    }

    const steps = Math.min(4, Math.max(1, Math.ceil(dt / (1 / 90))));
    const h = dt / steps;
    for (let s = 0; s < steps; s++) {
      integrate(h);
      for (let k = 0; k < iterations; k++) collide(k === 0);
    }

    const moved = new Map();
    let maxSpeed = 0;
    let anyKinematic = false;
    for (const b of bodies.values()) {
      if (b.kinematic) {
        anyKinematic = true;
        continue;
      }
      const p = before.get(b.id);
      if (p && (Math.abs(b.x - p[0]) > 0.01 || Math.abs(b.y - p[1]) > 0.01)) {
        touched.add(b.id);
        moved.set(b.id, { x: b.x, y: b.y });
      }
      const sp = Math.abs(b.vx) + Math.abs(b.vy);
      if (sp > maxSpeed) maxSpeed = sp;
    }

    if (maxSpeed < stopSpeed) idleMs += dt * 1000;
    else idleMs = 0;

    return { moved, settled: !anyKinematic && idleMs >= idleLimit, touched };
  }

  return { sync, setKinematic, moveKinematic, release, step, bodies: () => bodies };
}
