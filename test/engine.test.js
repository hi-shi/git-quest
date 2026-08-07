// node --test git-quest/test/engine.test.js
// 擬似 Git エンジンの振る舞いを、本物の git の挙動に照らして検証する。

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  createRepo,
  initRepo,
  headCommit,
  currentBranch,
  commitTree,
  readBlob,
  status,
  resolveRev,
  mergeBase,
  readCommit,
  listBranches,
} from '../js/engine/repo.js';
import { runLine } from '../js/engine/shell.js';
import { mergeText, hasConflictMarkers, diffLines } from '../js/engine/diff.js';
import { layoutGraph } from '../js/engine/graph.js';
import { tokenize, parseFlags } from '../js/engine/parser.js';

/** テスト用: 複数行のコマンドを順に流す。失敗したら内容つきで落とす。 */
function run(repo, script, { allowFail = false } = {}) {
  let last;
  for (const line of script.trim().split('\n')) {
    const l = line.trim();
    if (!l || l.startsWith('#')) continue;
    last = runLine(repo, l);
    if (!last.ok && !allowFail) {
      assert.fail(`コマンド失敗: ${l}\n${last.out}\n${last.hint || ''}`);
    }
  }
  return last;
}

function fresh() {
  const repo = createRepo();
  run(repo, 'git init');
  return repo;
}

function fileAt(repo, sha, path) {
  const tree = commitTree(repo, sha);
  return tree[path] ? readBlob(repo, tree[path]) : undefined;
}

// ------------------------------------------------------------------ parser

test('tokenize: クォートとリダイレクトを分ける', () => {
  assert.deepEqual(tokenize('git commit -m "hello world"'), ['git', 'commit', '-m', 'hello world']);
  assert.deepEqual(tokenize('echo "a b" > f.txt'), ['echo', 'a b', '>', 'f.txt']);
  assert.deepEqual(tokenize('echo x >> f.txt'), ['echo', 'x', '>>', 'f.txt']);
  assert.deepEqual(tokenize(''), []);
});

test('parseFlags: 値を取るオプションと束ねた短縮形', () => {
  const a = parseFlags(['-m', 'msg', 'file'], { withValue: ['-m'] });
  assert.equal(a.flags['-m'], 'msg');
  assert.deepEqual(a.args, ['file']);

  const b = parseFlags(['-am', 'msg'], { withValue: ['-m'] });
  assert.equal(b.flags['-a'], true);
  assert.equal(b.flags['-m'], 'msg');

  const c = parseFlags(['--hard', 'HEAD~1']);
  assert.equal(c.flags['--hard'], true);
  assert.deepEqual(c.args, ['HEAD~1']);
});

// ------------------------------------------------------------------ 基本

test('init 前は git コマンドが拒否される', () => {
  const repo = createRepo();
  const r = runLine(repo, 'git status');
  assert.equal(r.ok, false);
  assert.match(r.out, /not a git repository/);
});

test('add → commit で HEAD とツリーができる', () => {
  const repo = fresh();
  run(repo, `
    echo "hello" > a.txt
    git add a.txt
    git commit -m "first"
  `);
  const head = headCommit(repo);
  assert.ok(head, 'HEAD が作られていること');
  assert.equal(fileAt(repo, head, 'a.txt'), 'hello\n');
  assert.equal(currentBranch(repo), 'main');
  assert.equal(readCommit(repo, head).parents.length, 0);
});

test('status: untracked → staged → clean と遷移する', () => {
  const repo = fresh();
  run(repo, 'echo "x" > a.txt');
  assert.deepEqual(status(repo).untracked, ['a.txt']);

  run(repo, 'git add a.txt');
  let s = status(repo);
  assert.equal(s.untracked.length, 0);
  assert.deepEqual(s.staged, [{ path: 'a.txt', kind: 'new' }]);

  run(repo, 'git commit -m "c"');
  s = status(repo);
  assert.equal(s.staged.length + s.unstaged.length + s.untracked.length, 0);
});

test('ステージが空なら commit は失敗する', () => {
  const repo = fresh();
  run(repo, 'echo "x" > a.txt');
  const r = runLine(repo, 'git commit -m "no add"');
  assert.equal(r.ok, false);
  assert.match(r.out, /nothing added to commit/);
});

