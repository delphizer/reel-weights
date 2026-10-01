const PALETTE = ['#1F7A8C', '#A23E6A', '#6B7F1A', '#C0661B', '#4B4FA8', '#2F8F5B', '#8A5A2B'];

const DEFAULT_SOURCES = [
  {
    id: 's1', label: 'Top rated, anything (9.5+)', on: true, color: PALETTE[0],
    url: 'https://www.imdb.com/search/title/?title_type=tv_episode,feature,video_game,tv_special,tv_movie,tv_short&release_date=1899-01-01,2075-12-31&user_rating=9.5,10&num_votes=1000,&countries=!GR,!CO,!ES,!BR,!MX,!IR,!PK,!RO,!TH,!RS,!TN,!IT,!BD,!SA,!BG,!LY,!IN,!TR,!JO,!LK&my_watched=exclude&my_ratings=exclude&lists=!watchlist&count=250&sort=release_date,asc'
  },
  {
    id: 's2', label: 'Popular movies since 2010', on: true, color: PALETTE[1],
    url: 'https://www.imdb.com/search/title/?title_type=feature,tv_movie&release_date=2010-01-01,2076-12-31&user_rating=6.7,10&num_votes=100000,&countries=!IN&moviemeter=,3400&my_watched=exclude&my_ratings=exclude&lists=!watchlist&count=250'
  }
];

const DEFAULT_WEIGHTS = { recency: 5, popularity: 5, rating: 5, votes: 3, critics: 3 };

const AUTO_TYPES = [
  { key: 'movie', param: 'feature,tv_movie', label: 'Movies & TV movies', color: '#1F7A8C', minVotes: 10000, yearFrom: 1980, popMax: 5000 },
  { key: 'episode', param: 'tv_episode,tv_special', label: 'TV episodes & specials', color: '#4B4FA8', minVotes: 1000 },
  { key: 'series', param: 'tv_series,tv_miniseries', label: 'TV series & mini series', color: '#2F8F5B', minVotes: 10000 }
];
const DEFAULT_AUTO = {
  schema: 6,
  min: 50,
  max: 200,
  shared: 'countries=!TR,!GR,!CO,!ES,!BR,!MX,!IR,!PK,!RO,!TH,!RS,!TN,!IT,!BD,!SA,!BG,!LY,!IN,!JO,!LK&my_watched=exclude&my_ratings=exclude&lists=!watchlist',
  types: Object.fromEntries(AUTO_TYPES.map((t) => [t.key, { on: true, minVotes: t.minVotes, last: null, adjust: true, extra: '', yearFrom: t.yearFrom ?? null, yearTo: null, popMax: t.popMax ?? null }])),
  genreDeep: true, // extra searches for strongly boosted genres
  genre: {}        // cutoff state for those searches, keyed "movie:sci-fi"
};

// Sliders for the three auto types plus a catch-all, so games, shorts and videos
// from your own searches can be moved too (before, they were stuck at half score).
const TYPE_SLIDERS = [...AUTO_TYPES, { key: 'other', label: 'Other (shorts, games, videos)', color: '#8A5A2B' }];
const DEFAULT_TYPE_WEIGHTS = Object.fromEntries(TYPE_SLIDERS.map((t) => [t.key, 5]));
const TYPE_ALIASES = {
  movie: 'movie', feature: 'movie', tvmovie: 'movie',
  tvepisode: 'episode', tvspecial: 'episode', tvpilot: 'episode',
  tvseries: 'series', tvminiseries: 'series'
};
const typeKeyOf = (idOrText) => {
  const k = String(idOrText || '').toLowerCase().replace(/[^a-z]/g, '');
  return k ? TYPE_ALIASES[k] || 'other' : null;
};

// A genre gets a slider once it's on at least this many titles (or 2% of the list, whichever is more).
const GENRE_MIN_TITLES = 3;
// Genres at +5 or more get their own search per type on the next fetch (up to 4 genres),
// folded into that type's list. Those searches never drop below a 6.0 rating.
const GENRE_SEARCH_AT = 5;
const GENRE_SEARCH_MAX = 4;
const GENRE_FLOOR = 60;
const genreSlug = (g) => g.toLowerCase().replace(/\s+/g, '-');
const deepGenres = () => (state.auto.genreDeep === false ? [] :
  Object.entries(ui.genreWeights).filter(([, v]) => v >= GENRE_SEARCH_AT)
    .sort((a, b) => b[1] - a[1]).slice(0, GENRE_SEARCH_MAX).map(([g]) => g));


const EXPLAIN = {
  weighted: 'One set of sliders for everything. Age, rating, votes, critics and popularity are ranked within each type (movies against movies, episodes against episodes), since a 9.5 episode with 2k votes and a 9.5 movie with 500k aren\'t comparable. Genre sliders count the same way as the others (Sci-Fi at 7 matters as much as User rating at 7). Then the type sliders set your mix. The score shown is relative: the top title is 100. User rating is adjusted for vote count. Titles without a Metascore count as average for critics.',
  adjusted: 'IMDb rating pulled toward the average for its type until it has enough votes to trust (the same idea IMDb uses for its Top 250). Titles with few votes drop; well-loved big titles rise.',
  standing: 'Each title is ranked by rating within the search it came from, so a 9.6 episode with 1,200 votes and an 8.4 movie with 900k votes can both sit near the top of their own lists. The bar shows that position: full means best in that list.',
  interleave: 'Takes one title from each list in turn, keeping each search\'s own sort order (release date, popularity, etc).',
  rating: 'Raw IMDb rating, ties broken by vote count. Low-vote titles tend to dominate this view.',
  votes: 'Most-voted first. Big movies will dominate this view.',
  new: '', old: ''
};

let state = { tagCache: {}, tagNote: '', sources: [], hidden: new Set(), results: null, auto: structuredClone(DEFAULT_AUTO) };
const ui = {
  sort: 'weighted', type: 'all', genre: 'all', maxLen: 0, perShow: 3, showMode: 'group', q: '', showHidden: false, showRunning: true,
  weights: { ...DEFAULT_WEIGHTS }, typeWeights: { ...DEFAULT_TYPE_WEIGHTS }, genreWeights: {}, subWeights: {}, subOpen: false
};
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmtVotes = new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 });

/* ---------- storage ---------- */
async function load() {
  const s = await chrome.storage.local.get(['sources', 'hidden', 'results', 'ui', 'auto', 'tagCache', 'tagNote']);
  state.tagCache = s.tagCache || {};
  state.tagNote = s.tagNote || '';
  state.sources = Array.isArray(s.sources) ? s.sources : structuredClone(DEFAULT_SOURCES);
  state.hidden = new Set(s.hidden || []);
  state.results = s.results || null;
  Object.assign(ui, s.ui || {});
  // v1.2 briefly had a set of weights per type; keep whichever tab was showing.
  let sw = s.ui?.weights || {};
  if (typeof sw.rating !== 'number' && sw.movie) sw = sw[s.ui.weightTab] || sw.movie;
  ui.weights = { ...DEFAULT_WEIGHTS, ...sw };
  delete ui.weightTab;
  ui.typeWeights = { ...DEFAULT_TYPE_WEIGHTS, ...(s.ui?.typeWeights || {}) };
  ui.genreWeights = { ...(s.ui?.genreWeights || {}) };
  ui.subWeights = { ...(s.ui?.subWeights || {}) };
  if (s.auto) {
    state.auto = { ...DEFAULT_AUTO, ...s.auto, types: { ...DEFAULT_AUTO.types } };
    for (const k of Object.keys(DEFAULT_AUTO.types)) state.auto.types[k] = { ...DEFAULT_AUTO.types[k], ...(s.auto.types?.[k] || {}) };
    if (s.auto.schema !== DEFAULT_AUTO.schema) {
      // Older version: type groups and target changed, so forget learned cutoffs.
      state.auto.schema = DEFAULT_AUTO.schema;
      state.auto.min = DEFAULT_AUTO.min; state.auto.max = DEFAULT_AUTO.max;
      delete state.auto.target;
      for (const [k, c] of Object.entries(state.auto.types)) { Object.assign(c, DEFAULT_AUTO.types[k]); }
    }
  }
  state.auto.genre = { ...(s.auto?.genre || {}) };
  if (state.auto.genreDeep == null) state.auto.genreDeep = true;
  for (const c of Object.values(state.auto.types)) {
    if (!c.extra) continue;
    const p = new URLSearchParams(c.extra);
    const rd = p.get('release_date');
    if (rd != null) {
      const [from, to] = rd.split(',');
      c.yearFrom = parseInt(from) || null;
      c.yearTo = to && parseInt(to) < 2070 ? parseInt(to) : null;
      p.delete('release_date');
    }
    const mm = p.get('moviemeter');
    if (mm != null) { c.popMax = parseInt(mm.split(',')[1]) || null; p.delete('moviemeter'); }
    c.extra = decodeURIComponent(p.toString());
  }
  buildTypeSliders();
  renderAuto();
  $('sort').value = ui.sort;
  $('maxLen').value = String(ui.maxLen || 0);
  $('perShow').value = ui.showMode === 'all' ? 'all' : 'group';
  syncSliders();
  $('showHidden').checked = ui.showHidden;
  $('showRunning').checked = ui.showRunning !== false;
  renderSources();
  render();
  if (state.results) setStatus(`Last fetched ${new Date(state.results.fetchedAt).toLocaleString()}.`);
}
const saveAuto = () => chrome.storage.local.set({ auto: state.auto });
const saveSources = () => chrome.storage.local.set({ sources: state.sources });
const saveHidden = () => chrome.storage.local.set({ hidden: [...state.hidden] });
const saveUi = () => chrome.storage.local.set({ ui });
const setStatus = (t) => { $('status').textContent = t; };

