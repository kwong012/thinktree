/**
 * CanvasStage — 无 DOM 节点/边的画布渲染器。
 *
 * 目标：任意规模下都只按视口绘制。
 *  - 节点/边用 Canvas 2D，批量路径 + 视口裁剪；
 *  - 小地图单独 Canvas，缓存底图，视口变化只重绘遮罩；
 *  - 拖拽/碰撞物理直接改 ref 后重绘，不触发 React 逐节点更新；
 *  - 详情面板用单个 DOM 覆盖层，不参与画布绘制。
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import NodeDetail from './NodeDetail.jsx';
import KindIcon from './KindIcon.jsx';
import { createPhysics } from './physics.js';
import { NODE_SIZE, MIN_GAP } from '../layout.js';
import { lodFor } from '../lod.js';
import { t } from '../i18n.js';

const KIND_COLOR = {
  send: '#6871ff',
  context: '#9a9a9a',
  model: '#ca30c7',
  reason: '#ff77ff',
  tool: '#c7c400',
  answer: '#5ffa68',
};

const BG = '#000000';
const NODE_BG = '#0d0d0d';
const FOCUS = '#ff6e67';
const MIN_ZOOM = 0.02;
const MAX_ZOOM = 2.5;
const MINI_W = 390;
const MINI_H = 255;

const SANS = '"IBM Plex Sans Condensed", "Segoe UI", "Microsoft YaHei", sans-serif';
const MONO = '"IBM Plex Mono", ui-monospace, Consolas, monospace';
const REDUCED =
  typeof window !== 'undefined' &&
  window.matchMedia &&
  window.matchMedia('(prefers-reduced-motion: reduce)').matches;

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

function clip(value, n = 300) {
  const s = String(value ?? '').replace(/\s+/g, ' ').trim();
  return s.length > n ? s.slice(0, n) + '…' : s;
}

function modelLabel(m, provider) {
  if (!m?.id) return '';
  const p = m.provider || provider;
  return `${p ? p + '/' : ''}${m.id}`;
}

function fmtTime(ms) {
  try {
    return new Date(ms).toLocaleTimeString('zh-CN', { hour12: false });
  } catch {
    return '';
  }
}

function fmtTok(n) {
  if (!n) return '0';
  return n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n);
}

function fmtCost(c) {
  if (!c) return '';
  return `$${c < 0.01 ? c.toFixed(4) : c.toFixed(3)}`;
}

function titleOf(data) {
  const d = data.ev?.data || {};
  switch (data.kind) {
    case 'context':
      return d.source === 'system' ? '' : d.source || '';
    case 'model':
      return modelLabel(d.model, d.provider);
    case 'tool':
      return d.name || '';
    default:
      return '';
  }
}

function buildView(data, lang) {
  const d = data.ev?.data || {};
  const res = data.result?.data;
  const empty = t(lang, 'empty');
  const paras = [];

  switch (data.kind) {
    case 'send':
    case 'answer':
    case 'reason':
      paras.push({ text: clip(d.text, 1100) || empty, tone: 'body' });
      break;
    case 'context':
      paras.push({
        text: clip(d.text || d.notice || (d.instructionSources || []).join(', '), 700) || empty,
        tone: 'body',
      });
      break;
    case 'tool':
      paras.push({ text: clip(JSON.stringify(d.input ?? {}, null, 0), 320), tone: 'pre' });
      if (res) paras.push({ text: clip(res.output || res.status || '', 360), tone: 'out' });
      break;
    case 'model': {
      const r = d.response || {};
      if (r.reasoning) {
        paras.push({ text: `${t(lang, 'reasoning')}?${clip(r.reasoning, 240)}`, tone: 'dim' });
      }
      if (r.text) paras.push({ text: clip(r.text, 420), tone: 'body' });
      const chips = [];
      if (r.toolCalls?.length) chips.push(`${t(lang, 'toolCalls')} ×${r.toolCalls.length}`);
      chips.push(d.request?.raw ? t(lang, 'rawIO') : t(lang, 'noRawRequest'));
      paras.push({ text: chips.join(' · '), tone: 'chip' });
      break;
    }
    default:
      break;
  }

  return { title: titleOf(data), paras, foot: footOf(data, lang) };
}

function footOf(data, lang) {
  const d = data.ev?.data || {};
  const res = data.result?.data;
  const at = data.ev?.at ? fmtTime(data.ev.at) : '';
  if (data.kind === 'model') {
    const u = d.response?.usage || {};
    return `${at} · in ${fmtTok(u.input)} · out ${fmtTok(u.output)}${
      u.cacheRead ? ` · ${t(lang, 'cache')} ${fmtTok(u.cacheRead)}` : ''
    }${u.cost ? ` · ${fmtCost(u.cost)}` : ''}`;
  }
  if (data.kind === 'tool') {
    return `${at} · ${res?.status || d.kind || ''}${
      res?.durationMs != null ? ` · ${res.durationMs}ms` : ''
    }`;
  }
  return at;
}

function classifyEdge(e, nodeById, turnById, lastTurn, latestHasCache, expandedId) {
  const sourceNode = nodeById.get(e.source);
  const targetNode = nodeById.get(e.target);
  const cross = !!e.data?.cross;
  const thread = !!e.data?.thread;
  const active = (turnById.get(e.source) ?? -1) === lastTurn;
  const inLatest =
    (sourceNode?.turnIndex ?? -1) === lastTurn || (targetNode?.turnIndex ?? -1) === lastTurn;

  const contextEdge =
    (inLatest &&
      (sourceNode?.kind === 'context' ||
        targetNode?.kind === 'context' ||
        sourceNode?.kind === 'tool' ||
        targetNode?.kind === 'tool')) ||
    (cross && (targetNode?.turnIndex ?? -1) === lastTurn) ||
    (inLatest && latestHasCache && sourceNode?.kind === 'send' && targetNode?.kind === 'model');

  const focusEdge = !!(expandedId && (e.source === expandedId || e.target === expandedId));
  const color = focusEdge
    ? '#ff6e67'
    : contextEdge
      ? '#00c5c7'
      : active
        ? '#00c5c7'
        : cross
          ? '#c7c400'
          : thread
            ? '#c7c7c7'
            : '#9a9a9a';
  const width = focusEdge
    ? 2.6
    : contextEdge
      ? 2.2
      : active
        ? 2.1
        : cross
          ? 1.9
          : thread
            ? 1.9
            : 1.8;
  const dashed = cross && !contextEdge && !focusEdge;

  return {
    sourceNode,
    targetNode,
    cross,
    thread,
    active,
    contextEdge,
    focusEdge,
    color,
    width,
    dashed,
    skeleton: cross || thread || active,
  };
}

function wrapText(ctx, text, maxWidth, maxLines) {
  const out = [];
  if (!text || maxLines <= 0) return out;
  const src = String(text).slice(0, 2400);
  for (const para of src.split('\n')) {
    if (out.length >= maxLines) break;
    if (!para) {
      out.push('');
      continue;
    }
    let line = '';
    for (const ch of para) {
      const test = line + ch;
      if (line && ctx.measureText(test).width > maxWidth) {
        out.push(line);
        line = ch;
        if (out.length >= maxLines) break;
      } else {
        line = test;
      }
    }
    if (line && out.length < maxLines) out.push(line);
  }
  return out;
}

function fitText(ctx, text, maxWidth) {
  if (maxWidth <= 0) return '';
  if (ctx.measureText(text).width <= maxWidth) return text;
  let lo = 0;
  let hi = text.length;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (ctx.measureText(text.slice(0, mid) + '…').width <= maxWidth) lo = mid;
    else hi = mid - 1;
  }
  if (lo <= 0) return '';
  return text.slice(0, lo) + '…';
}

function bezier(ctx, sx, sy, tx, ty) {
  const c1 = sx + (tx - sx) * 0.25;
  const c2 = tx - (tx - sx) * 0.25;
  ctx.moveTo(sx, sy);
  ctx.bezierCurveTo(c1, sy, c2, ty, tx, ty);
}

function hashId(s) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}

function roundedRect(ctx, x, y, w, h, r) {
  if (ctx.roundRect) ctx.roundRect(x, y, w, h, Math.min(r, w / 2, h / 2));
  else ctx.rect(x, y, w, h);
}

/** ? KindIcon ????????????? */
function drawKindIcon(ctx, kind, x, y, size, color) {
  const k = size / 12;
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(k, k);
  ctx.strokeStyle = color;
  ctx.lineWidth = 1.3;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.beginPath();
  switch (kind) {
    case 'send':
      ctx.moveTo(2.4, 6); ctx.lineTo(9, 6);
      ctx.moveTo(6.6, 3.4); ctx.lineTo(9.2, 6); ctx.lineTo(6.6, 8.6);
      break;
    case 'context':
      ctx.moveTo(2.4, 3.4); ctx.lineTo(9.6, 3.4);
      ctx.moveTo(2.4, 6); ctx.lineTo(9.6, 6);
      ctx.moveTo(2.4, 8.6); ctx.lineTo(7, 8.6);
      break;
    case 'model':
      ctx.moveTo(6, 2.2); ctx.lineTo(9.8, 6); ctx.lineTo(6, 9.8); ctx.lineTo(2.2, 6); ctx.closePath();
      break;
    case 'reason':
      ctx.moveTo(6, 2.4); ctx.lineTo(6, 9.6);
      ctx.moveTo(3.1, 4.1); ctx.lineTo(8.9, 7.9);
      ctx.moveTo(8.9, 4.1); ctx.lineTo(3.1, 7.9);
      break;
    case 'tool':
      pathRect(ctx, 2.6, 2.6, 6.8, 6.8, 1.7);
      ctx.moveTo(7.05, 6); ctx.arc(6, 6, 1.05, 0, Math.PI * 2);
      break;
    case 'answer':
      ctx.moveTo(2.8, 6.3); ctx.lineTo(4.9, 8.4); ctx.lineTo(9.2, 3.7);
      break;
    default:
      ctx.moveTo(8, 6); ctx.arc(6, 6, 2, 0, Math.PI * 2);
  }
  ctx.stroke();
  ctx.restore();
}

