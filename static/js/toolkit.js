/* Code learning toolkit: algorithm visualizer, dry-run tables, complexity and data-structure references,
   concept notes, snippet library and spaced-repetition practice questions. */
const TK_TABS = [['visualizer', 'Visualizer'], ['dryrun', 'Dry run'], ['complexity', 'Complexity'], ['structures', 'Data structures'], ['concepts', 'Concepts'], ['snippets', 'Snippets'], ['practice', 'Practice']];
let tkStop = null;                                   // cleanup for the tab being left (timers)

App.pages.toolkit = async (rest) => {
  if (tkStop) { tkStop(); tkStop = null; }
  const tab = TK_TABS.some(t => t[0] === rest[0]) ? rest[0] : 'visualizer';
  await Study.subjects();
  $('#page').innerHTML = `<div class="page"><div class="page-title"><h1>Toolkit</h1></div>
    <div class="tk-tabs">${TK_TABS.map(([k, n]) => `<a href="#/toolkit/${k}" class="${k === tab ? 'on' : ''}">${n}</a>`).join('')}</div><div id="tkBody"></div></div>`;
  try { await ({visualizer: tkViz, dryrun: tkDry, complexity: tkComplexity, structures: tkStructures, concepts: tkConcepts, snippets: tkSnippets, practice: tkPractice}[tab])(); }
  catch (e) { $('#tkBody').innerHTML = `<div class="empty"><h2>Something went wrong</h2><p>${esc(e.message)}</p></div>`; }
};
const saveAsNote = async (title, body, subjectName, tags = []) => {
  try {
    const subject = (Study._subjects || []).find(s => s.name === subjectName);
    const n = await SA.add('notes', {title, body, subject_id: subject ? subject.id : '', tags});
    toast('Saved as a note'); return n;
  } catch (e) { toast(e.message, true); }
};

/* ======================================================================== VISUALIZER */
const clone = (a, extra) => ({arr: [...a], ...extra});
function* gBubble(a0, st) {
  const a = [...a0], n = a.length, sorted = new Set();
  yield {arr: [...a], msg: 'Start: repeatedly compare neighbours and swap them if they are out of order.', line: 0};
  for (let i = 0; i < n - 1; i++) {
    let swapped = false;
    for (let j = 0; j < n - 1 - i; j++) {
      st.c++; yield {arr: [...a], cmp: [j, j + 1], sorted: [...sorted], msg: `Compare ${a[j]} and ${a[j + 1]}.`, line: 2};
      if (a[j] > a[j + 1]) { [a[j], a[j + 1]] = [a[j + 1], a[j]]; st.s++; swapped = true; yield {arr: [...a], swap: [j, j + 1], sorted: [...sorted], msg: `${a[j + 1]} > ${a[j]}, so swap them.`, line: 3}; }
    }
    sorted.add(n - 1 - i);
    if (!swapped) { a.forEach((_, k) => sorted.add(k)); break; }
  }
  a.forEach((_, k) => sorted.add(k)); yield {arr: [...a], sorted: [...sorted], msg: 'Sorted. If a full pass makes no swaps, we can stop early.', line: 5};
}
function* gSelection(a0, st) {
  const a = [...a0], n = a.length, sorted = new Set();
  yield {arr: [...a], msg: 'Start: find the smallest remaining item and put it in place.', line: 0};
  for (let i = 0; i < n - 1; i++) {
    let m = i;
    for (let j = i + 1; j < n; j++) { st.c++; yield {arr: [...a], cmp: [m, j], pivot: m, sorted: [...sorted], msg: `Is ${a[j]} smaller than the current minimum ${a[m]}?`, line: 3}; if (a[j] < a[m]) m = j; }
    if (m !== i) { [a[i], a[m]] = [a[m], a[i]]; st.s++; yield {arr: [...a], swap: [i, m], sorted: [...sorted], msg: `Swap the minimum into position ${i}.`, line: 5}; }
    sorted.add(i);
  }
  a.forEach((_, k) => sorted.add(k)); yield {arr: [...a], sorted: [...sorted], msg: 'Sorted.', line: 6};
}
function* gInsertion(a0, st) {
  const a = [...a0], n = a.length;
  yield {arr: [...a], sorted: [0], msg: 'Start: the first item alone is already a sorted prefix.', line: 0};
  for (let i = 1; i < n; i++) {
    const key = a[i]; let j = i - 1;
    yield {arr: [...a], pivot: i, sorted: [...Array(i).keys()], msg: `Insert ${key} into the sorted prefix.`, line: 1};
    while (j >= 0) {
      st.c++; yield {arr: [...a], cmp: [j, j + 1], pivot: j + 1, sorted: [...Array(i).keys()], msg: `Is ${a[j]} greater than ${key}?`, line: 3};
      if (a[j] <= key) break;
      a[j + 1] = a[j]; st.s++; yield {arr: [...a], swap: [j, j + 1], sorted: [...Array(i).keys()], msg: `Shift ${a[j]} one place right.`, line: 4}; j--;
    }
    a[j + 1] = key; yield {arr: [...a], sorted: [...Array(i + 1).keys()], msg: `Place ${key} at position ${j + 1}.`, line: 6};
  }
  yield {arr: [...a], sorted: [...a.keys()], msg: 'Sorted.', line: 7};
}
function* gMerge(a0, st) {
  const a = [...a0];
  yield {arr: [...a], msg: 'Start: split in halves, sort each half, then merge them.', line: 0};
  function* sort(l, r) {
    if (l >= r) return;
    const m = (l + r) >> 1; yield* sort(l, m); yield* sort(m + 1, r);
    const L = a.slice(l, m + 1), R = a.slice(m + 1, r + 1); let i = 0, j = 0, k = l;
    yield {arr: [...a], range: [l, r], msg: `Merge the sorted halves [${l}..${m}] and [${m + 1}..${r}].`, line: 4};
    while (i < L.length || j < R.length) {
      if (j >= R.length || (i < L.length && L[i] <= R[j])) { st.c += j < R.length ? 1 : 0; a[k] = L[i++]; } else { st.c++; a[k] = R[j++]; }
      st.s++; yield {arr: [...a], range: [l, r], swap: [k], msg: `Write ${a[k]} to position ${k}.`, line: 6}; k++;
    }
  }
  yield* sort(0, a.length - 1); yield {arr: [...a], sorted: [...a.keys()], msg: 'Sorted.', line: 8};
}
function* gQuick(a0, st) {
  const a = [...a0], sorted = new Set();
  yield {arr: [...a], msg: 'Start: pick a pivot, put smaller items before it and larger after, then repeat on each side.', line: 0};
  function* qs(l, h) {
    if (l > h) return; if (l === h) { sorted.add(l); return; }
    const p = a[h]; let i = l - 1;
    yield {arr: [...a], range: [l, h], pivot: h, sorted: [...sorted], msg: `Choose ${p} as the pivot for [${l}..${h}].`, line: 2};
    for (let j = l; j < h; j++) {
      st.c++; yield {arr: [...a], range: [l, h], cmp: [j, h], pivot: h, sorted: [...sorted], msg: `Is ${a[j]} < pivot ${p}?`, line: 4};
      if (a[j] < p) { i++; if (i !== j) { [a[i], a[j]] = [a[j], a[i]]; st.s++; yield {arr: [...a], range: [l, h], swap: [i, j], pivot: h, sorted: [...sorted], msg: `Move ${a[i]} to the left part.`, line: 5}; } }
    }
    [a[i + 1], a[h]] = [a[h], a[i + 1]]; st.s++; sorted.add(i + 1);
    yield {arr: [...a], range: [l, h], swap: [i + 1, h], sorted: [...sorted], msg: `Pivot ${p} is now in its final position ${i + 1}.`, line: 7};
    yield* qs(l, i); yield* qs(i + 2, h);
  }
  yield* qs(0, a.length - 1); yield {arr: [...a], sorted: [...a.keys()], msg: 'Sorted.', line: 9};
}
function* gBinary(a0, st, target) {
  const a = [...a0].sort((x, y) => x - y); let lo = 0, hi = a.length - 1;
  yield {arr: [...a], msg: `Search for ${target} in the sorted list.`, line: 0};
  while (lo <= hi) {
    const mid = (lo + hi) >> 1; st.c++;
    yield {arr: [...a], range: [lo, hi], cmp: [mid], msg: `lo=${lo}, hi=${hi}, mid=${mid}. a[mid]=${a[mid]}.`, line: 3};
    if (a[mid] === target) { yield {arr: [...a], found: [mid], msg: `Found ${target} at index ${mid}.`, line: 4}; return; }
    if (a[mid] < target) { yield {arr: [...a], range: [mid + 1, hi], msg: `${a[mid]} < ${target}: search the right half.`, line: 6}; lo = mid + 1; }
    else { yield {arr: [...a], range: [lo, mid - 1], msg: `${a[mid]} > ${target}: search the left half.`, line: 8}; hi = mid - 1; }
  }
  yield {arr: [...a], msg: `${target} is not in the list.`, line: 10};
}
const VIZ_GRAPH = {nodes: {A: [50, 40], B: [150, 40], C: [50, 140], D: [250, 40], E: [150, 140], F: [50, 230], G: [250, 140], H: [150, 230]},
  adj: {A: ['B', 'C'], B: ['A', 'D', 'E'], C: ['A', 'F'], D: ['B'], E: ['B', 'F', 'G'], F: ['C', 'E', 'H'], G: ['E'], H: ['F']}};
