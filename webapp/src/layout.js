/**
 * layout.js — 把统一 trace 会话转成「节点 + 连线」图。
 *
 * 关系：以提问为根 → 若干模型调用 → 各自的思考/工具/回答（树）。
 * 排列：分层网格，避免出现一条超长横线：
 *   - 每轮内，模型调用（含其子节点）为一「簇」；
 *   - 簇按每行最多 COLS 个排列，簇内子节点两列换行；
 *   - 轮与轮纵向堆叠；允许连线交叉。
 * 跨轮：上一轮回答 → 下一轮提问（虚线，上下文/缓存来源）。
 */
export const NODE_SIZE = {
  send: [280, 88],
  context: [222, 62],
  model: [240, 104],
  reason: [222, 78],
  tool: [240, 96],
  answer: [280, 110],
};

function nodeSize(kind) {
  return NODE_SIZE[kind] || [220, 90];
}

// 事件对象在会话增量刷新时保持引用不变：缓存 node.data，
// 让 NodeCard 的 memo 能跳过未变化节点，避免每 1.2s 全量重渲染。
const dataCache = new WeakMap();

function cachedData(kind, ev, result, turnIndex) {
  let byKind = dataCache.get(ev);
  if (!byKind) dataCache.set(ev, (byKind = new Map()));
  let d = byKind.get(kind);
  if (!d || d.result !== result || d.turnIndex !== turnIndex) {
    d = { kind, ev, result, turnIndex };
    byKind.set(kind, d);
  }
  return d;
}

export function buildGraph(session, { turnIndex } = {}) {
  const nodes = [];
  const edges = [];
  let prevTurnLast = null;
  let prevPrompt = null;

  const turns = turnIndex == null
    ? session?.turns || []
    : (session?.turns || []).filter((t) => t.index === turnIndex);

  for (const turn of turns) {
    const results = new Map();
    for (const e of turn.events || []) {
      if (e.type === 'tool-result' && e.data?.callId) results.set(e.data.callId, e);
    }

    const add = (kind, ev, parentId, result, cross) => {
      const id = `${turn.id || turn.index}-${ev.seq}`;
      nodes.push({
        id,
        type: 'tt',
        position: { x: 0, y: 0 },
        data: cachedData(kind, ev, result, turn.index),
      });
      if (parentId) {
        edges.push({
          id: `${parentId}->${id}`,
          source: parentId,
          target: id,
          type: 'smoothstep',
          data: cross ? { cross: true } : undefined,
          style: cross ? { strokeDasharray: '5 4' } : undefined,
        });
      }
      return id;
    };

    let rootId = null;
    let currentModel = null;
    let lastAnswer = null;

    const promptEv = (turn.events || []).find((e) => e.type === 'prompt');
    if (promptEv) {
      rootId = add('send', promptEv, prevTurnLast, null, !!prevTurnLast);

      // 用户提问之间的「主线」：把每次发送串起来。
      if (prevPrompt) {
        edges.push({
          id: `${prevPrompt}->${rootId}-thread`,
          source: prevPrompt,
          target: rootId,
          type: 'smoothstep',
          data: { thread: true },
          style: { stroke: 'var(--thread)', strokeWidth: 1.2 },
        });
      }
      prevPrompt = rootId;
    }

    for (const e of turn.events || []) {
      if (e.type === 'prompt') continue;

      let kind = null;
      let result = null;
      switch (e.type) {
        case 'context':
          if ((e.data?.text || '').trim()) kind = 'context';
          break;
        case 'model-call':
          kind = 'model';
          break;
        case 'reasoning':
          if ((e.data?.text || '').trim()) kind = 'reason';
          break;
        case 'tool-call':
          kind = 'tool';
          result = results.get(e.data?.callId) || null;
          break;
        case 'answer':
          if ((e.data?.text || '').trim()) kind = 'answer';
          break;
        default:
          break;
      }
      if (!kind) continue;

      let parentId = rootId;
      if (kind !== 'model' && kind !== 'context') parentId = currentModel || rootId;

      const id = add(kind, e, parentId, result, false);
      if (kind === 'model') currentModel = id;
      if (kind === 'answer') lastAnswer = id;
      if (!rootId) rootId = id;
    }

    prevTurnLast = lastAnswer || currentModel || rootId;
  }

  return { nodes, edges };
}

