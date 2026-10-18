// Exports: the ProofPass receipt as HTML (rendered to PDF by headless Chromium), the reader's
// accessible package, and plain text. All document text is escaped.

import { toBlocks } from '@/lib/engine/adapted';
import { deriveActions } from '@/lib/engine/actions';
import { FINDING_LABEL, OUTCOME_LABEL, WEIGHTS } from '@/lib/engine/scoring';
import { labelsFor, outputLabelCode, isRtl } from '@/lib/engine/profiles';
import type { Adapted, Receipt } from '@/lib/engine/types';
import type { DocumentRow, VersionRow } from './db';

const esc = (s: unknown) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

const REVIEW_LABEL = { 'not-reviewed': 'Not reviewed by a person', 'partially-reviewed': 'Partially reviewed by a person', reviewed: 'Reviewed by a person' };

const BASE_CSS = `
  * { box-sizing: border-box; }
  body { font: 10.5pt/1.5 'Segoe UI', 'Noto Sans', 'Noto Sans Arabic', 'Noto Sans Tamil', 'Nirmala UI', Arial, sans-serif; color: #17181c; margin: 0; }
  h1 { font-size: 20pt; margin: 0; letter-spacing: -0.01em; }
  h2 { font-size: 9pt; text-transform: uppercase; letter-spacing: .08em; color: #5d6170; margin: 22px 0 8px; }
  table { width: 100%; border-collapse: collapse; }
  th { text-align: left; font-weight: 600; font-size: 8.5pt; color: #5d6170; border-bottom: 1px solid #c9ccd5; padding: 5px 8px 5px 0; }
  td { border-bottom: 1px solid #e6e8ee; padding: 6px 8px 6px 0; vertical-align: top; font-size: 9.5pt; }
  .muted { color: #5d6170; }
  .pill { display: inline-block; padding: 1px 7px; border-radius: 99px; font-size: 8.5pt; font-weight: 600; }
  .matched { background: #e3f2ea; color: #17643d; } .review { background: #fbf0d9; color: #7a4d00; }
  .mismatch, .missing { background: #fbe4e1; color: #8f2318; } .unverified { background: #eceef2; color: #4b4f5c; }
  .note { background: #f4f5f8; border-radius: 6px; padding: 8px 10px; margin: 8px 0; font-size: 9.5pt; }
  .warn { background: #fbf0d9; color: #5e3c00; }
  q { quotes: '“' '”'; }
`;

