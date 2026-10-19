import React, { Suspense, lazy, useEffect, useMemo, useRef, useState } from 'react';
import GraphCanvas from './canvas/GraphCanvas.jsx';
import { LangCtx } from './canvas/context.js';
import { fetchAgents, fetchSession, openStream } from './api.js';
import { t } from './i18n.js';

const Dashboard = lazy(() => import('./dashboard/Dashboard.jsx'));

const IFACE_LABEL = { 'cli/tui': 'CLI/TUI', cli: 'CLI', tui: 'TUI', desktop: 'Desktop' };

export default function App() {
  const [lang, setLang] = useState(() => localStorage.getItem('tt-lang') || 'zh');

  const [agents, setAgents] = useState([]);
  const [focused, setFocused] = useState(null);
  const [sessions, setSessions] = useState({});
  const [activeSource, setActiveSource] = useState(null);
  const [activeId, setActiveId] = useState(null);
  const [picked, setPicked] = useState({});
  const [refreshing, setRefreshing] = useState(false);
  const [status, setStatus] = useState('connecting');
  const [dashOpen, setDashOpen] = useState(false);
  const [dashLoaded, setDashLoaded] = useState(false);
  const dashLoading = useRef(new Set());

  useEffect(() => {
    if (dashOpen) setDashLoaded(true);
  }, [dashOpen]);

  useEffect(() => {
    document.documentElement.dataset.theme = 'dark';
  }, []);

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

          // 增量只含最后一轮：完整会话尚未加载时忽略，避免存下半截数据。
          if (sess.partial) {
            if (!old || !old.turns?.length) return prev;
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
          }

          return { ...prev, [key]: sess };
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
    if (activeAgent.sourceId !== activeSource) {
      setActiveSource(activeAgent.sourceId);
    }
    const ids = (activeAgent.sessions || []).map((s) => s.id);
    if (!ids.length) {
      setActiveId(null);
      return;
    }
    // 每个 tab 记住自己选中的 session，始终按 id 精确匹配。
    const want = picked[activeAgent.sourceId];
    if (want && ids.includes(want)) {
      if (activeId !== want) setActiveId(want);
      return;
    }
    if (activeId !== ids[0]) setActiveId(ids[0]);
  }, [activeAgent, activeSource, activeId, picked]);

  const key = activeAgent && activeId ? `${activeAgent.sourceId}:${activeId}` : null;
  const session = key ? sessions[key] : null;

  const agentSessions = useMemo(() => {
    if (!activeAgent) return [];
    return (activeAgent.sessions || [])
      .map((s) => sessions[`${activeAgent.sourceId}:${s.id}`])
      .filter(Boolean);
  }, [activeAgent, sessions]);

  useEffect(() => {
    if (!dashOpen || !activeAgent) return;
    const sourceId = activeAgent.sourceId;
    const missing = (activeAgent.sessions || [])
      .filter((s) => !sessions[`${sourceId}:${s.id}`])
      .slice(0, 8);
    for (const item of missing) {
      const cacheKey = `${sourceId}:${item.id}`;
      if (dashLoading.current.has(cacheKey)) continue;
      dashLoading.current.add(cacheKey);
      fetchSession(sourceId, item.id)
        .then((sess) => {
          setSessions((prev) => ({ ...prev, [`${sess.sourceId}:${sess.id}`]: sess }));
          dashLoading.current.delete(cacheKey);
        })
        .catch(() => {
          setTimeout(() => dashLoading.current.delete(cacheKey), 30000);
        });
    }
  }, [dashOpen, activeAgent, sessions]);

  useEffect(() => {
    if (!activeAgent || !activeId) return;
    const existing = sessions[`${activeAgent.sourceId}:${activeId}`];
    // 已加载完整会话则不再请求；只有增量或空数据时补一次全量。
    if (existing?.turns?.length) return;
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

  // 刷新：重新探测存活 agent / 会话，并回到最新活动会话。
  const refresh = async () => {
    if (refreshing) return;
    setRefreshing(true);
    try {
      const snap = await fetchAgents();
      setAgents(snap.agents || []);
      setFocused(snap.focused || null);

      const src = activeSource || snap.agents?.[0]?.sourceId;
      const agent = (snap.agents || []).find((a) => a.sourceId === src);
      const latest = agent?.sessions?.[0];
      if (agent && latest) {
        const sess = await fetchSession(agent.sourceId, latest.id);
        setSessions((prev) => ({ ...prev, [`${sess.sourceId}:${sess.id}`]: sess }));
        setActiveSource(agent.sourceId);
        setActiveId(latest.id);
        setPicked((prev) => {
          const next = { ...prev };
          delete next[agent.sourceId];
          return next;
        });
      }
    } catch {
      // ignore
    } finally {
      setRefreshing(false);
    }
  };

  return (
    <LangCtx.Provider value={lang}>
      <div className="app">
        <header className="topbar">
          <div className="brand">
            <svg
              className="brand-mark"
              width="172"
              height="30"
              viewBox="0 0 195 34"
              role="img"
              aria-label="thinkTREE"
            >
              <path
                d="M18 29V13.5M9 13.5h17M26 13.5 29.5 9.5"
                fill="none"
                stroke="var(--text)"
                strokeWidth="2.2"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
              <circle cx="9" cy="13.5" r="2.2" fill="var(--accent)" />
              <circle cx="29.5" cy="9.5" r="2.2" fill="var(--accent)" />
              <circle cx="18" cy="29" r="2.2" fill="var(--accent)" />
              <text
                x="36"
                y="28"
                fontSize="19"
                fontWeight="500"
                fill="var(--text)"
                letterSpacing=".2"
              >hink<tspan fill="var(--accent)" fontWeight="600">T</tspan><tspan fontWeight="600" letterSpacing=".8">REE</tspan></text>
            </svg>
          </div>
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
              <span className="flabel">{t(lang, 'foreground')}</span>
              <span className="fname">{focused.name}</span>
            </span>
          ) : null}
          <div className="hdr-actions">
            <button
              className={`iconbtn dash-toggle${dashOpen ? ' on' : ''}`}
              onClick={() => setDashOpen((v) => !v)}
              disabled={!activeAgent}
              aria-expanded={dashOpen}
              aria-controls="dashboard-panel"
              title={t(lang, 'dashboard')}
            >
              <svg width="13" height="13" viewBox="0 0 16 16" aria-hidden="true">
                <path
                  d="M2 13V7M6 13V3M10 13V6M14 13V9"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                />
              </svg>
              <span>{t(lang, 'dashboard')}</span>
            </button>
            <button
              className="iconbtn"
              onClick={() => setLang(lang === 'zh' ? 'en' : 'zh')}
              title="中文 / English"
            >
              {lang === 'zh' ? 'EN' : '中'}
            </button>
          </div>
        </header>

        <nav className="tabs">
          {agents.map((a) => (
            <button
              key={a.sourceId}
              className={`tab${a.sourceId === activeAgent?.sourceId ? ' on' : ''}`}
              onClick={() => {
                const target =
                  a.sessions?.find((s) => s.id === picked[a.sourceId]) || a.sessions?.[0];
                setActiveSource(a.sourceId);
                setActiveId(target?.id || null);
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
            {(activeAgent.sessions || []).map((s) => (
              <button
                key={s.id}
                className={`pill${s.id === activeId ? ' on' : ''}`}
                onClick={() => {
                  setPicked((prev) => ({ ...prev, [activeAgent.sourceId]: s.id }));
                  setActiveId(s.id);
                }}
                title={s.title}
              >
                {s.title || s.id}
              </button>
            ))}
            {picked[activeAgent.sourceId] ? (
              <button
                className="pill follow"
                onClick={() => {
                  setPicked((prev) => {
                    const next = { ...prev };
                    delete next[activeAgent.sourceId];
                    return next;
                  });
                  setActiveId(activeAgent.sessions?.[0]?.id || null);
                }}
                title={t(lang, 'follow')}
              >
                {t(lang, 'follow')}
              </button>
            ) : null}
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
            <GraphCanvas key={`${session.sourceId}:${session.id}`} session={session} onRefresh={refresh} refreshing={refreshing} />
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
          {activeAgent && dashLoaded ? (
            <Suspense fallback={dashOpen ? <div className="dash-loading">{t(lang, 'loading')}</div> : null}>
              <Dashboard
                open={dashOpen}
                onClose={() => setDashOpen(false)}
                agent={activeAgent}
                sessions={agentSessions}
                totalSessions={activeAgent.sessions?.length || 0}
                currentSession={session}
                lang={lang}
                onSelectSession={(id) => {
                  setPicked((prev) => ({ ...prev, [activeAgent.sourceId]: id }));
                  setActiveId(id);
                }}
              />
            </Suspense>
          ) : null}
        </main>
      </div>
    </LangCtx.Provider>
  );
}
