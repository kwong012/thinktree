/**
 * physics.js — 拖动碰撞的轻量物理求解（无 React 依赖）。
 *
 * 大规模优化：只积分/检测「醒着」的节点。
 *  - 全量节点只建一次空间索引，拖动时几乎不遍历全图；
 *  - 被拖节点撞到谁，谁才被唤醒，链式传播；
 *  - 速度衰减到阈值即休眠，整场静止后引擎停止。
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
  const maxAwake = opts.maxAwake ?? 800;

  const bodies = new Map();
  const awake = new Set();
  const touched = new Set();
  const grid = new Map();
  let lastTime = 0;
  let released = false;

  function cellRange(b) {
    const x0 = Math.floor(b.x / cell);
    const x1 = Math.floor((b.x + b.w) / cell);
    const y0 = Math.floor(b.y / cell);
    const y1 = Math.floor((b.y + b.h) / cell);
    const keys = [];
    for (let cx = x0; cx <= x1; cx++) {
      for (let cy = y0; cy <= y1; cy++) keys.push(cx + ',' + cy);
    }
    return keys;
  }

  function index(b) {
    const keys = cellRange(b);
    b._keys = keys;
    for (const k of keys) {
      let bucket = grid.get(k);
      if (!bucket) grid.set(k, (bucket = []));
      bucket.push(b);
    }
  }

  function reindex(b) {
    if (!b._keys) {
      index(b);
      return;
    }
    const keys = cellRange(b);
    if (keys.length === b._keys.length && keys.every((k, i) => k === b._keys[i])) return;
    b._keys = keys;
    for (const k of keys) {
      let bucket = grid.get(k);
      if (!bucket) grid.set(k, (bucket = []));
      bucket.push(b);
    }
  }

  function sync(items) {
    bodies.clear();
    awake.clear();
    touched.clear();
    grid.clear();
    for (const it of items) {
      const b = {
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
        spring: false,
        _keys: null,
      };
      bodies.set(it.id, b);
      index(b);
    }
    lastTime = 0;
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
      awake.add(id);
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
      reindex(b);
      awake.add(id);
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
      awake.add(id);
      touched.add(id);
    }
    for (const b of bodies.values()) {
      if (b.spring && awake.size < maxAwake) awake.add(b.id);
    }
    lastTime = 0;
  }

  function integrate(h) {
    for (const id of awake) {
      const b = bodies.get(id);
      if (!b || b.kinematic) continue;
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
    for (const id of awake) {
      const b = bodies.get(id);
      if (b && !b.kinematic) reindex(b);
    }
  }

  function collide(applyImpulse) {
    const seen = new Set();
    const ids = [...awake];
    for (const id of ids) {
      const a = bodies.get(id);
      if (!a) continue;
      const x0 = Math.floor((a.x - gap) / cell);
      const x1 = Math.floor((a.x + a.w + gap) / cell);
      const y0 = Math.floor((a.y - gap) / cell);
      const y1 = Math.floor((a.y + a.h + gap) / cell);

      for (let cx = x0; cx <= x1; cx++) {
        for (let cy = y0; cy <= y1; cy++) {
          const bucket = grid.get(cx + ',' + cy);
          if (!bucket) continue;
          for (let bi = 0; bi < bucket.length; bi++) {
            const b = bucket[bi];
            if (b === a) continue;
            const bAwake = awake.has(b.id);
            if (bAwake) {
              const key = a.id < b.id ? a.id + '|' + b.id : b.id + '|' + a.id;
              if (seen.has(key)) continue;
              seen.add(key);
            }

            const acx = a.x + a.w / 2;
            const acy = a.y + a.h / 2;
            const bcx = b.x + b.w / 2;
            const bcy = b.y + b.h / 2;
            const ox = (a.w + b.w) / 2 + gap - Math.abs(acx - bcx);
            const oy = (a.h + b.h) / 2 + gap - Math.abs(acy - bcy);
            if (ox <= 0 || oy <= 0) continue;

            if (!bAwake && awake.size < maxAwake) awake.add(b.id);
            awake.add(a.id);

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

            if (b.kinematic) {
              a.x -= nx * ov;
              a.y -= ny * ov;
              a.spring = mode === 'return';
              touched.add(a.id);
            } else if (a.kinematic) {
              b.x += nx * ov;
              b.y += ny * ov;
              b.spring = mode === 'return';
              touched.add(b.id);
            } else {
              a.x -= (nx * ov) / 2;
              a.y -= (ny * ov) / 2;
              b.x += (nx * ov) / 2;
              b.y += (ny * ov) / 2;
              if (mode === 'return') {
                a.spring = true;
                b.spring = true;
              }
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
  }

  function step(now) {
    if (!bodies.size) return { moved: new Map(), settled: true, touched };

    let dt = lastTime ? (now - lastTime) / 1000 : 1 / 60;
    lastTime = now;
    if (!(dt > 0)) dt = 1 / 60;
    if (dt > 0.1) dt = 0.1;

    const steps = Math.min(4, Math.max(1, Math.ceil(dt / (1 / 90))));
    const h = dt / steps;
    for (let s = 0; s < steps; s++) {
      integrate(h);
      for (let k = 0; k < iterations; k++) collide(k === 0);
    }

    const moved = new Map();
    for (const id of awake) {
      const b = bodies.get(id);
      if (!b) continue;
      if (b.kinematic) continue;
      moved.set(id, { x: b.x, y: b.y });
      const speed = Math.abs(b.vx) + Math.abs(b.vy);
      const far =
        b.spring && released && Math.abs(b.homeX - b.x) + Math.abs(b.homeY - b.y) > 1;
      if (speed < stopSpeed && !far) awake.delete(id);
    }

    return { moved, settled: awake.size === 0, touched };
  }

  return { sync, setKinematic, moveKinematic, release, step };
}