export function layoutGraph({ nodes, edges }, opts = {}) {
  const { expandedId = null, expandedW = 520, expandedH = 420, overrides = null } = opts;
  const sizeOf = (n) => (n.id === expandedId ? [expandedW, expandedH] : nodeSize(n.data.kind));

  const byId = new Map(nodes.map((n) => [n.id, n]));
  const childrenOf = new Map();
  const parentOf = new Map();
  for (const e of edges) {
    if (!byId.has(e.source) || !byId.has(e.target)) continue;
    if (!childrenOf.has(e.source)) childrenOf.set(e.source, []);
    childrenOf.get(e.source).push(e.target);
    parentOf.set(e.target, e.source);
  }

  const groups = new Map();
  for (const n of nodes) {
    const k = n.data.turnIndex ?? 0;
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(n);
  }

  const COLS = 4; // 每行最多几个簇
  const GAP_X = 52;
  const GAP_Y = 56;
  const CHILD_COLS = 2;
  const CHILD_W = 250;
  const CHILD_HGAP = 30;
  const CHILD_VGAP = 30;
  const PROMPT_GAP = 48;
  const TURN_GAP_X = 110;
  const TURN_GAP_Y = 110;

  const turnLayouts = [];

  for (const k of [...groups.keys()].sort((a, b) => a - b)) {
    const group = groups.get(k);
    const ids = new Set(group.map((n) => n.id));
    const parentInGroup = (id) => parentOf.has(id) && ids.has(parentOf.get(id));

    const roots = group.filter((n) => !parentInGroup(n.id));
    const prompt = roots.find((n) => n.data.kind === 'send') || null;

    const clusters = [];
    const makeCluster = (root) => ({
      root,
      children: (childrenOf.get(root.id) || [])
        .filter((id) => ids.has(id))
        .map((id) => byId.get(id)),
    });
    for (const r of roots) if (r !== prompt) clusters.push(makeCluster(r));
    if (prompt) {
      for (const id of childrenOf.get(prompt.id) || []) {
        if (ids.has(id)) clusters.push(makeCluster(byId.get(id)));
      }
    }

    // 簇内若含展开节点，则该簇子节点改为单列，避免遮挡。
    const measure = (c) => {
      const [rw, rh] = sizeOf(c.root);
      const expChild = c.children.some((ch) => ch.id === expandedId);
      const childCols = expChild ? 1 : CHILD_COLS;
      const childCellW = expChild ? Math.max(CHILD_W, expandedW) : CHILD_W;

      const rows = Math.ceil(c.children.length / childCols);
      const colsInRow = Math.min(childCols, c.children.length);
      const childW = c.children.length
        ? colsInRow * childCellW + (colsInRow - 1) * CHILD_HGAP
        : 0;

      const rowHeights = [];
      for (let r = 0; r < rows; r++) {
        const slice = c.children.slice(r * childCols, (r + 1) * childCols);
        rowHeights.push(Math.max(...slice.map((ch) => sizeOf(ch)[1])));
      }
      const childH = rows
        ? rowHeights.reduce((a, b) => a + b, 0) + (rows - 1) * CHILD_VGAP
        : 0;

      return {
        width: Math.max(rw, childW),
        height: rh + (rows ? CHILD_VGAP + childH : 0),
        rows,
        rowHeights,
        childCols,
        childCellW,
      };
    };

    const cells = clusters.map((c) => ({ c, m: measure(c) }));
    const cellW = Math.max(
      ...cells.map((x) => x.m.width),
      expandedId && ids.has(expandedId) ? expandedW : 0,
      0,
    );

    const local = [];
    const place = (node, x, y) => {
      const [w, h] = sizeOf(node);
      local.push({ node, x, y, w, h });
    };

    const gridRows = Math.ceil(cells.length / COLS) || 0;
    let cursorY = 0;

    for (let r = 0; r < gridRows; r++) {
      const row = cells.slice(r * COLS, (r + 1) * COLS);
      const rowH = Math.max(...row.map((x) => x.m.height));

      for (let j = 0; j < row.length; j++) {
        const { c, m } = row[j];
        const x = j * (cellW + GAP_X);
        const [rw, rh] = sizeOf(c.root);
        place(c.root, x + (cellW - rw) / 2, cursorY);

        let cy = cursorY + rh + CHILD_VGAP;
        for (let cr = 0; cr < m.rows; cr++) {
          const slice = c.children.slice(cr * m.childCols, (cr + 1) * m.childCols);
          for (let cj = 0; cj < slice.length; cj++) {
            const ch = slice[cj];
            const [cw] = sizeOf(ch);
            const cx = x + cj * (m.childCellW + CHILD_HGAP) + (m.childCellW - cw) / 2;
            place(ch, cx, cy);
          }
          cy += m.rowHeights[cr] + CHILD_VGAP;
        }
      }
      cursorY += rowH + GAP_Y;
    }

    const totalCols = Math.min(COLS, Math.max(1, cells.length));
    const gridWidth = cells.length ? totalCols * cellW + (totalCols - 1) * GAP_X : 0;

    if (prompt) {
      const [pw, ph] = sizeOf(prompt);
      place(prompt, gridWidth / 2 - pw / 2, -(ph + PROMPT_GAP));
    }

    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const p of local) {
      minX = Math.min(minX, p.x);
      minY = Math.min(minY, p.y);
      maxX = Math.max(maxX, p.x + p.w);
      maxY = Math.max(maxY, p.y + p.h);
    }

    turnLayouts.push({
      placements: local.map((p) => ({
        ...p,
        x: p.x - minX,
        y: p.y - minY,
      })),
      width: maxX - minX,
      height: maxY - minY,
    });
  }

  // 轮次也做网格排布，目标整体接近 16:10，避免变成一根长条。
  const maxW = Math.max(...turnLayouts.map((t) => t.width), 1);
  const totalArea = turnLayouts.reduce(
    (a, t) => a + (t.width + TURN_GAP_X) * (t.height + TURN_GAP_Y),
    0,
  );
  const MAX_ROW_W = Math.max(maxW, Math.sqrt(totalArea * 4.2));

  const positioned = [];
  let cx = 0;
  let cy = 0;
  let rowH = 0;

  for (const tl of turnLayouts) {
    if (cx > 0 && cx + tl.width > MAX_ROW_W) {
      cx = 0;
      cy += rowH + TURN_GAP_Y;
      rowH = 0;
    }
    for (const p of tl.placements) {
      positioned.push({
        ...p.node,
        position: { x: p.x + cx, y: p.y + cy },
        width: p.w,
        height: p.h,
        style: { width: p.w, height: p.h },
      });
    }
    cx += tl.width + TURN_GAP_X;
    rowH = Math.max(rowH, tl.height);
  }

  const rects = positioned.map((n) => ({
    ref: n,
    id: n.id,
    x: n.position.x,
    y: n.position.y,
    w: n.width,
    h: n.height,
  }));

  // 用户拖拽后的位置优先
  if (overrides) {
    for (const r of rects) {
      const o = overrides.get(r.id);
      if (o) {
        r.x = o.x;
        r.y = o.y;
      }
    }
  }

  // 全局防重叠：任何框都不遮挡
  resolveOverlaps(rects);
  for (const r of rects) r.ref.position = { x: r.x, y: r.y };

  return { nodes: positioned, edges };
}