test('add の後に編集すると、ステージと作業ツリーの両方に差分が出る', () => {
  const repo = fresh();
  run(repo, `
    echo "v1" > a.txt
    git add a.txt
    echo "v2" > a.txt
  `);
  const s = status(repo);
  assert.deepEqual(s.staged, [{ path: 'a.txt', kind: 'new' }]);
  assert.deepEqual(s.unstaged, [{ path: 'a.txt', kind: 'modified' }]);
  // コミットされるのは add した時点の内容
  run(repo, 'git commit -m "c"');
  assert.equal(fileAt(repo, headCommit(repo), 'a.txt'), 'v1\n');
});

test('.gitignore に一致するファイルは untracked に出ない', () => {
  const repo = fresh();
  run(repo, `
    echo "*.log" > .gitignore
    echo "noise" > debug.log
    echo "code" > main.js
  `);
  const s = status(repo);
  assert.ok(!s.untracked.includes('debug.log'));
  assert.ok(s.untracked.includes('main.js'));
  assert.ok(s.untracked.includes('.gitignore'));
});

test('commit --amend は sha を変えつつ親を保つ', () => {
  const repo = fresh();
  run(repo, `
    echo "a" > a.txt
    git add a.txt
    git commit -m "first"
    echo "b" > b.txt
    git add b.txt
    git commit -m "typo"
  `);
  const before = headCommit(repo);
  const parent = readCommit(repo, before).parents[0];
  run(repo, 'git commit --amend -m "fixed message"');
  const after = headCommit(repo);
  assert.notEqual(before, after, 'amend で sha が変わること');
  assert.equal(readCommit(repo, after).parents[0], parent, '親は同じ');
  assert.equal(readCommit(repo, after).message, 'fixed message');
});

// ------------------------------------------------------------------ restore / reset

test('restore --staged は index だけ戻し、ファイルの中身は残す', () => {
  const repo = fresh();
  run(repo, `
    echo "a" > a.txt
    git add a.txt
    git commit -m "base"
    echo "changed" > a.txt
    git add a.txt
  `);
  assert.equal(status(repo).staged.length, 1);

  run(repo, 'git restore --staged a.txt');
  const s = status(repo);
  assert.equal(s.staged.length, 0, 'ステージからは外れる');
  assert.deepEqual(s.unstaged, [{ path: 'a.txt', kind: 'modified' }], '変更自体は残る');
  assert.equal(repo.workdir['a.txt'], 'changed\n');
});

test('restore（--staged なし）は作業ツリーの編集を捨てる', () => {
  const repo = fresh();
  run(repo, `
    echo "a" > a.txt
    git add a.txt
    git commit -m "base"
    echo "oops" > a.txt
    git restore a.txt
  `);
  assert.equal(repo.workdir['a.txt'], 'a\n');
});

test('reset の3モードで HEAD / index / 作業ツリーの戻り方が違う', () => {
  const build = () => {
    const repo = fresh();
    run(repo, `
      echo "v1" > a.txt
      git add a.txt
      git commit -m "c1"
      echo "v2" > a.txt
      git add a.txt
      git commit -m "c2"
    `);
    return repo;
  };

  // --soft: HEAD だけ戻る。c2 の内容がステージ済みで残る
  const soft = build();
  const c1 = resolveRev(soft, 'HEAD~1');
  run(soft, 'git reset --soft HEAD~1');
  assert.equal(headCommit(soft), c1);
  assert.equal(soft.workdir['a.txt'], 'v2\n', '作業ツリーはそのまま');
  assert.deepEqual(status(soft).staged, [{ path: 'a.txt', kind: 'modified' }], 'ステージに残る');

  // --mixed: HEAD と index が戻る。作業ツリーは v2 のまま = 未ステージの変更
  const mixed = build();
  run(mixed, 'git reset HEAD~1');
  assert.equal(headCommit(mixed), resolveRev(mixed, 'HEAD'));
  assert.equal(mixed.workdir['a.txt'], 'v2\n', '作業ツリーはそのまま');
  assert.equal(status(mixed).staged.length, 0, 'ステージは空');
  assert.deepEqual(status(mixed).unstaged, [{ path: 'a.txt', kind: 'modified' }]);

  // --hard: 3つとも戻る。v2 は完全に消える
  const hard = build();
  run(hard, 'git reset --hard HEAD~1');
  assert.equal(hard.workdir['a.txt'], 'v1\n', '作業ツリーも巻き戻る');
  const s = status(hard);
  assert.equal(s.staged.length + s.unstaged.length, 0, 'まっさら');
});

