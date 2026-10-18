import React, { useContext, useState } from 'react';
import { Handle, Position } from '@xyflow/react';
import KindIcon from './KindIcon.jsx';
import { LodCtx, LangCtx, ExpandCtx } from './context.js';
import { t } from '../i18n.js';

function modelLabel(m, provider) {
  if (!m?.id) return '';
  const p = m.provider || provider;
  return `${p ? p + '/' : ''}${m.id}`;
}

function clip(value, n = 240) {
  const s = String(value ?? '').replace(/\s+/g, ' ').trim();
  return s.length > n ? s.slice(0, n) + '…' : s;
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

function bodyOf(data, lang) {
  const d = data.ev?.data || {};
  const res = data.result?.data;
  const empty = t(lang, 'empty');

  switch (data.kind) {
    case 'send':
    case 'answer':
    case 'reason':
      return <p>{clip(d.text, 700) || empty}</p>;
    case 'context':
      return <p>{clip(d.text || d.notice || (d.instructionSources || []).join(', '), 400) || empty}</p>;
    case 'tool':
      return (
        <>
          <pre className="ttpre">{clip(JSON.stringify(d.input ?? {}, null, 0), 260)}</pre>
          {res ? <pre className="ttpre out">{clip(res.output || res.status || '', 300)}</pre> : null}
        </>
      );
    case 'model': {
      const r = d.response || {};
      return (
        <>
          {r.reasoning ? (
            <p className="ttdim">
              {t(lang, 'reasoning')}：{clip(r.reasoning, 180)}
            </p>
          ) : null}
          {r.text ? <p>{clip(r.text, 260)}</p> : null}
          <div className="ttchips">
            {r.toolCalls?.length ? (
              <span className="chip">
                {t(lang, 'toolCalls')} ×{r.toolCalls.length}
              </span>
            ) : null}
            {d.request?.raw ? (
              <span className="chip">{t(lang, 'rawIO')}</span>
            ) : (
              <span className="chip muted">{t(lang, 'noRawRequest')}</span>
            )}
          </div>
        </>
      );
    }
    default:
      return null;
  }
}

function footOf(data, lang) {
  const d = data.ev?.data || {};
  const res = data.result?.data;
  const at = data.ev?.at ? fmtTime(data.ev.at) : '';

  if (data.kind === 'model') {
    const u = d.response?.usage || {};
    return (
      <>
        <span>{at}</span>
        <span>
          in {fmtTok(u.input)} · out {fmtTok(u.output)}
          {u.cacheRead ? ` · ${t(lang, 'cache')} ${fmtTok(u.cacheRead)}` : ''}
          {u.cost ? ` · ${fmtCost(u.cost)}` : ''}
        </span>
      </>
    );
  }
  if (data.kind === 'tool') {
    return (
      <>
        <span>{at}</span>
        <span>
          {res?.status || d.kind || ''}
          {res?.durationMs != null ? ` · ${res.durationMs}ms` : ''}
        </span>
      </>
    );
  }
  return <span>{at}</span>;
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

/** 点击后在框内展开的完整详情。 */
function Full({ data, lang, raw, onToggleRaw }) {
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

      {kind === 'context' ? (
        <Row label={t(lang, 'source')}>{d.source || '—'}</Row>
      ) : null}

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
          <Section title={t(lang, 'output')} out>{res?.output || empty}</Section>
        </>
      ) : null}

      {kind === 'model' ? (
        <>
          <Row label={t(lang, 'model')}>{modelLabel(d.model, d.provider) || '—'}</Row>
          <Row label={t(lang, 'agent')}>{d.agent || '—'}</Row>
          <Row label={t(lang, 'finish')}>{d.response?.finish || '—'}</Row>
          <Row label={t(lang, 'tokens')}>
            in {fmtTok(d.response?.usage?.input)} · out {fmtTok(d.response?.usage?.output)}
            {d.response?.usage?.cacheRead ? ` · ${t(lang, 'cache')} ${fmtTok(d.response.usage.cacheRead)}` : ''}
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
        <button onClick={onToggleRaw}>{raw ? t(lang, 'hideRawJson') : t(lang, 'rawJson')}</button>
      </div>
      {raw ? <pre className="dpre block raw">{JSON.stringify(d, null, 2)}</pre> : null}
    </div>
  );
}

export default function NodeCard({ id, data, selected }) {
  const lod = useContext(LodCtx);
  const lang = useContext(LangCtx);
  const expandedId = useContext(ExpandCtx);
  const [raw, setRaw] = useState(false);

  const expanded = expandedId === id;

  return (
    <div
      className={`ttnode kind-${data.kind}${selected ? ' sel' : ''}${expanded ? ' expanded' : ''}`}
      data-lod={lod}
    >
      <Handle type="target" position={Position.Left} className="tt-handle" />
      <Handle type="source" position={Position.Right} className="tt-handle" />
      <div className="tthead">
        <span className="tticon">
          <KindIcon kind={data.kind} />
        </span>
        <span className="ttkind">{t(lang, `kind.${data.kind}`)}</span>
        <span className="tttitle">{titleOf(data)}</span>
      </div>
      {expanded ? (
        <Full data={data} lang={lang} raw={raw} onToggleRaw={() => setRaw((v) => !v)} />
      ) : (
        <>
          <div className="ttbody">{bodyOf(data, lang)}</div>
          {lod === 'near' ? <div className="ttfoot">{footOf(data, lang)}</div> : null}
        </>
      )}
    </div>
  );
}