/**
 * 防重叠：迭代把相交的矩形沿最小穿透方向推开，保证框与框不遮挡。
 * items: [{ id, x, y, w, h }]（就地修改）
 */
export const MIN_GAP = 30;

export function resolveOverlaps(items, { gap = MIN_GAP, iterations = 60 } = {}) {
  if (items.length < 2) return;

  for (let it = 0; it < iterations; it++) {
    const cell = 340;
    const grid = new Map();
    for (const a of items) {
      const x0 = Math.floor(a.x / cell);
      const x1 = Math.floor((a.x + a.w) / cell);
      const y0 = Math.floor(a.y / cell);
      const y1 = Math.floor((a.y + a.h) / cell);
      for (let cx = x0; cx <= x1; cx++) {
        for (let cy = y0; cy <= y1; cy++) {
          const k = cx + ',' + cy;
          let bucket = grid.get(k);
          if (!bucket) grid.set(k, (bucket = []));
          bucket.push(a);
        }
      }
    }

    const seen = new Set();
    let moved = false;

    for (const bucket of grid.values()) {
      for (let i = 0; i < bucket.length; i++) {
        for (let j = i + 1; j < bucket.length; j++) {
          const a = bucket[i];
          const b = bucket[j];
          if (a === b) continue;
          const key = a.id < b.id ? a.id + '|' + b.id : b.id + '|' + a.id;
          if (seen.has(key)) continue;
          seen.add(key);

          const ox = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x) + gap;
          const oy = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y) + gap;
          if (ox <= 0 || oy <= 0) continue;

          if (ox < oy) {
            const dir = a.x + a.w / 2 < b.x + b.w / 2 ? -1 : 1;
            const push = ox / 2;
            a.x += dir * push;
            b.x -= dir * push;
          } else {
            const dir = a.y + a.h / 2 < b.y + b.h / 2 ? -1 : 1;
            const push = oy / 2;
            a.y += dir * push;
            b.y -= dir * push;
          }
          moved = true;
        }
      }
    }

    if (!moved) break;
  }
}