/* ---------- shared filters as checkboxes ----------
   a.shared stays the stored URL fragment; the checkboxes read and rewrite it. */
const BIG_COUNTRIES = [ // excluded on their own: these add the most titles to IMDb results
  ['IN', 'India'], ['TR', 'Turkey'], ['IT', 'Italy'], ['ES', 'Spain'],
  ['BR', 'Brazil'], ['MX', 'Mexico'], ['IR', 'Iran']
];
const OTHER_COUNTRIES = [
  ['GR', 'Greece'], ['CO', 'Colombia'], ['PK', 'Pakistan'], ['RO', 'Romania'], ['TH', 'Thailand'],
  ['RS', 'Serbia'], ['TN', 'Tunisia'], ['BD', 'Bangladesh'], ['SA', 'Saudi Arabia'], ['BG', 'Bulgaria'],
  ['LY', 'Libya'], ['JO', 'Jordan'], ['LK', 'Sri Lanka']
];

function parseShared(str) {
  const out = { watched: false, rated: false, watchlist: false, countries: new Set(), lists: [], rest: [] };
  for (const part of (str || '').split('&')) {
    if (!part.trim()) continue;
    const i = part.indexOf('=');
    const key = i < 0 ? part : part.slice(0, i);
    let val = i < 0 ? '' : part.slice(i + 1);
    try { val = decodeURIComponent(val); } catch {}
    if (key === 'my_watched' && val === 'exclude') out.watched = true;
    else if (key === 'my_ratings' && val === 'exclude') out.rated = true;
    else if (key === 'countries') {
      for (const c of val.split(',')) {
        const code = c.trim().toUpperCase();
        if (code.startsWith('!')) out.countries.add(code.slice(1));
        else if (code) out.rest.push(`countries=${code}`); // an "only these countries" filter: leave it alone
      }
    } else if (key === 'lists') {
      for (const l of val.split(',')) {
        if (l === '!watchlist') out.watchlist = true;
        else if (l) out.lists.push(l);
      }
    } else out.rest.push(part);
  }
  return out;
}

function buildShared(f) {
  const parts = [];
  if (f.countries.size) parts.push('countries=' + [...f.countries].map((c) => '!' + c).join(','));
  if (f.watched) parts.push('my_watched=exclude');
  if (f.rated) parts.push('my_ratings=exclude');
  const lists = [...(f.watchlist ? ['!watchlist'] : []), ...f.lists];
  if (lists.length) parts.push('lists=' + lists.join(','));
  return [...parts, ...f.rest].join('&');
}

/* ---------- auto searches sidebar ---------- */
function renderAuto() {
  const a = state.auto;
  const box = $('auto');
  box.innerHTML = `
    <div class="auto-top">
      <label>Between <input type="number" id="autoMin" min="1" max="250" step="10" value="${a.min}"> and <input type="number" id="autoMax" min="1" max="250" step="10" value="${a.max}"> titles per type</label>
      ${(() => {
        const f = parseShared(a.shared);
        const box = (attrs, checked, label, title = '') =>
          `<label class="chip"${title ? ` title="${esc(title)}"` : ''}><input type="checkbox" ${attrs} ${checked ? 'checked' : ''}> ${esc(label)}</label>`;
        const known = new Set([...BIG_COUNTRIES, ...OTHER_COUNTRIES].map(([c]) => c));
        const otherOn = OTHER_COUNTRIES.filter(([c]) => f.countries.has(c)).length;
        const custom = [...f.countries].filter((c) => !known.has(c));
        return `
        <fieldset class="shared">
          <legend>Filters used by every type</legend>
          <div class="chips">
            ${box('data-mine="watched"', f.watched, "Hide titles I've watched")}
            ${box('data-mine="rated"', f.rated, "Hide titles I've rated")}
            ${box('data-mine="watchlist"', f.watchlist, 'Hide my watchlist')}
          </div>
          <div class="sublabel">Leave out titles from</div>
          <div class="chips">
            ${BIG_COUNTRIES.map(([c, name]) => box(`data-country="${c}"`, f.countries.has(c), name)).join('')}
            ${box('data-country="other" id="otherCountries"', otherOn === OTHER_COUNTRIES.length, `Other countries (${OTHER_COUNTRIES.length})`,
                  OTHER_COUNTRIES.map(([, n]) => n).join(', '))}
          </div>
          ${custom.length ? `<div class="sublabel">Also left out: ${esc(custom.join(', '))} <button class="linkish" id="clearCustom">remove</button></div>` : ''}
          <label class="stack">More filters, in IMDb URL form
            <input type="text" id="sharedRest" spellcheck="false" placeholder="e.g. genres=!horror" value="${esc([...f.rest, ...(f.lists.length ? ['lists=' + f.lists.join(',')] : [])].join('&'))}">
          </label>
        </fieldset>`;
      })()}
      <label class="adj"><input type="checkbox" id="genreDeep" ${a.genreDeep !== false ? 'checked' : ''}> Search deeper for genres set to +${GENRE_SEARCH_AT} or more (one extra search per type, per genre)</label>
    </div>
    ${AUTO_TYPES.map((t) => {
      const c = a.types[t.key];
      const r = state.results?.bySource?.['auto-' + t.key];
      let note = '', cls = '';
      const now = [...pending].find(([id, v]) => (id === 'auto-' + t.key || id.startsWith(`genre-${t.key}-`)) && v !== 'Waiting…');
      if (now) { note = now[1]; cls = 'busy'; }
      else if (pending.has('auto-' + t.key)) { note = 'Waiting…'; cls = 'busy'; }
      else if (r && !r.ok) { note = `Failed: ${r.error}`; cls = 'err'; }
      else if (r && r.threshold != null) {
        const n = r.total ?? r.items.length;
        const shown = r.items.length < n ? ` (showing ${r.items.length})` : '';
        note = `Rating ${r.threshold.toFixed(1)}+, ${r.votes.toLocaleString()}+ votes gave ${n.toLocaleString()} titles${shown}.`;
        if (r.nextNote) { note += ' ' + r.nextNote; cls = 'warn'; }
      }
      return `
      <div class="src auto" style="--c:${t.color}" data-key="${t.key}">
        <div class="src-head">
          <input type="checkbox" ${c.on ? 'checked' : ''} aria-label="Include ${t.label}">
          <span class="label">${t.label}</span>
        </div>
        <div class="fields">
          <label>Rating from <input type="number" class="f-rating" min="1" max="9.9" step="0.1" value="${((c.last ?? 80) / 10).toFixed(1)}"></label>
          <label>Votes from <input type="number" class="f-votes" min="0" step="500" value="${voteFloor(c.minVotes, c.bump)}"></label>
        </div>
        <div class="fields">
          <label>Year from <input type="number" class="f-yfrom" min="1880" max="2100" step="1" placeholder="any" value="${c.yearFrom ?? ''}"></label>
          <label>to <input type="number" class="f-yto" min="1880" max="2100" step="1" placeholder="any" value="${c.yearTo ?? ''}"></label>
        </div>
        <div class="fields">
          <label>Popularity rank up to <input type="number" class="f-pop" min="1" step="500" placeholder="any" value="${c.popMax ?? ''}"></label>
        </div>
        <label class="adj"><input type="checkbox" class="f-adjust" ${c.adjust !== false ? 'checked' : ''}> Adjust rating and votes after each fetch to stay between ${a.min} and ${a.max}</label>
        <label class="extra">Extra filters for this type
          <input type="text" class="f-extra" spellcheck="false" placeholder="Anything else, in IMDb URL form, e.g. genres=comedy" value="${esc(c.extra || '')}">
        </label>
        ${note ? `<div class="note ${cls}">${esc(note)}</div>` : ''}
        ${r?.url && !pending.has('auto-' + t.key) ? `<a class="openlink" href="${esc(r.url)}" target="_blank" rel="noopener">Open this search on IMDb</a>` : ''}
        ${genreNotes(t.key)}
      </div>`;
    }).join('')}`;
  const fixRange = () => {
    a.min = Math.min(250, Math.max(1, Number($('autoMin').value) || 50));
    a.max = Math.min(250, Math.max(a.min, Number($('autoMax').value) || 200));
    $('autoMin').value = a.min; $('autoMax').value = a.max;
    for (const c of [...Object.values(a.types), ...Object.values(a.genre)]) resetBracket(c);
    saveAuto();
  };
  $('autoMin').onchange = fixRange;
  $('genreDeep').onchange = (e) => { a.genreDeep = e.target.checked; saveAuto(); };
  $('autoMax').onchange = fixRange;
  const setShared = (f) => {
    a.shared = buildShared(f);
    for (const c of [...Object.values(a.types), ...Object.values(a.genre)]) resetBracket(c); // different filters, different counts
    saveAuto();
  };
  const other = $('otherCountries');
  const someOther = OTHER_COUNTRIES.filter(([c]) => parseShared(a.shared).countries.has(c)).length;
  other.indeterminate = someOther > 0 && someOther < OTHER_COUNTRIES.length;
  box.querySelectorAll('fieldset.shared input[type=checkbox]').forEach((el) => {
    el.onchange = () => {
      const f = parseShared(a.shared);
      if (el.dataset.mine) f[el.dataset.mine] = el.checked;
      else if (el.dataset.country === 'other') {
        for (const [c] of OTHER_COUNTRIES) el.checked ? f.countries.add(c) : f.countries.delete(c);
        el.indeterminate = false;
      } else if (el.dataset.country) el.checked ? f.countries.add(el.dataset.country) : f.countries.delete(el.dataset.country);
      setShared(f);
    };
  });
  $('clearCustom')?.addEventListener('click', () => {
    const f = parseShared(a.shared);
    const known = new Set([...BIG_COUNTRIES, ...OTHER_COUNTRIES].map(([c]) => c));
    for (const c of [...f.countries]) if (!known.has(c)) f.countries.delete(c);
    setShared(f); renderAuto();
  });
  $('sharedRest').onchange = (e) => {
    const f = parseShared(a.shared);
    // Whatever's typed here replaces the old "more filters"; countries/watched/rated/watchlist typed here are understood too.
    const typed = parseShared(e.target.value.trim().replace(/^[?&]+/, ''));
    f.rest = typed.rest; f.lists = typed.lists;
    for (const c of typed.countries) f.countries.add(c);
    if (typed.watched) f.watched = true;
    if (typed.rated) f.rated = true;
    if (typed.watchlist) f.watchlist = true;
    setShared(f); renderAuto();
  };
  box.querySelectorAll('.src.auto').forEach((el) => {
    const c = a.types[el.dataset.key];
    el.querySelector('input[type=checkbox]').onchange = (e) => { c.on = e.target.checked; saveAuto(); render(); };
    const reopen = (keepVotes = false) => {
      if (!keepVotes) c.bump = 0;
      resetBracket(c);
      // The type's genre searches share its filters, so their cutoffs start over too.
      for (const [k, g] of Object.entries(a.genre)) if (k.startsWith(el.dataset.key + ':')) { g.bump = 0; g.last = null; resetBracket(g); }
    };
    el.querySelector('.f-rating').onchange = (e) => {
      const v = Math.round(Math.min(9.9, Math.max(1, Number(e.target.value) || 8)) * 10);
      c.last = v; reopen(true); e.target.value = (v / 10).toFixed(1); saveAuto();
    };
    const intOrNull = (v) => (v === '' ? null : Math.max(0, parseInt(v)) || null);
    el.querySelector('.f-yfrom').onchange = (e) => { c.yearFrom = intOrNull(e.target.value); reopen(); saveAuto(); };
    el.querySelector('.f-yto').onchange = (e) => { c.yearTo = intOrNull(e.target.value); reopen(); saveAuto(); };
    el.querySelector('.f-pop').onchange = (e) => { c.popMax = intOrNull(e.target.value); reopen(); saveAuto(); };
    el.querySelector('.f-votes').onchange = (e) => { c.minVotes = Math.max(0, Number(e.target.value) || 0); reopen(); saveAuto(); };
    el.querySelector('.f-adjust').onchange = (e) => { c.adjust = e.target.checked; reopen(); saveAuto(); };
    el.querySelector('.f-extra').onchange = (e) => { c.extra = e.target.value.trim().replace(/^[?&]+/, ''); reopen(); saveAuto(); };
  });
}