test('reset --hard は追跡外のファイルを消さない', () => {
  const repo = fresh();
  run(repo, `
    echo "a" > a.txt
    git add a.txt
    git commit -m "c1"
    echo "scratch" > memo.txt
    echo "changed" > a.txt
    git reset --hard HEAD
  `);
  assert.equal(repo.workdir['a.txt'], 'a\n', '追跡ファイルは戻る');
  assert.equal(repo.workdir['memo.txt'], 'scratch\n', '未追跡ファイルは残る');
});

test('revert は歴史を消さずに打ち消しコミットを積む', () => {
  const repo = fresh();
  run(repo, `
    echo "v1" > a.txt
    git add a.txt
    git commit -m "c1"
    echo "v2" > a.txt
    git add a.txt
    git commit -m "c2"
    git revert HEAD
  `);
  assert.equal(repo.workdir['a.txt'], 'v1\n', '内容は c1 に戻る');
  const head = headCommit(repo);
  assert.match(readCommit(repo, head).message, /^Revert /);
  // c2 は歴史に残っている
  const messages = [];
  let sha = head;
  while (sha) {
    messages.push(readCommit(repo, sha).message);
    sha = readCommit(repo, sha).parents[0];
  }
  assert.ok(messages.includes('c2'), 'c2 のコミットは残っている');
});

// ------------------------------------------------------------------ ブランチ / マージ

test('switch -c はブランチを作って移り、作業ツリーは変えない', () => {
  const repo = fresh();
  run(repo, `
    echo "a" > a.txt
    git add a.txt
    git commit -m "c1"
    git switch -c feature
  `);
  assert.equal(currentBranch(repo), 'feature');
  assert.deepEqual(listBranches(repo), ['feature', 'main']);
  assert.equal(repo.refs['refs/heads/feature'], repo.refs['refs/heads/main']);
});

test('fast-forward マージはマージコミットを作らない', () => {
  const repo = fresh();
  run(repo, `
    echo "a" > a.txt
    git add a.txt
    git commit -m "c1"
    git switch -c feature
    echo "b" > b.txt
    git add b.txt
    git commit -m "c2"
    git switch main
    git merge feature
  `);
  const head = headCommit(repo);
  assert.equal(readCommit(repo, head).parents.length, 1, '親は1つ = FF');
  assert.equal(head, repo.refs['refs/heads/feature']);
  assert.equal(repo.workdir['b.txt'], 'b\n');
});

test('--no-ff なら早送りできる場合でもマージコミットを作る', () => {
  const repo = fresh();
  run(repo, `
    echo "a" > a.txt
    git add a.txt
    git commit -m "c1"
    git switch -c feature
    echo "b" > b.txt
    git add b.txt
    git commit -m "c2"
    git switch main
    git merge --no-ff feature
  `);
  assert.equal(readCommit(repo, headCommit(repo)).parents.length, 2);
});

test('別々のファイルを触った枝は 3-way マージで自動的に統合される', () => {
  const repo = fresh();
  run(repo, `
    echo "base" > shared.txt
    git add .
    git commit -m "c1"
    git switch -c feature
    echo "from-feature" > feature.txt
    git add .
    git commit -m "feature work"
    git switch main
    echo "from-main" > main.txt
    git add .
    git commit -m "main work"
    git merge feature
  `);
  const head = headCommit(repo);
  assert.equal(readCommit(repo, head).parents.length, 2, 'マージコミット');
  assert.equal(repo.workdir['feature.txt'], 'from-feature\n');
  assert.equal(repo.workdir['main.txt'], 'from-main\n');
  assert.equal(repo.workdir['shared.txt'], 'base\n');
});