function pathRect(ctx, x, y, w, h, r) {
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
}

function paintEdges(ctx, scene, vp, W, H, { skipAnimated, onlyAnimated, dashOffset }) {
  const z = vp.zoom;
  const groups = new Map();
  const labels = [];

  for (const e of scene.edges) {
    if (onlyAnimated && !e.animate) continue;
    if (skipAnimated && e.animate) continue;
    const s = e.sourceNode;
    const tg = e.targetNode;
    if (!s || !tg) continue;
    const sx = (s.x + s.w) * z + vp.x;
    const sy = (s.y + s.h / 2) * z + vp.y;
    const tx = tg.x * z + vp.x;
    const ty = (tg.y + tg.h / 2) * z + vp.y;
    if (Math.max(sx, tx) < 0 || Math.min(sx, tx) > W) continue;
    if (Math.max(sy, ty) < 0 || Math.min(sy, ty) > H) continue;

    const far = z < 0.16;
    const width = far ? (e.skeleton ? 1.5 : 1.2) : e.width;
    const alpha = far && !e.skeleton ? 0.7 : 1;
    const key = `${e.color}|${width}|${e.dashed ? 1 : 0}|${alpha}`;
    let group = groups.get(key);
    if (!group) {
      groups.set(key, (group = { color: e.color, width, alpha, dashed: e.dashed, segs: [] }));
    }
    group.segs.push(sx, sy, tx, ty);

    if (e.label && z >= 0.16) {
      labels.push({ text: e.label, x: (sx + tx) / 2, y: (sy + ty) / 2 });
    }
  }

  ctx.lineCap = 'round';
  for (const g of groups.values()) {
    ctx.globalAlpha = g.alpha;
    ctx.strokeStyle = g.color;
    ctx.lineWidth = g.width;
    ctx.setLineDash(g.dashed ? [5, 4] : []);
    ctx.lineDashOffset = dashOffset || 0;
    ctx.beginPath();
    for (let i = 0; i < g.segs.length; i += 4) {
      bezier(ctx, g.segs[i], g.segs[i + 1], g.segs[i + 2], g.segs[i + 3]);
    }
    ctx.stroke();
  }
  ctx.setLineDash([]);
  ctx.lineDashOffset = 0;
  ctx.globalAlpha = 1;

  if (labels.length) {
    ctx.font = `8.5px ${SANS}`;
    ctx.textBaseline = 'top';
    for (const l of labels) {
      if (l.x < -40 || l.y < -20 || l.x > W + 40 || l.y > H + 20) continue;
      const w = ctx.measureText(l.text).width;
      ctx.fillStyle = 'rgba(0,0,0,.85)';
      ctx.beginPath();
      roundedRect(ctx, l.x - w / 2 - 3, l.y - 7, w + 6, 12, 4);
      ctx.fill();
      ctx.fillStyle = '#8a8a8a';
      ctx.fillText(l.text, l.x - w / 2, l.y - 6);
    }
  }
}