// One line per deeper genre search under each type card.
function genreNotes(typeKey) {
  const rows = Object.entries(state.results?.bySource || {})
    .filter(([id, r]) => id.startsWith(`genre-${typeKey}-`) && r && !pending.has(id))
    .map(([, r]) => {
      if (!r.ok) return `<div class="note err">${esc(r.genre || 'Genre')} search failed: ${esc(r.error)}</div>`;
      const n = r.total ?? r.items.length;
      const txt = `+ ${r.genre}: rating ${r.threshold.toFixed(1)}+, ${(r.votes ?? 0).toLocaleString()}+ votes gave ${n.toLocaleString()} titles.${r.nextNote ? ' ' + r.nextNote : ''}`;
      return `<div class="note ${r.nextNote ? 'warn' : ''}">${esc(txt)} <a class="openlink" href="${esc(r.url)}" target="_blank" rel="noopener">Open</a></div>`;
    });
  return rows.join('');
}

function allSources() {
  const auto = AUTO_TYPES.map((t) => ({
    id: 'auto-' + t.key, label: t.label, color: t.color, on: state.auto.types[t.key].on, typeKey: t.key
  }));
  return [...auto, ...state.sources];
}

/* ---------- sources sidebar ---------- */
function renderSources() {
  const box = $('sources');
  box.innerHTML = '';
  state.sources.forEach((s) => {
    const r = state.results?.bySource?.[s.id];
    let note = '', cls = '';
    if (pending.has(s.id)) { note = pending.get(s.id); cls = 'busy'; }
    else if (r) {
      if (!r.ok) { note = `Failed: ${r.error}`; cls = 'err'; }
      else if (r.total && r.total > r.items.length) {
        note = `${r.items.length} of ${r.total.toLocaleString()} loaded. IMDb only serves the first page; tighten the filters to see the rest.`; cls = 'warn';
      } else note = `${r.items.length} titles loaded.`;
      if (r.ok && r.stale) { note = 'URL changed since last fetch. Fetch again.'; cls = 'warn'; }
    }
    const el = document.createElement('div');
    el.className = 'src';
    el.style.setProperty('--c', s.color);
    el.innerHTML = `
      <div class="src-head">
        <input type="checkbox" ${s.on ? 'checked' : ''} aria-label="Include in results">
        <input class="label" value="${esc(s.label)}" aria-label="Search name">
        <button class="remove" title="Remove search" aria-label="Remove search">×</button>
      </div>
      <textarea spellcheck="false" aria-label="IMDb search URL" placeholder="Paste an imdb.com/search/title/?… URL">${esc(s.url)}</textarea>
      ${note ? `<div class="note ${cls}">${esc(note)}</div>` : ''}`;
    const [chk, label, rm] = el.querySelectorAll('input[type=checkbox], .label, .remove');
    chk.onchange = () => { s.on = chk.checked; saveSources(); render(); };
    label.oninput = () => { s.label = label.value; saveSources(); };
    label.onchange = () => render();
    el.querySelector('textarea').onchange = (e) => {
      s.url = e.target.value.trim();
      if (state.results?.bySource?.[s.id]) state.results.bySource[s.id].stale = true;
      saveSources(); renderSources();
    };
    rm.onclick = () => {
      if (!confirm(`Remove "${s.label}"?`)) return;
      state.sources = state.sources.filter((x) => x !== s);
      if (state.results?.bySource?.[s.id]) {
        delete state.results.bySource[s.id];
        chrome.storage.local.set({ results: state.results });
      }
      saveSources(); renderSources(); render();
    };
    box.appendChild(el);
  });
}

$('addBtn').onclick = () => {
  const used = new Set(state.sources.map((s) => s.color));
  state.sources.push({
    id: 's' + Date.now(), label: `Search ${state.sources.length + 1}`, on: true, url: '',
    color: PALETTE.find((c) => !used.has(c)) || PALETTE[state.sources.length % PALETTE.length]
  });
  saveSources(); renderSources();
  $('sources').lastElementChild.querySelector('textarea').focus();
};

/* ---------- fetching ---------- */
// Requests run inside an imdb.com tab so they carry your login cookies
// (needed for "exclude watched / rated / watchlist").
const withTimeout = (p, ms, msg) =>
  Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error(msg)), ms))]);

// A fresh tab each time: an IMDb tab that's been sitting in the background
// can be frozen or throttled by Chrome, which made fetches hang.
async function getImdbTab() {
  const tab = await chrome.tabs.create({ url: 'https://www.imdb.com/robots.txt', active: false });
  await withTimeout(new Promise((resolve) => {
    const listener = (id, info) => {
      if (id === tab.id && info.status === 'complete') { chrome.tabs.onUpdated.removeListener(listener); resolve(); }
    };
    chrome.tabs.onUpdated.addListener(listener);
    chrome.tabs.get(tab.id).then((t) => { if (t.status === 'complete') { chrome.tabs.onUpdated.removeListener(listener); resolve(); } });
  }), 20000, 'imdb.com took more than 20 seconds to open. Check your connection and try again.');
  return { tabId: tab.id, created: true };
}

function withCount(url) {
  try {
    const u = new URL(url);
    if (!u.searchParams.has('count')) u.searchParams.set('count', '250');
    return u.toString();
  } catch { return url; }
}

async function scrapeOne(tabId, url) {
  const [inj] = await withTimeout(
    chrome.scripting.executeScript({ target: { tabId }, func: scrapeSearches, args: [[url]] }),
    30000, 'IMDb didn\'t answer within 30 seconds. Use the link below to open the search and see what IMDb shows.');
  return inj.result[0];
}

const pending = new Map(); // source id -> "what it's doing" text

function autoUrl(t, cfg) {
  const tenths = cfg.last ?? 80;
  const votes = voteFloor(cfg.minVotes, cfg.bump);
  return {
    tenths, votes,
    url: `https://www.imdb.com/search/title/?title_type=${t.param}&user_rating=${(tenths / 10).toFixed(1)},10` +
      `&num_votes=${votes},&count=250` +
      (cfg.yearFrom || cfg.yearTo ? `&release_date=${cfg.yearFrom ? cfg.yearFrom + '-01-01' : ''},${cfg.yearTo ? cfg.yearTo + '-12-31' : ''}` : '') +
      (cfg.popMax ? `&moviemeter=,${cfg.popMax}` : '') +
      (state.auto.shared ? '&' + state.auto.shared : '') + (cfg.extra ? '&' + cfg.extra : '') +
      (cfg.genre ? '&genres=' + encodeURIComponent(cfg.genre) : '')
  };
}

// Current vote floor: the number typed in "Votes from", times 2^bump, rounded to 3 significant digits.
function voteFloor(minVotes, bump = 0) {
  if (!bump) return minVotes;
  const v = Math.max(minVotes || 100, 100) * 2 ** bump;
  const p = 10 ** Math.max(0, Math.floor(Math.log10(v)) - 2);
  return Math.max(10, Math.round(v / p) * p);
}
const BUMP_MIN = -3, BUMP_MAX = 10; // vote floor can go from 1/8 of your number up to 1024x

