(() => {
  'use strict';

  const $ = (s) => document.querySelector(s);
  const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  })[c]);
  const parseJson = (value) => { try { return JSON.parse(value || '{}'); } catch { return {}; } };
  const money = (n) => Number.isFinite(Number(n)) ? `£${Math.round(Number(n)).toLocaleString('en-GB')}` : '—';
  const savedOnly = new URLSearchParams(location.search).get('view') === 'saved';

  async function jsonFetch(url, options) {
    const response = await fetch(url, options);
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(body.error || `HTTP ${response.status}`);
    return body;
  }

  function contactHtml(x, contacts) {
    const phone = (contacts.phones && contacts.phones[0]) || contacts.phone || x.phone || '';
    const email = (contacts.emails && contacts.emails[0]) || contacts.email || '';
    const parts = [];
    if (phone) parts.push(`<a href="tel:${esc(phone)}">☎ ${esc(phone)}</a>`);
    else parts.push('<span class="muted">Phone not found</span>');
    if (email) parts.push(`<a href="mailto:${esc(email)}">✉ ${esc(email)}</a>`);
    if (x.website) parts.push(`<a href="${esc(x.website)}" target="_blank" rel="noreferrer">↗ ${esc(x.website)}</a>`);
    return parts.join('');
  }

  function prospectCard(x) {
    const ev = parseJson(x.evidence_json);
    const contacts = ev.contacts || {};
    const brand = parseJson(x.brand_json);
    const logo = brand.logoUrl || brand.faviconUrl || '';
    const verified = x.company_number
      ? `<span class="badge verified">Companies House ${esc(x.company_status || 'matched')}</span>`
      : `<span class="badge">Identity ${esc(Math.round(x.identity_confidence || 0))}%</span>`;
    const score = x.score ? Math.round(x.score) : '—';
    const effort = x.expected_effort_minutes ? `${Math.round((x.expected_effort_minutes / 60) * 10) / 10}h` : '—';
    const saved = Boolean(x.saved);

    return `<article class="card">
      <div class="cardTop"><div>
        <div class="name">${esc(x.name)}</div>
        <div class="muted">${esc(x.category || 'business')} • ${esc(x.address || '')}</div>
        ${verified}<span class="badge">${esc(x.sales_stage || 'new')}</span>
        ${logo ? `<br><img class="brandThumb" src="${esc(logo)}" alt="">` : ''}
      </div><div class="score">${esc(score)}</div></div>
      <div class="problem">${esc(x.primary_problem || 'Awaiting investigation')}</div>
      <div class="muted">${esc(x.proposed_solution || '')}</div>
      <div class="why"><b>WHY THIS COULD MAKE MONEY</b><br>${esc(ev.whyChosen || 'Evidence still being built.')}</div>
      <div class="contact">${contactHtml(x, contacts)}</div>
      <div class="economics">
        <div><small>Offer</small><br><b>${money(x.offer_price)}</b></div>
        <div><small>Margin</small><br><b>${money(x.expected_margin)}</b></div>
        <div><small>Effort</small><br><b>${esc(effort)}</b></div>
      </div>
      <div class="actions">
        <a href="/demo/${encodeURIComponent(x.id)}">Demo</a>
        <a href="/dossier/${encodeURIComponent(x.id)}">Dossier</a>
        <a href="/evidence/${encodeURIComponent(x.id)}">Evidence</a>
        <button type="button" class="saveBtn ${saved ? 'saved' : ''}" data-save-id="${esc(x.id)}" data-save-next="${saved ? '0' : '1'}">${saved ? '★ Saved' : '☆ Save'}</button>
      </div>
    </article>`;
  }

  async function load() {
    const [d, ps] = await Promise.all([
      jsonFetch('/api/dashboard'),
      jsonFetch(`/api/prospects?limit=60${savedOnly ? '&saved=1' : ''}`)
    ]);
    const t = d.totals || {};
    $('#summary').innerHTML = [
      ['Prospects', t.prospects || 0],
      ['★ Saved', t.saved || 0],
      ['80+ score', t.high_value || 0],
      ['Indicative margin', money(t.indicative_margin || 0)]
    ].map(([label, value]) => `<div class="sum"><small>${esc(label)}</small><strong>${esc(value)}</strong></div>`).join('');
    $('#heading').textContent = savedOnly ? '★ Saved prospects' : 'Prospects';
    $('#count').textContent = `${ps.length} shown`;
    $('#cards').innerHTML = ps.length ? ps.map(prospectCard).join('') : '<div class="muted">No prospects in this view yet.</div>';
  }

  async function toggleSave(button) {
    const id = button.dataset.saveId;
    const saved = button.dataset.saveNext === '1';
    button.disabled = true;
    try {
      await jsonFetch(`/api/prospects/${encodeURIComponent(id)}/save`, {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ saved })
      });
      await load();
    } finally {
      button.disabled = false;
    }
  }

  async function runHunt() {
    const q = $('#q').value.trim();
    if (!q) return;
    const btn = $('#huntBtn');
    const status = $('#status');
    if (btn.disabled) return;

    btn.disabled = true;
    btn.textContent = 'Hunting…';
    status.innerHTML = '<span class="spinner"></span>Starting Revenue Hunter…';
    let seconds = 0;
    const timer = setInterval(() => {
      seconds += 1;
      status.innerHTML = `<span class="spinner"></span>Revenue Hunter is working — ${seconds}s. Results are saved as they complete.`;
    }, 1000);

    try {
      const result = await jsonFetch('/api/run', {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ query: q })
      });
      const usage = result.governor && result.governor.usage;
      const limits = result.governor && result.governor.limits;
      status.textContent = `Run complete — ${result.count || 0} processed.${usage && limits ? ` Deep audits ${usage.deepAudits}/${limits.deepAuditsPerRun}.` : ''}`;
      await load();
    } catch (error) {
      status.textContent = `Run paused: ${error.message}. Completed prospects are already saved.`;
      await load().catch(() => {});
    } finally {
      clearInterval(timer);
      btn.disabled = false;
      btn.textContent = 'Hunt opportunities';
    }
  }

  function init() {
    const form = $('#hunt');
    const button = $('#huntBtn');
    if (!form || !button) return;

    // Prevent native navigation even if another handler misbehaves.
    form.setAttribute('action', 'javascript:void(0)');
    form.addEventListener('submit', (event) => { event.preventDefault(); runHunt(); });
    button.setAttribute('type', 'button');
    button.addEventListener('click', runHunt);
    $('#cards').addEventListener('click', (event) => {
      const save = event.target.closest('[data-save-id]');
      if (save) toggleSave(save);
    });

    load().catch((error) => {
      $('#status').textContent = `Dashboard data could not load: ${error.message}`;
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