function drawCard(ctx, n, vp, sx, sy, sw, sh, opts) {
  const z = vp.zoom;
  const color = KIND_COLOR[n.kind] || '#9a9a9a';
  const { lang, hovered, selected, expanded, level } = opts;
  if (!n.view || n._viewLang !== lang) {
    n.view = buildView(n.data, lang);
    n._viewLang = lang;
    n._wrap = null;
  }
  const view = n.view;
  const px = Math.max(4, 9 * z);

  ctx.save();
  ctx.beginPath();
  ctx.rect(sx, sy, sw, sh);
  ctx.clip();

  ctx.fillStyle = NODE_BG;
  ctx.fillRect(sx, sy, sw, sh);
  if (hovered) {
    ctx.fillStyle = '#181818';
    ctx.fillRect(sx, sy, sw, sh);
  } else {
    ctx.globalAlpha = 0.07;
    ctx.fillStyle = color;
    ctx.fillRect(sx, sy, sw, sh);
    ctx.globalAlpha = 1;
  }

  const barW = Math.max(1.5, 4 * z);
  ctx.fillStyle = color;
  ctx.fillRect(sx, sy, barW, sh);

  if (level >= 1) {
    const headY = sy + Math.max(3, 6 * z);
    let cx = sx + px + barW;
    const right = sx + sw - px;

    const iconSize = Math.max(8, 12 * z);
    if (cx + iconSize + 4 < right) {
      drawKindIcon(ctx, n.kind, cx, headY - 1, iconSize, color);
      cx += iconSize + 4 * z;
    }

    const kSize = Math.max(6, 8 * z);
    ctx.font = `700 ${kSize}px ${SANS}`;
    const kLabel = t(lang, `kind.${n.kind}`).toUpperCase();
    const kw = ctx.measureText(kLabel).width;
    if (kw > 0 && cx + kw + 10 < right) {
      ctx.fillStyle = color;
      ctx.globalAlpha = 0.8;
      ctx.textBaseline = 'top';
      ctx.fillText(kLabel, cx, headY + Math.max(0, 1 * z));
      ctx.globalAlpha = 1;
      cx += kw + 6 * z;
    }

    if (view.title) {
      const tSize = Math.max(7, 10.5 * z);
      ctx.font = `600 ${tSize}px ${SANS}`;
      ctx.fillStyle = '#f2f2f2';
      ctx.textBaseline = 'top';
      ctx.fillText(fitText(ctx, view.title, right - cx), cx, headY);
    }
  }

  if (level >= 2 && !expanded) {
    let y = sy + Math.max(24 * z, 6 * z + 16 * z);
    const maxW = sw - px * 2 - barW;
    const maxLines = level >= 3 ? 4 : 2;
    const key = `${level}|${Math.round(maxW / 6)}|${maxLines}|${lang}`;
    let lines;
    if (n._wrap && n._wrap.key === key) {
      lines = n._wrap.lines;
    } else {
      ctx.font = `400 ${Math.max(6, 10 * z)}px ${SANS}`;
      lines = [];
      for (const p of view.paras) {
        const remain = maxLines - lines.length;
        if (remain <= 0) break;
        for (const line of wrapText(ctx, p.text, maxW, remain)) {
          lines.push({ text: line, tone: p.tone });
        }
      }
      n._wrap = { key, lines };
    }

    for (const line of lines) {
      const size =
        line.tone === 'pre' || line.tone === 'out'
          ? Math.max(6, 9 * z)
          : line.tone === 'chip'
            ? Math.max(6, 8.5 * z)
            : Math.max(6, 10 * z);
      const lh = size * 1.45;
      if (y + lh > sy + sh - 4) break;
      ctx.font =
        line.tone === 'pre' || line.tone === 'out'
          ? `400 ${size}px ${MONO}`
          : `400 ${size}px ${SANS}`;
      ctx.fillStyle =
        line.tone === 'out'
          ? '#5ffa68'
          : line.tone === 'dim' || line.tone === 'chip'
            ? '#7f7f7f'
            : line.tone === 'pre'
              ? '#d0d0d0'
              : '#c7c7c7';
      ctx.textBaseline = 'top';
      const lx = sx + px + barW;
      if (line.tone === 'pre' || line.tone === 'out') {
        ctx.fillStyle = '#000000';
        ctx.fillRect(lx - 2, y - 1, maxW + 4, lh);
      } else if (line.tone === 'chip') {
        const cw = Math.min(maxW, ctx.measureText(line.text).width + 8);
        ctx.fillStyle = '#232323';
        ctx.beginPath();
        roundedRect(ctx, lx - 2, y - 1, cw, lh, 2);
        ctx.fill();
      }
      ctx.fillStyle =
        line.tone === 'out'
          ? '#5ffa68'
          : line.tone === 'chip'
            ? '#c7c7c7'
            : line.tone === 'dim'
              ? '#7f7f7f'
              : line.tone === 'pre'
                ? '#d0d0d0'
                : '#c7c7c7';
      ctx.fillText(line.text, lx, y);
      y += lh;
    }

    if (level >= 3 && view.foot) {
      ctx.font = `400 ${Math.max(6, 8.5 * z)}px ${SANS}`;
      ctx.fillStyle = '#7f7f7f';
      ctx.fillText(fitText(ctx, view.foot, maxW), sx + px + barW, sy + sh - 8.5 * z - 3);
    }
  }

  ctx.restore();

  if (selected || expanded) {
    ctx.strokeStyle = FOCUS;
    ctx.lineWidth = 1;
    ctx.strokeRect(sx + 0.5, sy + 0.5, sw - 1, sh - 1);
  }
}

function drawScene(ctx, scene, vp, W, H, opts) {
  const z = vp.zoom;

  if (scene.frame) {
    const f = scene.frame;
    const x = f.x * z + vp.x;
    const y = f.y * z + vp.y;
    const w = f.w * z;
    const h = f.h * z;
    ctx.strokeStyle = '#8a8a8a';
    ctx.lineWidth = 1;
    ctx.setLineDash([4, 4]);
    ctx.strokeRect(x + 0.5, y + 0.5, w, h);
    ctx.setLineDash([]);
    ctx.font = `600 ${Math.max(7, 8.5 * z)}px ${SANS}`;
    ctx.fillStyle = '#7f7f7f';
    ctx.textBaseline = 'top';
    const label = t(opts.lang, 'turnFrame').replace('{n}', (scene.frame.turnIndex ?? 0) + 1);
    const tw = ctx.measureText(label).width;
    ctx.fillStyle = BG;
    ctx.fillRect(x + 5, y - 13 * z, tw + 8, 13 * z);
    ctx.fillStyle = '#7f7f7f';
    ctx.fillText(label, x + 9, y - 12 * z);
  }

  paintEdges(ctx, scene, vp, W, H, {
    skipAnimated: opts.skipAnimated && !REDUCED,
    dashOffset: 0,
  });

  const blocks = new Map();
  const cards = [];
  for (const n of scene.nodes) {
    const sx = n.x * z + vp.x;
    const sy = n.y * z + vp.y;
    const sw = n.w * z;
    const sh = n.h * z;
    if (sx + sw < 0 || sy + sh < 0 || sx > W || sy > H) continue;
    if (sw < 60) {
      let arr = blocks.get(n.kind);
      if (!arr) blocks.set(n.kind, (arr = []));
      arr.push(sx, sy, Math.max(1, sw), Math.max(1, sh));
    } else {
      cards.push({ n, sx, sy, sw, sh });
    }
  }

  for (const [kind, rects] of blocks) {
    ctx.fillStyle = KIND_COLOR[kind] || '#9a9a9a';
    ctx.beginPath();
    for (let i = 0; i < rects.length; i += 4) {
      ctx.rect(rects[i], rects[i + 1], rects[i + 2], rects[i + 3]);
    }
    ctx.fill();
  }

  for (const c of cards) {
    const level = z >= 0.8 ? 3 : 2;
    drawCard(ctx, c.n, vp, c.sx, c.sy, c.sw, c.sh, {
      lang: opts.lang,
      hovered: opts.hoverId === c.n.id,
      selected: opts.selected.has(c.n.id),
      expanded: opts.expandedId === c.n.id,
      level,
    });
  }
}

