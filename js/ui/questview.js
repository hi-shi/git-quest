// クエスト画面と、ステージ一覧の引き出し。

import { CHAPTERS, ALL_STAGES } from '../stages/index.js';

/** `バッククォート` を <code> に変換しつつ、それ以外は textContent 経由で安全に入れる。 */
export function markup(text) {
  const frag = document.createDocumentFragment();
  const parts = String(text).split(/`([^`]+)`/g);
  parts.forEach((part, i) => {
    if (i % 2 === 1) {
      const code = document.createElement('code');
      code.textContent = part;
      frag.appendChild(code);
    } else if (part) {
      frag.appendChild(document.createTextNode(part));
    }
  });
  return frag;
}

function card(title) {
  const c = document.createElement('section');
  c.className = 'q-card';
  if (title) {
    const h = document.createElement('h3');
    h.textContent = title;
    c.appendChild(h);
  }
  return c;
}

/**
 * クエスト画面を描く。
 * @param {object} handlers {onRestart, onNext, onGoTerminal}
 */
export function renderQuest(el, session, revealed, handlers) {
  el.innerHTML = '';
  const { stage, goalState, cleared } = session;

  // --- 状況説明
  const intro = card(stage.title);
  const p = document.createElement('p');
  p.className = 'q-intro';
  p.appendChild(markup(stage.intro));
  intro.appendChild(p);
  el.appendChild(intro);

  // --- 目標
  const goals = card('達成すること');
  const ul = document.createElement('ul');
  ul.className = 'q-goals';
  stage.goals.forEach((g, i) => {
    const li = document.createElement('li');
    if (goalState[i]) li.className = 'done';
    const box = document.createElement('span');
    box.className = 'box';
    box.textContent = goalState[i] ? '✓' : '';
    li.appendChild(box);
    const span = document.createElement('span');
    span.appendChild(markup(g.text));
    li.appendChild(span);
    ul.appendChild(li);
  });
  goals.appendChild(ul);
  el.appendChild(goals);

  // --- ヒント（1つずつ開く）
  const hints = card('ヒント');
  const hl = document.createElement('ul');
  hl.className = 'hint-list';
  stage.hints.forEach((h, i) => {
    const li = document.createElement('li');
    if (i < revealed) {
      const d = document.createElement('div');
      d.className = 'hint-shown';
      d.appendChild(markup(h));
      li.appendChild(d);
    } else if (i === revealed) {
      const b = document.createElement('button');
      b.className = 'hint-btn';
      b.textContent = `ヒント ${i + 1} を見る（全 ${stage.hints.length} 個）`;
      b.addEventListener('click', () => handlers.onRevealHint());
      li.appendChild(b);
    } else {
      return;
    }
    hl.appendChild(li);
  });
  hints.appendChild(hl);
  el.appendChild(hints);

  // --- クリア後のまとめ
  if (cleared) {
    const teach = card('まとめ');
    const t = document.createElement('div');
    t.className = 'teach';
    for (const line of stage.teach) {
      const tp = document.createElement('p');
      tp.appendChild(markup(line));
      t.appendChild(tp);
    }
    teach.appendChild(t);
    el.appendChild(teach);
  }

  // --- 操作
  const actions = card(null);
  const row = document.createElement('div');
  row.className = 'q-actions';

  const term = document.createElement('button');
  term.className = 'ghost-btn';
  term.textContent = 'ターミナルへ';
  term.addEventListener('click', handlers.onGoTerminal);
  row.appendChild(term);

  const restart = document.createElement('button');
  restart.className = 'ghost-btn';
  restart.textContent = 'やり直す';
  restart.addEventListener('click', handlers.onRestart);
  row.appendChild(restart);

  const next = document.createElement('button');
  next.className = 'primary-btn';
  next.textContent = cleared ? '次のステージへ' : 'クリアすると進めます';
  next.disabled = !cleared || !handlers.hasNext;
  next.addEventListener('click', handlers.onNext);
  row.appendChild(next);

  actions.appendChild(row);
  el.appendChild(actions);
}

/** ステージ一覧（引き出しの中身）。 */
export function renderChapterList(
  listEl,
  progressEl,
  { currentId, isDone, onPick, onOpenReal, onOpenCheat }
) {
  listEl.innerHTML = '';

  const doneCount = ALL_STAGES.filter((s) => isDone(s.id)).length;
  progressEl.innerHTML = '';
  const label = document.createElement('div');
  label.textContent = `進捗 ${doneCount} / ${ALL_STAGES.length} ステージ`;
  progressEl.appendChild(label);
  const bar = document.createElement('div');
  bar.className = 'bar';
  const fill = document.createElement('i');
  fill.style.width = Math.round((doneCount / ALL_STAGES.length) * 100) + '%';
  bar.appendChild(fill);
  progressEl.appendChild(bar);

  for (const ch of CHAPTERS) {
    const block = document.createElement('div');
    block.className = 'ch-block';

    const title = document.createElement('div');
    title.className = 'ch-title';
    title.textContent = ch.title;
    block.appendChild(title);

    const sub = document.createElement('div');
    sub.className = 'ch-sub';
    sub.textContent = ch.subtitle;
    block.appendChild(sub);

    for (const st of ch.stages) {
      const b = document.createElement('button');
      b.className =
        'stage-btn' + (isDone(st.id) ? ' done' : '') + (st.id === currentId ? ' current' : '');
      const mark = document.createElement('span');
      mark.className = 'st-mark';
      mark.textContent = isDone(st.id) ? '✓' : '';
      b.appendChild(mark);
      const t = document.createElement('span');
      t.textContent = st.title;
      b.appendChild(t);
      b.addEventListener('click', () => onPick(st.id));
      block.appendChild(b);
    }
    listEl.appendChild(block);
  }

  // 第7章は擬似リポジトリではなく、本物の GitHub を触る特別な章
  const block = document.createElement('div');
  block.className = 'ch-block';
  const title = document.createElement('div');
  title.className = 'ch-title';
  title.textContent = '第8章 GitHub 実践';
  block.appendChild(title);
  const sub = document.createElement('div');
  sub.className = 'ch-sub';
  sub.textContent = '本物のリポジトリでブランチ → コミット → PR → マージ';
  block.appendChild(sub);
  const b = document.createElement('button');
  b.className = 'stage-btn';
  const mark = document.createElement('span');
  mark.className = 'st-mark';
  mark.textContent = '★';
  b.appendChild(mark);
  const t = document.createElement('span');
  t.textContent = '実リポジトリモードを開く';
  b.appendChild(t);
  b.addEventListener('click', onOpenReal);
  block.appendChild(b);
  listEl.appendChild(block);

  // チートシートは下部タブ「？逆引き」から開けるので、ここでは場所だけ案内する
  const note = document.createElement('p');
  note.className = 'fine';
  note.style.padding = '0 6px';
  note.textContent = '困ったときは、画面下いちばん右の「？逆引き」から逆引きチートシートが開けます。';
  listEl.appendChild(note);
  void onOpenCheat;
}