test('同じ行を両側が変えるとコンフリクトし、解消して commit できる', () => {
  const repo = fresh();
  run(repo, `
    echo "hello" > greet.txt
    git add .
    git commit -m "c1"
    git switch -c feature
    echo "bonjour" > greet.txt
    git add .
    git commit -m "french"
    git switch main
    echo "konnichiwa" > greet.txt
    git add .
    git commit -m "japanese"
  `);

  const m = runLine(repo, 'git merge feature');
  assert.equal(m.ok, false, 'コンフリクトで失敗すること');
  assert.match(m.out, /CONFLICT/);
  assert.deepEqual(status(repo).conflicted, ['greet.txt']);
  assert.ok(hasConflictMarkers(repo.workdir['greet.txt']), 'マーカーが書き込まれている');
  assert.ok(repo.MERGE_HEAD, 'マージ中の状態が保持されている');

  // マーカーを残したまま add すると止められる
  const bad = runLine(repo, 'git add greet.txt');
  assert.equal(bad.ok, false);
  assert.match(bad.out, /コンフリクトマーカー/);

  // 解消してコミット
  run(repo, `
    echo "konnichiwa / bonjour" > greet.txt
    git add greet.txt
    git commit -m "resolve"
  `);
  assert.equal(status(repo).conflicted.length, 0);
  assert.equal(repo.MERGE_HEAD, null);
  assert.equal(readCommit(repo, headCommit(repo)).parents.length, 2, 'マージコミットになる');
  assert.equal(repo.workdir['greet.txt'], 'konnichiwa / bonjour\n');
});

test('merge --abort でマージ開始前に戻る', () => {
  const repo = fresh();
  run(repo, `
    echo "hello" > greet.txt
    git add .
    git commit -m "c1"
    git switch -c feature
    echo "bonjour" > greet.txt
    git add .
    git commit -m "french"
    git switch main
    echo "konnichiwa" > greet.txt
    git add .
    git commit -m "japanese"
  `);
  const before = headCommit(repo);
  runLine(repo, 'git merge feature');
  run(repo, 'git merge --abort');
  assert.equal(headCommit(repo), before);
  assert.equal(repo.workdir['greet.txt'], 'konnichiwa\n');
  assert.equal(status(repo).conflicted.length, 0);
});

test('未コミットの変更があるとブランチ切替を止める', () => {
  const repo = fresh();
  run(repo, `
    echo "a" > a.txt
    git add .
    git commit -m "c1"
    git switch -c feature
    echo "feature-version" > a.txt
    git add .
    git commit -m "c2"
    git switch main
    echo "dirty" > a.txt
  `);
  const r = runLine(repo, 'git switch feature');
  assert.equal(r.ok, false);
  assert.match(r.out, /would be overwritten/);
});

test('マージ済みでないブランチは -d で消せず、-D なら消せる', () => {
  const repo = fresh();
  run(repo, `
    echo "a" > a.txt
    git add .
    git commit -m "c1"
    git switch -c feature
    echo "b" > b.txt
    git add .
    git commit -m "c2"
    git switch main
  `);
  const soft = runLine(repo, 'git branch -d feature');
  assert.equal(soft.ok, false);
  assert.match(soft.out, /not fully merged/);

  const hard = runLine(repo, 'git branch -D feature');
  assert.equal(hard.ok, true);
  assert.deepEqual(listBranches(repo), ['main']);
});

test('今いるブランチは削除できない', () => {
  const repo = fresh();
  run(repo, 'echo "a" > a.txt\ngit add .\ngit commit -m "c1"');
  const r = runLine(repo, 'git branch -d main');
  assert.equal(r.ok, false);
});

// ------------------------------------------------------------------ rebase / cherry-pick