function* gGraph(kind, start, st) {
  const seen = new Set([start]), frontier = [start], order = [];
  yield {visited: [], frontier: [...frontier], msg: `Start at ${start}. ${kind === 'bfs' ? 'The queue holds nodes to visit (front first).' : 'The stack holds nodes to visit (top last).'}`, line: 0};
  while (frontier.length) {
    const u = kind === 'bfs' ? frontier.shift() : frontier.pop(); order.push(u); st.c++;
    yield {visited: [...order], current: u, frontier: [...frontier], msg: `Visit ${u}. Order so far: ${order.join(' → ')}.`, line: 3};
    const ns = kind === 'bfs' ? VIZ_GRAPH.adj[u] : [...VIZ_GRAPH.adj[u]].reverse();
    for (const v of ns) if (!seen.has(v)) { seen.add(v); frontier.push(v); yield {visited: [...order], current: u, frontier: [...frontier], msg: `Add unvisited neighbour ${v}.`, line: 6}; }
  }
  yield {visited: [...order], frontier: [], msg: `Done. ${kind.toUpperCase()} order: ${order.join(' → ')}.`, line: 8};
}
const VIZ = {
  bubble: ['Bubble sort', 'sort', gBubble, ['for i in range(n - 1):', '    swapped = False', '    for j in range(n - 1 - i):', '        if a[j] > a[j + 1]: swap', '    if not swapped: break', 'sorted']],
  selection: ['Selection sort', 'sort', gSelection, ['for i in range(n - 1):', '    m = i', '    for j in range(i + 1, n):', '        if a[j] < a[m]:', '            m = j', '    swap a[i], a[m]', 'sorted']],
  insertion: ['Insertion sort', 'sort', gInsertion, ['sorted prefix = a[0]', 'for i in range(1, n):', '    key = a[i]; j = i - 1', '    while j >= 0 and a[j] > key:', '        a[j + 1] = a[j]; j -= 1', '', '    a[j + 1] = key', 'sorted']],
  merge: ['Merge sort', 'sort', gMerge, ['def sort(l, r):', '    if l >= r: return', '    m = (l + r) // 2', '    sort(l, m); sort(m + 1, r)', '    merge the two sorted halves', '    while both halves have items:', '        write the smaller one', '', 'sorted']],
  quick: ['Quick sort', 'sort', gQuick, ['def qs(l, h):', '    if l >= h: return', '    pivot = a[h]; i = l - 1', '    for j in range(l, h):', '        if a[j] < pivot:', '            i += 1; swap a[i], a[j]', '    swap a[i + 1], a[h]', '    qs(l, i); qs(i + 2, h)', '', 'sorted']],
  binary: ['Binary search', 'search', gBinary, ['lo, hi = 0, n - 1', 'while lo <= hi:', '    mid = (lo + hi) // 2', '    if a[mid] == target:', '        return mid', '    elif a[mid] < target:', '        lo = mid + 1', '    else:', '        hi = mid - 1', 'return -1']],
  bfs: ['Breadth-first search', 'graph', null, ['queue = [start]', 'while queue:', '    u = queue.pop(0)', '    visit(u)', '    for v in neighbours(u):', '        if v not seen:', '            queue.append(v)', '', 'done']],
  dfs: ['Depth-first search', 'graph', null, ['stack = [start]', 'while stack:', '    u = stack.pop()', '    visit(u)', '    for v in neighbours(u):', '        if v not seen:', '            stack.append(v)', '', 'done']],
};
async function tkViz() {
  const V = {key: store.get('vizAlgo', 'bubble'), data: store.get('vizData', [5, 3, 8, 1, 9, 2, 7]), target: 7, frames: [], i: 0, timer: 0, speed: 400, st: {c: 0, s: 0}};
  const rand = n => Array.from({length: n}, () => 1 + Math.floor(Math.random() * 40));
  $('#tkBody').innerHTML = `<div class="viz-ctl"><select id="vAlgo" aria-label="Algorithm">${Object.entries(VIZ).map(([k, v]) => `<option value="${k}">${v[0]}</option>`).join('')}</select>
      <span id="vArrCtl" style="display:contents"><label>Size <input id="vSize" type="range" min="5" max="40" value="${V.data.length}"></label><button class="btn" id="vRand">Randomize</button>
      <input id="vCustom" type="text" placeholder="or type numbers: 5, 3, 8, 1" style="width:190px" aria-label="Custom array"><button class="btn" id="vApply">Use</button></span>
      <label id="vTargetL">Target <input id="vTarget" type="number" value="7" style="width:70px"></label><label id="vStartL">Start <select id="vStart">${Object.keys(VIZ_GRAPH.nodes).map(n => `<option>${n}</option>`).join('')}</select></label></div>
    <div class="viz-ctl"><button class="btn primary" id="vPlay">${icon('play')}Play</button><button class="btn" id="vBack">${icon('back')}Step</button><button class="btn" id="vFwd">Step${icon('next')}</button><button class="btn" id="vReset">${icon('reset')}Reset</button>
      <label>Speed <input id="vSpeed" type="range" min="1" max="10" value="6"></label><input id="vScrub" type="range" min="0" max="0" value="0" style="flex:1;min-width:160px" aria-label="Step"><span class="badge" id="vStep"></span></div>
    <div class="viz-main"><div><div id="vStage"></div><div class="viz-msg" id="vMsg"></div><div class="stat-row" id="vStats"></div></div><div class="code-box" id="vCode" aria-label="Pseudocode"></div></div>`;
  const build = () => {
    const [name, kind, gen] = VIZ[V.key]; V.st = {c: 0, s: 0}; const frames = [];
    const it = kind === 'graph' ? gGraph(V.key, $('#vStart').value, V.st) : gen(V.data, V.st, V.target);
    for (const f of it) { frames.push({...f, c: V.st.c, s: V.st.s}); if (frames.length > 6000) break; }
    V.frames = frames; V.i = 0; $('#vScrub').max = frames.length - 1; draw();
  };
  const draw = () => {
    const f = V.frames[V.i], [name, kind, , code] = VIZ[V.key]; $('#vScrub').value = V.i; $('#vStep').textContent = `${V.i + 1} / ${V.frames.length}`;
    $('#vMsg').textContent = f.msg; $('#vStats').innerHTML = kind === 'graph' ? `<span>Visited: ${(f.visited || []).length}</span><span>${V.key === 'bfs' ? 'Queue' : 'Stack'}: [${(f.frontier || []).join(', ')}]</span>` : `<span>Comparisons: ${f.c}</span>${kind === 'sort' ? `<span>Writes/swaps: ${f.s}</span>` : ''}`;
    $('#vCode').innerHTML = code.map((l, n) => `<div class="${n === f.line ? 'on' : ''}">${esc(l) || ' '}</div>`).join('');
    if (kind === 'graph') {
      const vis = new Set(f.visited || []), edges = [];
      for (const [u, ns] of Object.entries(VIZ_GRAPH.adj)) for (const v of ns) if (u < v) edges.push(`<line x1="${VIZ_GRAPH.nodes[u][0]}" y1="${VIZ_GRAPH.nodes[u][1]}" x2="${VIZ_GRAPH.nodes[v][0]}" y2="${VIZ_GRAPH.nodes[v][1]}"/>`);
      $('#vStage').innerHTML = `<svg class="graph" viewBox="0 0 300 270">${edges.join('')}${Object.entries(VIZ_GRAPH.nodes).map(([k, [x, y]]) => `<g class="${vis.has(k) ? 'vis' : ''} ${f.current === k ? 'cur' : ''}"><circle cx="${x}" cy="${y}" r="20"/><text x="${x}" y="${y}">${k}</text></g>`).join('')}</svg>`;
    } else {
      const max = Math.max(...f.arr), sorted = new Set(f.sorted || []), n = f.arr.length;
      $('#vStage').innerHTML = `<div class="bars">${f.arr.map((v, k) => { const c = (f.found || []).includes(k) ? 'found' : (f.swap || []).includes(k) ? 'swap' : (f.cmp || []).includes(k) ? 'cmp' : f.pivot === k ? 'pivot' : sorted.has(k) ? 'sorted' : f.range && k >= f.range[0] && k <= f.range[1] ? 'range' : ''; return `<div class="${c}" style="height:${Math.max(4, Math.round(100 * v / max))}%">${n <= 20 ? `<span>${v}</span>` : ''}</div>`; }).join('')}</div>`;
    }
  };
  const stop = () => { clearInterval(V.timer); V.timer = 0; $('#vPlay').innerHTML = icon('play') + 'Play'; };
  const play = () => { if (V.timer) return stop(); if (V.i >= V.frames.length - 1) V.i = 0; $('#vPlay').innerHTML = icon('pause') + 'Pause'; V.timer = setInterval(() => { if (V.i >= V.frames.length - 1) return stop(); V.i++; draw(); }, 1100 - V.speed * 100); };
  const setMode = () => { const kind = VIZ[V.key][1]; $('#vArrCtl').style.display = kind === 'graph' ? 'none' : 'contents'; $('#vTargetL').style.display = V.key === 'binary' ? '' : 'none'; $('#vStartL').style.display = kind === 'graph' ? '' : 'none'; };
  $('#vAlgo').value = V.key; setMode();
  $('#vAlgo').onchange = e => { stop(); V.key = e.target.value; store.set('vizAlgo', V.key); setMode(); build(); };
  $('#vSize').oninput = e => { stop(); V.data = rand(+e.target.value); store.set('vizData', V.data); build(); };
  $('#vRand').onclick = () => { stop(); V.data = rand(V.data.length); store.set('vizData', V.data); build(); };
  $('#vApply').onclick = () => { const nums = $('#vCustom').value.split(/[\s,]+/).filter(Boolean).map(Number); if (nums.length < 2 || nums.length > 60 || nums.some(n => !Number.isFinite(n) || n < 0)) return toast('Enter 2 to 60 non-negative numbers, separated by commas.', true); stop(); V.data = nums; store.set('vizData', nums); $('#vSize').value = Math.min(40, nums.length); build(); };
  $('#vTarget').onchange = e => { V.target = +e.target.value; stop(); build(); }; $('#vStart').onchange = () => { stop(); build(); };
  $('#vPlay').onclick = play; $('#vBack').onclick = () => { stop(); V.i = Math.max(0, V.i - 1); draw(); }; $('#vFwd').onclick = () => { stop(); V.i = Math.min(V.frames.length - 1, V.i + 1); draw(); }; $('#vReset').onclick = () => { stop(); V.i = 0; draw(); };
  $('#vSpeed').oninput = e => { V.speed = +e.target.value; if (V.timer) { stop(); play(); } }; V.speed = 6;
  $('#vScrub').oninput = e => { stop(); V.i = +e.target.value; draw(); };
  tkStop = stop; build();
}

