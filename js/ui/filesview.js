// 「作業ツリー / ステージ / 直前のコミット」の3列比較。
// add と commit が何を動かしているのかを、この1画面で見せる。

import {
  status,
  commitTree,
  headCommit,
  readBlob,
  hashObject,
  isIgnored,
} from '../engine/repo.js';
import { diffLines } from '../engine/diff.js';

export function renderFiles(gridEl, detailEl, repo, { onEdit, selected, onSelect }) {
  gridEl.innerHTML = '';

  if (!repo || !repo.initialized) {
    gridEl.innerHTML =
      '<p class="file-empty" style="grid-column:1/-1">まだリポジトリがありません。<br />ターミナルで git init を。</p>';
    detailEl.innerHTML = '';
    return;
  }

  const s = status(repo);
  const head = commitTree(repo, headCommit(repo));
  const index = repo.index || {};
  const conflicts = new Set(s.conflicted);

  const cols = [
    {
      key: 'workdir',
      title: '作業ツリー',
      sub: 'いま編集中のファイル',
      items: Object.keys(repo.workdir)
        .sort()
        .map((p) => {
          const wdSha = hashObject('blob', repo.workdir[p]);
          let cls = '';
          if (conflicts.has(p)) cls = 'conflict';
          else if (isIgnored(repo, p) && !(p in index)) cls = 'ignored';
          else if (!(p in index)) cls = 'added'; // untracked
          else if (index[p] !== wdSha) cls = 'changed';
          return { path: p, cls };
        }),
    },
    {
      key: 'index',
      title: 'ステージ',
      sub: '次のコミットに入るもの',
      items: Object.keys(index)
        .sort()
        .map((p) => {
          let cls = '';
          if (!(p in head)) cls = 'added';
          else if (head[p] !== index[p]) cls = 'changed';
          return { path: p, cls };
        }),
    },
    {
      key: 'head',
      title: '直前のコミット',
      sub: 'HEAD が指す記録',
      items: Object.keys(head)
        .sort()
        .map((p) => ({ path: p, cls: '' })),
    },
  ];

  for (const col of cols) {
    const div = document.createElement('div');
    div.className = 'file-col';
    div.dataset.col = col.key;

    const h = document.createElement('h3');
    h.textContent = col.title;
    div.appendChild(h);

    const sub = document.createElement('p');
    sub.className = 'col-sub';
    sub.textContent = col.sub;
    div.appendChild(sub);

    if (!col.items.length) {
      const empty = document.createElement('p');
      empty.className = 'file-empty';
      empty.textContent = col.key === 'head' ? 'コミットなし' : '空';
      div.appendChild(empty);
    }

    for (const item of col.items) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'file-item ' + item.cls;
      b.textContent = item.path;
      b.title = item.path;
      b.addEventListener('click', () => onSelect(item.path));
      div.appendChild(b);
    }
    gridEl.appendChild(div);
  }

  renderDetail(detailEl, repo, selected, onEdit);
}

function renderDetail(detailEl, repo, path, onEdit) {
  detailEl.innerHTML = '';
  if (!path) {
    const p = document.createElement('div');
    p.className = 'file-empty';
    p.textContent = 'ファイル名をタップすると、中身と差分が見られます。';
    detailEl.appendChild(p);
    return;
  }

  const head = commitTree(repo, headCommit(repo));
  const index = repo.index || {};
  const inWork = path in repo.workdir;

  const headText = head[path] ? readBlob(repo, head[path]) : '';
  const indexText = index[path] ? readBlob(repo, index[path]) : '';
  const workText = inWork ? repo.workdir[path] : '';

  const headEl = document.createElement('div');
  headEl.className = 'fd-head';
  const name = document.createElement('span');
  name.textContent = path;
  headEl.appendChild(name);
  if (inWork) {
    const btn = document.createElement('button');
    btn.className = 'fd-edit';
    btn.textContent = '編集';
    btn.addEventListener('click', () => onEdit(path));
    headEl.appendChild(btn);
  }
  detailEl.appendChild(headEl);

  const states = [];
  if (workText !== indexText) states.push('作業ツリー ≠ ステージ（未 add）');
  if (indexText !== headText) states.push('ステージ ≠ コミット（未 commit）');
  if (!states.length) states.push('3か所とも同じ内容です');
  const st = document.createElement('div');
  st.style.color = 'var(--fg-faint)';
  st.style.marginBottom = '6px';
  st.textContent = states.join(' / ');
  detailEl.appendChild(st);

  if (workText !== indexText) {
    detailEl.appendChild(diffBlock('ステージ → 作業ツリー の差分', indexText, workText));
  } else if (indexText !== headText) {
    detailEl.appendChild(diffBlock('コミット → ステージ の差分', headText, indexText));
  } else {
    const pre = document.createElement('div');
    pre.textContent = workText || '（空のファイル）';
    detailEl.appendChild(pre);
  }
}

function diffBlock(title, a, b) {
  const wrap = document.createElement('div');
  const t = document.createElement('div');
  t.className = 'd-meta';
  t.textContent = title;
  wrap.appendChild(t);
  for (const part of diffLines(a, b)) {
    const line = document.createElement('div');
    line.className = part.type === 'add' ? 'd-add' : part.type === 'del' ? 'd-del' : '';
    line.textContent =
      (part.type === 'add' ? '+' : part.type === 'del' ? '-' : ' ') + part.line;
    wrap.appendChild(line);
  }
  return wrap;
}
