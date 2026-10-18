import React, { useContext, useEffect, useMemo, useRef, useState } from 'react';
import DesignTree from './DesignTree.jsx';
import CanvasStage from './CanvasStage.jsx';
import { LangCtx } from './context.js';
import { buildGraph, layoutGraph } from '../layout.js';
import { t } from '../i18n.js';

const LOD_KEY = { far: 'lodFar', mid: 'lodMid', near: 'lodNear' };
const EXPANDED_W = 520;

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
  const lang = useContext(LangCtx);
  const [lod, setLod] = useState('near');
  const [expandedId, setExpandedId] = useState(null);
  const [framedTurn, setFramedTurn] = useState(null);
  const [showMini, setShowMini] = useState(true);
  const [helpOpen, setHelpOpen] = useState(false);
  const [helpW, setHelpW] = useState(0);
  const [treeOpen, setTreeOpen] = useState(() => localStorage.getItem('tt-tree') !== '0');
  const [physMode, setPhysMode] = useState(() =>
    localStorage.getItem('tt-physics') === 'stay' ? 'stay' : 'return',
  );
  const choosePhysMode = (m) => {
    setPhysMode(m);
    localStorage.setItem('tt-physics', m);
  };

  const posRef = useRef(new Map());
  const actionsRef = useRef(null);
  const apiRef = useRef(null);

  useEffect(() => {
    if (!helpOpen) return undefined;
    const el = actionsRef.current;
    if (!el) return undefined;
    const sync = () => setHelpW(el.offsetWidth);
    sync();
    const ro = new ResizeObserver(sync);
    ro.observe(el);
    return () => ro.disconnect();
  }, [helpOpen]);

  const base = useMemo(() => buildGraph(session), [session]);
  const expandedNode = useMemo(
    () => (expandedId ? base.nodes.find((n) => n.id === expandedId) || null : null),
    [base, expandedId],
  );
  const expandedH = expandedNode ? estimateExpandedHeight(expandedNode.data) : 0;

  const computed = useMemo(
    () =>
      layoutGraph(base, {
        expandedId,
        expandedW: EXPANDED_W,
        expandedH: expandedH || 420,
        overrides: posRef.current,
      }),
    [base, expandedId, expandedH],
  );

  const toggleTree = () => {
    setTreeOpen((v) => {
      localStorage.setItem('tt-tree', v ? '0' : '1');
      return !v;
    });
  };

  return (
    <div className={`canvas-wrap lod-${lod}`}>
      <DesignTree
        session={session}
        open={treeOpen}
        onToggle={toggleTree}
        onJump={(id) => apiRef.current?.jumpTo(id)}
      />
      <div className="canvas-stage">
        <CanvasStage
          nodes={computed.nodes}
          edges={computed.edges}
          lang={lang}
          expandedId={expandedId}
          expandedW={EXPANDED_W}
          expandedH={expandedH || 420}
          framedTurn={framedTurn}
          onFramedTurn={setFramedTurn}
          onExpand={setExpandedId}
          onPane={() => setHelpOpen(false)}
          onLod={(l) => setLod((prev) => (prev === l ? prev : l))}
          physMode={physMode}
          showMini={showMini}
          overrides={posRef.current}
          apiRef={apiRef}
        />

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
          <div className="tb-actions" ref={actionsRef}>
            <button onClick={onRefresh} disabled={refreshing}>
              {t(lang, 'refresh')}
            </button>
            <button
              className={`phys-switch${physMode === 'return' ? ' on' : ''}`}
              onClick={() => choosePhysMode(physMode === 'stay' ? 'return' : 'stay')}
              title={`${t(lang, 'physMode')}：${
                physMode === 'stay' ? t(lang, 'physStayHint') : t(lang, 'physReturnHint')
              }`}
            >
              <span className="phys-track">
                <i />
              </span>
              {physMode === 'stay' ? t(lang, 'physStay') : t(lang, 'physReturn')}
            </button>
            <button className={showMini ? 'on' : ''} onClick={() => setShowMini((v) => !v)}>
              {showMini ? t(lang, 'hideMap') : t(lang, 'map')}
            </button>
            <button onClick={() => apiRef.current?.fitAll()}>{t(lang, 'fitAll')}</button>
            <button onClick={() => apiRef.current?.centerLatest()}>{t(lang, 'latest')}</button>
            <button
              className={`help-btn${helpOpen ? ' on' : ''}`}
              onClick={() => {
                if (!helpOpen) setHelpW(actionsRef.current?.offsetWidth || 0);
                setHelpOpen((v) => !v);
              }}
            >
              {t(lang, 'help')}
            </button>
          </div>
          {helpOpen ? (
            <div className="help-pop" style={helpW ? { width: helpW } : undefined}>
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
      </div>
    </div>
  );
}