/* ======================================================================== DRY RUN */
const DRY_TEMPLATES = {
  sum: ['Loop: sum of 1..4', ['i', 's'], [['init', '–', '0'], ['loop', '1', '1'], ['loop', '2', '3'], ['loop', '3', '6'], ['loop', '4', '10']], 's = 0\nfor i in 1..4: s += i'],
  binary: ['Binary search for 7 in [1, 3, 5, 7, 9, 11]', ['lo', 'hi', 'mid', 'a[mid]'], [['3', '0', '5', '2', '5'], ['6', '3', '5', '4', '9'], ['4', '3', '3', '3', '7']].map(r => r), 'compare a[mid] with 7; move lo or hi'],
  fact: ['Recursion: factorial(4)', ['call', 'n', 'returns'], [['fact(4)', '4', 'waiting'], ['fact(3)', '3', 'waiting'], ['fact(2)', '2', 'waiting'], ['fact(1)', '1', '1'], ['fact(2)', '2', '2 × 1 = 2'], ['fact(3)', '3', '3 × 2 = 6'], ['fact(4)', '4', '4 × 6 = 24']], 'n * fact(n - 1), base case n <= 1'],
};
function tkDry() {
  let D = store.get('dryrun', null) || {title: '', cols: ['i', 'sum'], rows: [{line: '', vals: ['0', '0'], note: ''}]};
  const save = () => store.set('dryrun', D);
  const md = () => `| Step | Line | ${D.cols.join(' | ')} | Note |\n|---|---|${D.cols.map(() => '---').join('|')}|---|\n` + D.rows.map((r, i) => `| ${i + 1} | ${r.line} | ${r.vals.join(' | ')} | ${r.note} |`).join('\n');
  const paint = () => {
    $('#tkBody').innerHTML = `<p class="muted" style="margin:0 0 12px">Trace a program by hand: one column per variable, one row per step. This is a manual table to practise dry runs; it does not execute your code.</p>
      <div class="viz-ctl"><input id="dTitle" type="text" placeholder="Title, e.g. Bubble sort on [4, 2, 5]" value="${esc(D.title)}" style="width:300px"><select id="dTpl"><option value="">Load an example…</option>${Object.entries(DRY_TEMPLATES).map(([k, v]) => `<option value="${k}">${esc(v[0])}</option>`).join('')}</select>
        <button class="btn" id="dAddCol">${icon('plus')}Variable</button><button class="btn" id="dAddRow">${icon('plus')}Step</button><span class="spacer" style="flex:1"></span>
        <button class="btn ghost" id="dCopy">Copy Markdown</button><button class="btn ghost" id="dCsv">${icon('download')}CSV</button><button class="btn" id="dNote">Save as note</button><button class="btn ghost danger" id="dClear">Clear</button></div>
      <div style="overflow:auto"><table class="dry"><thead><tr><th style="width:50px"><input value="Step" disabled></th><th><input value="Line" disabled></th>${D.cols.map((c, i) => `<th><input data-c="${i}" value="${esc(c)}" aria-label="Variable name"></th>`).join('')}<th><input value="Note" disabled></th><th class="act"></th></tr></thead>
      <tbody>${D.rows.map((r, ri) => `<tr><td><input value="${ri + 1}" disabled style="width:50px;text-align:center"></td><td><input data-r="${ri}" data-k="line" value="${esc(r.line)}" aria-label="Step ${ri + 1} line"></td>${r.vals.map((v, ci) => `<td><input data-r="${ri}" data-v="${ci}" value="${esc(v)}" aria-label="Step ${ri + 1}, ${esc(D.cols[ci])}"></td>`).join('')}<td><input data-r="${ri}" data-k="note" value="${esc(r.note)}" style="width:200px" aria-label="Step ${ri + 1} note"></td><td class="act"><button class="icon-btn" data-dup="${ri}" title="Duplicate step">${icon('plus')}</button><button class="icon-btn" data-del="${ri}" title="Delete step">${icon('trash')}</button></td></tr>`).join('')}</tbody></table></div>
      <p class="muted" style="font-size:12.5px">Click a variable name to rename it. <button class="btn ghost" id="dDelCol">Remove last variable</button></p>`;
    $('#dTitle').oninput = e => { D.title = e.target.value; save(); };
    $('#tkBody').oninput = e => { const t = e.target; if (t.dataset.c !== undefined) D.cols[+t.dataset.c] = t.value; else if (t.dataset.v !== undefined) D.rows[+t.dataset.r].vals[+t.dataset.v] = t.value; else if (t.dataset.k) D.rows[+t.dataset.r][t.dataset.k] = t.value; save(); };
    $('#dAddCol').onclick = () => { D.cols.push('var' + (D.cols.length + 1)); D.rows.forEach(r => r.vals.push('')); save(); paint(); };
    $('#dDelCol').onclick = () => { if (D.cols.length > 1) { D.cols.pop(); D.rows.forEach(r => r.vals.pop()); save(); paint(); } };
    $('#dAddRow').onclick = () => { const l = D.rows[D.rows.length - 1]; D.rows.push({line: '', vals: l ? [...l.vals] : D.cols.map(() => ''), note: ''}); save(); paint(); };
    $('#tkBody').onclick = e => { const d = e.target.closest('[data-del]'), u = e.target.closest('[data-dup]'); if (d && D.rows.length > 1) { D.rows.splice(+d.dataset.del, 1); save(); paint(); } else if (u) { const r = D.rows[+u.dataset.dup]; D.rows.splice(+u.dataset.dup + 1, 0, {...r, vals: [...r.vals]}); save(); paint(); } };
    $('#dTpl').onchange = e => { const t = DRY_TEMPLATES[e.target.value]; if (!t) return; const cols = t[1]; D = {title: t[0], cols: [...cols], rows: t[2].map(r => { const vals = r.slice(r.length - cols.length); const line = r.length > cols.length ? r[0] : ''; return {line, vals, note: ''}; })}; D.rows[0].note = t[3].replace(/\n/g, '; '); save(); paint(); };
    $('#dCopy').onclick = () => copyText((D.title ? `**${D.title}**\n\n` : '') + md());
    $('#dCsv').onclick = () => download('dry-run.csv', [['Step', 'Line', ...D.cols, 'Note'], ...D.rows.map((r, i) => [i + 1, r.line, ...r.vals, r.note])].map(r => r.map(c => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\n'), 'text/csv');
    $('#dNote').onclick = async () => { const n = await saveAsNote('Dry run: ' + (D.title || 'untitled'), (D.title ? `**${D.title}**\n\n` : '') + md(), 'Data Structures and Algorithms', ['dry-run']); if (n) App.go('#/notes/' + n.id); };
    $('#dClear').onclick = async () => { if (await UI.confirm('All rows and variables are removed.', {title: 'Clear this table?', confirm: 'Clear', danger: true})) { D = {title: '', cols: ['i', 'sum'], rows: [{line: '', vals: ['', ''], note: ''}]}; save(); paint(); } };
  };
  paint();
}

/* ======================================================================== COMPLEXITY */
const oClass = s => /^O\((1|log n|L)\)$|^O\(1\)/.test(s) ? 'o-good' : /n²|n³|2ⁿ|V·E|V³|n\^/.test(s) ? 'o-bad' : s === '—' ? '' : 'o-mid';
function tkComplexity() {
  let cat = 'All', q = '', logScale = false, N = 20;
  const cats = ['All', ...new Set(Ref.complexity.map(r => r[0]))];
  $('#tkBody').innerHTML = `<div class="viz-ctl"><input id="cQ" type="search" placeholder="Search algorithms or structures" style="width:260px"><span class="chips" id="cCats" style="padding:0">${cats.map(c => `<button class="chip${c === cat ? ' on' : ''}" data-c="${c}">${c}</button>`).join('')}</span></div>
    <div style="overflow:auto;max-height:46vh;border:1px solid var(--line);border-radius:10px"><table class="ref"><thead><tr><th>Algorithm / operation</th><th>Best</th><th>Average</th><th>Worst</th><th>Space</th><th>Notes</th></tr></thead><tbody id="cRows"></tbody></table></div>
    <div class="sec-head"><h2>How fast does it grow?</h2></div>
    <div class="viz-ctl"><label>n up to <input id="gN" type="range" min="5" max="60" value="${N}"> <b id="gNv">${N}</b></label><label class="chk"><input id="gLog" type="checkbox"> Log scale</label></div>
    <div class="viz-main"><canvas id="gCan" width="720" height="300" style="width:100%;border:1px solid var(--line);border-radius:10px;background:var(--bg)"></canvas>
      <div><div class="viz-ctl"><label>Input size n <input id="oN" type="number" value="1000000" min="1" style="width:110px"></label></div><table class="ref" id="oTab"></table><p class="muted" style="font-size:12px">Estimated time assumes about 10⁸ simple operations per second.</p></div></div>`;
  const rows = () => Ref.complexity.filter(r => (cat === 'All' || r[0] === cat) && (!q || (r[1] + ' ' + r[6]).toLowerCase().includes(q)));
  const paintRows = () => { $('#cRows').innerHTML = rows().map(r => `<tr><td><b>${esc(r[1])}</b></td>${[2, 3, 4, 5].map(i => `<td class="o ${oClass(r[i])}">${esc(r[i])}</td>`).join('')}<td class="muted">${esc(r[6])}</td></tr>`).join('') || '<tr><td colspan="6" class="noresult">No matches.</td></tr>'; };
  $('#cQ').oninput = e => { q = e.target.value.toLowerCase(); paintRows(); };
  $('#cCats').onclick = e => { const c = e.target.closest('.chip'); if (c) { cat = c.dataset.c; $$('#cCats .chip').forEach(x => x.classList.toggle('on', x === c)); paintRows(); } };
  const FNS = [['1', '#2ea043', n => 1], ['log n', '#14a37f', n => Math.log2(n)], ['n', '#388bfd', n => n], ['n log n', '#8957e5', n => n * Math.log2(n)], ['n²', '#f0883e', n => n * n], ['2ⁿ', '#d1242f', n => 2 ** n]];
  const draw = () => {
    const cv = $('#gCan'), g = cv.getContext('2d'), W = cv.width, H = cv.height, m = {l: 50, r: 90, t: 14, b: 28}; g.clearRect(0, 0, W, H);
    const cs = getComputedStyle(document.documentElement), fg = cs.getPropertyValue('--fg2').trim(), line = cs.getPropertyValue('--line').trim();
    const vals = FNS.map(f => Array.from({length: N}, (_, i) => f[2](i + 1))), top = logScale ? Math.log10(Math.max(...vals.flat())) : Math.min(Math.max(...vals.flat()), N * N * 1.2);
    const X = i => m.l + (i / (N - 1)) * (W - m.l - m.r), Y = v => { const t = logScale ? Math.log10(Math.max(v, 1)) / (top || 1) : Math.min(v, top) / top; return H - m.b - t * (H - m.t - m.b); };
    g.strokeStyle = line; g.fillStyle = fg; g.font = '11px sans-serif'; g.lineWidth = 1;
    for (let k = 0; k <= 4; k++) { const y = m.t + k * (H - m.t - m.b) / 4; g.beginPath(); g.moveTo(m.l, y); g.lineTo(W - m.r, y); g.stroke(); const v = logScale ? 10 ** (top * (1 - k / 4)) : top * (1 - k / 4); g.textAlign = 'right'; g.fillText(v >= 1e4 ? v.toExponential(0) : Math.round(v), m.l - 6, y + 4); }
    g.textAlign = 'center'; [1, Math.round(N / 2), N].forEach(n => g.fillText('n=' + n, X(n - 1), H - 8));
    FNS.forEach((f, k) => { g.strokeStyle = f[1]; g.lineWidth = 2; g.beginPath(); vals[k].forEach((v, i) => { const y = Y(v); i ? g.lineTo(X(i), y) : g.moveTo(X(i), y); }); g.stroke(); g.fillStyle = f[1]; g.textAlign = 'left'; g.fillText('O(' + f[0] + ')', W - m.r + 8, Math.max(m.t + 8, Math.min(H - m.b - 4, Y(vals[k][N - 1])))); });
  };
  const paintOps = () => {
    const n = Math.max(1, +$('#oN').value || 1), rows = [['O(1)', 1], ['O(log n)', Math.log2(n)], ['O(n)', n], ['O(n log n)', n * Math.log2(n)], ['O(n²)', n * n], ['O(2ⁿ)', n > 60 ? Infinity : 2 ** n]];
    const t = ops => ops === Infinity ? 'impossible' : ops / 1e8 < 1e-6 ? '< 1 µs' : ops / 1e8 < 1e-3 ? (ops / 1e5).toPrecision(2) + ' µs' : ops / 1e8 < 1 ? (ops / 1e5).toPrecision(2) + ' ms' : ops / 1e8 < 60 ? (ops / 1e8).toPrecision(2) + ' s' : ops / 1e8 < 86400 * 365 ? (ops / 1e8 / 3600).toPrecision(2) + ' h' : 'years+';
    $('#oTab').innerHTML = '<thead><tr><th>Class</th><th>Operations</th><th>~Time</th></tr></thead><tbody>' + rows.map(([c, o]) => `<tr><td class="o">${c}</td><td class="o">${o === Infinity ? '∞' : o > 1e15 ? o.toExponential(1) : Math.round(o).toLocaleString()}</td><td class="${o / 1e8 > 60 ? 'o-bad' : o / 1e8 > 1 ? 'o-mid' : 'o-good'}">${t(o)}</td></tr>`).join('') + '</tbody>';
  };
  $('#gN').oninput = e => { N = +e.target.value; $('#gNv').textContent = N; draw(); }; $('#gLog').onchange = e => { logScale = e.target.checked; draw(); }; $('#oN').oninput = paintOps;
  paintRows(); paintOps(); draw();
}

/* ======================================================================== STRUCTURES & CONCEPTS */
function tkStructures() {
  $('#tkBody').innerHTML = `<div class="ref-grid">${Ref.structures.map((s, i) => `<div class="ref-card"><h3>${esc(s.name)}</h3><p>${esc(s.desc)}</p><p><b>Operations:</b> ${esc(s.ops)}</p><p><b>Use it for:</b> ${esc(s.use)}</p><pre>${esc(s.code)}</pre>
    <div class="act"><button class="btn" data-copy="${i}">Copy code</button><button class="btn" data-note="${i}">Save to notes</button></div></div>`).join('')}</div>`;
  $('#tkBody').onclick = async e => {
    const c = e.target.closest('[data-copy]'), n = e.target.closest('[data-note]');
    if (c) copyText(Ref.structures[+c.dataset.copy].code);
    if (n) { const s = Ref.structures[+n.dataset.note]; saveAsNote('Data structure: ' + s.name, `${s.desc}\n\n**Operations:** ${s.ops}\n\n**Use it for:** ${s.use}\n\n\`\`\`python\n${s.code}\n\`\`\`\n`, 'Data Structures and Algorithms', ['reference']); }
  };
}
function tkConcepts() {
  let subj = '', q = '';
  const subjects = [...new Set(Ref.concepts.map(c => c[0]))];
  $('#tkBody').innerHTML = `<div class="viz-ctl"><input id="kQ" type="search" placeholder="Search concepts" style="width:240px"><select id="kSub"><option value="">All subjects</option>${subjects.map(s => `<option>${esc(s)}</option>`).join('')}</select></div><div class="ref-grid" id="kGrid"></div>`;
  const paint = () => { const list = Ref.concepts.filter(c => (!subj || c[0] === subj) && (!q || (c[1] + c[2]).toLowerCase().includes(q)));
    $('#kGrid').innerHTML = list.map(c => `<div class="ref-card"><span class="badge accent" style="align-self:flex-start">${esc(c[0])}</span><h3>${esc(c[1])}</h3><p>${esc(c[2])}</p><div class="act"><button class="btn" data-k="${Ref.concepts.indexOf(c)}">Save to notes</button></div></div>`).join('') || '<div class="noresult">No concepts match.</div>'; };
  $('#kQ').oninput = e => { q = e.target.value.toLowerCase(); paint(); }; $('#kSub').onchange = e => { subj = e.target.value; paint(); };
  $('#kGrid').onclick = e => { const b = e.target.closest('[data-k]'); if (b) { const c = Ref.concepts[+b.dataset.k]; saveAsNote(c[1], `${c[2]}\n`, c[0], ['concept']); } };
  paint();
}

/* ======================================================================== SNIPPETS */
async function tkSnippets() {
  let mode = 'mine', editing = null;
  const LANGS = ['python', 'javascript', 'typescript', 'java', 'c', 'cpp', 'sql', 'bash', 'go', 'rust', 'text'];
  const paint = async () => {
    const mine = await SA.list('snippets');
    $('#tkBody').innerHTML = `<div class="viz-ctl"><div class="seg" id="snSeg"><button data-m="mine" class="${mode === 'mine' ? 'active' : ''}">My snippets (${mine.length})</button><button data-m="patterns" class="${mode === 'patterns' ? 'active' : ''}">Common patterns</button></div><span class="spacer" style="flex:1"></span>${mode === 'mine' ? `<button class="btn primary" id="snNew">${icon('plus')}New snippet</button>` : ''}</div>
      ${mode === 'mine' ? `${editing ? `<div class="panel" style="margin-bottom:14px"><div class="addrow"><input id="snTitle" type="text" placeholder="Title" value="${esc(editing.title || '')}"><select id="snLang">${LANGS.map(l => `<option ${l === (editing.language || 'python') ? 'selected' : ''}>${l}</option>`).join('')}</select><select id="snSub">${Study.subjectOptions(editing.subject_id)}</select><input id="snTags" type="text" placeholder="tags" value="${esc((editing.tags || []).join(', '))}" style="max-width:180px"></div>
        <textarea id="snCode" rows="10" spellcheck="false" style="width:100%;font:13px/1.5 var(--mono)">${esc(editing.code || '')}</textarea><div class="addrow" style="margin:10px 0 0"><button class="btn primary" id="snSave">Save</button><button class="btn" id="snCancel">Cancel</button>${editing.id ? '<button class="btn danger" id="snDel">Delete</button>' : ''}</div></div>` : ''}
        <div class="ref-grid">${mine.map((s, i) => `<div class="ref-card"><h3>${esc(s.title || 'Untitled')}</h3><div class="tags"><span class="badge accent">${esc(s.language || 'text')}</span>${s.subject_id ? `<span class="badge">${esc(Study.subjectName(s.subject_id))}</span>` : ''}${s.tags.map(t => `<span class="badge">#${esc(t)}</span>`).join('')}</div><pre>${esc(s.code.slice(0, 600))}</pre><div class="act"><button class="btn" data-copy="${i}">Copy</button><button class="btn" data-edit="${i}">Edit</button></div></div>`).join('') || '<div class="empty"><h2>No snippets yet</h2><p>Save code you reuse. You can also start from the Common patterns tab.</p></div>'}</div>`
      : `<div class="ref-grid">${Ref.patterns.map((p, i) => `<div class="ref-card"><h3>${esc(p[0])}</h3><p>${esc(p[1])}</p><pre>${esc(p[2])}</pre><div class="act"><button class="btn" data-pcopy="${i}">Copy</button><button class="btn" data-psave="${i}">Save to my snippets</button></div></div>`).join('')}</div>`}`;
    $('#snSeg').onclick = e => { const b = e.target.closest('button'); if (b) { mode = b.dataset.m; editing = null; paint(); } };
    $('#snNew')?.addEventListener('click', () => { editing = {}; paint(); });
    $('#snCancel')?.addEventListener('click', () => { editing = null; paint(); });
    $('#snSave')?.addEventListener('click', async () => {
      const body = {title: $('#snTitle').value, language: $('#snLang').value, subject_id: $('#snSub').value, tags: $('#snTags').value.split(',').map(t => t.trim()).filter(Boolean), code: $('#snCode').value};
      try { editing.id ? await SA.upd('snippets', editing.id, body) : await SA.add('snippets', body); editing = null; toast('Snippet saved'); paint(); } catch (e) { toast(e.message, true); }
    });
    $('#snDel')?.addEventListener('click', async () => { if (await UI.confirm('', {title: 'Delete this snippet?', confirm: 'Delete', danger: true})) { await SA.del('snippets', editing.id); editing = null; paint(); } });
    $('#tkBody').onclick = async e => {
      const c = e.target.closest('[data-copy]'), ed = e.target.closest('[data-edit]'), pc = e.target.closest('[data-pcopy]'), ps = e.target.closest('[data-psave]');
      if (c) copyText(mine[+c.dataset.copy].code); else if (ed) { editing = mine[+ed.dataset.edit]; paint(); }
      else if (pc) copyText(Ref.patterns[+pc.dataset.pcopy][2]);
      else if (ps) { const p = Ref.patterns[+ps.dataset.psave]; try { await SA.add('snippets', {title: p[0], language: 'python', code: p[2], tags: ['pattern']}); toast('Saved to your snippets'); } catch (er) { toast(er.message, true); } }
    };
  };
  await paint();
}

/* ======================================================================== PRACTICE (spaced repetition) */
async function tkPractice() {
  let mode = 'review', queue = [], shown = false, f = {subject: '', diff: '', q: ''}, editing = null;
  const load = async () => { queue = await api('/api/study/practice/due'); };
  const paint = async () => {
    const all = await SA.list('questions'); if (mode === 'review') await load();
    const body = mode === 'review' ? (queue.length ? (() => { const q = queue[0]; return `<p class="muted" style="text-align:center">${queue.length} left today${q.subject_id ? ' · ' + esc(Study.subjectName(q.subject_id)) : ''} · ${esc(q.difficulty)}</p>
        <div class="flash-card"><div class="q">${esc(q.question)}</div>${shown ? `<div class="a">${esc(q.answer || '(no answer saved)')}</div>` : ''}</div>
        <div class="rate">${shown ? ['again', 'hard', 'good', 'easy'].map(g => `<button class="btn ${g === 'good' ? 'primary' : ''}" data-g="${g}">${g[0].toUpperCase() + g.slice(1)}</button>`).join('') : '<button class="btn primary" id="pShow">Show answer</button>'}</div>
        <p class="muted" style="text-align:center;font-size:12.5px">Again = see it today · Hard = tomorrow · Good / Easy = later each time (1, 3, 7, 14, 30 days)</p>`; })()
      : `<div class="empty"><h2>${all.length ? 'All caught up' : 'No questions yet'}</h2><p>${all.length ? 'Nothing is due for review. Come back tomorrow, or add more questions.' : 'Add your own questions, or import a starter set.'}</p>${all.length ? '' : '<button class="btn primary" id="pStarter">Import starter questions</button>'}</div>`)
      : `<div class="viz-ctl"><input id="pQ" type="search" placeholder="Search questions" value="${esc(f.q)}" style="width:220px"><select id="pSub"><option value="">All subjects</option>${(Study._subjects || []).map(s => `<option value="${s.id}" ${f.subject === s.id ? 'selected' : ''}>${esc(s.name)}</option>`).join('')}</select>
        <select id="pDiff"><option value="">Any difficulty</option>${['easy', 'medium', 'hard'].map(d => `<option ${f.diff === d ? 'selected' : ''}>${d}</option>`).join('')}</select><button class="btn" id="pStarter">Import starter questions</button></div>
        ${editing ? `<div class="panel" style="margin-bottom:14px"><textarea id="pqQ" rows="3" placeholder="Question" style="width:100%">${esc(editing.question || '')}</textarea><textarea id="pqA" rows="3" placeholder="Answer" style="width:100%;margin-top:8px">${esc(editing.answer || '')}</textarea>
          <div class="addrow" style="margin:10px 0 0"><select id="pqS">${Study.subjectOptions(editing.subject_id)}</select><select id="pqD">${['easy', 'medium', 'hard'].map(d => `<option ${d === (editing.difficulty || 'medium') ? 'selected' : ''}>${d}</option>`).join('')}</select><input id="pqSrc" type="text" placeholder="Source (optional)" value="${esc(editing.source || '')}"><button class="btn primary" id="pqSave">Save</button><button class="btn" id="pqCancel">Cancel</button>${editing.id ? '<button class="btn danger" id="pqDel">Delete</button>' : ''}</div></div>` : ''}
        <div class="rows">${all.filter(q => (!f.subject || q.subject_id === f.subject) && (!f.diff || q.difficulty === f.diff) && (!f.q || (q.question + q.answer).toLowerCase().includes(f.q.toLowerCase()))).map(q => `<div class="row" data-edit="${q.id}"><span class="nm" style="flex:1;white-space:normal">${esc(q.question)}</span><span class="badge">${esc(q.difficulty)}</span><span class="when">${q.due ? 'due ' + esc(q.due) : 'new'}</span></div>`).join('') || '<div class="noresult">No questions match.</div>'}</div>`;
    $('#tkBody').innerHTML = `<div class="viz-ctl"><div class="seg" id="pSeg"><button data-m="review" class="${mode === 'review' ? 'active' : ''}">Review</button><button data-m="all" class="${mode === 'all' ? 'active' : ''}">All questions (${all.length})</button></div><span class="spacer" style="flex:1"></span><button class="btn primary" id="pNew">${icon('plus')}New question</button></div>${body}`;
    $('#pSeg').onclick = e => { const b = e.target.closest('button'); if (b) { mode = b.dataset.m; shown = false; editing = null; paint(); } };
    $('#pNew').onclick = () => { mode = 'all'; editing = {}; paint(); };
    $('#pShow')?.addEventListener('click', () => { shown = true; paint(); });
    $('#tkBody').onclick = async e => {
      const g = e.target.closest('[data-g]'); if (g) { try { await api(`/api/study/questions/${queue[0].id}/review`, {json: {grade: g.dataset.g}}); shown = false; paint(); } catch (er) { toast(er.message, true); } return; }
      const ed = e.target.closest('[data-edit]'); if (ed) { editing = all.find(x => x.id === ed.dataset.edit); paint(); }
    };
    $('#pStarter')?.addEventListener('click', async () => {
      const have = new Set(all.map(q => q.question)); let n = 0;
      for (const [sub, diff, q, a] of Ref.questions) { if (have.has(q)) continue; const s = Study._subjects.find(x => x.name === sub); await SA.add('questions', {question: q, answer: a, difficulty: diff, subject_id: s ? s.id : '', source: 'Starter set'}); n++; }
      toast(n ? `${n} questions added` : 'Starter questions are already in your list'); mode = 'review'; paint();
    });
    $('#pQ')?.addEventListener('input', debounce(e => { f.q = e.target.value; paint(); }, 300)); $('#pSub')?.addEventListener('change', e => { f.subject = e.target.value; paint(); }); $('#pDiff')?.addEventListener('change', e => { f.diff = e.target.value; paint(); });
    $('#pqCancel')?.addEventListener('click', () => { editing = null; paint(); });
    $('#pqSave')?.addEventListener('click', async () => {
      const body = {question: $('#pqQ').value, answer: $('#pqA').value, subject_id: $('#pqS').value, difficulty: $('#pqD').value, source: $('#pqSrc').value};
      try { editing.id ? await SA.upd('questions', editing.id, body) : await SA.add('questions', body); editing = null; toast('Question saved'); paint(); } catch (e) { toast(e.message, true); }
    });
    $('#pqDel')?.addEventListener('click', async () => { if (await UI.confirm('', {title: 'Delete this question?', confirm: 'Delete', danger: true})) { await SA.del('questions', editing.id); editing = null; paint(); } });
  };
  await paint();
}
