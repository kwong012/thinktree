import React, { useContext, useEffect, useMemo, useRef, useState } from 'react';
import {
  ReactFlow,
  ReactFlowProvider,
  Controls,
  MiniMap,
  useNodesState,
  useEdgesState,
  useReactFlow,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import NodeCard from './NodeCard.jsx';
import FlowEdge from './FlowEdge.jsx';
import TurnFrame from './TurnFrame.jsx';
import DesignTree from './DesignTree.jsx';
import { LodCtx, LangCtx, ExpandCtx } from './context.js';
import { buildGraph, layoutGraph, NODE_SIZE, MIN_GAP } from '../layout.js';
import { lodFor } from '../lod.js';
import { t } from '../i18n.js';

const nodeTypes = { tt: NodeCard, turnframe: TurnFrame };
const edgeTypes = { tt: FlowEdge };
const LOD_KEY = { far: 'lodFar', mid: 'lodMid', near: 'lodNear' };

const EXPANDED_W = 520;

const MINI_COLOR = {
  send: '#6871ff',
  context: '#9a9a9a',
  model: '#ca30c7',
  reason: '#ff77ff',
  tool: '#c7c400',
  answer: '#5ffa68',
};

const EDGE_COLOR = {
  focus: '#ff6e67',
  context: '#00c5c7',
  active: '#00c5c7',
  cross: '#c7c400',
  thread: '#c7c7c7',
  base: '#9a9a9a',
};

function classifyEdge(e, nodeById, turnById, lastTurn, latestHasCache, expandedId) {
  const sourceNode = nodeById.get(e.source);
  const targetNode = nodeById.get(e.target);
  const cross = !!e.data?.cross;
  const thread = !!e.data?.thread;
  const active = (turnById.get(e.source) ?? -1) === lastTurn;
  const inLatest =
    (sourceNode?.data.turnIndex ?? -1) === lastTurn ||
    (targetNode?.data.turnIndex ?? -1) === lastTurn;

  const contextEdge =
    (inLatest &&
      (sourceNode?.data.kind === 'context' ||
        targetNode?.data.kind === 'context' ||
        sourceNode?.data.kind === 'tool' ||
        targetNode?.data.kind === 'tool')) ||
    (cross && (targetNode?.data.turnIndex ?? -1) === lastTurn) ||
    (inLatest &&
      latestHasCache &&
      sourceNode?.data.kind === 'send' &&
      targetNode?.data.kind === 'model');

  const focusEdge = !!(expandedId && (e.source === expandedId || e.target === expandedId));
  const color = focusEdge
    ? EDGE_COLOR.focus
    : contextEdge
      ? EDGE_COLOR.context
      : active
        ? EDGE_COLOR.active
        : cross
          ? EDGE_COLOR.cross
          : thread
            ? EDGE_COLOR.thread
            : EDGE_COLOR.base;
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

function estimateExpandedHeight(data) {
  const d = data.ev?.data || {};
  const res = data.result?.data;
  const len = (s) => (s == null ? 0 : typeof s === 'string' ? s.length : JSON.stringify(s).length);
  let chars = 0;
  if (data.kind === 'model') {
    chars = len(d.response?.reasoning) + len(d.response?.text) + len(d.request);
  } else if (data.kind === 'tool') {
    chars = len(d.input) + len(res?.output);
  } else {
    chars = len(d.text || d.notice);
  }
  return Math.min(900, 180 + Math.ceil(chars / 60) * 16);
}

export default function GraphCanvas({ session, onRefresh, refreshing }) {
  return (
    <ReactFlowProvider>
      <Inner session={session} onRefresh={onRefresh} refreshing={refreshing} />
    </ReactFlowProvider>
  );
}

function FarCanvas({ nodes, edges, expandedId }) {
  const rf = useReactFlow();
  const ref = useRef(null);

  const scene = useMemo(() => {
    const nodeById = new Map(nodes.map((n) => [n.id, n]));
    const turnById = new Map(nodes.map((n) => [n.id, n.data?.turnIndex ?? 0]));
    let lastTurn = 0;
    for (const n of nodes) lastTurn = Math.max(lastTurn, n.data?.turnIndex ?? 0);
    let latestHasCache = false;
    for (const n of nodes) {
      if (
        (n.data?.turnIndex ?? 0) === lastTurn &&
        n.data?.kind === 'model' &&
        (n.data?.ev?.data?.response?.usage?.cacheRead || 0) > 0
      ) {
        latestHasCache = true;
        break;
      }
    }

    const nodeGroups = new Map();
    for (const n of nodes) {
      const kind = n.data?.kind || 'context';
      let list = nodeGroups.get(kind);
      if (!list) nodeGroups.set(kind, (list = []));
      const size = NODE_SIZE[kind] || [220, 90];
      list.push({
        x: n.position.x,
        y: n.position.y,
        w: n.width || size[0],
        h: n.height || size[1],
      });
    }

    const edgeGroups = new Map();
    for (const e of edges) {
      const look = classifyEdge(e, nodeById, turnById, lastTurn, latestHasCache, expandedId);
      const s = look.sourceNode;
      const t = look.targetNode;
      if (!s || !t) continue;
      const sx = s.position.x + (s.width || 220) / 2;
      const sy = s.position.y + (s.height || 90) / 2;
      const tx = t.position.x + (t.width || 220) / 2;
      const ty = t.position.y + (t.height || 90) / 2;
      const key = `${look.color}|${look.dashed ? 1 : 0}|${look.skeleton ? 1 : 0}`;
      let group = edgeGroups.get(key);
      if (!group) {
        edgeGroups.set(
          key,
          (group = { color: look.color, dashed: look.dashed, skeleton: look.skeleton, segs: [] }),
        );
      }
      group.segs.push(sx, sy, tx, ty);
    }

    return { nodeGroups, edgeGroups };
  }, [nodes, edges, expandedId]);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return undefined;
    const ctx = canvas.getContext('2d');
    let raf = 0;
    let last = '';
    let cw = 0;
    let ch = 0;

    const draw = (vp) => {
      const rect = canvas.parentElement.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      const W = Math.max(1, Math.round(rect.width));
      const H = Math.max(1, Math.round(rect.height));
      if (W !== cw || H !== ch) {
        cw = W;
        ch = H;
        canvas.width = Math.round(W * dpr);
        canvas.height = Math.round(H * dpr);
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, W, H);
      const z = vp.zoom;

      ctx.lineCap = 'round';
      for (const group of scene.edgeGroups.values()) {
        ctx.globalAlpha = group.skeleton ? 1 : 0.7;
        ctx.strokeStyle = group.color;
        ctx.lineWidth = group.skeleton ? 1.5 : 1.2;
        ctx.setLineDash(group.dashed ? [4, 4] : []);
        ctx.beginPath();
        for (let i = 0; i < group.segs.length; i += 4) {
          const x1 = group.segs[i] * z + vp.x;
          const y1 = group.segs[i + 1] * z + vp.y;
          const x2 = group.segs[i + 2] * z + vp.x;
          const y2 = group.segs[i + 3] * z + vp.y;
          if ((x1 < 0 && x2 < 0) || (y1 < 0 && y2 < 0) || (x1 > W && x2 > W) || (y1 > H && y2 > H)) {
            continue;
          }
          ctx.moveTo(x1, y1);
          ctx.lineTo(x2, y2);
        }
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
      ctx.setLineDash([]);

      for (const [kind, list] of scene.nodeGroups) {
        ctx.fillStyle = MINI_COLOR[kind] || '#9a9a9a';
        for (const r of list) {
          const x = r.x * z + vp.x;
          const y = r.y * z + vp.y;
          const w = Math.max(1, r.w * z);
          const h = Math.max(1, r.h * z);
          if (x + w < 0 || y + h < 0 || x > W || y > H) continue;
          ctx.fillRect(x, y, w, h);
        }
      }
    };

    const tick = () => {
      const vp = rf.getViewport();
      const key = `${vp.x.toFixed(1)}|${vp.y.toFixed(1)}|${vp.zoom.toFixed(4)}`;
      if (key !== last) {
        last = key;
        draw(vp);
      }
      raf = requestAnimationFrame(tick);
    };

    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [rf, scene]);

  return <canvas ref={ref} className="far-canvas" />;
}
function Inner({ session, onRefresh, refreshing }) {
  const rf = useReactFlow();
  const lang = useContext(LangCtx);
  const [lod, setLod] = useState('near');
  const [expandedId, setExpandedId] = useState(null);
  const [measuredH, setMeasuredH] = useState(0);
  const [showMini, setShowMini] = useState(true);
  const [helpOpen, setHelpOpen] = useState(false);
  const [framedTurn, setFramedTurn] = useState(null);
  const [frameRect, setFrameRect] = useState(null);
  const [treeOpen, setTreeOpen] = useState(() => localStorage.getItem('tt-tree') !== '0');
  // 用户手动拖拽后的位置（跨实时刷新保留）
  const posRef = useRef(new Map());
  const [dragVersion, setDragVersion] = useState(0);
  const dragTick = useRef(0);
  const dragGuard = useRef(0);
  const miniDown = useRef(null);

  // 点击小地图空白处 → 视口跳到对应位置（拖动视口矩形时不触发）。
  const onMiniDown = (e) => {
    miniDown.current = e.target.closest?.('.react-flow__minimap')
      ? { x: e.clientX, y: e.clientY }
      : null;
  };
  const onMiniClick = (e) => {
    const wrap = e.target.closest?.('.react-flow__minimap');
    if (!wrap) return;
    const d = miniDown.current;
    if (d && (Math.abs(e.clientX - d.x) > 5 || Math.abs(e.clientY - d.y) > 5)) return;
    const svg = wrap.querySelector('svg');
    if (!svg?.getScreenCTM) return;
    const pt = svg.createSVGPoint();
    pt.x = e.clientX;
    pt.y = e.clientY;
    const loc = pt.matrixTransform(svg.getScreenCTM().inverse());
    rf.setCenter(loc.x, loc.y, { zoom: rf.getViewport().zoom, duration: 300 });
  };

  // 拖动时被压到的框即时让位（无需等松手）。
  const avoidOverlap = (dragged) => {
    const now = performance.now();
    if (now - dragTick.current < 55) return;
    dragTick.current = now;

    const ax = dragged.position.x;
    const ay = dragged.position.y;
    const dw = dragged.measured?.width ?? dragged.width ?? 240;
    const dh = dragged.measured?.height ?? dragged.height ?? 100;

    setNodes((ns) => {
      let changed = false;
      const next = ns.map((n) => {
        if (n.id === dragged.id) return n;
        if (framedTurn != null && (n.data?.turnIndex ?? -1) === framedTurn) return n;
        const w = n.measured?.width ?? n.width ?? 240;
        const h = n.measured?.height ?? n.height ?? 100;
        const ox = Math.min(ax + dw, n.position.x + w) - Math.max(ax, n.position.x) + MIN_GAP;
        const oy = Math.min(ay + dh, n.position.y + h) - Math.max(ay, n.position.y) + MIN_GAP;
        if (ox <= 0 || oy <= 0) return n;

        changed = true;
        let pos;
        if (ox < oy) {
          const dir = ax + dw / 2 < n.position.x + w / 2 ? 1 : -1;
          pos = { x: n.position.x + dir * ox, y: n.position.y };
        } else {
          const dir = ay + dh / 2 < n.position.y + h / 2 ? 1 : -1;
          pos = { x: n.position.x, y: n.position.y + dir * oy };
        }
        posRef.current.set(n.id, pos);
        return { ...n, position: pos };
      });
      return changed ? next : ns;
    });
  };

  useEffect(() => {
    setMeasuredH(0);
  }, [expandedId]);

  const base = useMemo(() => buildGraph(session), [session]);
  const expandedNode = useMemo(
    () => (expandedId ? base.nodes.find((n) => n.id === expandedId) || null : null),
    [base, expandedId],
  );
  const expandedH = measuredH || (expandedNode ? estimateExpandedHeight(expandedNode.data) : 0);

  // 展开时用「放大后的尺寸」重新布局，周围节点自动避让。
  const computed = useMemo(
    () =>
      layoutGraph(base, {
        expandedId,
        expandedW: EXPANDED_W,
        expandedH: expandedH || 420,
        overrides: posRef.current,
      }),
    [base, expandedId, expandedH, dragVersion],
  );

  const [nodes, setNodes, onNodesChange] = useNodesState([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState([]);

  // 包络框：跟随该轮所有节点的当前位置（拖动时实时更新）。
  useEffect(() => {
    if (framedTurn == null) {
      setFrameRect(null);
      return;
    }
    const group = nodes.filter((n) => n.type === 'tt' && (n.data?.turnIndex ?? -1) === framedTurn);
    if (!group.length) {
      setFrameRect(null);
      return;
    }
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const n of group) {
      const w = n.measured?.width ?? n.width ?? n.style?.width ?? 240;
      const h = n.measured?.height ?? n.height ?? n.style?.height ?? 100;
      minX = Math.min(minX, n.position.x);
      minY = Math.min(minY, n.position.y);
      maxX = Math.max(maxX, n.position.x + w);
      maxY = Math.max(maxY, n.position.y + h);
    }
    const pad = 26;
    const rect = {
      x: minX - pad,
      y: minY - pad - 16,
      w: maxX - minX + pad * 2,
      h: maxY - minY + pad * 2 + 16,
    };
    setFrameRect((prev) =>
      prev &&
      Math.abs(prev.x - rect.x) < 0.5 &&
      Math.abs(prev.y - rect.y) < 0.5 &&
      Math.abs(prev.w - rect.w) < 0.5 &&
      Math.abs(prev.h - rect.h) < 0.5
        ? prev
        : rect,
    );
  }, [nodes, framedTurn]);

  const frameNode = useMemo(
    () =>
      framedTurn != null && frameRect
        ? {
            id: `turnframe-${framedTurn}`,
            type: 'turnframe',
            position: { x: frameRect.x, y: frameRect.y },
            style: { width: frameRect.w, height: frameRect.h, zIndex: -1 },
            data: { turnIndex: framedTurn },
            draggable: false,
            selectable: false,
            connectable: false,
            focusable: false,
            deletable: false,
          }
        : null,
    [framedTurn, frameRect],
  );

  const displayNodes = useMemo(
    () => (frameNode ? [frameNode, ...nodes] : nodes),
    [frameNode, nodes],
  );

  // 框选整轮：选中该轮全部节点，拖动时整体移动。
  useEffect(() => {
    if (framedTurn == null) return;
    setNodes((ns) =>
      ns.map((n) =>
        n.type === 'tt'
          ? { ...n, selected: (n.data?.turnIndex ?? -1) === framedTurn }
          : n,
      ),
    );
  }, [framedTurn, setNodes]);

  // 同步节点/边；展开的节点变大并置顶；最后一条流水线的连线高亮并流动。
  useEffect(() => {
    const turnById = new Map(computed.nodes.map((n) => [n.id, n.data.turnIndex ?? 0]));
    const nodeById = new Map(computed.nodes.map((n) => [n.id, n]));
    const lastTurn = computed.nodes.reduce((m, n) => Math.max(m, n.data.turnIndex ?? 0), 0);

    // 最新一轮是否命中缓存（cacheRead > 0）
    const latestHasCache = computed.nodes.some(
      (n) =>
        (n.data.turnIndex ?? 0) === lastTurn &&
        n.data.kind === 'model' &&
        (n.data.ev?.data?.response?.usage?.cacheRead || 0) > 0,
    );

    // 展开节点及其直接相连的上下文关系（独立配色，避免与既有高亮重复）
    const related = new Set();
    if (expandedId) {
      related.add(expandedId);
      for (const e of computed.edges) {
        if (e.source === expandedId) related.add(e.target);
        if (e.target === expandedId) related.add(e.source);
      }
    }

    setNodes(
      computed.nodes.map((n) => {
        const [w, h] = NODE_SIZE[n.data.kind] || [220, 90];
        const isExpanded = n.id === expandedId;
        return {
          ...n,
          selected: framedTurn != null && (n.data.turnIndex ?? -1) === framedTurn,
          className: related.has(n.id) ? 'focus-rel' : undefined,
          zIndex: isExpanded ? 1000 : undefined,
          width: isExpanded ? EXPANDED_W : w,
          height: isExpanded ? undefined : h,
          style: isExpanded
            ? { width: EXPANDED_W, minHeight: expandedH }
            : { ...n.style, width: w, height: h },
        };
      }),
    );

    setEdges(
      computed.edges.map((e) => {
        const look = classifyEdge(e, nodeById, turnById, lastTurn, latestHasCache, expandedId);

        return {
          ...e,
          type: 'tt',
          animated: false,
          hidden: lod === 'far',
          data: { ...(e.data || {}), animate: look.active || look.focusEdge },
          className: look.focusEdge
            ? 'edge-focus'
            : look.contextEdge
              ? 'edge-context'
              : undefined,
          label: look.cross ? t(lang, 'contextLabel') : undefined,
          labelStyle: { fill: 'var(--muted)', fontSize: 9 },
          labelBgStyle: { fill: 'var(--bg)', fillOpacity: 0.85 },
          labelBgPadding: [3, 2],
          labelBgBorderRadius: 4,
          style: {
            stroke: look.color,
            strokeWidth: look.width,
            strokeDasharray: look.dashed ? '5 4' : undefined,
          },
        };
      }),
    );
  }, [computed, expandedId, expandedH, framedTurn, lang, lod, setNodes, setEdges]);

  // 展开后，等新布局生效再把该框居中。
  useEffect(() => {
    if (!expandedId) return;
    const n = computed.nodes.find((x) => x.id === expandedId);
    if (!n) return;
    const z = Math.min(Math.max(rf.getViewport().zoom, 0.55), 1);
    rf.setCenter(n.position.x + EXPANDED_W / 2, n.position.y + Math.min(expandedH, 640) / 2, {
      zoom: z,
      duration: 300,
    });
  }, [expandedId]); // eslint-disable-line react-hooks/exhaustive-deps

  // 展开框的真实高度 → 反馈给布局，让周围框避让。
  useEffect(() => {
    if (!expandedId) return undefined;
    let ro;
    let raf;
    const attach = () => {
      const el = document.querySelector(`.react-flow__node[data-id="${expandedId}"]`);
      if (!el) {
        raf = requestAnimationFrame(attach);
        return;
      }
      ro = new ResizeObserver((entries) => {
        const h = entries[0]?.contentRect?.height || 0;
        if (h > 40) setMeasuredH((prev) => (Math.abs(prev - h) > 8 ? h : prev));
      });
      ro.observe(el);
    };
    raf = requestAnimationFrame(attach);
    return () => {
      cancelAnimationFrame(raf);
      ro?.disconnect();
    };
  }, [expandedId]);

  const lastNode = computed.nodes[computed.nodes.length - 1];

  const toggleTree = () => {
    setTreeOpen((v) => {
      localStorage.setItem('tt-tree', v ? '0' : '1');
      return !v;
    });
  };

  const jumpTo = (id) => {
    if (!id) return;
    const n = rf.getNode(id);
    if (!n) return;
    const w = n.measured?.width ?? n.width ?? n.style?.width ?? 240;
    const h = n.measured?.height ?? n.height ?? n.style?.height ?? 100;
    rf.setCenter(n.position.x + w / 2, n.position.y + h / 2, {
      zoom: Math.max(rf.getZoom(), 0.9),
      duration: 450,
    });
  };

  const centerLast = (zoom = 1, duration = 450) => {
    if (!lastNode) return;
    rf.setCenter(
      lastNode.position.x + (lastNode.style?.width || 280) / 2,
      lastNode.position.y + (lastNode.style?.height || 120) / 2,
      { zoom, duration },
    );
  };

  useEffect(() => {
    const timer = setTimeout(() => centerLast(1, 500), 80);
    return () => clearTimeout(timer);
  }, [session?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const onNodeClick = (event, node) => {
    setHelpOpen(false);
    if (Date.now() - dragGuard.current < 250) return;
    // Shift/Ctrl/Cmd 用于多选，不触发交互
    if (event.shiftKey || event.metaKey || event.ctrlKey) return;
    if (node.type !== 'tt') return;

    // 包络框内点击其他框：保持整轮选中，便于整体拖动
    if (
      node.data.kind !== 'send' &&
      framedTurn != null &&
      (node.data.turnIndex ?? -1) === framedTurn
    ) {
      setNodes((ns) =>
        ns.map((n) =>
          n.type === 'tt'
            ? { ...n, selected: (n.data?.turnIndex ?? -1) === framedTurn }
            : n,
        ),
      );
      return;
    }

    setExpandedId((prev) => (prev === node.id ? null : node.id));
  };

  const onNodeContextMenu = (event, node) => {
    if (node.type !== 'tt' || node.data.kind !== 'send') return;
    event.preventDefault();
    const ti = node.data.turnIndex;
    setFramedTurn((prev) => (prev === ti ? null : ti));
  };

  return (
    <div
      className={`canvas-wrap lod-${lod}`}
      onPointerDownCapture={onMiniDown}
      onClickCapture={onMiniClick}
      onDoubleClick={(e) => {
        if (e.target.closest?.('.drawer') || e.target.closest?.('.tree')) return;
        centerLast(1, 450);
      }}
    >
      <DesignTree
        session={session}
        open={treeOpen}
        onToggle={toggleTree}
        onJump={jumpTo}
      />
      <div className="canvas-stage">
      <div className="canvas-toolbar">
        <div className="tb-group">
          <span className="lod-pill" data-lod={lod}>
            {t(lang, LOD_KEY[lod] || 'lodMid')}
          </span>
          <span className="tb-sep" />
          <span className="tb-count">
            {computed.nodes.length} {t(lang, 'nodes')} · {computed.edges.length}{' '}
            {t(lang, 'edges')}
          </span>
          <span className="tb-sep" />
          <span className="hl-legend">
            <i /> {t(lang, 'ctxLegend')}
          </span>
        </div>
        <div className="tb-legend">
          {['send', 'context', 'model', 'reason', 'tool', 'answer'].map((k) => (
            <span key={k} className={`tb-lg kind-${k}`}>
              <i />
              {t(lang, `kind.${k}`)}
            </span>
          ))}
        </div>
        <div className="spacer" />
        <div className="tb-actions">
          <button onClick={onRefresh} disabled={refreshing}>
            {t(lang, 'refresh')}
          </button>
          <button className={showMini ? 'on' : ''} onClick={() => setShowMini((v) => !v)}>
            {showMini ? t(lang, 'hideMap') : t(lang, 'map')}
          </button>
          <button onClick={() => rf.fitView({ padding: 0.12, duration: 450 })}>
            {t(lang, 'fitAll')}
          </button>
          <button onClick={() => centerLast(1, 450)}>{t(lang, 'latest')}</button>
          <button className={`help-btn${helpOpen ? ' on' : ''}`} onClick={() => setHelpOpen((v) => !v)}>
            {t(lang, 'help')}
          </button>
        </div>
        {helpOpen ? (
          <div className="help-pop">
            <div className="help-title">{t(lang, 'helpTitle')}</div>
            <ul>
              {(t(lang, 'helpItems') || []).map((line, i) => (
                <li key={i}>
                  <span>{String(i + 1).padStart(2, '0')}</span>
                  {line}
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </div>

      <ExpandCtx.Provider value={expandedId}>
        <LodCtx.Provider value={lod}>
          <ReactFlow
            nodes={displayNodes}
            edges={edges}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            nodeTypes={nodeTypes}
            edgeTypes={edgeTypes}
            onMove={(_, vp) => {
              const l = lodFor(vp.zoom);
              setLod((prev) => (prev === l ? prev : l));
            }}
            onNodeClick={onNodeClick}
            onNodeContextMenu={onNodeContextMenu}
            onNodeDragStart={() => {
              dragGuard.current = Date.now();
            }}
            onNodeDrag={(_, node) => avoidOverlap(node)}
            onNodeDragStop={(_, node, dragged) => {
              dragGuard.current = Date.now();
              for (const n of dragged?.length ? dragged : [node]) {
                posRef.current.set(n.id, n.position);
              }
              setDragVersion((v) => v + 1);
            }}
            onPaneClick={() => {
              setHelpOpen(false);
              setExpandedId(null);
              setFramedTurn(null);
            }}
            onInit={(inst) => setLod(lodFor(inst.getZoom()))}
            minZoom={0.02}
            maxZoom={2.5}
            proOptions={{ hideAttribution: true }}
            nodesConnectable={false}
            elementsSelectable
            selectionOnDrag
            panOnDrag={[1]}
            onlyRenderVisibleElements={lod !== 'far'}
            colorMode="dark"
          >
            <Controls showInteractive={false} />
            {showMini ? (
              <MiniMap
                position="bottom-right"
                style={{ width: 390, height: 255 }}
                pannable
                zoomable
                className="tt-minimap"
                nodeColor={(n) => MINI_COLOR[n.data?.kind] || 'var(--muted)'}
                nodeStrokeWidth={0}
                nodeBorderRadius={3}
                maskColor="var(--minimap-mask)"
              />
            ) : null}
          </ReactFlow>
          {lod === 'far' ? (
            <FarCanvas nodes={computed.nodes} edges={computed.edges} expandedId={expandedId} />
          ) : null}
        </LodCtx.Provider>
      </ExpandCtx.Provider>
      </div>
    </div>
  );
}