/* One request per search per fetch; afterwards both knobs move for the next fetch.
   Model: ln(titles) ≈ c − α·rating − β·log2(votes), with rating in tenths.
   α and β start from typical IMDb values and are re-fit from this search's own
   past fetches (ridge regression pulled toward those starting values). The change
   needed in ln(titles) is split in half: half from the rating, half from the votes.
   If one knob hits a limit, the other covers the rest. */
const PRIOR = { alpha: 0.12, beta: 0.6 };   // per 0.1 of rating; per doubling of votes
const RIDGE = { alpha: 30, beta: 3 };

function resetBracket(c) {
  c.hist = [];
  c.many = c.manyN = c.few = c.fewN = c.settled = undefined; // fields from older versions
  c.lo = c.hi = undefined;
  c.lastDelta = null;
}

function fitSlopes(hist) {
  if (!hist.length) return { ...PRIOR };
  // Solve (XᵀX + Λ)θ = Xᵀy + Λθ0 for θ = [c, a, b], y = c + a·r + b·k.
  const A = [[0, 0, 0], [0, RIDGE.alpha, 0], [0, 0, RIDGE.beta]];
  const v = [0, RIDGE.alpha * -PRIOR.alpha, RIDGE.beta * -PRIOR.beta];
  for (const { r, k, y } of hist) {
    const x = [1, r, k];
    for (let i = 0; i < 3; i++) { v[i] += x[i] * y; for (let j = 0; j < 3; j++) A[i][j] += x[i] * x[j]; }
  }
  for (let i = 0; i < 3; i++) {
    let piv = i;
    for (let j = i + 1; j < 3; j++) if (Math.abs(A[j][i]) > Math.abs(A[piv][i])) piv = j;
    [A[i], A[piv]] = [A[piv], A[i]]; [v[i], v[piv]] = [v[piv], v[i]];
    if (Math.abs(A[i][i]) < 1e-9) return { ...PRIOR };
    for (let j = i + 1; j < 3; j++) {
      const f = A[j][i] / A[i][i];
      for (let m = i; m < 3; m++) A[j][m] -= f * A[i][m];
      v[j] -= f * v[i];
    }
  }
  const th = [0, 0, 0];
  for (let i = 2; i >= 0; i--) {
    let t = v[i];
    for (let m = i + 1; m < 3; m++) t -= A[i][m] * th[m];
    th[i] = t / A[i][i];
  }
  const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x));
  return { alpha: clamp(-th[1], 0.02, 0.6), beta: clamp(-th[2], 0.15, 2) };
}

function stepCutoff(cfg, n, floor = 10, capped = false, baseVotes = cfg.minVotes) {
  const { min, max } = state.auto;
  const r0 = cfg.last ?? 80, k0 = cfg.bump ?? 0;
  const y = Math.log(Math.max(n, 0.5) * (capped ? 2 : 1)); // "250 shown, total unknown" means at least that many
  cfg.hist = [...(cfg.hist || []), { r: r0, k: k0, y }].slice(-8);
  if (n >= min && n <= max) return null;

  const { alpha, beta } = fitSlopes(cfg.hist);
  let delta = Math.log(Math.sqrt(min * max)) - y; // aim for the middle of the range, on a log scale
  // Overshot last time (too many, then too few, or the reverse)? Take a smaller step.
  if (cfg.lastDelta && Math.sign(cfg.lastDelta) !== Math.sign(delta)) delta *= 0.6;
  // Counts near 0 (or far above the range) say little about how far to go; cap one fetch at about 12x either way.
  delta = Math.max(-2.5, Math.min(2.5, delta));
  cfg.lastDelta = delta;
  // Moving dr tenths and dk doublings changes ln(titles) by −α·dr − β·dk.
  const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x));
  const rLo = floor, rHi = 99;
  const QK = 32; // vote steps of 1/32 of a doubling (about 2%), so votes can fine-tune
  const qk = (x) => clamp(Math.round(x * QK) / QK, BUMP_MIN, BUMP_MAX);
  // Half the change from the rating. IMDb ratings go in 0.1 steps, so it can only
  // get close to half; votes are nearly continuous and make up the difference.
  let r = clamp(Math.round(r0 + clamp(-delta / 2 / alpha, -15, 15)), rLo, rHi);
  const needK = (delta + alpha * (r - r0)) / -beta;             // what votes must do for the rest
  let k = qk(k0 + clamp(needK, -2, 2));
  // Votes hit a limit? Give what's left back to the rating.
  const left = delta - (-alpha * (r - r0) - beta * (k - k0));
  if (Math.abs(left) > 0.03) r = clamp(Math.round(r - left / alpha), rLo, rHi);
  // Always move at least a little the right way.
  if (r === r0 && k === k0) {
    const dir = delta > 0 ? -1 : 1;
    k = qk(k0 + dir / QK * 2);
    if (k === k0) r = clamp(r0 + dir, rLo, rHi);
  }
  const f = (t) => (t / 10).toFixed(1);
  const vf = (kk) => (voteFloor(baseVotes, kk) ?? 0).toLocaleString();
  if (r === r0 && k === k0) {
    return delta > 0
      ? `Too few even at ${f(r0)}+ and ${vf(k0)}+ votes; that's everything within the limits.`
      : `Too many even at ${f(r0)}+ and ${vf(k0)}+ votes.`;
  }
  cfg.last = r; cfg.bump = k;
  return `Outside ${min}–${max}; next fetch will try ${f(r)}+ and ${vf(k)}+ votes.`;
}