test('rebase はコミットを付け替え、sha を作り直す', () => {
  const repo = fresh();
  run(repo, `
    echo "base" > base.txt
    git add .
    git commit -m "c1"
    git switch -c feature
    echo "f1" > f1.txt
    git add .
    git commit -m "feature 1"
    echo "f2" > f2.txt
    git add .
    git commit -m "feature 2"
    git switch main
    echo "m1" > m1.txt
    git add .
    git commit -m "main 1"
    git switch feature
  `);
  const oldTip = headCommit(repo);
  const mainTip = repo.refs['refs/heads/main'];

  run(repo, 'git rebase main');
  const newTip = headCommit(repo);

  assert.notEqual(newTip, oldTip, 'sha が作り直されている');
  assert.equal(currentBranch(repo), 'feature');
  // main のコミットが feature の祖先になっている = 一直線
  const chain = [];
  let sha = newTip;
  while (sha) {
    chain.push(sha);
    const c = readCommit(repo, sha);
    assert.ok(c.parents.length <= 1, 'rebase 後はマージコミットが無い');
    sha = c.parents[0];
  }
  assert.ok(chain.includes(mainTip), 'main の先端が祖先に含まれる');
  // 全ファイルが揃っている
  for (const f of ['base.txt', 'm1.txt', 'f1.txt', 'f2.txt']) {
    assert.ok(f in repo.workdir, `${f} が作業ツリーにある`);
  }
});

test('rebase 中のコンフリクトは --continue で進み、--abort で戻せる', () => {
  const setup = () => {
    const repo = fresh();
    run(repo, `
      echo "v0" > shared.txt
      git add .
      git commit -m "c1"
      git switch -c feature
      echo "feature-edit" > shared.txt
      git add .
      git commit -m "feature edit"
      git switch main
      echo "main-edit" > shared.txt
      git add .
      git commit -m "main edit"
      git switch feature
    `);
    return repo;
  };

  const abort = setup();
  const before = headCommit(abort);
  const r = runLine(abort, 'git rebase main');
  assert.equal(r.ok, false, 'コンフリクトで止まる');
  assert.ok(abort.REBASE, 'rebase 進行中');
  run(abort, 'git rebase --abort');
  assert.equal(headCommit(abort), before, '元の位置に戻る');
  assert.equal(abort.REBASE, null);

  const cont = setup();
  runLine(cont, 'git rebase main');
  run(cont, `
    echo "merged-by-hand" > shared.txt
    git add shared.txt
    git rebase --continue
  `);
  assert.equal(cont.REBASE, null, 'rebase が完了している');
  assert.equal(cont.workdir['shared.txt'], 'merged-by-hand\n');
  assert.equal(currentBranch(cont), 'feature');
});

test('cherry-pick は1コミット分の変更だけを別 sha で持ってくる', () => {
  const repo = fresh();
  run(repo, `
    echo "base" > base.txt
    git add .
    git commit -m "c1"
    git switch -c feature
    echo "wanted" > wanted.txt
    git add .
    git commit -m "the good one"
    echo "unwanted" > unwanted.txt
    git add .
    git commit -m "not this one"
    git switch main
  `);
  const src = resolveRev(repo, 'feature~1');
  run(repo, `git cherry-pick ${src}`);
  assert.equal(repo.workdir['wanted.txt'], 'wanted\n');
  assert.ok(!('unwanted.txt' in repo.workdir), '狙っていないコミットは来ない');
  assert.notEqual(headCommit(repo), src, '別の sha になる');
  assert.equal(readCommit(repo, headCommit(repo)).message, 'the good one');
});

// ------------------------------------------------------------------ stash

test('stash で退避し、pop で戻せる', () => {
  const repo = fresh();
  run(repo, `
    echo "v1" > a.txt
    git add .
    git commit -m "c1"
    echo "work-in-progress" > a.txt
    git stash
  `);
  assert.equal(repo.workdir['a.txt'], 'v1\n', '退避後はコミット直後の状態');
  assert.equal(repo.stash.length, 1);

  run(repo, 'git stash pop');
  assert.equal(repo.workdir['a.txt'], 'work-in-progress\n');
  assert.equal(repo.stash.length, 0);
});

// ------------------------------------------------------------------ リモート

/** リモート用に、既に何コミットか入った別リポジトリを作る。 */
function makeRemote() {
  const remote = initRepo();
  run(remote, `
    echo "# team project" > README.md
    git add .
    git commit -m "initial commit"
  `);
  remote.defaultBranch = 'main';
  return remote;
}