export function receiptHtml(r: Receipt): string {
  const v = r.verification;
  const row = (k: string, val: string) => `<tr><th style="width:180px">${esc(k)}</th><td>${val}</td></tr>`;
  const claims = r.claims
    .map(
      (c, i) => `<tr>
        <td class="muted">${i + 1}</td>
        <td>${esc(c.text)}<div class="muted">${esc(c.type)} · ${esc(c.criticality)}${c.paragraph ? ` · paragraph ${c.paragraph}` : ''}</div></td>
        <td><span class="pill ${c.finding}">${esc(FINDING_LABEL[c.finding])}</span></td>
        <td>${c.result.evidence ? `<q dir="auto">${esc(c.result.evidence)}</q>` : '<span class="muted">Not found in the explanation</span>'}${c.result.note ? `<div class="muted">${esc(c.result.note)}</div>` : ''}${c.result.flags.map((f) => `<div class="muted">${esc(f)}</div>`).join('')}</td>
      </tr>`,
    )
    .join('');
  const counts = v.counts;
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${esc(r.receiptId)} · ProofPass</title><style>${BASE_CSS}
    @page { size: A4; margin: 18mm 16mm; }
    header { display: flex; justify-content: space-between; align-items: flex-end; border-bottom: 2px solid #17181c; padding-bottom: 10px; }
    .brand { font-size: 8.5pt; letter-spacing: .14em; text-transform: uppercase; color: #3550c8; font-weight: 700; }
    .id { text-align: right; font-size: 9pt; color: #5d6170; } .id b { display: block; font: 600 11pt Consolas, monospace; color: #17181c; }
    .summary { display: grid; grid-template-columns: repeat(5, 1fr); gap: 8px; margin: 14px 0; }
    .summary div { border: 1px solid #e0e2e9; border-radius: 6px; padding: 8px; } .summary b { display: block; font-size: 15pt; }
    .outcome { font-size: 14pt; font-weight: 600; margin-top: 14px; }
  </style></head><body>
    <header><div><div class="brand">PlainProof · ProofPass</div><h1>Fidelity Receipt</h1></div><div class="id"><b>${esc(r.receiptId)}</b>${esc(new Date(r.issuedAt).toUTCString())}</div></header>
    <div class="outcome">${esc(OUTCOME_LABEL[v.outcome])}${v.semantic ? '' : ' (lexical check only)'}</div>
    <p class="note ${v.semantic ? '' : 'warn'}">${esc(v.statement)}</p>
    <div class="summary">
      <div><b>${v.claimCount}</b>facts extracted</div><div><b>${counts.matched}</b>matched</div>
      <div><b>${counts.review + counts.mismatch + counts.missing + counts.unverified}</b>flagged</div>
      <div><b>${r.unresolved.length}</b>unresolved</div><div><b>${r.repairAttempts}</b>repair attempts</div>
    </div>
    <table>
      ${row('Document', `${esc(r.document.title)}${r.document.filename ? ` <span class="muted">(${esc(r.document.filename)})</span>` : ''}`)}
      ${row('Document ID', `<code>${esc(r.document.id)}</code>`)}
      ${row('Text extraction', esc(r.document.extraction))}
      ${row('Audience', `${esc(r.audience.label)} · ${esc(r.audience.tone)} tone · reading grade ${r.audience.targetGrade}${r.audience.storyMode ? ' · story mode' : ''}`)}
      ${row('Language', esc(r.audience.languageLabel))}
      ${row('Critical facts', `${counts.criticalMatched} of ${counts.critical} matched`)}
      ${row('Human review', `${esc(REVIEW_LABEL[r.humanReview.status])} · ${r.humanReview.decisions.length} of ${r.humanReview.flaggedItems} flagged items reviewed`)}
      ${row('Writer model', esc(r.engine.writerModel))}
      ${row('Verifier model', esc(r.engine.verifierModel))}
      ${row('Hardware', esc(r.engine.hardware))}
      ${row('Original SHA-256', `<code style="font-size:8pt">${esc(r.document.sha256)}</code>`)}
      ${row('Explanation SHA-256', `<code style="font-size:8pt">${esc(r.adapted.sha256)}</code>`)}
      ${row('Processing cost', r.cost.preview ? `Preview Mode: ${r.cost.calls} rule-based steps, no AI model and no GPU used` : `${r.cost.totalTokens.toLocaleString('en')} tokens · ${r.cost.gpuSeconds} s of GPU time · about $${r.cost.usd.toFixed(4)} at $${r.cost.gpuHourlyUsd}/GPU-hour`)}
    </table>
    ${r.faultInjection ? `<p class="note warn">Test fault injected: ${esc(r.faultInjection.description)}.</p>` : ''}
    <h2>Verification rounds</h2>
    <table><tr><th>Round</th><th>Kind</th><th>Outcome</th><th>Problems found</th></tr>${r.rounds
      .map((x) => `<tr><td>${x.round + 1}${x.round === r.selectedRound ? ' (issued)' : ''}</td><td>${esc(x.kind)}</td><td>${esc(OUTCOME_LABEL[x.outcome])}</td><td>${x.problems}</td></tr>`)
      .join('')}</table>
    <h2>Unresolved findings</h2>
    ${r.unresolved.length ? `<table>${r.unresolved.map((u) => `<tr><td style="width:150px"><b>${esc(u.finding)}</b></td><td dir="auto">${esc(u.label)}</td></tr>`).join('')}</table>` : '<p class="muted">None.</p>'}
    <h2>Facts checked (${r.claims.length})</h2>
    <table><tr><th>#</th><th>Fact from the original</th><th>Finding</th><th>Evidence in the explanation</th></tr>${claims}</table>
    ${r.inventions.length ? `<h2>Statements not supported by the original</h2><table>${r.inventions.map((i) => `<tr><td dir="auto"><q>${esc(i.quote)}</q><div class="muted">${esc(i.note)} (${i.severity} severity, ${i.source === 'guard' ? 'number check' : 'detector'})</div></td></tr>`).join('')}</table>` : ''}
    ${r.humanReview.decisions.length ? `<h2>Human review</h2><table>${r.humanReview.decisions.map((d) => `<tr><td>${esc(new Date(d.at).toUTCString())}</td><td dir="auto">${esc(d.label)}${d.note ? `<div class="muted">${esc(d.note)}</div>` : ''}</td><td>${esc(d.reviewer ?? '')}</td></tr>`).join('')}</table>` : ''}
    <h2>How findings are weighted</h2>
    <p class="muted">Critical facts count ${WEIGHTS.critical}×, important ${WEIGHTS.important}×, background ${WEIGHTS.background}×. Any critical fact that is missing, mismatched or unverified means "Issues found", whatever else passes. No accuracy percentage is reported.</p>
    <h2>Limitations</h2>
    <ul>${r.limitations.map((l) => `<li>${esc(l)}</li>`).join('')}</ul>
    ${r.officialSourceNote ? `<p class="note" dir="auto">${esc(r.officialSourceNote)}</p>` : ''}
  </body></html>`;
}

function adaptedHtml(v: Adapted, language: string, sourceLanguage: string) {
  const labels = labelsFor(outputLabelCode(language, sourceLanguage));
  const out: string[] = [];
  let open: string | null = null;
  for (const b of toBlocks(v, labels)) {
    const list = b.kind === 'item' || b.kind === 'bullet' ? 'ul' : b.kind === 'step' ? 'ol' : null;
    if (list !== open) {
      if (open) out.push(`</${open}>`);
      if (list) out.push(`<${list}>`);
      open = list;
    }
    if (b.kind === 'title') out.push(`<h1>${esc(b.text)}</h1>`);
    else if (b.kind === 'section') out.push(`<h2>${esc(b.text)}</h2>`);
    else if (b.kind === 'subheading') out.push(`<h3>${esc(b.text)}</h3>`);
    else if (list) out.push(`<li>${esc(b.text)}</li>`);
    else out.push(`<p>${esc(b.text)}</p>`);
  }
  if (open) out.push(`</${open}>`);
  if (v.definitions.length) {
    out.push(`<h2>${esc(labels.definitions)}</h2><dl>${v.definitions.map((d) => `<dt>${esc(d.term)}</dt><dd>${esc(d.explanation)}</dd>`).join('')}</dl>`);
  }
  return { html: out.join('\n'), labels };
}

// A single self-contained, accessible HTML file a reader can keep, print or send on.
export function packageHtml(doc: DocumentRow, version: VersionRow, receipt: Receipt): string {
  const round = version.rounds[version.finalRound];
  const lang = outputLabelCode(version.language, doc.sourceLanguage ?? '');
  const rtl = isRtl(version.language, doc.sourceLanguage ?? '');
  const { html, labels } = adaptedHtml(round.version, version.language, doc.sourceLanguage ?? '');
  const { actions } = deriveActions(round.version, doc.claims ?? [], round.results);
  return `<!doctype html><html lang="${lang}" dir="${rtl ? 'rtl' : 'ltr'}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${esc(round.version.title || doc.title)}</title><style>${BASE_CSS}
    body { font-size: 13pt; line-height: 1.7; max-width: 46em; margin: 0 auto; padding: 32px 20px 64px; }
    h1 { font-size: 22pt; margin-bottom: 8px; } h2 { margin-top: 28px; } h3 { font-size: 13pt; margin: 18px 0 6px; }
    li { margin: 6px 0; } dt { font-weight: 700; margin-top: 8px; } dd { margin: 0 0 6px; }
    .meta { border: 1px solid #d9dce4; border-radius: 10px; padding: 12px 16px; font-size: 11pt; margin: 18px 0; }
    .checklist li { list-style: none; } .checklist li::before { content: '☐ '; }
    @media print { body { padding: 0; } }
  </style></head><body>
  <main>
    <p class="muted" lang="en" dir="ltr">PlainProof explanation for: ${esc(receipt.audience.label)} · ${esc(receipt.audience.languageLabel)}</p>
    ${html}
    ${actions.length ? `<h2>${esc(labels.actions)}: checklist</h2><ul class="checklist">${actions.map((a) => `<li>${esc(a.text)}${a.deadline ? ` <span class="muted" dir="auto">(${esc(a.deadline)})</span>` : ''}</li>`).join('')}</ul>` : ''}
    ${receipt.officialSourceNote ? `<p class="note">${esc(receipt.officialSourceNote)}</p>` : ''}
  </main>
  <aside class="meta" lang="en" dir="ltr">
    <strong>How this was checked (ProofPass ${esc(receipt.receiptId)})</strong><br>
    ${esc(OUTCOME_LABEL[receipt.verification.outcome])}: ${receipt.verification.counts.matched} of ${receipt.verification.claimCount} facts matched; ${receipt.unresolved.length} unresolved.<br>
    ${esc(receipt.verification.statement)}<br>
    ${esc(REVIEW_LABEL[receipt.humanReview.status])}.<br>
    Original document: ${esc(doc.filename ?? doc.title)}. The original is the official source.
  </aside>
  </body></html>`;
}

export function plainText(doc: DocumentRow, version: VersionRow): string {
  const round = version.rounds[version.finalRound];
  const labels = labelsFor(outputLabelCode(version.language, doc.sourceLanguage ?? ''));
  const lines: string[] = [];
  for (const b of toBlocks(round.version, labels)) {
    if (b.kind === 'title') lines.push(b.text.toUpperCase(), '');
    else if (b.kind === 'section') lines.push('', b.text, '-'.repeat(Math.min(40, b.text.length)));
    else if (b.kind === 'subheading') lines.push('', b.text);
    else if (b.kind === 'item' || b.kind === 'bullet') lines.push(`- ${b.text}`);
    else if (b.kind === 'step') lines.push(`${b.number}. ${b.text}`);
    else lines.push(b.text, '');
  }
  if (round.version.definitions.length) {
    lines.push('', labels.definitions);
    for (const d of round.version.definitions) lines.push(`- ${d.term}: ${d.explanation}`);
  }
  return lines.join('\n').replace(/\n{3,}/g, '\n\n').trim() + '\n';
}

// Headless Chromium renders the receipt HTML to PDF, so every script (Arabic, Tamil) shapes correctly.
const g = globalThis as unknown as { __ppbrowser?: Promise<import('playwright').Browser>; __ppbrowserTimer?: NodeJS.Timeout };

export async function htmlToPdf(html: string): Promise<Buffer> {
  const { chromium } = await import('playwright');
  g.__ppbrowser ??= chromium.launch({ args: ['--no-sandbox'] }).catch((err) => {
    g.__ppbrowser = undefined;
    throw err;
  });
  const browser = await g.__ppbrowser;
  clearTimeout(g.__ppbrowserTimer);
  g.__ppbrowserTimer = setTimeout(() => {
    g.__ppbrowser = undefined;
    void browser.close();
  }, 120_000);
  const context = await browser.newContext({ javaScriptEnabled: false });
  try {
    const page = await context.newPage();
    await page.route('**/*', (route) => (route.request().url().startsWith('data:') ? route.continue() : route.abort()));
    await page.setContent(html, { waitUntil: 'load' });
    return await page.pdf({ format: 'A4', printBackground: true, margin: { top: '16mm', bottom: '16mm', left: '14mm', right: '14mm' } });
  } finally {
    await context.close();
  }
}