$('fetchBtn').onclick = async () => {
  const autos = AUTO_TYPES.filter((t) => state.auto.types[t.key].on);
  const srcs = state.sources.filter((s) => s.on && s.url.trim());
  if (!autos.length && !srcs.length) { setStatus('Turn on at least one type or search first.'); return; }
  const bad = srcs.find((s) => !/^https:\/\/www\.imdb\.com\/search\/title\//.test(s.url));
  if (bad) { setStatus(`"${bad.label}" isn't an imdb.com/search/title URL.`); return; }

  // Deeper searches for strongly boosted genres, one per type; their results are
  // folded into that type's list, so they're ranked with (and like) the rest of the type.
  const genres = deepGenres();
  const jobs = [
    ...autos.map((t) => ({ id: 'auto-' + t.key, label: t.label, auto: t })),
    ...autos.flatMap((t) => genres.map((g) => ({ id: `genre-${t.key}-${genreSlug(g)}`, label: `${t.label}: ${g}`, auto: t, genre: g }))),
    ...srcs.map((s) => ({ id: s.id, label: s.label, src: s }))
  ];
  // New genre searches start half a point below their type's current cutoff, so they
  // reach deeper from the first fetch. (Set before the type searches adjust their own.)
  for (const j of jobs) {
    if (!j.genre) continue;
    const gk = `${j.auto.key}:${genreSlug(j.genre)}`;
    const typeLast = state.auto.types[j.auto.key].last ?? 80;
    const g = state.auto.genre[gk] ||= {};
    if (g.last == null) g.last = Math.max(GENRE_FLOOR, typeLast - 5);
  }
  $('fetchBtn').disabled = true;
  jobs.forEach((j) => pending.set(j.id, 'Waiting…'));
  renderAuto(); renderSources();

  // Carry over results only for searches that still exist (removed ones used to pile up).
  const live = new Set([...allSources().map((s) => s.id), ...jobs.map((j) => j.id)]);
  state.results = {
    fetchedAt: Date.now(),
    bySource: Object.fromEntries(Object.entries(state.results?.bySource || {}).filter(([id]) => live.has(id)))
  };
  let tab, done = 0, failed = 0;
  const progress = () => setStatus(`Fetched ${done} of ${jobs.length} searches${failed ? `, ${failed} failed` : ''}…`);
  try {
    setStatus('Opening IMDb in a background tab…');
    tab = await getImdbTab();
    progress();
    for (const j of jobs) {
      if (done) await new Promise((r) => setTimeout(r, 600));
      pending.set(j.id, j.genre ? `Fetching the deeper ${j.genre} search…` : 'Fetching now…');
      renderAuto(); renderSources();
      let entry;
      try {
        if (j.auto) {
          const typeCfg = state.auto.types[j.auto.key];
          let cfg = typeCfg, urlCfg = typeCfg, floor = 10;
          if (j.genre) {
            // Same filters as the type, but its own rating cutoff that can go deeper.
            const gk = `${j.auto.key}:${genreSlug(j.genre)}`;
            cfg = state.auto.genre[gk];
            urlCfg = { ...typeCfg, last: cfg.last, bump: cfg.bump ?? 0, genre: genreSlug(j.genre) };
            floor = GENRE_FLOOR;
          }
          const { url, tenths, votes } = autoUrl(j.auto, urlCfg);
          j.url = url;
          const r = await scrapeOne(tab.tabId, url);
          if (!r.ok) throw new Error(r.error);
          const n = r.total ?? r.items.length;
          const next = typeCfg.adjust === false ? null : stepCutoff(cfg, n, floor, r.total == null && r.items.length >= 250, typeCfg.minVotes);
          entry = {
            ok: true, total: r.total, threshold: tenths / 10, votes, url, genre: j.genre || null,
            nextNote: next || '',
            items: r.items.map((it) => ({ ...norm(it), typeKey: j.auto.key })).filter((x) => x.id)
          };
          await saveAuto();
        } else {
          j.url = withCount(j.src.url);
          const r = await scrapeOne(tab.tabId, j.url);
          if (!r.ok) throw new Error(r.error);
          entry = { ok: true, total: r.total, items: r.items.map(norm).filter((x) => x.id) };
        }
      } catch (e) {
        failed++;
        entry = { ok: false, error: e.message, items: [], url: j.url };
      }
      state.results.bySource[j.id] = entry;
      pending.delete(j.id);
      done++;
      progress();
      renderAuto(); renderSources(); render(); // results appear as each search lands
    }
    await chrome.storage.local.set({ results: state.results });
    await loadSubGenres(tab.tabId);
    const n = new Set(Object.values(state.results.bySource).flatMap((r) => r.items.map((x) => x.id))).size;
    setStatus(failed
      ? `Done with ${failed} failed search${failed > 1 ? 'es' : ''}; see the sidebar. ${n} titles shown.`
      : `Fetched ${n} titles at ${new Date().toLocaleTimeString()}.`);
    // Pop up help when this fetch got nothing, or IMDb sent a page that wasn't search results.
    const fresh = jobs.map((j) => ({ j, r: state.results.bySource[j.id] }));
    const got = fresh.reduce((t, { r }) => t + (r?.items?.length || 0), 0);
    const blocked = fresh.find(({ r }) => r && !r.ok && /without search results|HTTP (403|429|503)/.test(r.error || ''));
    if (got === 0 || blocked) {
      const pick = blocked || fresh.find(({ r }) => r && !r.ok) || fresh[0];
      showTrouble(pick?.r?.url || pick?.j?.url,
        blocked ? `"${blocked.j.label}" got a page back from IMDb that wasn't search results.`
          : `None of your ${jobs.length} searches returned any titles.`);
    }
  } catch (e) {
    setStatus(`Couldn't fetch: ${e.message}`);
  } finally {
    pending.clear();
    if (tab?.created) chrome.tabs.remove(tab.tabId).catch(() => {});
    $('fetchBtn').disabled = false;
    renderAuto(); renderSources(); render();
  }
};

function showTrouble(url, why) {
  const dlg = $('trouble');
  if (dlg.open) return;
  $('troubleWhy').textContent = why;
  const link = $('troubleLink');
  link.href = url || 'https://www.imdb.com/';
  link.textContent = url ? 'Open the search on IMDb' : 'Open IMDb';
  $('troubleClose').onclick = () => dlg.close();
  dlg.showModal();
}

/* Sub-genres aren't in search results, so ask IMDb's GraphQL API (the one imdb.com itself
   uses) for every title's "interests" in batches of 100: a handful of requests per fetch,
   and only for titles not already cached (tags rarely change). */
async function loadSubGenres(tabId) {
  const ids = new Set(Object.values(state.results.bySource).flatMap((r) => (r.items || []).map((x) => x.id)));
  const missing = [...ids].filter((id) => !(id in state.tagCache));
  if (!missing.length) return;
  const chunks = [];
  for (let i = 0; i < missing.length; i += 100) chunks.push(missing.slice(i, i + 100));
  setStatus(`Loading sub-genres for ${missing.length} titles…`);
  let res;
  try {
    const [inj] = await withTimeout(
      chrome.scripting.executeScript({ target: { tabId }, func: fetchInterests, args: [chunks] }),
      60000, 'IMDb took too long to send sub-genres.');
    res = inj.result;
  } catch (e) { res = { ok: false, error: e.message }; }
  if (!res.ok) {
    state.tagNote = `Couldn't load sub-genres: ${res.error}`;
  } else {
    for (const t of res.titles) {
      if (!t?.id) continue;
      state.tagCache[t.id] = findInterests(t);
    }
    // Titles IMDb didn't return get an empty entry so we don't ask again every fetch.
    for (const id of missing) if (!(id in state.tagCache)) state.tagCache[id] = [];
    state.tagNote = '';
  }
  const keys = Object.keys(state.tagCache);
  if (keys.length > 5000) {
    for (const id of keys) if (!ids.has(id)) delete state.tagCache[id];
  }
  await chrome.storage.local.set({ tagCache: state.tagCache, tagNote: state.tagNote });
  render();
}

/* Runs inside the imdb.com tab. Must be self-contained. */
async function fetchInterests(chunks) {
  const query = 'query T($ids:[ID!]!){titles(ids:$ids){id interests(first:25){edges{node{id primaryText{text}}}}}}';
  const titles = [];
  try {
    for (const ids of chunks) {
      const res = await fetch('https://api.graphql.imdb.com/', {
        method: 'POST',
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ query, operationName: 'T', variables: { ids } })
      });
      const text = await res.text();
      let body;
      try { body = JSON.parse(text); } catch { throw new Error(`HTTP ${res.status}: ${text.slice(0, 160)}`); }
      if (body.errors?.length && !body.data?.titles) throw new Error(body.errors.map((e) => e.message).join('; ').slice(0, 300));
      titles.push(...(body.data?.titles || []));
    }
    return { ok: true, titles };
  } catch (e) {
    return { ok: false, error: String(e.message || e), titles };
  }
}

/* Runs inside the imdb.com tab. Must be self-contained. */
async function scrapeSearches(urls) {
  const out = [];
  for (const url of urls) {
    try {
      const res = await fetch(url, { credentials: 'include' });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const doc = new DOMParser().parseFromString(await res.text(), 'text/html');
      let items = [], total = null, found = false;
      const nd = doc.getElementById('__NEXT_DATA__');
      if (nd) {
        const hit = findKey(JSON.parse(nd.textContent), 'titleListItems');
        if (hit && Array.isArray(hit.value)) { items = hit.value; total = hit.parent.total ?? null; found = true; }
      }
      if (!items.length) { const d = fromDom(doc); if (d.length) { items = d; found = true; } }
      if (!found) {
        const title = (doc.title || '').trim();
        throw new Error(`IMDb sent back a page without search results${title ? ` ("${title.slice(0, 60)}")` : ''}. Open imdb.com in a tab and check for a robot check or sign-in prompt, then fetch again.`);
      }
      out.push({ ok: true, items, total });
    } catch (e) {
      out.push({ ok: false, error: String(e.message || e), items: [] });
    }
  }
  return out;

  function findKey(obj, key, depth = 0) {
    if (!obj || typeof obj !== 'object' || depth > 12) return null;
    if (key in obj) return { value: obj[key], parent: obj };
    for (const v of Object.values(obj)) {
      const r = findKey(v, key, depth + 1);
      if (r) return r;
    }
    return null;
  }
  function parseVotes(t) {
    const m = (t || '').replace(/[(),\s]/g, '').match(/([\d.]+)([KM]?)/i);
    if (!m) return null;
    return Math.round(parseFloat(m[1]) * ({ K: 1e3, M: 1e6 }[m[2].toUpperCase()] || 1));
  }
  function fromDom(doc) {
    const seen = new Set(), res = [];
    doc.querySelectorAll('li.ipc-metadata-list-summary-item').forEach((li) => {
      const a = li.querySelector('a[href*="/title/tt"]');
      const id = a?.getAttribute('href').match(/tt\d+/)?.[0];
      if (!id || seen.has(id)) return;
      seen.add(id);
      const meta = [...li.querySelectorAll('.dli-title-metadata-item')].map((e) => e.textContent);
      res.push({
        titleId: id,
        titleText: (li.querySelector('h3')?.textContent || '').replace(/^\d+\.\s*/, ''),
        releaseYear: parseInt(meta[0]) || null,
        ratingSummary: {
          aggregateRating: parseFloat(li.querySelector('.ipc-rating-star--rating')?.textContent) || null,
          voteCount: parseVotes(li.querySelector('.ipc-rating-star--voteCount')?.textContent)
        },
        primaryImage: { url: li.querySelector('img')?.getAttribute('src') }
      });
    });
    return res;
  }
}

/* IMDb's JSON shape shifts; read defensively. */
/* IMDb tags titles with sub-genres it calls "interests" (ids like in0000123). Where they
   sit in search results isn't documented, so look anywhere in the item for objects with
   an interest id and a name. */
function findInterests(it) {
  const out = new Set();
  const nameOf = (o) => {
    for (const v of [o.primaryText, o.name, o.text, o.displayableText]) {
      const t = typeof v === 'string' ? v : v?.text ?? v?.plainText;
      if (t) return t;
    }
    return '';
  };
  const walk = (o, depth) => {
    if (!o || typeof o !== 'object' || depth > 7) return;
    if (Array.isArray(o)) { o.forEach((v) => walk(v, depth + 1)); return; }
    if (typeof o.id === 'string' && /^in\d{7,}$/.test(o.id)) { const n = nameOf(o); if (n) out.add(n); }
    for (const v of Object.values(o)) if (v && typeof v === 'object') walk(v, depth + 1);
  };
  walk(it, 0);
  return [...out];
}

