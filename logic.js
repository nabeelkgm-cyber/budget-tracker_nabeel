/* SIS Budget Tracker - pure logic (no DOM): parsing the approved budget and the ERP trial balance,
   default ledger -> budget head mapping, and the budget-vs-actual calculation.
   Works in the browser (window.SIS) and in Node (module.exports) so it can be tested. */
(function (root) {
  'use strict';

  const DEFAULT_SETTINGS = {
    fyStartMonth: 4,                    // April
    warnPct: 80,                        // amber at this % of annual budget used
    breachPct: 100,                     // red at this %
    capexLedgers: '5020,5025,5030,5035,5040,506014',
    excludeHeads: 'al hiber'            // comma separated, matched against head names (lower case)
  };

  // Default ledger code -> text that identifies the budget head (matched inside the head name).
  // Only a starting suggestion: the user can change any mapping on the Mapping tab.
  const MAP_RULES = {
    1005: 'tuition', 1010: 'transport', 1015: 'annual special', 1025: 'tc fee', 1035: 'book sale', 7021: 'book sale',
    1050: 'exam fee', 1055: 'tc fee', 1220: 'canteen', 1264: 'ground rent', 1200: 'others (', 1230: 'others (',
    1240: 'others (', 2501: 'others (',
    3055: 'salaries', 3127: 'salaries', 4076: 'salaries', 4077: 'salaries', 4081: 'salaries', 4082: 'salaries',
    4083: 'salaries', 4091: 'salaries', 3070: 'overtime', 3125: 'overtime', 3035: 'ticket', 3095: 'immigration',
    3050: 'staff accommodation', 3105: 'accommodation expense', 3115: 'staff welfare', 2130: 'concession',
    3126: 'exam registration', 3128: 'book purchase', 2105: 'school premise', 2110: 'maintenance vehicle',
    2115: 'rental vehicles', 2120: 'fuel', 2125: 'ict', 4079: 'ict', 3515: 'printing', 3520: 'communication',
    3630: 'communication', 3525: 'lab materials', 3530: 'electricity', 3535: 'repairs', 4078: 'repairs',
    3550: 'cleaning', 3615: 'cleaning', 3685: 'cleaning', 100302: 'cleaning', 3575: 'legal', 3585: 'management fee',
    3590: 'bank charges', 4072: 'bank charges', 3610: 'events', 3620: 'events', 3635: 'refreshment',
    3640: 'miscellaneous', 4074: 'miscellaneous', 3645: 'conveyance', 3665: 'newspaper', 3670: 'directors',
    5020: 'capital expenditure', 5025: 'capital expenditure', 5030: 'capital expenditure',
    5035: 'capital expenditure', 5040: 'capital expenditure', 506014: 'capital expenditure'
  };

  const num = v => {
    if (typeof v === 'number') return v;
    const s = String(v == null ? '' : v).replace(/[,\s ]/g, '').replace(/^\((.*)\)$/, '-$1');
    const n = parseFloat(s);
    return isNaN(n) ? 0 : n;
  };
  const clean = v => String(v == null ? '' : v).replace(/[ \s]+/g, ' ').trim();
  const round2 = n => Math.round((n + Number.EPSILON) * 100) / 100;

  /* ---------- Approved budget (the "Budget Summary" sheet layout) ---------- */
  // rows = array of arrays (sheet_to_json with header:1). Returns {heads:[{name,section,amount}], totals}.
  function parseBudget(rows) {
    let hdr = -1, nameCol = 1, amtCol = 2;
    for (let i = 0; i < rows.length; i++) {
      const r = rows[i].map(clean);
      const p = r.findIndex(c => /^particulars$/i.test(c));
      if (p >= 0) {
        const b = r.findIndex((c, j) => j > p && /budget/i.test(c) && /2\d{3}/.test(c));
        hdr = i; nameCol = p; amtCol = b >= 0 ? b : p + 1; break;
      }
    }
    if (hdr < 0) throw new Error('Could not find a "Particulars" header with a Budget column. Use the Budget Summary sheet.');
    const heads = [];
    let section = null;
    for (let i = hdr + 1; i < rows.length; i++) {
      const r = rows[i], name = clean(r[nameCol]), up = name.toUpperCase();
      if (!name) continue;
      const val = r[amtCol];
      const hasVal = typeof val === 'number' || (val !== '' && val != null && !isNaN(num(val)) && /\d/.test(String(val)));
      if (!hasVal) {                                   // section / group title rows
        if (/^REVENUE BUDGET/.test(up)) section = 'income';
        else if (/^EXPENDITURE BUDGET/.test(up)) section = 'expense';
        continue;
      }
      if (/^TOTAL OPERATING EXPENSE/.test(up)) { section = 'below'; continue; }
      if (/^(SUB TOTAL|TOTAL)/.test(up)) continue;
      if (section === 'income' || section === 'expense') heads.push({ name, section, amount: num(val) });
      else if (section === 'below') {
        if (/^DEPRECIATION/.test(up) || /^INCOME TAX/.test(up)) heads.push({ name, section: 'expense', amount: num(val) });
        else if (/^LESS: CAPITAL EXPENDITURE/.test(up)) heads.push({ name: 'Capital Expenditure', section: 'capex', amount: num(val) });
      }
    }
    if (!heads.length) throw new Error('No budget lines were found in the sheet.');
    return { heads, totals: budgetTotals(heads) };
  }
  function budgetTotals(heads) {
    const t = { income: 0, expense: 0, capex: 0 };
    heads.forEach(h => t[h.section] += h.amount);
    t.operating = heads.filter(h => h.section === 'expense' && !/^(depreciation|income tax)/i.test(h.name)).reduce((s, h) => s + h.amount, 0);
    return Object.fromEntries(Object.entries(t).map(([k, v]) => [k, round2(v)]));
  }

  /* ---------- ERP trial balance ---------- */
  // DC Netra's "Report.xls" is really an HTML page. Turn its table rows into arrays of cell text.
  // Group rows carry extra empty leading cells, so rows of 6+ cells are cut down to the last 6:
  // [ledger code, particulars, opening Dr, opening Cr, closing Dr, closing Cr].
  function htmlToRows(html) {
    const body = html.slice(Math.max(0, html.search(/<body/i)));
    const rows = [];
    (body.match(/<tr[^>]*>[\s\S]*?<\/tr>/gi) || []).forEach(tr => {
      let cells = (tr.match(/<t[dh][^>]*>[\s\S]*?<\/t[dh]>/gi) || []).map(c => decodeHtml(c.replace(/<[^>]+>/g, ' ')).replace(/[\s\u00a0]+/g, ' ').trim());
      if (cells.length > 6) cells = cells.slice(-6);
      rows.push(cells);
    });
    return rows;
  }
  function decodeHtml(t) {
    return t.replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'");
  }
  const looksLikeHtml = text => /<html|<table|<!doctype/i.test(String(text).slice(0, 4000));

  // rows = array of arrays (xlsx/xls/csv). Returns {from,to,ledgers,totals,checks}.
  function parseTB(rows) {
    let from = null, to = null, hdr = -1;
    for (let i = 0; i < rows.length; i++) {
      const line = rows[i].map(clean).join(' ');
      const m = line.match(/from\s+(\d{1,2})[-\/.](\d{1,2})[-\/.](\d{4})\s+to\s+(\d{1,2})[-\/.](\d{1,2})[-\/.](\d{4})/i);
      if (m) { from = isoDate(+m[3], +m[2], +m[1]); to = isoDate(+m[6], +m[5], +m[4]); }
      if (hdr < 0 && /ledger code/i.test(clean(rows[i][0])) && /particulars/i.test(clean(rows[i][1]))) hdr = i;
    }
    if (hdr < 0) throw new Error('This does not look like a DC Netra Trial Balance (no "Ledger code / Particulars" header).');
    if (!to) throw new Error('Could not find the "From dd-mm-yyyy to dd-mm-yyyy" period line in the file.');
    const ledgers = [], groups = [];
    let main = null, mainType = 'bs', sub = '', total = null;
    for (let i = hdr + 1; i < rows.length; i++) {
      const r = rows[i], code = clean(r[0]), name = clean(r[1]);
      if (!name && !code) continue;
      const n = [2, 3, 4, 5].map(k => num(r[k]));     // open Dr, open Cr, close Dr, close Cr
      if (/^total$/i.test(name)) { total = n; continue; }
      if (!code) {                                     // group row
        const mm = name.match(/^([A-Z]\d)\s*-\s*(.+)$/);
        if (mm) {
          main = mm[1]; sub = '';
          mainType = /revenue|income/i.test(mm[2]) ? 'income' : /expenditure|expense/i.test(mm[2]) ? 'expense' : 'bs';
          groups.push({ level: 1, name, n });
        } else { sub = name; groups.push({ level: 2, name, n }); }
        continue;
      }
      const prefix = code + ' - ';
      const ledgerName = name.startsWith(prefix) ? name.slice(prefix.length) : name;
      ledgers.push({ code, name: ledgerName, main, sub, type: mainType, od: n[0], oc: n[1], cd: n[2], cc: n[3] });
    }
    const sum = (arr, k) => arr.reduce((s, x) => s + x[k], 0);
    const mains = groups.filter(g => g.level === 1);
    const t = total || [0, 1, 2, 3].map(k => mains.reduce((s, g) => s + g.n[k], 0));
    const checks = {
      openingBalanced: round2(t[0] - t[1]) === 0,
      closingBalanced: round2(t[2] - t[3]) === 0,
      totalRowFound: !!total,
      totals: t.map(round2),
      ledgerCount: ledgers.length,
      plDr: round2(sum(ledgers.filter(l => l.type !== 'bs'), 'cd')),
      plCr: round2(sum(ledgers.filter(l => l.type !== 'bs'), 'cc'))
    };
    return { from, to, ledgers, checks };
  }
  function isoDate(y, m, d) { return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`; }

  // Movement for the period (positive number = normal direction for that account type).
  function movement(l, capexSet) {
    const dr = (l.cd - l.cc) - (l.od - l.oc);
    if (l.type === 'income') return round2(-dr);
    if (l.type === 'expense') return round2(dr);
    return capexSet.has(l.code) ? round2(dr) : null;   // other balance-sheet ledgers are excluded
  }
  const capexSetOf = s => new Set(String(s.capexLedgers).split(/[,\s]+/).filter(Boolean));

  function monthsElapsed(toIso, settings) {
    const [y, m] = toIso.split('-').map(Number);
    const fy = m >= settings.fyStartMonth ? y : y - 1;
    return (y - fy) * 12 + m - settings.fyStartMonth + 1;
  }

  /* ---------- default mapping ---------- */
  function findHead(heads, text, section) {
    const t = text.toLowerCase();
    const h = heads.find(h => h.section === section && h.name.toLowerCase().includes(t));
    return h ? h.name : null;
  }
  function suggestMapping(ledgers, heads, settings) {
    const capex = capexSetOf(settings), out = {};
    ledgers.forEach(l => {
      const sec = l.type === 'bs' ? (capex.has(l.code) ? 'capex' : null) : l.type;
      const rule = MAP_RULES[l.code];
      if (!sec || !rule) return;
      const h = findHead(heads, rule, sec);
      if (h) out[l.code] = h;
    });
    return out;
  }

  /* ---------- budget vs actual ---------- */
  // state: {heads, mapping{code->head}, settings}; tb: parsed TB. Returns rows + reconciliation.
  function compute(state, tb) {
    const s = state.settings, capex = capexSetOf(s), months = monthsElapsed(tb.to, s);
    const excl = String(s.excludeHeads || '').toLowerCase().split(',').map(x => x.trim()).filter(Boolean);
    const isExcluded = n => excl.some(x => n.toLowerCase().includes(x));
    const rows = {};
    state.heads.forEach(h => {
      if (isExcluded(h.name)) return;
      rows[h.section + '|' + h.name] = { name: h.name, section: h.section, budget: h.amount, actual: 0, ledgers: [] };
    });
    const unmapped = [];
    let plTotal = 0, mappedTotal = 0, excludedTotal = 0;
    tb.ledgers.forEach(l => {
      const mv = movement(l, capex);
      if (mv === null) return;
      const sec = l.type === 'bs' ? 'capex' : l.type;
      const head = state.mapping[l.code];
      if (l.type !== 'bs') plTotal += l.type === 'income' ? mv : -mv;
      if (head === '__exclude') { if (l.type !== 'bs') excludedTotal += l.type === 'income' ? mv : -mv; return; }
      const row = head && rows[sec + '|' + head];
      if (row) { row.actual += mv; row.ledgers.push({ code: l.code, name: l.name, amount: mv }); mappedTotal += mv; }
      else if (mv !== 0 || l.type !== 'bs') unmapped.push({ code: l.code, name: l.name, section: sec, amount: mv });
    });
    const list = Object.values(rows).map(r => {
      const ytdBudget = r.budget * months / 12, income = r.section === 'income';
      const pct = r.budget ? r.actual / r.budget * 100 : (r.actual ? Infinity : 0);
      const ytdPct = ytdBudget ? r.actual / ytdBudget * 100 : (r.actual ? Infinity : 0);
      const projected = months ? r.actual / months * 12 : 0;
      const variance = income ? r.actual - ytdBudget : ytdBudget - r.actual;   // + = favourable
      let status = 'ok', label = 'On track';
      if (income) { if (ytdPct < 90) { status = 'warn'; label = 'Behind target'; } else if (ytdPct >= 100) label = 'Ahead / on target'; }
      else if (!r.budget && r.actual) { status = 'bad'; label = 'Unbudgeted'; }
      else if (pct >= s.breachPct) { status = 'bad'; label = 'Over budget'; }
      else if (pct >= s.warnPct) { status = 'warn'; label = 'Near limit'; }
      return Object.assign(r, { ytdBudget, pct, ytdPct, available: r.budget - r.actual, variance, projected,
        projectedVar: income ? projected - r.budget : r.budget - projected, status, label });
    });
    const unmappedTotal = unmapped.filter(u => u.section !== 'capex').reduce((a, u) => a + (u.section === 'income' ? u.amount : -u.amount), 0);
    return {
      months, rows: list, unmapped,
      recon: { plNet: round2(plTotal), mappedNet: round2(list.filter(r => r.section === 'income').reduce((a, r) => a + r.actual, 0) -
        list.filter(r => r.section === 'expense').reduce((a, r) => a + r.actual, 0)), unmappedNet: round2(unmappedTotal), excludedNet: round2(excludedTotal) }
    };
  }

  const api = { htmlToRows, looksLikeHtml, DEFAULT_SETTINGS, MAP_RULES, parseBudget, budgetTotals, parseTB, movement, monthsElapsed, suggestMapping, compute, capexSetOf, round2, num, clean };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.SIS = api;
})(typeof window !== 'undefined' ? window : globalThis);
