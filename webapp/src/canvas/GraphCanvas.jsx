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

export default function GraphCanvas({ session }) {
  return (
    <ReactFlowProvider>
      <Inner session={session} />
    </ReactFlowProvider>
  );
}

function Inner({ session }) {
  const rf = useReactFlow();
  const lang = useContext(LangCtx);
  const [lod, setLod] = useState('near');
  const [expandedId, setExpandedId] = useState(null);
  const [measuredH, setMeasuredH] = useState(0);
  const [showMini, setShowMini] = useState(true);
  const [framedTurn, setFramedTurn] = useState(null);
  const [frameRect, setFrameRect] = useState(null);
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
        const sourceNode = nodeById.get(e.source);
        const targetNode = nodeById.get(e.target);
        const cross = !!e.data?.cross;
        const active = (turnById.get(e.source) ?? -1) === lastTurn;
        const inLatest =
          (sourceNode?.data.turnIndex ?? -1) === lastTurn ||
          (targetNode?.data.turnIndex ?? -1) === lastTurn;

        // 最新一轮的「上下文检索」连线：上下文节点 / 工具检索 / 跨轮继承 / 缓存命中
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
        const skeleton = cross || !!e.data?.thread || active;

        return {
          ...e,
          type: 'tt',
          animated: false,
          hidden: lod === 'far' && !skeleton,
          data: { ...(e.data || {}), animate: active || focusEdge },
          className: focusEdge ? 'edge-focus' : contextEdge ? 'edge-context' : undefined,
          label: cross ? t(lang, 'contextLabel') : undefined,
          labelStyle: { fill: 'var(--muted)', fontSize: 9 },
          labelBgStyle: { fill: 'var(--bg)', fillOpacity: 0.85 },
          labelBgPadding: [3, 2],
          labelBgBorderRadius: 4,
          style: {
            stroke: focusEdge
              ? 'var(--focus)'
              : contextEdge
                ? 'var(--highlight)'
                : active
                  ? 'var(--accent)'
                  : cross
                    ? 'var(--edge-cross)'
                    : 'var(--edge)',
            strokeWidth: focusEdge ? 1.8 : contextEdge ? 1.6 : active ? 1.4 : cross ? 1.2 : 1.0,
            strokeDasharray: cross && !contextEdge && !focusEdge ? '5 4' : undefined,
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
    if (Date.now() - dragGuard.current < 250) return;
    // Shift/Ctrl/Cmd 用于多选，不触发交互
    if (event.shiftKey || event.metaKey || event.ctrlKey) return;
    if (node.type !== 'tt') return;

    // 点击「提问」：显示/收起整轮包络框
    if (node.data.kind === 'send') {
      const ti = node.data.turnIndex;
      setFramedTurn((prev) => (prev === ti ? null : ti));
      setExpandedId(null);
      return;
    }

    // 包络框内点击其他框：保持整轮选中，便于整体拖动
    if (framedTurn != null && (node.data.turnIndex ?? -1) === framedTurn) {
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

  return (
    <div
      className={`canvas-wrap lod-${lod}`}
      onPointerDownCapture={onMiniDown}
      onClickCapture={onMiniClick}
      onDoubleClick={(e) => {
        if (e.target.closest?.('.drawer')) return;
        centerLast(1, 450);
      }}
    >
      <div className="canvas-toolbar">
        <span className="lod-pill" data-lod={lod}>
          {t(lang, LOD_KEY[lod] || 'lodMid')}
        </span>
        <span className="muted">
          {computed.nodes.length} {t(lang, 'nodes')} · {computed.edges.length} {t(lang, 'edges')}
        </span>
        <span className="hl-legend">
          <i /> {t(lang, 'ctxLegend')}
        </span>
        <div className="spacer" />
        <button onClick={() => setShowMini((v) => !v)}>
          {showMini ? t(lang, 'hideMap') : t(lang, 'map')}
        </button>
        <button onClick={() => rf.fitView({ padding: 0.12, duration: 450 })}>
          {t(lang, 'fitAll')}
        </button>
        <button onClick={() => centerLast(1, 450)}>{t(lang, 'latest')}</button>
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
            panOnDrag={[1, 2]}
            onlyRenderVisibleElements
            colorMode="dark"
          >
            <Controls showInteractive={false} />
            {showMini ? (
              <MiniMap
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
        </LodCtx.Provider>
      </ExpandCtx.Provider>
    </div>
  );
}