function norm(it) {
  const txt = (v) => (typeof v === 'string' ? v : v?.text ?? v?.plainText ?? v?.plotText?.plainText ?? '');
  const year = it.releaseYear?.year ?? it.releaseYear ?? null;
  const img = it.primaryImage?.url || '';
  const num = (v) => (typeof v === 'number' && isFinite(v) ? v : null);
  const genres = Array.isArray(it.genres) ? it.genres.map(txt).filter(Boolean)
    : (it.titleGenres?.genres || []).map((g) => txt(g.genre ?? g)).filter(Boolean);
  const secs = num(it.runtime) ?? num(it.runtime?.seconds);
  const endYear = it.endYear?.year ?? it.endYear ?? it.releaseYear?.endYear ?? null;
  const subs = findInterests(it).filter((x) => !genres.includes(x));
  return {
    genres,
    subs,
    runtime: secs ? Math.round(secs / 60) : null, // minutes
    metascore: num(it.metascore) ?? num(it.metascore?.score) ?? num(it.metacritic?.metascore?.score),
    cert: txt(it.certificate?.rating ?? it.certificate) || '',
    endYear: num(endYear) ?? (parseInt(endYear) || null),
    status: txt(it.productionStatus?.currentProductionStage ?? it.productionStatus?.status ?? it.productionStatus) || '',
    trailer: typeof it.trailerId === 'string' ? it.trailerId : '',
    id: it.titleId || it.id || it.tconst,
    title: txt(it.titleText) || txt(it.originalTitleText),
    series: txt(it.series?.titleText) || txt(it.series?.series?.titleText) || txt(it.seriesTitle) || '',
    seriesId: it.series?.series?.id || it.series?.id || it.seriesId || '',
    type: txt(it.titleType?.text ?? it.titleType) || '',
    year: typeof year === 'number' ? year : parseInt(year) || null,
    rating: it.ratingSummary?.aggregateRating ?? null,
    votes: it.ratingSummary?.voteCount ?? null,
    plot: txt(it.plot),
    typeKey: typeKeyOf(it.titleType?.id) || typeKeyOf(txt(it.titleType?.text ?? it.titleType)),
    img: img ? img.replace(/\._V1_.*\.(jpg|png)$/i, '._V1_UX96_.$1') : ''
  };
}

/* ---------- merge + rank ---------- */
/* A type's main search plus its deeper genre searches, merged into one list in estimated
   IMDb popularity order, so "popularity" means the same thing for every movie whether it
   came from the Movies search or the Sci-Fi one. Both kinds of search come back sorted by
   popularity; titles in both act as anchors, and genre-only titles are placed between the
   anchors around them. */
function bucketItems(typeKey) {
  const bs = state.results.bySource;
  const main = bs['auto-' + typeKey]?.items || [];
  const extras = Object.entries(bs)
    .filter(([id, r]) => id.startsWith(`genre-${typeKey}-`) && r.items?.length).map(([, r]) => r.items);
  if (!extras.length) return main;
  const lists = main.length ? [main, ...extras] : [...extras].sort((a, b) => b.length - a.length);
  const base = lists[0];
  const pos = new Map(base.map((it, i) => [it.id, i]));
  const item = new Map(base.map((it) => [it.id, it]));
  const est = new Map();
  for (const list of lists.slice(1)) {
    const anchors = [];
    list.forEach((it, i) => { if (pos.has(it.id)) anchors.push([i, pos.get(it.id)]); });
    const slope = anchors.length >= 2
      ? Math.max(0.05, (anchors.at(-1)[1] - anchors[0][1]) / Math.max(1, anchors.at(-1)[0] - anchors[0][0]))
      : Math.max(1, base.length / list.length);
    let a = 0;
    list.forEach((it, i) => {
      if (pos.has(it.id)) return;
      while (a < anchors.length && anchors[a][0] < i) a++;
      const prev = anchors[a - 1], next = anchors[a];
      const k = prev && next ? prev[1] + ((next[1] - prev[1]) * (i - prev[0])) / (next[0] - prev[0])
        : next ? next[1] - (next[0] - i) * slope
        : prev ? prev[1] + (i - prev[0]) * slope
        : i * slope;
      if (!item.has(it.id)) item.set(it.id, it);
      if (!est.has(it.id)) est.set(it.id, []);
      est.get(it.id).push(k);
    });
  }
  for (const [id, ks] of est) pos.set(id, ks.reduce((t, k) => t + k, 0) / ks.length);
  return [...item.values()].sort((x, y) => pos.get(x.id) - pos.get(y.id));
}

function merged() {
  if (!state.results) return [];
  const map = new Map();
  allSources().forEach((s, si) => {
    const items = s.typeKey ? bucketItems(s.typeKey) : state.results.bySource[s.id]?.items;
    if (!s.on || !items?.length) return;
    const byRating = [...items].sort((a, b) => (b.rating ?? 0) - (a.rating ?? 0) || (b.votes ?? 0) - (a.votes ?? 0));
    const n = byRating.length;
    const pct = new Map(byRating.map((it, i) => [it.id, n > 1 ? 1 - i / (n - 1) : 1]));
    items.forEach((it, order) => {
      let m = map.get(it.id);
      if (!m) { m = { ...it, hits: [] }; map.set(it.id, m); }
      m.hits.push({ si, label: s.label, color: s.color, order, pct: pct.get(it.id), n, auto: !!s.typeKey });
    });
  });
  return [...map.values()].map((m) => {
    const first = m.hits.reduce((a, h) => (h.order < a.order || (h.order === a.order && h.si < a.si) ? h : a));
    return { ...m, standing: Math.max(...m.hits.map((h) => h.pct)), firstOrder: first.order, firstSi: first.si };
  });
}

/* Percentile rank (0..1) of each value within the pool; ties share the midpoint. */
function pctRanker(values) {
  const v = values.filter((x) => x != null).sort((a, b) => a - b);
  const n = v.length;
  const lower = (x) => { let lo = 0, hi = n; while (lo < hi) { const m = (lo + hi) >> 1; v[m] < x ? lo = m + 1 : hi = m; } return lo; };
  const upper = (x) => { let lo = 0, hi = n; while (lo < hi) { const m = (lo + hi) >> 1; v[m] <= x ? lo = m + 1 : hi = m; } return lo; };
  return (x) => (x == null || n < 2 ? 0.5 : ((lower(x) + upper(x) - 1) / 2) / (n - 1));
}

/* Rating adjusted for how many votes back it up (the formula IMDb uses for its Top 250):
   adj = v/(v+m)·R + m/(v+m)·C, where C is the average rating for that type in the list
   and m is the median vote count for that type. Few votes pull a title toward average. */
function computeAdjusted(pool) {
  const groups = new Map();
  pool.forEach((x) => {
    const k = x.typeKey || 'other';
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(x);
  });
  for (const g of groups.values()) {
    const rated = g.filter((x) => x.rating != null);
    const C = rated.reduce((s, x) => s + x.rating, 0) / (rated.length || 1);
    const votes = rated.map((x) => x.votes ?? 0).sort((a, b) => a - b);
    const m = votes[votes.length >> 1] || 1;
    g.forEach((x) => {
      if (x.rating == null) { x.adj = null; return; }
      const v = x.votes ?? 0;
      x.adj = (v / (v + m)) * x.rating + (m / (v + m)) * C;
    });
  }
}

/* ---------- genres ---------- */
function genreCounts(pool) {
  const c = new Map();
  pool.forEach((x) => (x.genres || []).forEach((g) => c.set(g, (c.get(g) || 0) + 1)));
  return c;
}
const genreHidden = (x) => (x.genres || []).some((g) => ui.genreWeights[g] <= -10) ||
  (x.subs || []).some((g) => ui.subWeights[g] <= -10);
const genreLabel = (v) => (v <= -10 ? 'Hidden' : v > 0 ? `+${v}` : String(v));

let genreKey = '';
function buildGenreSliders(shown, needsRefetch) {
  const key = needsRefetch ? '!' : shown.map(([g, n]) => g + ':' + n).join('|');
  if (key === genreKey) return; // don't rebuild while someone is dragging
  genreKey = key;
  const box = $('genreWeights');
  if (needsRefetch) { box.innerHTML = '<p class="gnote">Fetch again to load genres.</p>'; return; }
  if (!shown.length) { box.innerHTML = '<p class="gnote">No genre is on enough titles for a slider yet.</p>'; return; }
  box.innerHTML = shown.map(([g, n], i) => `
    <div class="w">
      <label for="gw-${i}">${esc(g)} <span class="cnt">${n}</span></label>
      <input type="range" id="gw-${i}" data-g="${esc(g)}" min="-10" max="10" step="1" value="${ui.genreWeights[g] || 0}">
      <span class="ends"><span>Hide</span><output id="go-${i}">${genreLabel(ui.genreWeights[g] || 0)}</output><span>More</span></span>
    </div>`).join('');
  box.querySelectorAll('input[type=range]').forEach((el) => {
    const g = el.dataset.g;
    const out = $('go-' + el.id.slice(3));
    el.oninput = () => {
      ui.genreWeights[g] = Number(el.value); // keep 0 while dragging so the slider doesn't vanish
      out.textContent = genreLabel(ui.genreWeights[g]);
      scheduleRender();
    };
    el.onchange = () => {
      if (!ui.genreWeights[g]) delete ui.genreWeights[g];
      saveUi();
    };
  });
}