test('clone するとリモートの内容と origin/* が手に入る', () => {
  const remote = makeRemote();
  const repo = createRepo();
  const r = runLine(repo, 'git clone https://example.com/team.git', {
    remoteFactory: () => remote,
  });
  assert.equal(r.ok, true, r.out);
  assert.equal(repo.workdir['README.md'], '# team project\n');
  assert.equal(currentBranch(repo), 'main');
  assert.ok(repo.refs['refs/remotes/origin/main'], 'origin/main が作られる');
  assert.equal(repo.remotes.origin.url, 'https://example.com/team.git');
});

test('push -u でリモートに送り、追跡先が設定される', () => {
  const remote = makeRemote();
  const repo = createRepo();
  runLine(repo, 'git clone https://example.com/team.git', { remoteFactory: () => remote });
  run(repo, `
    echo "my work" > mine.txt
    git add .
    git commit -m "add mine"
    git push -u origin main
  `);
  const localTip = repo.refs['refs/heads/main'];
  assert.equal(remote.refs['refs/heads/main'], localTip, 'リモートが進んでいる');
  assert.equal(repo.refs['refs/remotes/origin/main'], localTip, 'origin/main も進む');
  assert.equal(commitTree(remote, localTip)['mine.txt'] !== undefined, true, 'オブジェクトが渡っている');
});

test('リモートが先に進んでいると push は non-fast-forward で拒否される', () => {
  const remote = makeRemote();
  const repo = createRepo();
  runLine(repo, 'git clone https://example.com/team.git', { remoteFactory: () => remote });

  // 別の人がリモートを進める
  run(remote, `
    echo "teammate work" > theirs.txt
    git add .
    git commit -m "teammate commit"
  `);
  // 自分もローカルで進める
  run(repo, `
    echo "my work" > mine.txt
    git add .
    git commit -m "my commit"
  `);

  const push = runLine(repo, 'git push origin main');
  assert.equal(push.ok, false);
  assert.match(push.out, /non-fast-forward/);

  // pull してから push すれば通る
  run(repo, 'git pull');
  const push2 = runLine(repo, 'git push origin main');
  assert.equal(push2.ok, true, push2.out);
  assert.ok('theirs.txt' in repo.workdir, '相手の変更も取り込まれている');
});

test('fetch は origin/* だけ動かし、作業ツリーは変えない', () => {
  const remote = makeRemote();
  const repo = createRepo();
  runLine(repo, 'git clone https://example.com/team.git', { remoteFactory: () => remote });
  run(remote, `
    echo "new" > new.txt
    git add .
    git commit -m "remote commit"
  `);

  const localBefore = repo.refs['refs/heads/main'];
  run(repo, 'git fetch');
  assert.equal(repo.refs['refs/heads/main'], localBefore, 'ローカルブランチは動かない');
  assert.notEqual(repo.refs['refs/remotes/origin/main'], localBefore, 'origin/main は進む');
  assert.ok(!('new.txt' in repo.workdir), '作業ツリーは変わらない');

  run(repo, 'git merge origin/main');
  assert.equal(repo.workdir['new.txt'], 'new\n');
});

test('pull --rebase は歴史を一直線に保つ', () => {
  const remote = makeRemote();
  const repo = createRepo();
  runLine(repo, 'git clone https://example.com/team.git', { remoteFactory: () => remote });
  run(remote, `
    echo "theirs" > theirs.txt
    git add .
    git commit -m "teammate"
  `);
  run(repo, `
    echo "mine" > mine.txt
    git add .
    git commit -m "mine"
    git pull --rebase
  `);
  const head = headCommit(repo);
  assert.equal(readCommit(repo, head).parents.length, 1, 'マージコミットができていない');
  assert.ok('theirs.txt' in repo.workdir);
  assert.ok('mine.txt' in repo.workdir);
});

// ------------------------------------------------------------------ diff / merge テキスト

test('mergeText: 片側だけの変更は自動採用', () => {
  const base = 'a\nb\nc\n';
  assert.equal(mergeText(base, 'a\nB\nc\n', base).text, 'a\nB\nc\n');
  assert.equal(mergeText(base, base, 'a\nb\nC\n').text, 'a\nb\nC\n');
});

test('mergeText: 別々の行への変更は両方入る', () => {
  const r = mergeText('a\nb\nc\n', 'A\nb\nc\n', 'a\nb\nC\n');
  assert.equal(r.clean, true);
  assert.equal(r.text, 'A\nb\nC\n');
});

