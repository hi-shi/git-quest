// ターミナル画面。出力の描画と、スマホで打ちやすくするための入力補助。

import { listBranches, listRemoteBranches, status } from '../engine/repo.js';
import { displayPath, inRepo, repoDirAbs, cwdInRepo, listDir, cwdRel } from '../engine/paths.js';
import { HELP } from '../engine/commands.js';
import { SHELL_COMMANDS } from '../engine/shell.js';

const GIT_SUBCOMMANDS = Object.keys(HELP).concat([
  'restore',
  'reset',
  'revert',
  'stash',
  'cherry-pick',
  'config',
  'clean',
  'show',
]);

export class Terminal {
  /**
   * @param {object} els {output, form, input, chips}
   * @param {(line:string, opts?:{animate?:boolean})=>void} onSubmit
   */
  constructor(els, onSubmit) {
    this.out = els.output;
    this.form = els.form;
    this.input = els.input;
    this.chipsEl = els.chips;
    this.cwdPathEl = els.cwdPath;
    this.cwdBadgeEl = els.cwdBadge;
    this.onSubmit = onSubmit;
    this.history = [];
    this.histPos = -1;

    this.form.addEventListener('submit', (e) => {
      e.preventDefault();
      const line = this.input.value.trim();
      if (!line) return;
      this.input.value = '';
      this.history.push(line);
      this.histPos = this.history.length;
      this.onSubmit(line, { animate: false });
    });

    this.input.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        this.recall(-1);
      } else if (e.key === 'ArrowDown') {
        e.preventDefault();
        this.recall(1);
      } else if (e.key === 'Tab') {
        e.preventDefault();
        this.complete();
      }
    });
  }

  recall(dir) {
    if (!this.history.length) return;
    this.histPos = Math.max(0, Math.min(this.history.length, this.histPos + dir));
    this.input.value = this.history[this.histPos] || '';
    // カーソルを末尾へ
    requestAnimationFrame(() => {
      const n = this.input.value.length;
      this.input.setSelectionRange(n, n);
    });
  }

  /** Tab 補完。サブコマンド → ブランチ名 → ファイル名の順に候補を探す。 */
  complete() {
    const value = this.input.value;
    const parts = value.split(' ');
    const last = parts[parts.length - 1];
    const candidates = this.completionsFor(parts, last);
    if (!candidates.length) return;
    if (candidates.length === 1) {
      parts[parts.length - 1] = candidates[0];
      this.input.value = parts.join(' ') + ' ';
    } else {
      const prefix = commonPrefix(candidates);
      if (prefix.length > last.length) {
        parts[parts.length - 1] = prefix;
        this.input.value = parts.join(' ');
      }
      this.write({ kind: 'out', text: candidates.join('  ') });
    }
  }

  completionsFor(parts, last) {
    const repo = this.repo;
    const pool = [];
    if (parts.length === 1) {
      pool.push('git', ...SHELL_COMMANDS);
    } else if (parts[0] === 'git' && parts.length === 2) {
      pool.push(...GIT_SUBCOMMANDS);
    } else if (repo) {
      // cd の候補は今いるフォルダの中のフォルダ名
      if (parts[0] === 'cd') {
        pool.push(...listDir(repo, repo.cwd).dirs, '..', '~');
      } else {
        const here = cwdRel(repo);
        const { dirs, files } = listDir(repo, repo.cwd);
        pool.push(
          ...listBranches(repo),
          ...listRemoteBranches(repo),
          ...files,
          ...dirs.map((d) => d + '/')
        );
        void here;
      }
    }
    return [...new Set(pool)].filter((c) => c.startsWith(last) && c !== last).sort();
  }

  /** グラフ／補完のために現在のリポジトリを渡しておく。 */
  bind(repo) {
    this.repo = repo;
    this.renderCwd();
  }

  /**
   * 入力欄の上に「いまどこにいるか」を出す。
   * リポジトリのルートか、その下か、外かがひと目で分かるようにする。
   */
  renderCwd() {
    const repo = this.repo;
    if (!repo || !this.cwdPathEl) return;
    this.cwdPathEl.textContent = displayPath(repo);

    const badge = this.cwdBadgeEl;
    if (!badge) return;
    if (!inRepo(repo)) {
      badge.className = 'cwd-badge outside';
      badge.textContent = repo.gitRoot === null ? 'リポジトリなし' : 'リポジトリの外';
      return;
    }
    const here = cwdInRepo(repo);
    if (!here) {
      badge.className = 'cwd-badge root';
      badge.textContent = 'リポジトリのルート';
    } else {
      badge.className = 'cwd-badge sub';
      badge.textContent = 'ルートの下（' + here + '）';
    }
  }

  clear() {
    // 打ち込み途中でステージが切り替わっても中途半端な行が残らないように
    this.finishTyping();
    this.input.value = '';
    this.out.innerHTML = '';
  }

  /**
   * 1ブロック書き出す。
   * @param {{kind:'cmd'|'out'|'error'|'hint'|'sys'|'goal', text:string}} block
   */
  write(block) {
    const div = document.createElement('div');
    div.className = 'term-block';

    if (block.kind === 'cmd') {
      const p = document.createElement('div');
      p.className = 'term-cmd mono';
      p.textContent = block.text;
      div.appendChild(p);
    } else if (block.kind === 'hint') {
      const p = document.createElement('div');
      p.className = 'term-hint';
      p.textContent = '💡 ' + block.text;
      div.appendChild(p);
    } else if (block.kind === 'sys') {
      const p = document.createElement('div');
      p.className = 'term-sys';
      p.textContent = block.text;
      div.appendChild(p);
    } else if (block.kind === 'goal') {
      const p = document.createElement('div');
      p.className = 'term-goal';
      p.textContent = '✓ ' + block.text;
      div.appendChild(p);
    } else {
      const p = document.createElement('div');
      p.className = 'term-out' + (block.kind === 'error' ? ' error' : '');
      colorize(p, block.text);
      div.appendChild(p);
    }

    this.out.appendChild(div);
    this.scrollToEnd();
  }

  /**
   * 打ち込み中のアニメーションを即座に完了させる。
   * 次のコマンドが来たときなど、待たせたくない場面で使う。
   */
  finishTyping() {
    if (this.typing) {
      clearTimeout(this.typing.timer);
      this.typing.finish();
      this.typing = null;
    }
  }

  /**
   * 実行したコマンドを `$ ...` としてターミナルに出す。
   * animate を付けると1文字ずつ現れる（チップをタップしたとき用）。
   * 自分で打った場合は既に見えているので、待たせずに即座に出す。
   * @returns {Promise<void>} 表示し終わったら解決する
   */
  writeCommand(text, { animate = false } = {}) {
    this.finishTyping();

    const div = document.createElement('div');
    div.className = 'term-block';

    // どこで打ったコマンドなのかを1行添える。
    // 同じコマンドでも場所によって結果が変わるので、後から見返せるようにする。
    if (this.repo) {
      const where = document.createElement('div');
      where.className = 'term-where';
      where.textContent = displayPath(this.repo);
      div.appendChild(where);
    }

    const p = document.createElement('div');
    p.className = 'term-cmd mono';
    div.appendChild(p);
    this.out.appendChild(div);

    const reduce =
      typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (!animate || reduce || !text) {
      p.textContent = text;
      this.scrollToEnd();
      return Promise.resolve();
    }

    const chars = [...text]; // 絵文字や結合文字で壊れないように
    // 長いコマンドでも待たされないよう、全体で 400ms 前後に収める
    const step = Math.max(14, Math.min(55, Math.round(400 / chars.length)));
    p.classList.add('typing');
    this.scrollToEnd();

    return new Promise((resolve) => {
      let i = 0;
      const finish = () => {
        p.textContent = text;
        p.classList.remove('typing');
        this.scrollToEnd();
        resolve();
      };
      const tick = () => {
        p.textContent = chars.slice(0, ++i).join('');
        if (i >= chars.length) {
          this.typing = null;
          finish();
          return;
        }
        this.out.scrollTop = this.out.scrollHeight;
        this.typing.timer = setTimeout(tick, step);
      };
      this.typing = { timer: setTimeout(tick, step), finish };
    });
  }

  /**
   * ターミナルの流れの中に押せるボタンを1つ置く。
   * ステージクリア後の「次へ進む」導線など、コマンドではない操作に使う。
   */
  writeAction(label, onClick) {
    const div = document.createElement('div');
    div.className = 'term-block';
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'term-action';
    b.textContent = label;
    b.addEventListener('click', () => {
      b.disabled = true;
      onClick();
    });
    div.appendChild(b);
    this.out.appendChild(div);
    this.scrollToEnd();
    return b;
  }

  scrollToEnd() {
    requestAnimationFrame(() => {
      this.out.scrollTop = this.out.scrollHeight;
    });
  }

  /**
   * 文脈に合わせたコマンドチップを並べる。
   * スマホでは `-` や `/` が打ちにくいので、ここが実質の主操作になる。
   */
  renderChips(repo, stage) {
    const chips = suggestChips(repo, stage);
    this.chipsEl.innerHTML = '';
    for (const c of chips) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'chip' + (c.accent ? ' accent' : '');
      b.textContent = c.label;
      b.addEventListener('click', () => {
        if (c.run) {
          this.input.value = '';
          // ターミナル側で1文字ずつ現れる。タップだけで進めていても
          // コマンドの字面が目に入るので、自然と覚えられる。
          this.onSubmit(c.text, { animate: true });
        } else {
          // 続きを打ってもらう系（引数が要るもの）は入力欄に入れて待つ
          this.input.value = c.text;
          this.input.focus();
          const n = this.input.value.length;
          requestAnimationFrame(() => this.input.setSelectionRange(n, n));
        }
      });
      this.chipsEl.appendChild(b);
    }
  }
}

