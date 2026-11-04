// Runs inside a logged-in grafana.payfuture.net tab, started by the "Trace in formatter" bookmarklet.
// Finds every trace for a transaction id, pulls its spans from Tempo and its log lines from Loki,
// and hands both to the formatter tab with postMessage. Nothing leaves the browser.
(() => {
  'use strict';

  // __pfSite lets a local copy of the page be tested against real Grafana data.
  const SITE = window.__pfSite || 'https://shreyasjejurkar-pf.github.io/json-formatter/';
  const SITE_ORIGIN = new URL(SITE).origin;
  const ENVS = { 'ig-prod': 6, 'ig-qa': 3, 'ige-prod': 7, 'ige-qa': 2 };
  const MAX_TRACES = 30;
  const DAY = 864e5;

  if (window.__pfTrace) { window.__pfTrace.show(); return; }

  // ---------- panel ----------
  // Shadow DOM keeps Grafana's styles out of the panel and the panel's out of Grafana.

  const host = document.createElement('div');
  host.id = 'pf-trace';
  host.style.cssText = 'position:fixed;top:16px;right:16px;z-index:2147483647';
  const root = host.attachShadow({ mode: 'open' });
  const orgNow = +(new URLSearchParams(location.search).get('orgId') || 0);
  const envNow = Object.keys(ENVS).find(k => ENVS[k] === orgNow) || 'ig-prod';
  root.innerHTML = `
<style>
  :host { all: initial; }
  .p { width: 340px; font: 13px/1.45 system-ui, sans-serif; color: #1d1d1b; background: #fff; border: 1px solid #ccc;
       border-radius: 10px; box-shadow: 0 12px 40px rgba(0,0,0,.35); padding: 12px 14px; }
  h2 { font-size: 14px; margin: 0 0 8px; display: flex; }
  h2 span { flex: 1; }
  label { display: block; margin: 8px 0 3px; color: #555; font-size: 12px; }
  input, select { width: 100%; box-sizing: border-box; font: 13px system-ui, sans-serif; padding: 5px 7px;
                  border: 1px solid #bbb; border-radius: 6px; background: #fff; color: #1d1d1b; }
  .row { display: flex; gap: 8px; }
  .row > div { flex: 1; }
  button { font: 13px system-ui, sans-serif; border: 1px solid #bbb; background: #f4f4f1; color: #1d1d1b;
           border-radius: 6px; padding: 5px 12px; cursor: pointer; }
  button.go { background: #2457c5; border-color: #2457c5; color: #fff; margin-top: 12px; width: 100%; }
  button:disabled { opacity: .6; cursor: default; }
  .x { border: 0; background: none; font-size: 18px; line-height: 1; padding: 0 4px; }
  .st { margin-top: 8px; font-size: 12px; color: #555; min-height: 1.4em; white-space: pre-wrap; }
  .st.err { color: #b3261e; }
  .hint { font-size: 11.5px; color: #777; margin-top: 3px; }
</style>
<form class="p">
  <h2><span>Trace in formatter</span><button type="button" class="x" aria-label="Close">&times;</button></h2>
  <label for="id">Transaction ID or trace ID</label>
  <input id="id" required autocomplete="off" spellcheck="false" placeholder="INVB8D1793777607601">
  <div class="row">
    <div><label for="env">Environment</label><select id="env">${Object.keys(ENVS).map(k => `<option${k === envNow ? ' selected' : ''}>${k}</option>`).join('')}</select></div>
    <div><label for="back">Search back</label><select id="back">
      <option value="1">1 day</option><option value="3">3 days</option><option value="7" selected>7 days</option><option value="30">30 days</option>
    </select></div>
  </div>
  <div class="hint">Transaction IDs that end in a timestamp are searched from that time, so "Search back" only matters for other IDs.</div>
  <button class="go">Open timeline</button>
  <div class="st" role="status"></div>
</form>`;
  document.body.appendChild(host);
  const $ = (s) => root.querySelector(s);
  const status = (text, err) => { $('.st').textContent = text; $('.st').classList.toggle('err', !!err); };
  $('.x').addEventListener('click', () => { host.hidden = true; });
  window.__pfTrace = { show: () => { host.hidden = false; $('#id').focus(); } };
  if (location.origin !== 'https://grafana.payfuture.net') {
    status('Run this bookmark on a grafana.payfuture.net tab.', true);
    $('.go').disabled = true;
  }
  $('#id').focus();

  // ---------- Grafana API ----------

  let ORG = 0;
  const headers = (json) => ({ 'X-Grafana-Org-Id': String(ORG), ...(json ? { 'Content-Type': 'application/json' } : {}) });

  async function datasources() {
    const r = await fetch('/api/datasources', { headers: headers() });
    if (r.status === 401) throw new Error('Grafana says you are not logged in. Log in and run the bookmark again.');
    if (!r.ok) throw new Error(`Grafana answered ${r.status} when listing datasources.`);
    const list = await r.json();
    return { loki: list.find(d => d.type === 'loki')?.uid, tempo: list.find(d => d.type === 'tempo')?.uid };
  }

  async function lokiRange(uid, expr, from, to) {
    const body = {
      queries: [{ refId: 'A', datasource: { uid, type: 'loki' }, expr, queryType: 'range', maxLines: 5000, direction: 'forward' }],
      from: String(Math.floor(from)), to: String(Math.ceil(to))
    };
    const r = await fetch('/api/ds/query?ds_type=loki', { method: 'POST', headers: headers(true), body: JSON.stringify(body) });
    const j = await r.json().catch(() => ({}));
    const err = j.results?.A?.error || (!r.ok && (j.message || `HTTP ${r.status}`));
    if (err) throw new Error(`Loki: ${String(err).slice(0, 200)}`);
    const out = [];
    for (const f of j.results.A.frames || []) {
      const names = f.schema.fields.map(x => x.name), v = f.data.values;
      const li = names.indexOf('Line'), ni = names.indexOf('tsNs'), ti = names.indexOf('Time'), la = names.indexOf('labels');
      if (li < 0) continue;
      for (let i = 0; i < v[li].length; i++) {
        const ns = ni >= 0 ? String(v[ni][i]) : String(BigInt(v[ti][i]) * 1000000n);
        out.push({ ns, line: v[li][i], svc: (la >= 0 && v[la][i]?.service_name) || '' });
      }
    }
    return out;
  }

  // Ranges longer than a day time out, so each day is its own query.
  async function lokiDays(uid, expr, from, to, onDay) {
    const out = [];
    for (let a = from; a < to; a += DAY) {
      out.push(...await lokiRange(uid, expr, a, Math.min(a + DAY, to)));
      onDay?.(out.length);
    }
    return out;
  }

  async function tempoTrace(uid, id) {
    const r = await fetch(`/api/datasources/proxy/uid/${uid}/api/traces/${id}`, { headers: { ...headers(), Accept: 'application/json' } });
    if (r.status === 404) return null;
    if (!r.ok) throw new Error(`Tempo answered ${r.status} for trace ${id}.`);
    return r.json();
  }

  // ---------- span conversion ----------

  const b64hex = (s) => {
    if (!s) return '';
    if (/^[0-9a-f]+$/i.test(s) && s.length % 2 === 0 && s.length >= 16) return s.toLowerCase();
    return [...atob(s)].map(c => c.charCodeAt(0).toString(16).padStart(2, '0')).join('');
  };
  const nsMs = (ns) => Number(BigInt(ns) / 1000n) / 1000;
  const attrVal = (v) => v == null ? '' : 'stringValue' in v ? v.stringValue : 'intValue' in v ? String(v.intValue)
    : 'doubleValue' in v ? String(v.doubleValue) : 'boolValue' in v ? String(v.boolValue) : JSON.stringify(v);

  // Only attributes that explain the call. Client addresses, user agents and query strings stay behind.
  const KEEP = /^(http\.request\.method|http\.route|http\.response\.status_code|url\.path|url\.full|server\.address|server\.port|db\.query\.text|db\.statement|db\.system(\.name)?|db\.namespace|db\.operation(\.name)?|messaging\.\S+|rpc\.\S+|error\.type|exception\.\S+|otel\.status_\S+)$/;
  const stripQuery = (u) => u.replace(/[?#].*$/, '');

  function attrs(list) {
    const o = {};
    for (const a of list || []) {
      if (!KEEP.test(a.key)) continue;
      let v = attrVal(a.value);
      if (a.key === 'url.full' || a.key === 'url.path') v = stripQuery(v);
      o[a.key] = v.length > 4000 ? v.slice(0, 4000) + '…' : v;
    }
    return o;
  }

  function spansOf(trace) {
    const out = [];
    for (const b of trace.batches || trace.resourceSpans || []) {
      const svc = attrVal((b.resource?.attributes || []).find(a => a.key === 'service.name')?.value);
      for (const ss of b.scopeSpans || b.instrumentationLibrarySpans || []) {
        const scope = (ss.scope || ss.instrumentationLibrary)?.name || '';
        for (const s of ss.spans || []) {
          out.push({
            id: b64hex(s.spanId), parent: b64hex(s.parentSpanId), name: s.name || '',
            kind: String(s.kind || '').replace('SPAN_KIND_', '').toLowerCase(), svc, scope,
            start: nsMs(s.startTimeUnixNano), end: nsMs(s.endTimeUnixNano),
            status: s.status?.code ? { code: String(s.status.code).replace('STATUS_CODE_', '').toLowerCase(), message: s.status.message || '' } : null,
            attrs: attrs(s.attributes),
            events: (s.events || []).filter(e => /exception/i.test(e.name)).map(e => ({ name: e.name, t: nsMs(e.timeUnixNano), attrs: attrs(e.attributes) }))
          });
        }
      }
    }
    return out.sort((a, b) => a.start - b.start);
  }

  const traceOfLine = (line) => { try { return JSON.parse(line).traceid || ''; } catch { return ''; } };

  // ---------- run ----------

  async function collect(id, back, progress) {
    const ds = await datasources();
    if (!ds.loki) throw new Error('This Grafana org has no Loki datasource.');
    const now = Date.now();
    const logs = new Map();
    const addLogs = (rows) => { for (const r of rows) logs.set(r.ns + r.line, r); };
    const notes = [];
    let traceIds;

    if (/^[0-9a-f]{32}$/i.test(id)) {
      traceIds = [id.toLowerCase()];
    } else {
      // INV ids end in the creation time in ms, so the search can start there instead of days back.
      const stamp = +(id.match(/(\d{13})$/)?.[1] || 0);
      const known = stamp > now - 400 * DAY && stamp < now + DAY;
      const from = known ? stamp - 15 * 6e4 : now - back * DAY;
      const to = known ? Math.min(now, stamp + 3 * DAY) : now;
      progress(`Searching logs for ${id}…`);
      const rows = await lokiDays(ds.loki, `{service_name=~".+"} |= ${JSON.stringify(id)}`, from, to,
        (n) => progress(`Searching logs for ${id}… ${n} lines so far`));
      if (!rows.length) {
        throw new Error(`No log lines mention ${id} in ${Object.keys(ENVS).find(k => ENVS[k] === ORG)} between ` +
          `${new Date(from).toISOString().slice(0, 16)} and ${new Date(to).toISOString().slice(0, 16)} UTC. Check the environment.`);
      }
      addLogs(rows);
      traceIds = [...new Set(rows.map(r => traceOfLine(r.line)).filter(Boolean))];
      if (traceIds.length > MAX_TRACES) {
        notes.push(`${traceIds.length} traces mention this id; only the first ${MAX_TRACES} are shown.`);
        traceIds = traceIds.slice(0, MAX_TRACES);
      }
    }

    const traces = [];
    let n = 0;
    for (const tid of traceIds) {
      progress(`Loading trace ${++n} of ${traceIds.length} from Tempo…`);
      const t = ds.tempo ? await tempoTrace(ds.tempo, tid) : null;
      traces.push({ id: tid, spans: t ? spansOf(t) : [] });
    }

    n = 0;
    for (const t of traces) {
      progress(`Loading log lines for trace ${++n} of ${traces.length}…`);
      const own = [...logs.values()].filter(r => r.line.includes(t.id)).map(r => nsMs(r.ns));
      const times = t.spans.flatMap(s => [s.start, s.end]).concat(own);
      let from, to;
      if (times.length) { from = Math.min(...times) - 2 * 6e4; to = Math.max(...times) + 2 * 6e4; }
      else { from = now - back * DAY; to = now; }
      addLogs(await lokiDays(ds.loki, `{service_name=~".+"} |= ${JSON.stringify(t.id)}`, from, Math.min(to, now)));
    }
    const missing = traces.filter(t => !t.spans.length).length;
    if (missing) notes.push(`${missing} of ${traces.length} trace${traces.length === 1 ? ' is' : 's are'} not in Tempo, which keeps traces for a limited time. Their log lines are still shown.`);
    if (!logs.size && !traces.some(t => t.spans.length)) throw new Error(`Nothing found for trace ${id}.`);
    return { logs: [...logs.values()].sort((a, b) => (BigInt(a.ns) < BigInt(b.ns) ? -1 : 1)), traces, notes };
  }

  $('form').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const id = $('#id').value.trim();
    const env = $('#env').value;
    ORG = ENVS[env];
    const back = +$('#back').value;
    $('.go').disabled = true;
    status('Opening the formatter…');

    // Opened now, while the click still counts as a user action, so the popup blocker lets it through.
    const win = window.open(SITE + '#grafana', '_blank');
    if (!win) { status('The browser blocked the new tab. Allow pop-ups for grafana.payfuture.net and try again.', true); $('.go').disabled = false; return; }

    let ready = false, queued = [];
    const send = (msg) => { if (ready) win.postMessage(msg, SITE_ORIGIN); else queued.push(msg); };
    const onMsg = (e) => {
      if (e.source !== win || e.origin !== SITE_ORIGIN || e.data?.pf !== 'ready') return;
      ready = true;
      queued.forEach(m => win.postMessage(m, SITE_ORIGIN));
      queued = [];
    };
    window.addEventListener('message', onMsg);
    const progress = (text) => { status(text); send({ pf: 'status', text }); };

    try {
      const data = await collect(id, back, progress);
      send({ pf: 'data', payload: { v: 1, kind: 'grafana', query: id, env, fetched: Date.now(), ...data } });
      status(`Done: ${data.traces.length} trace${data.traces.length === 1 ? '' : 's'}, ${data.logs.length} log lines. The formatter tab has the timeline.`);
    } catch (err) {
      status(err.message, true);
      send({ pf: 'error', text: err.message });
    } finally {
      $('.go').disabled = false;
      // The formatter replies once it loads; give a slow load time before dropping the listener.
      setTimeout(() => window.removeEventListener('message', onMsg), 120000);
    }
  });
})();
