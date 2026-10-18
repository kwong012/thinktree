import React, { useState } from 'react';
import { t } from '../i18n.js';

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

function pretty(v, empty) {
  if (v == null) return empty;
  if (typeof v === 'string') return v;
  try {
    return JSON.stringify(v, null, 2);
  } catch {
    return String(v);
  }
}

function Row({ label, children }) {
  return (
    <div className="drow">
      <span className="dlabel">{label}</span>
      <span className="dval">{children}</span>
    </div>
  );
}

function Section({ title, children, out }) {
  return (
    <>
      <div className="dsec">{title}</div>
      <pre className={`dpre block${out ? ' out' : ''}`}>{children}</pre>
    </>
  );
}

/** 节点完整详情（原 NodeCard 的框内展开内容）。 */
export default function NodeDetail({ data, lang }) {
  const [raw, setRaw] = useState(false);
  const d = data.ev?.data || {};
  const res = data.result?.data;
  const empty = t(lang, 'empty');
  const kind = data.kind;

  return (
    <div className="ttfull">
      <Row label={t(lang, 'time')}>{fmtTime(data.ev?.at) || '—'}</Row>

      {(kind === 'send' || kind === 'answer' || kind === 'reason' || kind === 'context') && (
        <Section title={t(lang, 'text')}>{d.text || empty}</Section>
      )}

      {kind === 'context' ? <Row label={t(lang, 'source')}>{d.source || '—'}</Row> : null}

      {kind === 'tool' ? (
        <>
          <Row label={t(lang, 'type')}>
            {d.kind || '—'}
            {d.server ? ` · ${d.server}` : ''}
          </Row>
          <Row label={t(lang, 'status')}>{res?.status || '—'}</Row>
          <Row label={t(lang, 'duration')}>
            {res?.durationMs != null ? `${res.durationMs}ms` : '—'}
          </Row>
          <Section title={t(lang, 'input')}>{pretty(d.input, empty)}</Section>
          <Section title={t(lang, 'output')} out>
            {res?.output || empty}
          </Section>
        </>
      ) : null}

      {kind === 'model' ? (
        <>
          <Row label={t(lang, 'model')}>{modelLabel(d.model, d.provider) || '—'}</Row>
          <Row label={t(lang, 'agent')}>{d.agent || '—'}</Row>
          <Row label={t(lang, 'finish')}>{d.response?.finish || '—'}</Row>
          <Row label={t(lang, 'tokens')}>
            in {fmtTok(d.response?.usage?.input)} · out {fmtTok(d.response?.usage?.output)}
            {d.response?.usage?.cacheRead
              ? ` · ${t(lang, 'cache')} ${fmtTok(d.response.usage.cacheRead)}`
              : ''}
            {d.response?.usage?.cost ? ` · ${fmtCost(d.response.usage.cost)}` : ''}
          </Row>
          <Section title={t(lang, 'request')}>{pretty(d.request, empty)}</Section>
          <Section title={t(lang, 'reasoning')}>{d.response?.reasoning || empty}</Section>
          <Section title={t(lang, 'text')}>{d.response?.text || empty}</Section>
          {d.response?.toolCalls?.length ? (
            <Section title={t(lang, 'toolCalls')}>{pretty(d.response.toolCalls, empty)}</Section>
          ) : null}
        </>
      ) : null}

      <div className="drawer-actions">
        <button onClick={() => setRaw((v) => !v)}>
          {raw ? t(lang, 'hideRawJson') : t(lang, 'rawJson')}
        </button>
      </div>
      {raw ? <pre className="dpre block raw">{JSON.stringify(d, null, 2)}</pre> : null}
    </div>
  );
}
