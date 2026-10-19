import React, { useEffect, useMemo, useRef, useState } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { t } from '../i18n.js';
import { REDUCED, MOTION, easeOutExpo, tween } from '../motion.js';
import EChart from './EChart.jsx';
import {
  buildDashboard,
  formatCost,
  formatDuration,
  formatPct,
  formatTokens,
} from './metrics.js';
import {
  buildCacheOption,
  buildContextOption,
  buildHeatOption,
  buildTokenOption,
} from './options.js';
import './dashboard.css';

export default function Dashboard({
  open,
  onClose,
  agent,
  sessions,
  totalSessions,
  currentSession,
  onSelectSession,
  lang,
}) {
  const [scope, setScope] = useState('agent');
  const [heatRange, setHeatRange] = useState('24h');
  const lastDash = useRef(null);
  const wasOpen = useRef(false);

  // 默认始终回到「全部会话」；手动切到当前会话只在本次打开内有效。
  useEffect(() => {
    if (open && !wasOpen.current) setScope('agent');
    wasOpen.current = open;
  }, [open]);

  useEffect(() => {
    setScope('agent');
  }, [agent?.sourceId]);

  const dash = useMemo(() => {
    if (!open && lastDash.current) return lastDash.current;
    const next = buildDashboard(sessions, {
      scope,
      heatRange,
      currentSessionId: currentSession?.id,
    });
    lastDash.current = next;
    return next;
  }, [open, sessions, scope, heatRange, currentSession?.id]);

  const tokenOption = useMemo(
    () => (dash.series.length ? buildTokenOption(dash.series, lang) : null),
    [dash.series, lang],
  );
  const cacheOption = useMemo(
    () => (dash.series.length ? buildCacheOption(dash.series, lang) : null),
    [dash.series, lang],
  );
  const contextOption = useMemo(
    () => (dash.total > 0 ? buildContextOption(dash, lang) : null),
    [dash, lang],
  );
  const heatOption = useMemo(
    () => (dash.heat.hasData ? buildHeatOption(dash.heat, lang) : null),
    [dash.heat, lang],
  );

  const sessionCount = scope === 'session' ? (currentSession ? 1 : 0) : sessions.length;
  const loadedLabel =
    scope === 'agent'
      ? `${sessions.length}/${totalSessions || agent?.sessions?.length || sessions.length}`
      : String(sessionCount);

  const heatHeight = heatRange === '7d' ? 248 : heatRange === '30d' ? 140 : 104;
  const kpiKey = `${open ? 'open' : 'closed'}|${agent?.sourceId || ''}|${scope}`;
  const chartKey = `${open ? 'open' : 'closed'}|${scope}|${heatRange}`;

  return (
    <Dialog.Root open={open} onOpenChange={(v) => !v && onClose()} modal={false}>
      <Dialog.Content
        id="dashboard-panel"
        className="dashboard"
        forceMount
        inert={!open}
        aria-hidden={!open}
        aria-label={t(lang, 'dashTitle')}
        onInteractOutside={(event) => event.preventDefault()}
        onPointerDownOutside={(event) => event.preventDefault()}
      >
        <header className="dash-head">
          <div className="dash-head-main">
            <Dialog.Title className="dash-title">{t(lang, 'dashTitle')}</Dialog.Title>
            <div className="dash-sub">
              <span className="dash-agent">{agent?.name || '—'}</span>
              <span className="dash-dot" />
              <span>
                {t(lang, 'dashSessions')} {loadedLabel}
              </span>
              {scope === 'agent' ? (
                <>
                  <span className="dash-dot" />
                  <span>{t(lang, 'dashPartial')}</span>
                </>
              ) : null}
            </div>
          </div>
          <div className="dash-head-actions">
            <div className="dash-seg" role="group" aria-label={t(lang, 'dashScope')}>
              <button
                className={scope === 'agent' ? 'on' : ''}
                onClick={() => setScope('agent')}
              >
                {t(lang, 'dashAll')}
              </button>
              <button
                className={scope === 'session' ? 'on' : ''}
                onClick={() => setScope('session')}
              >
                {t(lang, 'dashSession')}
              </button>
            </div>
            <Dialog.Close asChild>
              <button className="dash-close" aria-label={t(lang, 'close')}>
                <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
                  <path d="M2 2l8 8M10 2l-8 8" stroke="currentColor" strokeWidth="1.4" />
                </svg>
              </button>
            </Dialog.Close>
          </div>
        </header>

        <Dialog.Description className="sr-only">
          {t(lang, 'dashDescription')}
        </Dialog.Description>

        <div className="dash-body">
          <div className="dash-kpis">
            <Kpi
              index={0}
              label={t(lang, 'dashSessions')}
              value={loadedLabel}
              sub={agent?.interface || ''}
            />
            <Kpi
              index={1}
              label={t(lang, 'dashContext')}
              value={dash.contextTokens}
              format={formatTokens}
              animateKey={kpiKey}
              sub={`${formatTokens(dash.usage.input)} ${t(lang, 'dashFreshInput')}`}
            />
            <Kpi
              index={2}
              label={t(lang, 'dashCacheHit')}
              value={dash.cacheRate}
              format={formatPct}
              animateKey={kpiKey}
              sub={`${formatTokens(dash.usage.cacheRead)} ${t(lang, 'dashCacheRead')}`}
            />
            <Kpi
              index={3}
              label={t(lang, 'dashGenerated')}
              value={dash.generated}
              format={formatTokens}
              animateKey={kpiKey}
              sub={`${formatTokens(dash.usage.output)} / ${formatTokens(dash.usage.reasoning)}`}
            />
            <Kpi
              index={4}
              label={t(lang, 'dashCost')}
              value={dash.cost}
              format={formatCost}
              animateKey={kpiKey}
              sub={scope === 'agent' ? t(lang, 'dashAllSessions') : t(lang, 'dashSession')}
            />
            <Kpi
              index={5}
              label={t(lang, 'turns')}
              value={dash.turns}
              format={formatCount}
              animateKey={kpiKey}
              sub={formatDuration(dash.durationMs)}
            />
          </div>

          <div className="dash-grid">
            <section className="dash-card dash-wide" style={{ '--i': 0 }}>
              <div className="dash-card-head">
                <div>
                  <div className="dash-card-title">
                    {scope === 'session' ? t(lang, 'dashTokenByTurn') : t(lang, 'dashTokenBySession')}
                  </div>
                  <div className="dash-card-sub">
                    {t(lang, 'dashCtxVsGen')} · {formatTokens(dash.total)}
                  </div>
                </div>
              </div>
              {tokenOption ? (
                <EChart
                  option={tokenOption}
                  height={286}
                  active={open}
                  animationKey={chartKey}
                  label={t(lang, 'dashTokenBySession')}
                />
              ) : (
                <Empty lang={lang} />
              )}
            </section>

            <section className="dash-card" style={{ '--i': 1 }}>
              <div className="dash-card-head">
                <div>
                  <div className="dash-card-title">{t(lang, 'dashCacheTrend')}</div>
                  <div className="dash-card-sub">{t(lang, 'dashCacheTrendHint')}</div>
                </div>
              </div>
              {cacheOption ? (
                <EChart
                  option={cacheOption}
                  height={238}
                  active={open}
                  animationKey={chartKey}
                  label={t(lang, 'dashCacheTrend')}
                />
              ) : (
                <Empty lang={lang} />
              )}
            </section>

            <section className="dash-card" style={{ '--i': 2 }}>
              <div className="dash-card-head">
                <div>
                  <div className="dash-card-title">{t(lang, 'dashContextMix')}</div>
                  <div className="dash-card-sub">
                    {dash.context.events
                      ? `${dash.context.events} ${t(lang, 'dashContextEvents')} · ${formatTokens(
                          dash.context.chars,
                        )} chars`
                      : t(lang, 'dashNoContext')}
                  </div>
                </div>
              </div>
              {contextOption ? (
                <EChart
                  option={contextOption}
                  height={238}
                  active={open}
                  animationKey={chartKey}
                  label={t(lang, 'dashContextMix')}
                />
              ) : (
                <Empty lang={lang} />
              )}
            </section>

            <section className="dash-card dash-wide" style={{ '--i': 3 }}>
              <div className="dash-card-head">
                <div>
                  <div className="dash-card-title">{t(lang, 'dashHeat')}</div>
                  <div className="dash-card-sub">
                    {heatRange === '30d'
                      ? `${dash.heat.start || '—'} → ${dash.heat.end || '—'}`
                      : `${dash.heat.start || '—'} → ${dash.heat.end || '—'} · ${
                          heatRange === '7d' ? '7d' : '24h'
                        }`}
                  </div>
                </div>
                <div className="dash-seg" role="group" aria-label={t(lang, 'dashHeat')}>
                  <button
                    className={heatRange === '24h' ? 'on' : ''}
                    onClick={() => setHeatRange('24h')}
                  >
                    {t(lang, 'dashHeat24h')}
                  </button>
                  <button
                    className={heatRange === '7d' ? 'on' : ''}
                    onClick={() => setHeatRange('7d')}
                  >
                    {t(lang, 'dashHeat7d')}
                  </button>
                  <button
                    className={heatRange === '30d' ? 'on' : ''}
                    onClick={() => setHeatRange('30d')}
                  >
                    {t(lang, 'dashHeat30d')}
                  </button>
                </div>
              </div>
              {heatOption ? (
                <EChart
                  option={heatOption}
                  height={heatHeight}
                  active={open}
                  animationKey={chartKey}
                  label={t(lang, 'dashHeat')}
                />
              ) : (
                <Empty lang={lang} />
              )}
            </section>
          </div>

          <section className="dash-card dash-table-card" style={{ '--i': 4 }}>
            <div className="dash-card-head">
              <div>
                <div className="dash-card-title">{t(lang, 'dashTable')}</div>
                <div className="dash-card-sub">
                  {dash.sessionRows.length} {t(lang, 'dashSessions')} · {dash.turns} {t(lang, 'turns')}
                </div>
              </div>
            </div>
            {dash.sessionRows.length ? (
              <div className="dash-table-wrap">
                <table className="dash-table">
                  <thead>
                    <tr>
                      <th>{t(lang, 'dashSessionCol')}</th>
                      <th>{t(lang, 'model')}</th>
                      <th className="num">{t(lang, 'turns')}</th>
                      <th className="num">{t(lang, 'dashContext')}</th>
                      <th className="num">{t(lang, 'dashCacheHit')}</th>
                      <th className="num">{t(lang, 'dashGenerated')}</th>
                      <th className="num">{t(lang, 'dashCost')}</th>
                      <th className="num">{t(lang, 'dashUpdated')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {dash.sessionRows.map((row) => (
                      <tr
                        key={row.id}
                        className={row.isCurrent ? 'on' : ''}
                        onClick={() => {
                          onSelectSession?.(row.id);
                          setScope('session');
                        }}
                      >
                        <td>
                          <span className="dash-row-title">{row.title}</span>
                          {row.statuses?.error || row.statuses?.running ? (
                            <span className="dash-row-state">
                              {row.statuses.error ? `${row.statuses.error} err` : ''}
                              {row.statuses.error && row.statuses.running ? ' · ' : ''}
                              {row.statuses.running ? 'live' : ''}
                            </span>
                          ) : null}
                        </td>
                        <td className="dash-model">{row.model}</td>
                        <td className="num">{row.turns}</td>
                        <td className="num">{formatTokens(row.contextTokens)}</td>
                        <td className="num">{formatPct(row.cacheRate)}</td>
                        <td className="num">{formatTokens(row.generated)}</td>
                        <td className="num">{formatCost(row.cost)}</td>
                        <td className="num dash-updated">{formatClock(row.updatedAt)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <Empty lang={lang} />
            )}
          </section>
        </div>
      </Dialog.Content>
    </Dialog.Root>
  );
}

function Kpi({ label, value, format, sub, index = 0, animateKey = '' }) {
  return (
    <div className="dash-kpi" style={{ '--i': index }}>
      <div className="dash-kpi-label">{label}</div>
      <div className="dash-kpi-value">
        {typeof value === 'number' ? (
          <AnimatedNumber value={value} format={format} animateKey={animateKey} />
        ) : (
          value
        )}
      </div>
      <div className="dash-kpi-sub">{sub}</div>
    </div>
  );
}

function AnimatedNumber({ value, format, animateKey }) {
  const [display, setDisplay] = useState(value);
  const fromRef = useRef(value);
  const keyRef = useRef(null);

  useEffect(() => {
    const target = Number.isFinite(value) ? value : 0;
    const prevKey = keyRef.current;
    const keyChanged = animateKey !== prevKey;
    keyRef.current = animateKey;

    if (REDUCED || !keyChanged) {
      fromRef.current = target;
      setDisplay(target);
      return undefined;
    }

    // 从关闭到打开时从 0 滚入；切换 scope/agent 时从当前值滚到新值。
    const opening =
      animateKey.startsWith('open') && (!prevKey || prevKey.startsWith('closed'));
    const from = opening ? 0 : Number.isFinite(fromRef.current) ? fromRef.current : target;
    fromRef.current = target;
    return tween({
      from,
      to: target,
      duration: MOTION.countUp,
      ease: easeOutExpo,
      onUpdate: (v) => setDisplay(v),
    });
  }, [value, animateKey]);

  if (typeof display !== 'number' || !Number.isFinite(display) || !format) {
    return format ? format(value) : value;
  }
  return format(display);
}

function formatCount(n) {
  return String(Math.round(Number(n) || 0));
}

function Empty({ lang }) {
  return <div className="dash-empty">{t(lang, 'dashNoData')}</div>;
}

function formatClock(ms) {
  if (!ms) return '—';
  const d = new Date(ms);
  const p = (n) => String(n).padStart(2, '0');
  return `${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}
