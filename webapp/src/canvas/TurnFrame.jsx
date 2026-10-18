import React, { useContext } from 'react';
import { LangCtx } from './context.js';
import { t } from '../i18n.js';

/** 点击「提问」后出现的整轮包络框（纯描边，不含括号）。 */
export default function TurnFrame({ data }) {
  const lang = useContext(LangCtx);
  const n = (data?.turnIndex ?? 0) + 1;
  return (
    <div className="turnframe">
      <div className="turnframe-label">{t(lang, 'turnFrame').replace('{n}', n)}</div>
    </div>
  );
}