/** diff とコンフリクトマーカーに色を付ける。 */
function colorize(el, text) {
  const lines = text.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    let cls = '';
    if (/^<{7}|^={7}$|^>{7}/.test(line)) cls = 'd-conflict';
    else if (/^\+/.test(line)) cls = 'd-add';
    else if (/^-/.test(line) && !/^---/.test(line)) cls = 'd-del';
    else if (/^(diff --git|index |@@|\+\+\+|---)/.test(line)) cls = 'd-meta';

    if (cls) {
      const span = document.createElement('span');
      span.className = cls;
      span.textContent = line;
      el.appendChild(span);
    } else {
      el.appendChild(document.createTextNode(line));
    }
    if (i < lines.length - 1) el.appendChild(document.createTextNode('\n'));
  }
}

function commonPrefix(list) {
  if (!list.length) return '';
  let p = list[0];
  for (const s of list) {
    while (!s.startsWith(p)) p = p.slice(0, -1);
  }
  return p;
}

/**
 * 今の状態で「次に打ちそうなコマンド」を並べる。
 * run:true はタップで即実行、false は入力欄に差し込むだけ（引数が要るもの）。
 */
function suggestChips(repo, stage) {
  const chips = [];
  const add = (label, text, opts = {}) =>
    chips.push({ label, text: text ?? label, run: opts.run !== false, accent: !!opts.accent });

  if (!repo || !repo.initialized) {
    add('git init', 'git init', { accent: true });
    add('pwd');
    add('ls');
    add('echo "..." > file', 'echo "" > ', { run: false });
    add('help');
    return chips;
  }

  const s = status(repo);

  // リポジトリの外にいるなら、まず戻る手段を最優先で出す
  if (!inRepo(repo)) {
    const root = repoDirAbs(repo);
    if (root) add('cd ' + displayPath(repo, root), 'cd ' + displayPath(repo, root), { accent: true });
    add('pwd');
    add('ls');
    return chips;
  }

  add('git status', 'git status', { accent: true });

  // 現在地まわり。サブディレクトリにいるときは戻る手段を目立たせる
  add('pwd');
  if (cwdInRepo(repo)) add('cd ..', 'cd ..', { accent: true });
  const here = listDir(repo, repo.cwd).dirs.filter((d) => !d.startsWith('.'));
  if (here.length) add('cd ' + here[0]);

  if (Object.keys(repo.conflicts).length) {
    const first = Object.keys(repo.conflicts)[0];
    add('edit ' + first, 'edit ' + first, { accent: true });
    add('git add ' + first);
    if (repo.REBASE) add('git rebase --continue', 'git rebase --continue', { accent: true });
    else add('git commit', 'git commit -m "マージ"', { run: false, accent: true });
    add('git merge --abort');
    return chips;
  }

  if (repo.REBASE) {
    add('git rebase --continue', 'git rebase --continue', { accent: true });
    add('git rebase --abort');
  }

  if (s.untracked.length || s.unstaged.length) {
    add('git add .', 'git add .', { accent: true });
    const target = (s.unstaged[0] && s.unstaged[0].path) || s.untracked[0];
    if (target) add('git add ' + target);
  }
  if (s.staged.length) {
    add('git commit -m "…"', 'git commit -m ""', { run: false, accent: true });
    add('git diff --staged');
  }
  if (s.unstaged.length) add('git diff');

  add('git log --oneline');
  add('git branch');

  if (listBranches(repo).length > 1) {
    add('git switch …', 'git switch ', { run: false });
    add('git merge …', 'git merge ', { run: false });
  } else {
    add('git switch -c …', 'git switch -c ', { run: false });
  }

  if (repo.remotes.origin) {
    add('git push', 'git push', { accent: true });
    add('git pull');
    add('git fetch');
    add('git remote -v');
  }

  add('ls');
  add('echo "…" > file', 'echo "" > ', { run: false });

  // ステージのヒントに出てくるコマンドを最優先で前に出す
  if (stage && stage.hints) {
    const fromHints = [];
    for (const h of stage.hints) {
      for (const m of h.matchAll(/`([^`]+)`/g)) {
        const cmd = m[1].trim();
        if (/^(git |ls|cat |edit |echo |touch )/.test(cmd) && cmd.length < 46) fromHints.push(cmd);
      }
    }
    for (const cmd of [...new Set(fromHints)].slice(0, 3).reverse()) {
      chips.unshift({
        label: cmd,
        text: cmd,
        run: !/(…|\.\.\.|<|>)/.test(cmd) || /^echo /.test(cmd),
        accent: true,
      });
    }
  }

  // 重複を落とす
  const seen = new Set();
  return chips.filter((c) => (seen.has(c.label) ? false : seen.add(c.label)));
}