let subKey = '';
function buildSubSliders(shown, anySubs, fetched) {
  const det = $('subBox');
  const adjusted = Object.values(ui.subWeights).filter((v) => v).length;
  $('subSummary').textContent = state.tagNote ? 'couldn\'t load' : !fetched ? '' : anySubs
    ? `${shown.length} on enough titles${adjusted ? ` · ${adjusted} adjusted` : ''}`
    : 'none in these results';
  det.open = !!ui.subOpen;
  det.ontoggle = () => { ui.subOpen = det.open; saveUi(); };
  const key = (anySubs ? '' : '!') + shown.map(([g, n]) => g + ':' + n).join('|');
  if (key === subKey) return;
  subKey = key;
  const box = $('subWeights');
  if (state.tagNote) { subKey = ''; box.innerHTML = `<p class="gnote">${esc(state.tagNote)}</p>`; return; }
  if (!fetched) { box.innerHTML = '<p class="gnote">Fetch to load sub-genres.</p>'; return; }
  if (!anySubs) {
    box.innerHTML = '<p class="gnote">No sub-genres loaded yet. They load after the searches finish, so fetch again if this stays empty.</p>';
    return;
  }
  if (!shown.length) { box.innerHTML = '<p class="gnote">No sub-genre is on enough titles for a slider yet.</p>'; return; }
  box.innerHTML = shown.map(([g, n], i) => `
    <div class="w">
      <label for="sw-${i}">${esc(g)} <span class="cnt">${n}</span></label>
      <input type="range" id="sw-${i}" data-g="${esc(g)}" min="-10" max="10" step="1" value="${ui.subWeights[g] || 0}">
      <span class="ends"><span>Hide</span><output id="so-${i}">${genreLabel(ui.subWeights[g] || 0)}</output><span>More</span></span>
    </div>`).join('');
  box.querySelectorAll('input[type=range]').forEach((el) => {
    const g = el.dataset.g;
    const out = $('so-' + el.id.slice(3));
    el.oninput = () => {
      ui.subWeights[g] = Number(el.value);
      out.textContent = genreLabel(ui.subWeights[g]);
      scheduleRender();
    };
    el.onchange = () => {
      if (!ui.subWeights[g]) delete ui.subWeights[g];
      const adj = Object.values(ui.subWeights).filter((v) => v).length;
      $('subSummary').textContent = `${shown.length} on enough titles${adj ? ` · ${adj} adjusted` : ''}`;
      saveUi();
    };
  });
}

/* One set of sliders for every title, but each title is ranked only against titles of its
   own type (movies vs movies, episodes vs episodes), since their ratings and vote counts
   aren't comparable. Genre sliders are extra terms of the same kind: a title
   tagged Sci-Fi earns the Sci-Fi weight, and a negative weight is earned by titles WITHOUT
   that genre. The type slider then scales the whole score, which sets the mix of types.
   Rankers come from `pool` (visible titles); scores go onto every title in `targets`, so
   hidden titles shown with "Show hidden" still sort sensibly. */
function applyWeights(pool, targets) {
  const gw = Object.entries(ui.genreWeights).filter(([, v]) => v && v > -10);
  const sw = Object.entries(ui.subWeights).filter(([, v]) => v && v > -10);
  const gTotal = [...gw, ...sw].reduce((t, [, v]) => t + Math.abs(v), 0);
  const bucketOf = (x) => x.typeKey || 'other';
  const groups = new Map();
  pool.forEach((x) => {
    const k = bucketOf(x);
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(x);
  });
  const rankers = new Map();
  const rankersFor = (k) => {
    if (!rankers.has(k)) {
      const g = groups.get(k) || [];
      rankers.set(k, {
        year: pctRanker(g.map((x) => x.year)),
        adj: pctRanker(g.map((x) => x.adj)),
        votes: pctRanker(g.map((x) => x.votes)),
        meta: pctRanker(g.map((x) => x.metascore)) // no Metascore = average
      });
    }
    return rankers.get(k);
  };
  targets.forEach((x) => {
    const k = bucketOf(x);
    const r = rankersFor(k);
    const w = ui.weights;
    const total = Math.abs(w.recency) + w.popularity + w.rating + w.votes + w.critics + gTotal || 1;
    const age = r.year(x.year);
    const recency = w.recency >= 0 ? age : 1 - age;
    // Popularity from the title's own type list when it's in one, else from your own searches.
    const hits = x.hits.some((h) => h.auto) ? x.hits.filter((h) => h.auto) : x.hits;
    const pop = Math.max(...hits.map((h) => (h.n > 1 ? 1 - h.order / (h.n - 1) : 1)));
    const gs = new Set(x.genres || []);
    const ss = new Set(x.subs || []);
    const term = (set) => (t, [g, v]) => t + (v > 0 ? (set.has(g) ? v : 0) : (set.has(g) ? 0 : -v));
    const genre = gw.reduce(term(gs), 0) + sw.reduce(term(ss), 0);
    const base = (Math.abs(w.recency) * recency + w.popularity * pop + w.rating * r.adj(x.adj) +
      w.votes * r.votes(x.votes) + w.critics * r.meta(x.metascore) + genre) / total;
    x.wscore = base * ((ui.typeWeights[k] ?? 5) / 10);
  });
}

const SORTS = {
  weighted: (a, b) => b.wscore - a.wscore || (b.rating ?? 0) - (a.rating ?? 0),
  standing: (a, b) => b.standing - a.standing || (b.rating ?? 0) - (a.rating ?? 0),
  interleave: (a, b) => a.firstOrder - b.firstOrder || a.firstSi - b.firstSi,
  adjusted: (a, b) => (b.adj ?? 0) - (a.adj ?? 0) || (b.votes ?? 0) - (a.votes ?? 0),
  rating: (a, b) => (b.rating ?? 0) - (a.rating ?? 0) || (b.votes ?? 0) - (a.votes ?? 0),
  votes: (a, b) => (b.votes ?? 0) - (a.votes ?? 0),
  critics: (a, b) => (b.metascore ?? -1) - (a.metascore ?? -1) || (b.rating ?? 0) - (a.rating ?? 0),
  new: (a, b) => (b.year ?? 0) - (a.year ?? 0),
  old: (a, b) => (a.year ?? 9999) - (b.year ?? 9999)
};

const fmtLen = (m) => (m >= 60 ? `${Math.floor(m / 60)}h${m % 60 ? ` ${m % 60}m` : ''}` : `${m}m`);
/* A series counts as still running when IMDb gives it no end year. Exceptions: IMDb's
   production status says it ended, or it's a mini series from an earlier year (those
   often have no end year but are finished by definition). Episodes aren't judged: their
   data doesn't say whether the parent show is still going. */
const THIS_YEAR = new Date().getFullYear();
function isRunning(x) {
  if (x.typeKey !== 'series' || x.endYear) return false;
  if (/ended|cancel|complete|finished/i.test(x.status || '')) return false;
  if (/mini/i.test(x.type || '') && x.year && x.year < THIS_YEAR) return false;
  return true;
}
const yearText = (x) => {
  if (x.typeKey !== 'series' || !x.year) return x.year;
  if (!x.endYear) return isRunning(x) ? `${x.year}–` : `${x.year}`;
  return x.endYear === x.year ? `${x.year}` : `${x.year}–${x.endYear}`;
};
const mcClass = (s) => (s >= 61 ? 'hi' : s >= 40 ? 'mid' : 'lo'); // Metacritic's own color bands

