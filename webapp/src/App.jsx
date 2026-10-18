import React, { useEffect, useMemo, useState } from 'react';
import GraphCanvas from './canvas/GraphCanvas.jsx';
import { LangCtx } from './canvas/context.js';
import { fetchAgents, fetchSession, openStream } from './api.js';
import { t } from './i18n.js';

const IFACE_LABEL = { 'cli/tui': 'CLI/TUI', cli: 'CLI', tui: 'TUI', desktop: 'Desktop' };

export default function App() {
  const [theme, setTheme] = useState(() => localStorage.getItem('tt-theme') || 'dark');
  const [lang, setLang] = useState(() => localStorage.getItem('tt-lang') || 'zh');

  const [agents, setAgents] = useState([]);
  const [focused, setFocused] = useState(null);
  const [sessions, setSessions] = useState({});
  const [activeSource, setActiveSource] = useState(null);
  const [activeId, setActiveId] = useState(null);
  const [status, setStatus] = useState('connecting');

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem('tt-theme', theme);
  }, [theme]);

  useEffect(() => {
    document.documentElement.lang = lang === 'zh' ? 'zh-CN' : 'en';
    localStorage.setItem('tt-lang', lang);
  }, [lang]);

  useEffect(() => {
    const es = openStream({
      onAgents: (snap) => {
        setAgents(snap.agents || []);
        setFocused(snap.focused || null);
      },
      onSession: (sess) => {
        setSessions((prev) => {
          const key = `${sess.sourceId}:${sess.id}`;
          const old = prev[key];
          if (!sess.partial || !old) return { ...prev, [key]: sess };

          const map = new Map((old.turns || []).map((t) => [t.index, t]));
          for (const t of sess.turns || []) map.set(t.index, t);
          return {
            ...prev,
            [key]: {
              ...old,
              updatedAt: sess.updatedAt ?? old.updatedAt,
              turns: [...map.values()].sort((a, b) => a.index - b.index),
            },
          };
        });
      },
      onStatus: setStatus,
    });
    fetchAgents()
      .then((snap) => {
        setAgents(snap.agents || []);
        setFocused(snap.focused || null);
      })
      .catch(() => {});
    return () => es.close();
  }, []);

  const activeAgent = useMemo(
    () => agents.find((a) => a.sourceId === activeSource) || agents[0] || null,
    [agents, activeSource],
  );

  useEffect(() => {
    if (!activeAgent) {
      setActiveSource(null);
      setActiveId(null);
      return;
    }
    if (activeAgent.sourceId !== activeSource) setActiveSource(activeAgent.sourceId);
    const ids = (activeAgent.sessions || []).map((s) => s.id);
    if (!ids.includes(activeId)) setActiveId(ids[0] || null);
  }, [activeAgent, activeSource, activeId]);

  const key = activeAgent && activeId ? `${activeAgent.sourceId}:${activeId}` : null;
  const session = key ? sessions[key] : null;

  useEffect(() => {
    if (!activeAgent || !activeId) return;
    if (sessions[`${activeAgent.sourceId}:${activeId}`]) return;
    let alive = true;
    fetchSession(activeAgent.sourceId, activeId)
      .then((sess) => {
        if (alive) setSessions((prev) => ({ ...prev, [`${sess.sourceId}:${sess.id}`]: sess }));
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [activeAgent, activeId, sessions]);

  return (
    <LangCtx.Provider value={lang}>
      <div className="app">
        <header className="topbar">
          <div className="brand">{t(lang, 'brand')}</div>
          <div className="status" data-status={status}>
            <span className="sdot" />
            {status === 'open'
              ? t(lang, 'live')
              : status === 'error'
                ? t(lang, 'reconnecting')
                : t(lang, 'connecting')}
          </div>
          <div className="spacer" />
          {focused ? (
            <span className="focused">
              {t(lang, 'foreground')}: {focused.name}
            </span>
          ) : null}
          <button
            className="iconbtn"
            onClick={() => setLang(lang === 'zh' ? 'en' : 'zh')}
            title="中文 / English"
          >
            {lang === 'zh' ? 'EN' : '中'}
          </button>
          <button
            className="iconbtn"
            onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
            title={theme === 'dark' ? t(lang, 'themeLight') : t(lang, 'themeDark')}
          >
            {theme === 'dark' ? (
              <svg className="ticon" viewBox="0 0 12 12">
                <circle cx="6" cy="6" r="2.1" />
                <path d="M6 1.4v1.4M6 9.2v1.4M1.4 6h1.4M9.2 6h1.4M2.9 2.9l1 1M8.1 8.1l1 1M9.1 2.9l-1 1M3.9 8.1l-1 1" />
              </svg>
            ) : (
              <svg className="ticon" viewBox="0 0 12 12">
                <path d="M9.7 7.6A4.2 4.2 0 1 1 5.4 1.8a3.3 3.3 0 0 0 4.3 5.8Z" />
              </svg>
            )}
          </button>
        </header>

        <nav className="tabs">
          {agents.map((a) => (
            <button
              key={a.sourceId}
              className={`tab${a.sourceId === activeAgent?.sourceId ? ' on' : ''}`}
              onClick={() => {
                setActiveSource(a.sourceId);
                setActiveId(a.sessions?.[0]?.id || null);
              }}
              title={a.description}
            >
              <span className="tabname">{a.name}</span>
              <span className="iface">{IFACE_LABEL[a.interface] || a.interface}</span>
              {a.focused ? <span className="focusdot" title={t(lang, 'foreground')} /> : null}
              {a.sessions?.length > 1 ? <span className="scount">{a.sessions.length}</span> : null}
            </button>
          ))}
          {!agents.length ? <span className="tabempty">{t(lang, 'noAgents')}</span> : null}
        </nav>

        {activeAgent ? (
          <div className="sessionbar">
            <span className="agentname">{activeAgent.name}</span>
            {(activeAgent.sessions || []).map((s) => (
              <button
                key={s.id}
                className={`pill${s.id === activeId ? ' on' : ''}`}
                onClick={() => setActiveId(s.id)}
                title={s.title}
              >
                {s.title || s.id}
              </button>
            ))}
            <div className="spacer" />
            {session ? (
              <span className="meta">
                {session.turns?.length || 0} {t(lang, 'turns')}
                {session.directory ? ` · ${session.directory}` : ''}
              </span>
            ) : null}
          </div>
        ) : null}

        <main className="main">
          {session ? (
            <GraphCanvas key={`${session.sourceId}:${session.id}`} session={session} theme={theme} />
          ) : activeAgent ? (
            <div className="stage">{t(lang, 'loading')}</div>
          ) : (
            <div className="stage empty">
              <div>
                <h2>{t(lang, 'noAgents')}</h2>
                <p>{t(lang, 'noAgentsHint')}</p>
              </div>
            </div>
          )}
        </main>
      </div>
    </LangCtx.Provider>
  );
}