test('mergeText: 同じ行への別の変更はマーカーを残す', () => {
  const r = mergeText('a\nb\nc\n', 'a\nOURS\nc\n', 'a\nTHEIRS\nc\n');
  assert.equal(r.clean, false);
  assert.ok(hasConflictMarkers(r.text));
  assert.match(r.text, /<<<<<<< HEAD\nOURS\n=======\nTHEIRS\n>>>>>>>/);
});

test('diffLines: 追加・削除・維持を区別する', () => {
  const d = diffLines('a\nb\n', 'a\nc\n');
  assert.deepEqual(d.filter((x) => x.type === 'same').map((x) => x.line), ['a']);
  assert.ok(d.some((x) => x.type === 'del' && x.line === 'b'));
  assert.ok(d.some((x) => x.type === 'add' && x.line === 'c'));
});

// ------------------------------------------------------------------ グラフ

test('layoutGraph: 枝分かれが別レーンに割り当てられる', () => {
  const repo = fresh();
  run(repo, `
    echo "a" > a.txt
    git add .
    git commit -m "c1"
    git switch -c feature
    echo "f" > f.txt
    git add .
    git commit -m "f1"
    git switch main
    echo "m" > m.txt
    git add .
    git commit -m "m1"
  `);
  const g = layoutGraph(repo);
  assert.equal(g.nodes.length, 3);
  assert.ok(g.lanes >= 2, '2本以上のレーンに分かれる');
  // 分岐元 c1 に2本のエッジが集まる
  const c1 = resolveRev(repo, 'main~1');
  assert.equal(g.edges.filter((e) => e.to === c1).length, 2);
});

test('layoutGraph: マージコミットは2本の親エッジを持つ', () => {
  const repo = fresh();
  run(repo, `
    echo "a" > a.txt
    git add .
    git commit -m "c1"
    git switch -c feature
    echo "f" > f.txt
    git add .
    git commit -m "f1"
    git switch main
    echo "m" > m.txt
    git add .
    git commit -m "m1"
    git merge feature
  `);
  const g = layoutGraph(repo);
  const head = headCommit(repo);
  assert.equal(g.edges.filter((e) => e.from === head).length, 2);
  assert.ok(g.nodes.find((n) => n.sha === head).isMerge);
  assert.ok(g.nodes.find((n) => n.sha === head).labels.some((l) => l.includes('HEAD')));
});

test('mergeBase は共通の分岐点を返す', () => {
  const repo = fresh();
  run(repo, `
    echo "a" > a.txt
    git add .
    git commit -m "c1"
  `);
  const base = headCommit(repo);
  run(repo, `
    git switch -c feature
    echo "f" > f.txt
    git add .
    git commit -m "f1"
    git switch main
    echo "m" > m.txt
    git add .
    git commit -m "m1"
  `);
  assert.equal(
    mergeBase(repo, repo.refs['refs/heads/main'], repo.refs['refs/heads/feature']),
    base
  );
});

// ------------------------------------------------------------------ シェル

test('echo > は上書き、>> は追記', () => {
  const repo = fresh();
  run(repo, `
    echo "line1" > f.txt
    echo "line2" >> f.txt
  `);
  assert.equal(repo.workdir['f.txt'], 'line1\nline2\n');
  run(repo, 'echo "replaced" > f.txt');
  assert.equal(repo.workdir['f.txt'], 'replaced\n');
});

test('存在しないコマンドはヒント付きで返る', () => {
  const repo = fresh();
  const r = runLine(repo, 'gti status');
  assert.equal(r.ok, false);
  assert.match(r.out, /command not found/);
  assert.ok(r.hint);
});

test('git の未知のサブコマンドは候補を出す', () => {
  const repo = fresh();
  const r = runLine(repo, 'git comit -m "x"');
  assert.equal(r.ok, false);
  assert.match(r.hint, /commit/);
});

test('edit は編集対象を UI に伝える', () => {
  const repo = fresh();
  run(repo, 'echo "x" > a.txt');
  const r = runLine(repo, 'edit a.txt');
  assert.equal(r.editFile, 'a.txt');
});