let lastView = [];
function render() {
  const all = merged();
  all.forEach((x) => { x.subs = (state.tagCache[x.id] || []).filter((t) => !(x.genres || []).includes(t)); });
  const visible = all.filter((x) => !state.hidden.has(x.id));
  computeAdjusted(all);

  // type filter options
  const types = [...new Set(all.map((x) => x.type).filter(Boolean))].sort();
  if (ui.type !== 'all' && !types.includes(ui.type)) ui.type = 'all';
  $('type').innerHTML = '<option value="all">All types</option>' + types.map((t) => `<option ${t === ui.type ? 'selected' : ''}>${esc(t)}</option>`).join('');

  // genres: count tags across the list, give common ones a slider
  const counts = genreCounts(visible);
  const byCount = [...counts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  if (ui.genre !== 'all' && !counts.has(ui.genre)) ui.genre = 'all';
  $('genre').innerHTML = '<option value="all">All genres</option>' +
    byCount.map(([g, n]) => `<option value="${esc(g)}" ${g === ui.genre ? 'selected' : ''}>${esc(g)} (${n})</option>`).join('');
  const minN = Math.max(GENRE_MIN_TITLES, Math.ceil(visible.length * 0.02));
  buildGenreSliders(byCount.filter(([g, n]) => n >= minN || ui.genreWeights[g] != null), all.length > 0 && counts.size === 0);
  // sub-genres: same rule, at most 40 sliders, tucked in a collapsible section
  const subCounts = new Map();
  visible.forEach((x) => (x.subs || []).forEach((g) => subCounts.set(g, (subCounts.get(g) || 0) + 1)));
  const subShown = [...subCounts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .filter(([g, n]) => n >= minN || ui.subWeights[g] != null).slice(0, 40);
  buildSubSliders(subShown, subCounts.size > 0, all.length > 0);

  const weighted = ui.sort === 'weighted';
  $('weights').hidden = !weighted;
  if (weighted) applyWeights(visible, all);

  const q = ui.q.toLowerCase();
  let genreOut = 0, capped = 0, running = 0;
  let view = all
    .filter((x) => ui.showHidden || !state.hidden.has(x.id))
    .filter((x) => { if (ui.showRunning === false && isRunning(x)) { running++; return false; } return true; })
    .filter((x) => ui.type === 'all' || x.type === ui.type)
    .filter((x) => ui.genre === 'all' || (x.genres || []).includes(ui.genre))
    .filter((x) => !ui.maxLen || x.runtime == null || x.runtime <= ui.maxLen)
    .filter((x) => !q || (x.title + ' ' + x.series).toLowerCase().includes(q))
    .filter((x) => { if (weighted && genreHidden(x)) { genreOut++; return false; } return true; })
    .sort(SORTS[ui.sort] || SORTS.weighted);

  // Several episodes of one show become one row (its best-ranked episode); the rest
  // sit under it and expand on click.
  const showKey = (x) => (x.typeKey === 'episode' || x.series) && (x.seriesId || x.series.toLowerCase()) || '';
  const rows = [];
  let grouped = 0;
  if (ui.showMode !== 'all') {
    const byShow = new Map();
    for (const x of view) {
      const k = showKey(x);
      const g = k && byShow.get(k);
      if (g) { g.rest.push(x); grouped++; continue; }
      const row = { x, key: k, rest: [] };
      if (k) byShow.set(k, row);
      rows.push(row);
    }
  } else view.forEach((x) => rows.push({ x, key: '', rest: [] }));
  lastView = view;

  $('explain').textContent = EXPLAIN[ui.sort] || '';
  $('count').textContent = view.length ? `${rows.length} ${rows.length === view.length ? 'titles' : 'rows'}` : 'Results';
  const notes = [running && `${running} still-running show${running > 1 ? 's' : ''} hidden`, genreOut && `${genreOut} hidden by genre sliders`, grouped && `${grouped} more episodes grouped under their shows`].filter(Boolean);
  $('countNote').textContent = notes.length ? `(${notes.join('; ')})` : '';

  const list = $('list');
  if (!state.results) {
    list.innerHTML = '<li class="empty">Nothing fetched yet. Make sure you\'re signed in to IMDb in this browser, then press Fetch &amp; merge.</li>';
    return;
  }
  if (!view.length) {
    list.innerHTML = '<li class="empty">No titles match. Clear the title filter, change the type, genre or length, or turn a search back on.</li>';
    return;
  }
  const top = weighted ? Math.max(0, ...view.map((x) => x.wscore || 0)) : 0;
  const rowHtml = (x, rankLabel, extra = '', cls = '') => {
    const hid = state.hidden.has(x.id);
    const meta = [x.series && `from ${x.series}`, x.type, yearText(x), x.runtime && fmtLen(x.runtime), x.cert].filter(Boolean).map(esc).join(', ');
    const genres = (x.genres || []).map(esc).join(' · ');
    const subTip = (x.subs || []).length ? ` title="${esc(x.subs.join(', '))}"` : '';
    const trailer = x.trailer ? `<a class="trailer" href="https://www.imdb.com/video/${esc(x.trailer)}/" target="_blank" rel="noopener">▶ Trailer</a>` : '';
    return `
    <li class="row ${cls} ${hid ? 'hidden-item' : ''}">
      <div class="rank">${rankLabel}</div>
      ${x.img ? `<img class="poster" loading="lazy" src="${esc(x.img)}" alt="">` : '<div class="poster"></div>'}
      <div>
        <div class="title"><a href="https://www.imdb.com/title/${esc(x.id)}/" target="_blank" rel="noopener">${esc(x.title)}</a></div>
        <div class="meta">${meta}</div>
        ${genres || trailer ? `<div class="meta genres"${subTip}>${genres}${genres && trailer ? ' · ' : ''}${trailer}</div>` : ''}
        ${x.plot ? `<div class="plot">${esc(x.plot)}</div>` : ''}
        ${extra}
      </div>
      <div class="standing">
        ${x.hits.map((h) => `
          <div title="${esc(h.label)}: #${Math.round((1 - h.pct) * (h.n - 1)) + 1} of ${h.n} by rating">
            <div class="bar" style="--c:${h.color}"><span style="width:${Math.max(4, h.pct * 100)}%"></span></div>
          </div>`).join('')}
        <small>${x.hits.map((h) => esc(h.label)).join(' + ')}</small>
      </div>
      <div class="score">
        <b>${x.rating ?? '–'}</b>
        <div>${x.votes != null ? fmtVotes.format(x.votes) + ' votes' : ''}</div>
        ${x.metascore != null ? `<div><span class="mc ${mcClass(x.metascore)}" title="Metascore (critics)">${x.metascore}</span></div>` : ''}
        ${weighted && top > 0 ? `<div class="ws" title="Weighted score, top title = 100">${Math.round((x.wscore / top) * 100)}</div>` : ''}
      </div>
      <button class="hide" data-id="${esc(x.id)}" title="${hid ? 'Unhide' : 'Hide from results'}" aria-label="${hid ? 'Unhide' : 'Hide'}">${hid ? '↺' : '×'}</button>
    </li>`;
  };
  list.innerHTML = rows.map((row, i) => {
    if (!row.rest.length) return rowHtml(row.x, i + 1);
    const open = openShows.has(row.key);
    const name = row.x.series || 'this show';
    const toggle = `<button class="group-toggle" data-key="${esc(row.key)}" aria-expanded="${open}">
      ${open ? '▾ Hide' : '▸'} ${row.rest.length} more episode${row.rest.length > 1 ? 's' : ''} from ${esc(name)}</button>`;
    return rowHtml(row.x, i + 1, toggle, 'group-lead') +
      (open ? row.rest.map((x) => rowHtml(x, '', '', 'child')).join('') : '');
  }).join('');
}

const openShows = new Set(); // shows expanded in this session

$('list').onclick = (e) => {
  const t = e.target.closest('.group-toggle');
  if (t) {
    const k = t.dataset.key;
    openShows.has(k) ? openShows.delete(k) : openShows.add(k);
    render();
    return;
  }
  const b = e.target.closest('.hide');
  if (!b) return;
  const id = b.dataset.id;
  state.hidden.has(id) ? state.hidden.delete(id) : state.hidden.add(id);
  saveHidden(); render();
};

let rafPending = false;
function scheduleRender() {
  if (rafPending) return;
  rafPending = true;
  requestAnimationFrame(() => { rafPending = false; render(); });
}
function syncSliders() {
  const w = ui.weights;
  for (const k of Object.keys(DEFAULT_WEIGHTS)) {
    $('w-' + k).value = w[k];
    const v = w[k];
    $('o-' + k).textContent = k === 'recency' ? (v === 0 ? 'Ignore' : v > 0 ? `+${v}` : v) : v;
  }
}
for (const k of Object.keys(DEFAULT_WEIGHTS)) {
  $('w-' + k).oninput = (e) => {
    ui.weights[k] = Number(e.target.value);
    syncSliders();
    scheduleRender();
  };
  $('w-' + k).onchange = saveUi;
}
function buildTypeSliders() {
  const box = $('typeWeights');
  box.innerHTML = TYPE_SLIDERS.map((t) => `
    <div class="w">
      <label for="tw-${t.key}"><span class="dot" style="background:${t.color}"></span>${t.label}</label>
      <input type="range" id="tw-${t.key}" min="0" max="10" step="1" value="${ui.typeWeights[t.key]}">
      <span class="ends"><span>Bottom</span><output id="to-${t.key}">${ui.typeWeights[t.key]}</output><span>Top</span></span>
    </div>`).join('');
  TYPE_SLIDERS.forEach((t) => {
    const el = $('tw-' + t.key);
    el.oninput = () => {
      ui.typeWeights[t.key] = Number(el.value);
      $('to-' + t.key).textContent = el.value;
      scheduleRender();
    };
    el.onchange = saveUi;
  });
}
$('resetWeights').onclick = () => {
  ui.weights = { ...DEFAULT_WEIGHTS }; ui.typeWeights = { ...DEFAULT_TYPE_WEIGHTS }; ui.genreWeights = {}; ui.subWeights = {};
  genreKey = ''; // force the genre sliders to redraw at 0
  syncSliders(); buildTypeSliders(); saveUi(); render();
};
$('sort').onchange = (e) => { ui.sort = e.target.value; saveUi(); render(); };
$('type').onchange = (e) => { ui.type = e.target.value; render(); };
$('genre').onchange = (e) => { ui.genre = e.target.value; render(); };
$('maxLen').onchange = (e) => { ui.maxLen = Number(e.target.value) || 0; saveUi(); render(); };
$('perShow').onchange = (e) => { ui.showMode = e.target.value; saveUi(); render(); };
$('q').oninput = (e) => { ui.q = e.target.value; render(); };
$('showHidden').onchange = (e) => { ui.showHidden = e.target.checked; saveUi(); render(); };
$('showRunning').onchange = (e) => { ui.showRunning = e.target.checked; saveUi(); render(); };

$('exportBtn').onclick = () => {
  if (!lastView.length) { setStatus('Nothing to export yet.'); return; }
  const cell = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const rows = [['imdb_id', 'title', 'series', 'type', 'year', 'end_year', 'still_running', 'genres', 'runtime_min', 'certificate', 'rating', 'adjusted_rating', 'votes', 'metascore', 'lists', 'url']]
    .concat(lastView.map((x) => [
      x.id, x.title, x.series, x.type, x.year, x.endYear, isRunning(x) ? 'yes' : '', (x.genres || []).join(', '), x.runtime, x.cert,
      x.rating, x.adj != null ? x.adj.toFixed(2) : '', x.votes, x.metascore,
      x.hits.map((h) => h.label).join(' + '), `https://www.imdb.com/title/${x.id}/`
    ]));
  // The BOM makes Excel read accented titles (Amélie, Pokémon) correctly.
  const blob = new Blob(['﻿' + rows.map((r) => r.map(cell).join(',')).join('\n')], { type: 'text/csv' });
  const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(blob), download: 'imdb-merged.csv' });
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
};

// Weight sections can be collapsed; all start open, and your choice is remembered.
document.querySelectorAll('#weights details.wsec').forEach((d) => {
  const sec = d.dataset.sec;
  d.ontoggle = () => {
    const set = new Set(ui.collapsed || []);
    d.open ? set.delete(sec) : set.add(sec);
    ui.collapsed = [...set];
    saveUi();
  };
});
function applyCollapsed() {
  const set = new Set(ui.collapsed || []);
  document.querySelectorAll('#weights details.wsec').forEach((d) => { d.open = !set.has(d.dataset.sec); });
}

// Fetch as soon as the page opens (or reloads), unless that's turned off.
load().then(() => {
  applyCollapsed();
  const auto = $('autoFetch');
  auto.checked = ui.autoFetch !== false;
  auto.onchange = () => { ui.autoFetch = auto.checked; saveUi(); };
  if (auto.checked && !$('fetchBtn').disabled) $('fetchBtn').click();
});