export default function CanvasStage({
  nodes,
  edges,
  lang,
  expandedId,
  expandedW,
  expandedH,
  framedTurn,
  onFramedTurn,
  onExpand,
  onPane,
  onLod,
  physMode,
  showMini,
  overrides,
  onExpandedHeight,
  apiRef,
}) {
  const rootRef = useRef(null);
  const canvasRef = useRef(null);
  const animRef = useRef(null);
  const miniRef = useRef(null);
  const detailRef = useRef(null);

  const sceneRef = useRef({ nodes: [], nodeById: new Map(), edges: [], frame: null });
  const vpRef = useRef({ x: 0, y: 0, zoom: 1 });
  const sizeRef = useRef({ w: 1, h: 1, dpr: 1 });
  const selRef = useRef(new Set());
  const hoverRef = useRef(null);
  const dragRef = useRef(null);
  const engineRef = useRef(null);
  const engineRaf = useRef(0);
  const paintRaf = useRef(0);
  const animRaf = useRef(0);
  const camRaf = useRef(0);
  const miniBaseRef = useRef(null);
  const miniDragRef = useRef(null);
  const lastMeasureRef = useRef(0);
  const interactingRef = useRef(false);
  const initializedRef = useRef(false);
  const lodRef = useRef('near');
  const expandedRef = useRef(expandedId);
  const langRef = useRef(lang);
  const propsRef = useRef({});
  const [detailNode, setDetailNode] = useState(null);

  langRef.current = lang;
  expandedRef.current = expandedId;
  propsRef.current = {
    lang,
    expandedId,
    onFramedTurn,
    onExpand,
    onPane,
    onLod,
    physMode,
    overrides,
    framedTurn,
    onExpandedHeight,
  };

  const schedulePaint = useCallback(() => {
    if (paintRaf.current) return;
    paintRaf.current = requestAnimationFrame(() => {
      paintRaf.current = 0;
      paintRef.current();
    });
  }, []);

  const clearAnim = useCallback(() => {
    const c = animRef.current;
    if (!c) return;
    const ctx = c.getContext('2d');
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, c.width, c.height);
  }, []);

  const drawAnimated = useCallback((now) => {
    const c = animRef.current;
    if (!c) return;
    const { w, h, dpr } = sizeRef.current;
    const ctx = c.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    const scene = sceneRef.current;
    const vp = vpRef.current;
    if (!scene.edges.some((e) => e.animate)) return;
    const z = vp.zoom;
    ctx.lineCap = 'round';
    for (const e of scene.edges) {
      if (!e.animate) continue;
      const s = e.sourceNode;
      const tg = e.targetNode;
      if (!s || !tg) continue;
      const sx = (s.x + s.w) * z + vp.x;
      const sy = (s.y + s.h / 2) * z + vp.y;
      const tx = tg.x * z + vp.x;
      const ty = (tg.y + tg.h / 2) * z + vp.y;
      if (Math.max(sx, tx) < 0 || Math.min(sx, tx) > w) continue;
      if (Math.max(sy, ty) < 0 || Math.min(sy, ty) > h) continue;
      ctx.strokeStyle = e.color;
      ctx.lineWidth = z < 0.16 ? 1.5 : e.width;
      ctx.setLineDash([4, 7]);
      ctx.lineDashOffset = -(((now / 1600 + (e.phase || 0)) % 1) * 11);
      ctx.beginPath();
      bezier(ctx, sx, sy, tx, ty);
      ctx.stroke();
      if (e.label && z >= 0.16) {
        ctx.setLineDash([]);
        ctx.font = `8.5px ${SANS}`;
        ctx.textBaseline = 'top';
        const lx = (sx + tx) / 2;
        const ly = (sy + ty) / 2;
        const lw = ctx.measureText(e.label).width;
        ctx.fillStyle = 'rgba(0,0,0,.85)';
        ctx.beginPath();
        roundedRect(ctx, lx - lw / 2 - 3, ly - 7, lw + 6, 12, 4);
        ctx.fill();
        ctx.fillStyle = '#8a8a8a';
        ctx.fillText(e.label, lx - lw / 2, ly - 6);
        ctx.setLineDash([4, 7]);
      }
    }
    ctx.setLineDash([]);
    ctx.lineDashOffset = 0;
  }, []);

  const animTick = useCallback(
    (now) => {
      animRaf.current = 0;
      if (interactingRef.current || document.hidden) return;
      drawAnimated(now);
      animRaf.current = requestAnimationFrame(animTick);
    },
    [drawAnimated],
  );

  const startAnim = useCallback(() => {
    if (REDUCED || interactingRef.current) return;
    if (!sceneRef.current.edges.some((e) => e.animate)) return;
    if (animRaf.current) return;
    animRaf.current = requestAnimationFrame(animTick);
  }, [animTick]);

  const stopAnim = useCallback(() => {
    if (animRaf.current) cancelAnimationFrame(animRaf.current);
    animRaf.current = 0;
    clearAnim();
  }, [clearAnim]);

  const setInteracting = useCallback(
    (v) => {
      if (interactingRef.current === v) return;
      interactingRef.current = v;
      if (v) stopAnim();
      else startAnim();
      schedulePaint();
    },
    [schedulePaint, startAnim, stopAnim],
  );

  const emitLod = useCallback(() => {
    const l = lodFor(vpRef.current.zoom);
    if (l !== lodRef.current) {
      lodRef.current = l;
      propsRef.current.onLod?.(l);
    }
  }, []);

  const positionDetail = useCallback(() => {
    const el = detailRef.current;
    if (!el) return;
    const id = expandedRef.current;
    if (!id) return;
    const n = sceneRef.current.nodeById.get(id);
    if (!n) return;
    const vp = vpRef.current;
    el.style.left = `${n.x * vp.zoom + vp.x}px`;
    el.style.top = `${n.y * vp.zoom + vp.y}px`;
    el.style.width = `${n.w}px`;
    el.style.height = `${n.h}px`;
    el.style.transform = `scale(${vp.zoom})`;
  }, []);

  const paint = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const { w, h, dpr } = sizeRef.current;
    const ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = BG;
    ctx.fillRect(0, 0, w, h);

    const scene = sceneRef.current;
    drawScene(ctx, scene, vpRef.current, w, h, {
      lang: langRef.current,
      hoverId: hoverRef.current,
      selected: selRef.current,
      expandedId: expandedRef.current,
      skipAnimated: !interactingRef.current,
    });

    const drag = dragRef.current;
    if (drag?.kind === 'marquee' && drag.rect) {
      const r = drag.rect;
      const x = r.x0 * vpRef.current.zoom + vpRef.current.x;
      const y = r.y0 * vpRef.current.zoom + vpRef.current.y;
      const ww = (r.x1 - r.x0) * vpRef.current.zoom;
      const hh = (r.y1 - r.y0) * vpRef.current.zoom;
      ctx.fillStyle = 'rgba(0,197,199,.08)';
      ctx.fillRect(x, y, ww, hh);
      ctx.strokeStyle = 'rgba(0,197,199,.8)';
      ctx.lineWidth = 1;
      ctx.setLineDash([4, 3]);
      ctx.strokeRect(x + 0.5, y + 0.5, ww, hh);
      ctx.setLineDash([]);
    }

    positionDetail();
  }, [positionDetail]);

  const paintRef = useRef(paint);
  paintRef.current = paint;

  const drawMini = useCallback(() => {
    const mini = miniRef.current;
    const base = miniBaseRef.current;
    if (!mini || !base) return;
    const dpr = sizeRef.current.dpr;
    const ctx = mini.getContext('2d');
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, mini.width, mini.height);
    ctx.drawImage(base.canvas, 0, 0);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    const { w, h } = sizeRef.current;
    const vp = vpRef.current;
    const rx = (-vp.x / vp.zoom) * base.scale + base.ox;
    const ry = (-vp.y / vp.zoom) * base.scale + base.oy;
    const rw = (w / vp.zoom) * base.scale;
    const rh = (h / vp.zoom) * base.scale;

    ctx.fillStyle = 'rgba(0,0,0,.8)';
    ctx.beginPath();
    ctx.rect(0, 0, MINI_W, MINI_H);
    ctx.rect(rx, ry, rw, rh);
    ctx.fill('evenodd');
  }, []);

  const rebuildMini = useCallback(() => {
    const mini = miniRef.current;
    if (!mini) return;
    const list = sceneRef.current.nodes;
    const dpr = sizeRef.current.dpr;
    mini.width = Math.round(MINI_W * dpr);
    mini.height = Math.round(MINI_H * dpr);
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const n of list) {
      if (n.x < minX) minX = n.x;
      if (n.y < minY) minY = n.y;
      if (n.x + n.w > maxX) maxX = n.x + n.w;
      if (n.y + n.h > maxY) maxY = n.y + n.h;
    }
    if (!list.length || !isFinite(minX)) {
      miniBaseRef.current = null;
      return;
    }
    const pad = 10;
    const bw = Math.max(1, maxX - minX);
    const bh = Math.max(1, maxY - minY);
    const scale = Math.min((MINI_W - pad * 2) / bw, (MINI_H - pad * 2) / bh);
    const ox = (MINI_W - bw * scale) / 2 - minX * scale;
    const oy = (MINI_H - bh * scale) / 2 - minY * scale;

    const base = document.createElement('canvas');
    base.width = Math.round(MINI_W * dpr);
    base.height = Math.round(MINI_H * dpr);
    const b = base.getContext('2d');
    b.scale(dpr, dpr);
    b.fillStyle = '#0a0a0a';
    b.fillRect(0, 0, MINI_W, MINI_H);

    const groups = new Map();
    for (const n of list) {
      let rects = groups.get(n.kind);
      if (!rects) groups.set(n.kind, (rects = []));
      rects.push(
        n.x * scale + ox,
        n.y * scale + oy,
        Math.max(1.5, n.w * scale),
        Math.max(1.5, n.h * scale),
      );
    }
    for (const [kind, rects] of groups) {
      b.fillStyle = KIND_COLOR[kind] || '#9a9a9a';
      b.beginPath();
      for (let i = 0; i < rects.length; i += 4) {
        const w = rects[i + 2];
        const h = rects[i + 3];
        roundedRect(b, rects[i], rects[i + 1], w, h, Math.min(3, w / 2, h / 2));
      }
      b.fill();
    }

    miniBaseRef.current = { canvas: base, scale, ox, oy };
    drawMini();
  }, [drawMini]);

  const afterViewport = useCallback(() => {
    emitLod();
    schedulePaint();
    positionDetail();
    drawMini();
  }, [emitLod, schedulePaint, positionDetail, drawMini]);

  const cancelCamAnim = useCallback(() => {
    if (camRaf.current) cancelAnimationFrame(camRaf.current);
    camRaf.current = 0;
  }, []);

  const animateTo = useCallback(
    (target, duration = 320) => {
      cancelCamAnim();
      const start = { ...vpRef.current };
      if (!duration || REDUCED) {
        vpRef.current = { ...target };
        afterViewport();
        return;
      }
      setInteracting(true);
      const t0 = performance.now();
      const tick = (now) => {
        const p = Math.min(1, (now - t0) / duration);
        const e = 1 - Math.pow(1 - p, 3);
        vpRef.current.x = start.x + (target.x - start.x) * e;
        vpRef.current.y = start.y + (target.y - start.y) * e;
        vpRef.current.zoom = start.zoom + (target.zoom - start.zoom) * e;
        afterViewport();
        if (p < 1) {
          camRaf.current = requestAnimationFrame(tick);
        } else {
          camRaf.current = 0;
          setInteracting(false);
        }
      };
      camRaf.current = requestAnimationFrame(tick);
    },
    [afterViewport, cancelCamAnim, setInteracting],
  );

  const centerOn = useCallback(
    (n, zoom, duration = 300) => {
      const { w, h } = sizeRef.current;
      const z = clamp(zoom ?? vpRef.current.zoom, MIN_ZOOM, MAX_ZOOM);
      animateTo(
        {
          zoom: z,
          x: w / 2 - (n.x + n.w / 2) * z,
          y: h / 2 - (n.y + n.h / 2) * z,
        },
        duration,
      );
    },
    [animateTo],
  );

  const ensureInitialView = useCallback(() => {
    if (initializedRef.current) return;
    const list = sceneRef.current.nodes;
    const { w, h } = sizeRef.current;
    if (!list.length || w < 2 || h < 2) return;
    initializedRef.current = true;
    const n = list[list.length - 1];
    cancelCamAnim();
    vpRef.current = { x: w / 2 - (n.x + n.w / 2), y: h / 2 - (n.y + n.h / 2), zoom: 1 };
    afterViewport();
  }, [afterViewport, cancelCamAnim]);

  const fitAll = useCallback(() => {
    const list = sceneRef.current.nodes;
    if (!list.length) return;
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const n of list) {
      if (n.x < minX) minX = n.x;
      if (n.y < minY) minY = n.y;
      if (n.x + n.w > maxX) maxX = n.x + n.w;
      if (n.y + n.h > maxY) maxY = n.y + n.h;
    }
    const { w, h } = sizeRef.current;
    const pad = 60;
    const z = clamp(
      Math.min((w - pad * 2) / Math.max(1, maxX - minX), (h - pad * 2) / Math.max(1, maxY - minY)),
      MIN_ZOOM,
      1.2,
    );
    animateTo(
      { zoom: z, x: w / 2 - ((minX + maxX) / 2) * z, y: h / 2 - ((minY + maxY) / 2) * z },
      450,
    );
  }, [animateTo]);

  const centerLatest = useCallback(() => {
    const list = sceneRef.current.nodes;
    if (!list.length) return;
    centerOn(list[list.length - 1], 1, 450);
  }, [centerOn]);

  const jumpTo = useCallback(
    (id) => {
      const n = sceneRef.current.nodeById.get(id);
      if (n) centerOn(n, Math.max(vpRef.current.zoom, 0.9), 450);
    },
    [centerOn],
  );

  const zoomBy = useCallback(
    (factor) => {
      const { w, h } = sizeRef.current;
      const vp = vpRef.current;
      const z = clamp(vp.zoom * factor, MIN_ZOOM, MAX_ZOOM);
      const wx = (w / 2 - vp.x) / vp.zoom;
      const wy = (h / 2 - vp.y) / vp.zoom;
      animateTo({ zoom: z, x: w / 2 - wx * z, y: h / 2 - wy * z }, 200);
    },
    [animateTo],
  );

  useEffect(() => {
    if (apiRef) apiRef.current = { fitAll, centerLatest, jumpTo, zoomBy };
  }, [apiRef, fitAll, centerLatest, jumpTo, zoomBy]);

  /* ---------- sync computed graph into the canvas scene ---------- */
  useEffect(() => {
    const prevById = sceneRef.current.nodeById;
    const current = new Map();
    for (const n of nodes) {
      const kind = n.data.kind;
      const isExp = n.id === expandedId;
      const size = NODE_SIZE[kind] || [220, 90];
      const w = isExp ? expandedW : n.width || size[0];
      const h = isExp ? expandedH || 420 : n.height || size[1];
      const prev = prevById.get(n.id);
      const keep = !!prev && !!(engineRef.current || dragRef.current);
      const view = prev && prev.data === n.data ? prev.view : null;
      const wrapCache = prev && prev.data === n.data ? prev._wrap : null;
      current.set(n.id, {
        id: n.id,
        data: n.data,
        kind,
        turnIndex: n.data.turnIndex ?? 0,
        x: keep ? prev.x : n.position.x,
        y: keep ? prev.y : n.position.y,
        w,
        h,
        view,
        _wrap: wrapCache,
      });
    }

    const list = [...current.values()];
    const turnById = new Map();
    let lastTurn = 0;
    for (const n of list) {
      turnById.set(n.id, n.turnIndex);
      if (n.turnIndex > lastTurn) lastTurn = n.turnIndex;
    }
    let latestHasCache = false;
    for (const n of list) {
      if (
        n.turnIndex === lastTurn &&
        n.kind === 'model' &&
        (n.data.ev?.data?.response?.usage?.cacheRead || 0) > 0
      ) {
        latestHasCache = true;
        break;
      }
    }

    let animBudget = 40;
    const edgeViews = [];
    for (const e of edges) {
      const look = classifyEdge(e, current, turnById, lastTurn, latestHasCache, expandedId);
      if (!look.sourceNode || !look.targetNode) continue;
      const animate = (look.active || look.focusEdge) && animBudget > 0;
      if (animate) animBudget -= 1;
      edgeViews.push({
        id: e.id,
        source: e.source,
        target: e.target,
        sourceNode: look.sourceNode,
        targetNode: look.targetNode,
        color: look.color,
        width: look.width,
        dashed: look.dashed,
        animate,
        phase: (hashId(e.id) % 13) / 13,
        skeleton: look.skeleton,
        label: look.cross ? t(lang, 'contextLabel') : '',
      });
    }

    let frame = null;
    if (framedTurn != null) {
      let minX = Infinity;
      let minY = Infinity;
      let maxX = -Infinity;
      let maxY = -Infinity;
      for (const n of list) {
        if (n.turnIndex !== framedTurn) continue;
        if (n.x < minX) minX = n.x;
        if (n.y < minY) minY = n.y;
        if (n.x + n.w > maxX) maxX = n.x + n.w;
        if (n.y + n.h > maxY) maxY = n.y + n.h;
      }
      if (isFinite(minX)) {
        const pad = 26;
        frame = {
          x: minX - pad,
          y: minY - pad - 16,
          w: maxX - minX + pad * 2,
          h: maxY - minY + pad * 2 + 16,
          turnIndex: framedTurn,
        };
      }
    }

    sceneRef.current = { nodes: list, nodeById: current, edges: edgeViews, frame };
    for (const id of [...selRef.current]) if (!current.has(id)) selRef.current.delete(id);

    if (framedTurn != null) {
      const ids = new Set(list.filter((n) => n.turnIndex === framedTurn).map((n) => n.id));
      selRef.current = ids;
    }

    ensureInitialView();
    rebuildMini();
    positionDetail();
    schedulePaint();
    startAnim();
  }, [
    nodes,
    edges,
    lang,
    expandedId,
    expandedW,
    expandedH,
    framedTurn,
    ensureInitialView,
    rebuildMini,
    positionDetail,
    schedulePaint,
    startAnim,
  ]);

  const centeredExpandRef = useRef(null);
  useEffect(() => {
    if (!expandedId) {
      centeredExpandRef.current = null;
      return;
    }
    if (centeredExpandRef.current === expandedId) return;
    centeredExpandRef.current = expandedId;
    const n = sceneRef.current.nodeById.get(expandedId);
    if (!n) return;
    const { h } = sizeRef.current;
    const z = clamp(Math.min(vpRef.current.zoom, (h - 48) / Math.max(1, n.h)), 0.55, 1);
    centerOn(n, z, 300);
  }, [expandedId, centerOn]);

  useEffect(() => {
    setDetailNode(expandedId ? nodes.find((n) => n.id === expandedId) || null : null);
  }, [expandedId, nodes]);

  useEffect(() => {
    lastMeasureRef.current = 0;
  }, [expandedId]);

  useEffect(() => {
    const el = detailRef.current;
    if (!el) return undefined;
    const report = () => {
      const h = el.scrollHeight;
      if (h <= 40 || Math.abs(h - lastMeasureRef.current) < 2) return;
      lastMeasureRef.current = h;
      propsRef.current.onExpandedHeight?.(Math.min(1200, Math.max(180, h)));
    };
    report();
    const ro = new ResizeObserver(report);
    ro.observe(el);
    return () => ro.disconnect();
  }, [detailNode, lang]);

  useEffect(() => {
    if (framedTurn == null) {
      selRef.current.clear();
      schedulePaint();
    }
  }, [framedTurn, schedulePaint]);

  useEffect(() => {
    if (showMini) {
      rebuildMini();
      drawMini();
    }
  }, [showMini, rebuildMini, drawMini]);

  /* ---------- sizing ---------- */
  useEffect(() => {
    const el = rootRef.current;
    if (!el) return undefined;
    const ro = new ResizeObserver(() => {
      const rect = el.getBoundingClientRect();
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      const w = Math.max(1, Math.round(rect.width));
      const h = Math.max(1, Math.round(rect.height));
      sizeRef.current = { w, h, dpr };
      for (const c of [canvasRef.current, animRef.current]) {
        if (!c) continue;
        c.width = Math.round(w * dpr);
        c.height = Math.round(h * dpr);
      }
      const mini = miniRef.current;
      if (mini) {
        mini.width = Math.round(MINI_W * dpr);
        mini.height = Math.round(MINI_H * dpr);
      }
      rebuildMini();
      ensureInitialView();
      afterViewport();
      startAnim();
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [rebuildMini, ensureInitialView, afterViewport, startAnim]);

  /* ---------- wheel zoom ---------- */
  useEffect(() => {
    const el = canvasRef.current;
    if (!el) return undefined;
    const onWheel = (e) => {
      e.preventDefault();
      cancelCamAnim();
      setInteracting(false);
      const rect = el.getBoundingClientRect();
      const px = e.clientX - rect.left;
      const py = e.clientY - rect.top;
      const vp = vpRef.current;
      const factor = Math.exp(-e.deltaY * (e.deltaMode === 1 ? 0.05 : 0.0015));
      const z = clamp(vp.zoom * factor, MIN_ZOOM, MAX_ZOOM);
      if (z === vp.zoom) return;
      const wx = (px - vp.x) / vp.zoom;
      const wy = (py - vp.y) / vp.zoom;
      vp.zoom = z;
      vp.x = px - wx * z;
      vp.y = py - wy * z;
      afterViewport();
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [afterViewport, cancelCamAnim, setInteracting]);

  useEffect(() => {
    return () => {
      for (const r of [engineRaf, paintRaf, animRaf, camRaf]) {
        if (r.current) cancelAnimationFrame(r.current);
      }
    };
  }, []);

  /* ---------- interactions ---------- */
  const toWorld = (e) => {
    const rect = canvasRef.current.getBoundingClientRect();
    const vp = vpRef.current;
    return {
      x: (e.clientX - rect.left - vp.x) / vp.zoom,
      y: (e.clientY - rect.top - vp.y) / vp.zoom,
    };
  };

  const hitTest = (wx, wy) => {
    const list = sceneRef.current.nodes;
    for (let i = list.length - 1; i >= 0; i--) {
      const n = list[i];
      if (wx >= n.x && wx <= n.x + n.w && wy >= n.y && wy <= n.y + n.h) return n;
    }
    return null;
  };

  const startEngineLoop = () => {
    if (engineRaf.current) return;
    const tick = (now) => {
      engineRaf.current = 0;
      const eng = engineRef.current;
      if (!eng) return;
      const res = eng.step(now);
      if (res.moved.size) {
        const byId = sceneRef.current.nodeById;
        for (const [id, p] of res.moved) {
          const n = byId.get(id);
          if (n) {
            n.x = p.x;
            n.y = p.y;
          }
        }
        schedulePaint();
      }
      if (res.settled) {
        engineRef.current = null;
        if (res.touched.size) {
          const byId = sceneRef.current.nodeById;
          for (const id of res.touched) {
            const n = byId.get(id);
            if (n) propsRef.current.overrides.set(id, { x: n.x, y: n.y });
          }
        }
        drawMini();
        setInteracting(false);
        return;
      }
      engineRaf.current = requestAnimationFrame(tick);
    };
    engineRaf.current = requestAnimationFrame(tick);
  };

  const beginNodeDrag = (hit, world) => {
    const props = propsRef.current;
    let ids;
    if (selRef.current.has(hit.id)) ids = [...selRef.current];
    else if (props.framedTurn != null && hit.turnIndex === props.framedTurn) {
      ids = sceneRef.current.nodes
        .filter((n) => n.turnIndex === props.framedTurn)
        .map((n) => n.id);
    } else ids = [hit.id];

    selRef.current = new Set(ids);
    const starts = new Map();
    for (const id of ids) {
      const n = sceneRef.current.nodeById.get(id);
      if (n) starts.set(id, { x: n.x, y: n.y });
    }

    const eng = createPhysics({ mode: props.physMode, gap: MIN_GAP });
    eng.sync(
      sceneRef.current.nodes.map((n) => ({ id: n.id, x: n.x, y: n.y, w: n.w, h: n.h })),
    );
    eng.setKinematic(ids);
    engineRef.current = eng;

    dragRef.current = {
      kind: 'drag',
      ids: new Set(ids),
      starts,
      startWorld: world,
      startClient: { x: 0, y: 0 },
      last: { x: world.x, y: world.y, t: performance.now() },
      moved: false,
      nodeId: hit.id,
      pointerId: null,
    };
    setInteracting(true);
    startEngineLoop();
  };

  const onPointerDown = (e) => {
    cancelCamAnim();
    setInteracting(false);
    propsRef.current.onPane?.();
    const canvas = canvasRef.current;
    const world = toWorld(e);

    if (e.button === 1 || e.button === 2) {
      if (e.button === 2) {
        const hit = hitTest(world.x, world.y);
        if (hit && hit.kind === 'send') {
          e.preventDefault();
          const props = propsRef.current;
          props.onFramedTurn?.(props.framedTurn === hit.turnIndex ? null : hit.turnIndex);
          return;
        }
      }
      dragRef.current = {
        kind: 'pan',
        sx: e.clientX,
        sy: e.clientY,
        vx: vpRef.current.x,
        vy: vpRef.current.y,
      };
      setInteracting(true);
      canvas.setPointerCapture(e.pointerId);
      e.preventDefault();
      return;
    }

    if (e.button !== 0) return;
    const hit = hitTest(world.x, world.y);

    if (hit) {
      if (e.shiftKey || e.ctrlKey || e.metaKey) {
        const sel = selRef.current;
        if (sel.has(hit.id)) sel.delete(hit.id);
        else sel.add(hit.id);
        propsRef.current.onFramedTurn?.(null);
        schedulePaint();
        return;
      }
      const props = propsRef.current;
      if (props.framedTurn != null && hit.turnIndex !== props.framedTurn) {
        props.onFramedTurn?.(null);
      }
      beginNodeDrag(hit, world);
      if (canvas) canvas.style.cursor = 'grabbing';
      dragRef.current.startClient = { x: e.clientX, y: e.clientY };
      dragRef.current.pointerId = e.pointerId;
      canvas.setPointerCapture(e.pointerId);
    } else {
      dragRef.current = {
        kind: 'marquee',
        startClient: { x: e.clientX, y: e.clientY },
        x0: world.x,
        y0: world.y,
        x1: world.x,
        y1: world.y,
        rect: null,
        add: e.shiftKey,
        moved: false,
      };
      if (!e.shiftKey) selRef.current.clear();
      canvas.setPointerCapture(e.pointerId);
    }
    schedulePaint();
  };

  const onPointerMove = (e) => {
    const drag = dragRef.current;
    if (!drag) {
      const now = performance.now();
      if (now - (onPointerMove._last || 0) < 45) return;
      onPointerMove._last = now;
      const world = toWorld(e);
      const hit = hitTest(world.x, world.y);
      const id = hit ? hit.id : null;
      const canvas = canvasRef.current;
      if (canvas) {
        canvas.style.cursor = hit ? 'pointer' : 'default';
        canvas.title = hit && hit.kind === 'send' ? t(langRef.current, 'sendHint') : '';
      }
      if (id !== hoverRef.current) {
        hoverRef.current = id;
        schedulePaint();
      }
      return;
    }

    if (drag.kind === 'pan') {
      vpRef.current.x = drag.vx + (e.clientX - drag.sx);
      vpRef.current.y = drag.vy + (e.clientY - drag.sy);
      schedulePaint();
      drawMini();
      positionDetail();
      return;
    }

    if (drag.kind === 'marquee') {
      const world = toWorld(e);
      drag.x1 = world.x;
      drag.y1 = world.y;
      drag.rect = {
        x0: Math.min(drag.x0, drag.x1),
        y0: Math.min(drag.y0, drag.y1),
        x1: Math.max(drag.x0, drag.x1),
        y1: Math.max(drag.y0, drag.y1),
      };
      drag.moved =
        Math.abs(e.clientX - drag.startClient.x) > 3 ||
        Math.abs(e.clientY - drag.startClient.y) > 3;
      schedulePaint();
      return;
    }

    if (drag.kind === 'drag') {
      const world = toWorld(e);
      const now = performance.now();
      const dx = world.x - drag.startWorld.x;
      const dy = world.y - drag.startWorld.y;
      if (
        Math.abs(e.clientX - drag.startClient.x) > 3 ||
        Math.abs(e.clientY - drag.startClient.y) > 3
      ) {
        drag.moved = true;
      }
      const dt = Math.max(8, now - drag.last.t) / 1000;
      const vx = clamp((world.x - drag.last.x) / dt, -1600, 1600);
      const vy = clamp((world.y - drag.last.y) / dt, -1600, 1600);

      const moves = new Map();
      for (const id of drag.ids) {
        const s = drag.starts.get(id);
        const n = sceneRef.current.nodeById.get(id);
        if (!s || !n) continue;
        n.x = s.x + dx;
        n.y = s.y + dy;
        moves.set(id, { x: n.x, y: n.y, vx, vy });
      }
      engineRef.current?.moveKinematic(moves);
      drag.last = { x: world.x, y: world.y, t: now };
      schedulePaint();
      drawMini();
      positionDetail();
    }
  };

  const finishMarquee = (drag) => {
    if (drag.moved && drag.rect) {
      const r = drag.rect;
      const picked = new Set(drag.add ? selRef.current : []);
      for (const n of sceneRef.current.nodes) {
        if (n.x + n.w >= r.x0 && n.x <= r.x1 && n.y + n.h >= r.y0 && n.y <= r.y1) {
          picked.add(n.id);
        }
      }
      selRef.current = picked;
      propsRef.current.onFramedTurn?.(null);
    } else {
      selRef.current.clear();
      propsRef.current.onExpand?.(null);
      propsRef.current.onFramedTurn?.(null);
      propsRef.current.onPane?.();
    }
    schedulePaint();
  };

  const onPointerUp = (e) => {
    const drag = dragRef.current;
    if (!drag) return;
    dragRef.current = null;
    const canvas = canvasRef.current;
    if (canvas?.hasPointerCapture(e.pointerId)) canvas.releasePointerCapture(e.pointerId);
    if (canvas) canvas.style.cursor = 'default';

    if (drag.kind === 'marquee') {
      finishMarquee(drag);
      return;
    }
    if (drag.kind === 'pan') {
      setInteracting(false);
      afterViewport();
      return;
    }

    if (drag.kind === 'drag') {
      if (drag.moved) {
        engineRef.current?.release(drag.ids);
        startEngineLoop();
      } else {
        engineRef.current = null;
        setInteracting(false);
        const props = propsRef.current;
        const hit = sceneRef.current.nodeById.get(drag.nodeId);
        if (hit) {
          if (props.framedTurn != null && hit.turnIndex === props.framedTurn && hit.kind !== 'send') {
            props.onFramedTurn?.(props.framedTurn);
          } else {
            props.onExpand?.(props.expandedId === hit.id ? null : hit.id);
          }
        }
        schedulePaint();
      }
    }
  };

  const onDoubleClick = (e) => {
    if (e.target !== canvasRef.current) return;
    centerLatest();
  };

  const miniNavigate = (e) => {
    const mini = miniRef.current;
    const base = miniBaseRef.current;
    if (!mini || !base) return null;
    const rect = mini.getBoundingClientRect();
    const wx = (e.clientX - rect.left - base.ox) / base.scale;
    const wy = (e.clientY - rect.top - base.oy) / base.scale;
    const { w, h } = sizeRef.current;
    const vp = vpRef.current;
    return { zoom: vp.zoom, x: w / 2 - wx * vp.zoom, y: h / 2 - wy * vp.zoom };
  };

  const onMiniPointer = (e, down) => {
    const mini = miniRef.current;
    if (!mini || !miniBaseRef.current) return;
    if (e.type === 'pointerdown') {
      miniDragRef.current = { x: e.clientX, y: e.clientY, moved: false };
      mini.setPointerCapture(e.pointerId);
      return;
    }
    const st = miniDragRef.current;
    if (!st) return;
    if (e.type === 'pointermove') {
      if (Math.abs(e.clientX - st.x) + Math.abs(e.clientY - st.y) > 4) st.moved = true;
      if (st.moved) {
        const target = miniNavigate(e);
        if (target) animateTo(target, 0);
      }
      return;
    }
    const target = miniNavigate(e);
    if (target) animateTo(target, st.moved ? 0 : 300);
    miniDragRef.current = null;
    if (mini.hasPointerCapture(e.pointerId)) mini.releasePointerCapture(e.pointerId);
  };

  const onMiniWheel = (e) => {
    e.preventDefault();
    cancelCamAnim();
    setInteracting(false);
    const mini = miniRef.current;
    const base = miniBaseRef.current;
    if (!mini || !base) return;
    const rect = mini.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;
    const wx = (mx - base.ox) / base.scale;
    const wy = (my - base.oy) / base.scale;
    const vp = vpRef.current;
    const factor = Math.exp(-e.deltaY * 0.0015);
    vp.zoom = clamp(vp.zoom * factor, MIN_ZOOM, MAX_ZOOM);
    const { w, h } = sizeRef.current;
    vp.x = w / 2 - wx * vp.zoom;
    vp.y = h / 2 - wy * vp.zoom;
    afterViewport();
  };

  const detailKind = detailNode?.data?.kind || 'context';

  return (
    <div className="canvas-stage-root" ref={rootRef}>
      <canvas
        ref={canvasRef}
        className="stage-canvas"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onPointerLeave={() => {
          if (canvasRef.current) canvasRef.current.title = '';
          if (hoverRef.current) {
            hoverRef.current = null;
            schedulePaint();
          }
        }}
        onDoubleClick={onDoubleClick}
        onContextMenu={(e) => e.preventDefault()}
      />
      <canvas ref={animRef} className="stage-canvas stage-anim" />
      <div className="canvas-controls">
        <button onClick={() => zoomBy(1.25)} title="Zoom in" aria-label="Zoom in">
          +
        </button>
        <button onClick={() => zoomBy(0.8)} title="Zoom out" aria-label="Zoom out">
          ?
        </button>
        <button onClick={() => fitAll()} title={t(lang, 'fitAll')} aria-label={t(lang, 'fitAll')}>
          <svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true">
            <path
              d="M6 2H2v4M10 2h4v4M6 14H2v-4M10 14h4v-4"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.3"
              strokeLinecap="round"
            />
          </svg>
        </button>
      </div>
      {detailNode ? (
        <div
          ref={detailRef}
          className="canvas-detail"
          style={{ '--c': KIND_COLOR[detailKind] || '#9a9a9a' }}
          onWheel={(e) => e.stopPropagation()}
        >
          <div className="tthead">
            <span className="tticon" style={{ color: KIND_COLOR[detailKind] || '#9a9a9a' }}>
              <KindIcon kind={detailKind} />
            </span>
            <span className="ttkind">{t(lang, `kind.${detailKind}`)}</span>
            <span className="tttitle">{titleOf(detailNode.data)}</span>
          </div>
          <NodeDetail data={detailNode.data} lang={lang} />
        </div>
      ) : null}
      {showMini ? (
        <canvas
          ref={miniRef}
          className="tt-minimap-canvas"
          onPointerDown={(e) => onMiniPointer(e, true)}
          onPointerMove={(e) => {
            if (e.buttons === 1) onMiniPointer(e, true);
          }}
          onPointerUp={(e) => onMiniPointer(e, false)}
          onWheel={onMiniWheel}
        />
      ) : null}
    </div>
  );
}
