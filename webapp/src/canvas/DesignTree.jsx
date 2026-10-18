import React, { useContext, useEffect, useMemo, useRef, useState } from 'react';
import KindIcon from './KindIcon.jsx';
import { LangCtx } from './context.js';
import { t } from '../i18n.js';

function eventKind(e) {
  const d = e.data || {};
  switch (e.type) {
    case 'prompt':
      return 'send';
    case 'context':
      return (d.text || d.notice || '').trim() ? 'context' : null;
    case 'model-call':
      return 'model';
    case 'reasoning':
      return (d.text || '').trim() ? 'reason' : null;
    case 'tool-call':
      return 'tool';
    case 'answer':
      return (d.text || '').trim() ? 'answer' : null;
    default:
      return null;
  }
}

function modelName(m, provider) {
  if (!m?.id) return '';
  const p = m.provider || provider;
  return `${p ? p + '/' : ''}${m.id}`;
}

function oneLine(value, n = 240) {
  const s = String(value ?? '').replace(/\s+/g, ' ').trim();
  return s.length > n ? s.slice(0, n) + '…' : s;
}

function inputHint(input) {
  if (!input || typeof input !== 'object') return '';
  const v =
    input.command ||
    input.filePath ||
    input.path ||
    input.pattern ||
    input.query ||
    Object.values(input).find((x) => typeof x === 'string' && x.trim());
  return oneLine(v, 120);
}

function labelOf(kind, e, lang) {
  const d = e.data || {};
  const prefix = t(lang, `kind.${kind}`);
  switch (kind) {
    case 'send':
      return oneLine(d.text);
    case 'model':
      return `${prefix} · ${modelName(d.model, d.provider) || t(lang, 'model')}`;
    case 'tool': {
      const hint = inputHint(d.input);
      return `${prefix} · ${d.name || ''}${hint ? ` ${hint}` : ''}`;
    }
    case 'context':
      return `${prefix} · ${oneLine(d.text || d.notice || d.source || '')}`;
    case 'reason':
    case 'answer':
      return `${prefix} · ${oneLine(d.text)}`;
    default:
      return prefix;
  }
}

function eventsOf(turn, lang) {
  const events = [];
  for (const e of turn.events || []) {
    const kind = eventKind(e);
    if (!kind) continue;
    events.push({
      id: `${turn.id || turn.index}-${e.seq}`,
      kind,
      label: labelOf(kind, e, lang),
    });
  }
  return events;
}

function Caret({ open }) {
  return (
    <svg
      className={`tree-caret${open ? ' open' : ''}`}
      viewBox="0 0 9 9"
      width="9"
      height="9"
      aria-hidden="true"
    >
      <path d="M3 1.5 6.5 4.5 3 7.5" fill="none" stroke="currentColor" strokeWidth="1.2" />
    </svg>
  );
}

export default function DesignTree({ session, open, onToggle, onJump }) {
  const lang = useContext(LangCtx);
  const [expanded, setExpanded] = useState(() => new Set());
  const [active, setActive] = useState(null);
  const bodyRef = useRef(null);

  const turns = useMemo(
    () =>
      (session?.turns || []).map((turn) => {
        const events = eventsOf(turn, lang);
        const promptEv = events.find((e) => e.kind === 'send');
        return {
          key: String(turn.id || turn.index),
          promptId: promptEv?.id || null,
          label: oneLine(turn.prompt || promptEv?.label) || `#${turn.index + 1}`,
          events,
        };
      }),
    [session, lang],
  );

  useEffect(() => {
    const el = bodyRef.current;
    if (!el || !open) return;
    const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
    if (nearBottom || el.dataset.session !== session?.id) {
      el.dataset.session = session?.id || '';
      el.scrollTop = el.scrollHeight;
    }
  }, [turns.length, open, session?.id]);

  const toggleTurn = (key) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  return (
    <aside className={`tree${open ? '' : ' closed'}`}>
      <div className="tree-head">
        {open ? (
          <>
            <span className="tree-title">{t(lang, 'designTree')}</span>
            <span className="tree-count">
              {turns.length} {t(lang, 'turns')}
            </span>
          </>
        ) : null}
        <button
          className="tree-toggle"
          onClick={onToggle}
          title={open ? t(lang, 'hideTree') : t(lang, 'showTree')}
        >
          <svg viewBox="0 0 10 12" width="10" height="12" aria-hidden="true">
            <path
              d={open ? 'M6.5 2 2.5 6l4 4' : 'M3.5 2l4 4-4 4'}
              fill="none"
              stroke="currentColor"
              strokeWidth="1.4"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </button>
      </div>
      {open ? null : <span className="tree-rail-label">{t(lang, 'designTree')}</span>}

      {open ? (
        <>
          <div className="tree-body" ref={bodyRef}>
            {turns.map((turn) => {
              const isOpen = expanded.has(turn.key);
              return (
                <div key={turn.key}>
                  <button
                    className={`tree-row tree-turn kind-send${
                      active === turn.promptId ? ' active' : ''
                    }`}
                    onClick={() => {
                      setActive(turn.promptId);
                      onJump?.(turn.promptId);
                    }}
                    title={turn.label}
                  >
                    <span
                      className="tree-caret-btn"
                      onClick={(e) => {
                        e.stopPropagation();
                        toggleTurn(turn.key);
                      }}
                    >
                      <Caret open={isOpen} />
                    </span>
                    <span className="tree-ico">
                      <KindIcon kind="send" />
                    </span>
                    <span className="tree-label">{turn.label}</span>
                  </button>
                  {isOpen
                    ? turn.events
                        .filter((e) => e.kind !== 'send')
                        .map((e) => (
                          <button
                            key={e.id}
                            className={`tree-row tree-child kind-${e.kind}${
                              active === e.id ? ' active' : ''
                            }`}
                            onClick={() => {
                              setActive(e.id);
                              onJump?.(e.id);
                            }}
                            title={e.label}
                          >
                            <span className="tree-ico">
                              <KindIcon kind={e.kind} />
                            </span>
                            <span className="tree-label">{e.label}</span>
                          </button>
                        ))
                    : null}
                </div>
              );
            })}
            {!turns.length ? <div className="tree-empty">{t(lang, 'loading')}</div> : null}
          </div>
        </>
      ) : null}
    </aside>
  );
}
