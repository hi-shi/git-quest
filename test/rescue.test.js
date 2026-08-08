// node --test test/rescue.test.js
//
// 「やらかした後に取り戻せる」ことの検証。
// reflog / detached HEAD / rm --cached は、どれも事故ったときの命綱なので
// 期待どおり救えることをここで固定する。

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  createRepo,
  headCommit,
  readCommit,
  listBranches,
  status,
  resolveRev,
  currentBranch,
  commitTree,
} from '../js/engine/repo.js';
import { runLine } from '../js/engine/shell.js';

function run(repo, script, { allowFail = false } = {}) {
  let last;
  for (const line of script.trim().split('\n')) {
    const l = line.trim();
    if (!l || l.startsWith('#')) continue;
    last = runLine(repo, l);
    if (!last.ok && !allowFail) assert.fail(`失敗: ${l}\n${last.out}\n${last.hint || ''}`);
  }
  return last;
}

function fresh() {
  const repo = createRepo();
  run(repo, 'git init');
  return repo;
}

// ------------------------------------------------------------------ reflog

test('reflog は HEAD が動くたびに記録される', () => {
  const repo = fresh();
  run(repo, `
    echo "a" > a.txt
    git add .
    git commit -m "1つ目"
    echo "b" > b.txt
    git add .
    git commit -m "2つ目"
  `);
  const log = repo.reflog;
  assert.equal(log.length, 2, 'コミット2回分');
  assert.equal(log[0].message, '2つ目', '新しいものが先頭');
  assert.equal(log[1].message, '1つ目');
  assert.equal(log[0].action, 'commit');
});

test('HEAD が動かないコマンドは reflog を汚さない', () => {
  const repo = fresh();
  run(repo, `
    echo "a" > a.txt
    git add .
    git commit -m "1つ目"
  `);
  const before = repo.reflog.length;
  run(repo, `
    git status
    git log
    git branch feature
  `);
  assert.equal(repo.reflog.length, before, '記録が増えない');
});

test('HEAD@{n} でひとつ前の位置を指せる', () => {
  const repo = fresh();
  run(repo, `
    echo "v1" > a.txt
    git add .
    git commit -m "1つ目"
    echo "v2" > a.txt
    git add .
    git commit -m "2つ目"
  `);
  const first = resolveRev(repo, 'HEAD@{1}');
  assert.equal(readCommit(repo, first).message, '1つ目');
});

test('reset --hard で消したコミットを reflog から取り戻せる', () => {
  const repo = fresh();
  run(repo, `
    echo "v1" > a.txt
    git add .
    git commit -m "土台"
    echo "大事な作業" > work.txt
    git add .
    git commit -m "大事な作業"
  `);
  const lost = headCommit(repo);

  run(repo, 'git reset --hard HEAD~1');
  assert.ok(!('work.txt' in repo.workdir), 'いったん消える');
  assert.notEqual(headCommit(repo), lost);

  // reflog には残っている
  const out = runLine(repo, 'git reflog').out;
  assert.match(out, /大事な作業/);

  run(repo, `git reset --hard ${lost}`);
  assert.equal(repo.workdir['work.txt'], '大事な作業\n', '取り戻せた');
});

test('branch -D で消したブランチのコミットを reflog から救える', () => {
  const repo = fresh();
  run(repo, `
    echo "base" > a.txt
    git add .
    git commit -m "土台"
    git switch -c feature
    echo "機能" > feature.txt
    git add .
    git commit -m "新機能"
    git switch main
    git branch -D feature
  `);
  assert.deepEqual(listBranches(repo), ['main'], 'ブランチは消えた');
  assert.ok(!('feature.txt' in repo.workdir), 'ファイルも見えない');

  const out = runLine(repo, 'git reflog').out;
  assert.match(out, /新機能/, 'reflog には残っている');

  run(repo, 'git switch -c rescue HEAD@{1}');
  assert.equal(repo.workdir['feature.txt'], '機能\n', 'ファイルが戻った');
  assert.equal(currentBranch(repo), 'rescue');
  assert.equal(readCommit(repo, headCommit(repo)).message, '新機能');
});

test('reflog はリポジトリが無いと使えない', () => {
  const repo = createRepo();
  const r = runLine(repo, 'git reflog');
  assert.equal(r.ok, false);
  assert.match(r.out, /not a git repository/);
});

// ------------------------------------------------------------------ switch -c の開始位置

test('switch -c に開始位置を渡すと、その内容が作業ツリーに展開される', () => {
  const repo = fresh();
  run(repo, `
    echo "v1" > a.txt
    git add .
    git commit -m "1つ目"
    echo "v2" > a.txt
    echo "追加" > b.txt
    git add .
    git commit -m "2つ目"
    git switch -c old HEAD~1
  `);
  assert.equal(repo.workdir['a.txt'], 'v1\n', '開始位置の内容になる');
  assert.ok(!('b.txt' in repo.workdir), '後で足したファイルは無い');
});

test('開始位置を渡さない switch -c は作業ツリーを触らない', () => {
  const repo = fresh();
  run(repo, `
    echo "v1" > a.txt
    git add .
    git commit -m "1つ目"
    echo "作業中" > wip.txt
    git switch -c feature
  `);
  assert.equal(repo.workdir['wip.txt'], '作業中\n', '未コミットの作業は保たれる');
});

test('未コミットの変更があるときは、開始位置つき switch -c を止める', () => {
  const repo = fresh();
  run(repo, `
    echo "v1" > a.txt
    git add .
    git commit -m "1つ目"
    echo "v2" > a.txt
    git add .
    git commit -m "2つ目"
    echo "編集中" > a.txt
  `);
  const r = runLine(repo, 'git switch -c old HEAD~1');
  assert.equal(r.ok, false);
  assert.match(r.out, /would be overwritten/);
  assert.equal(repo.workdir['a.txt'], '編集中\n', '編集は失われない');
});

test('存在しない開始位置はエラーになる', () => {
  const repo = fresh();
  run(repo, 'echo "a" > a.txt\ngit add .\ngit commit -m "c1"');
  const r = runLine(repo, 'git switch -c foo nonexistent');
  assert.equal(r.ok, false);
  assert.match(r.out, /invalid reference/);
  assert.ok(!listBranches(repo).includes('foo'), 'ブランチは作られない');
});

// ------------------------------------------------------------------ detached HEAD

test('sha を直接 checkout すると分離 HEAD になる', () => {
  const repo = fresh();
  run(repo, `
    echo "v1" > a.txt
    git add .
    git commit -m "1つ目"
    echo "v2" > a.txt
    git add .
    git commit -m "2つ目"
  `);
  const first = resolveRev(repo, 'HEAD~1');
  const r = runLine(repo, `git checkout ${first}`);
  assert.equal(r.ok, true, r.out);
  assert.equal(repo.HEAD.type, 'detached');
  assert.equal(currentBranch(repo), null, 'ブランチには乗っていない');
  assert.equal(repo.workdir['a.txt'], 'v1\n');
  assert.match(r.hint, /HEAD がブランチから外れて/);
});

test('分離 HEAD でコミットすると、どのブランチからも辿れなくなる', () => {
  const repo = fresh();
  run(repo, `
    echo "v1" > a.txt
    git add .
    git commit -m "1つ目"
    echo "v2" > a.txt
    git add .
    git commit -m "2つ目"
  `);
  const mainTip = headCommit(repo);
  run(repo, `
    git checkout ${resolveRev(repo, 'HEAD~1')}
    echo "迷子の作業" > lost.txt
    git add .
    git commit -m "分離HEADでの作業"
  `);
  const orphan = headCommit(repo);
  assert.notEqual(orphan, mainTip);
  assert.equal(repo.refs['refs/heads/main'], mainTip, 'main は動いていない');

  // どのブランチからも辿れない
  const reachable = new Set();
  for (const [ref, sha] of Object.entries(repo.refs)) {
    if (!ref.startsWith('refs/heads/')) continue;
    let cur = sha;
    while (cur) {
      reachable.add(cur);
      cur = (readCommit(repo, cur) || {}).parents?.[0];
    }
  }
  assert.ok(!reachable.has(orphan), 'ブランチからは辿れない＝迷子');

  // switch -c で救える
  run(repo, 'git switch -c saved');
  assert.equal(repo.refs['refs/heads/saved'], orphan, 'ブランチが付いて救出できた');
  assert.equal(repo.HEAD.type, 'branch');
  assert.equal(repo.workdir['lost.txt'], '迷子の作業\n');
});

test('分離 HEAD から救わずにブランチへ戻ると、コミットは reflog にだけ残る', () => {
  const repo = fresh();
  run(repo, `
    echo "v1" > a.txt
    git add .
    git commit -m "1つ目"
    echo "v2" > a.txt
    git add .
    git commit -m "2つ目"
  `);
  run(repo, `git checkout ${resolveRev(repo, 'HEAD~1')}`);
  run(repo, `
    echo "迷子" > lost.txt
    git add .
    git commit -m "迷子のコミット"
  `);
  const orphan = headCommit(repo);
  run(repo, 'git switch main');
  assert.ok(!('lost.txt' in repo.workdir), '見えなくなる');

  const out = runLine(repo, 'git reflog').out;
  assert.match(out, /迷子のコミット/, 'reflog からは辿れる');
  assert.ok(out.includes(orphan), 'sha も出ている');
});

// ------------------------------------------------------------------ rm --cached

test('rm --cached は追跡だけやめ、ファイルは残す', () => {
  const repo = fresh();
  run(repo, `
    echo "secret=xxx" > .env
    echo "code" > app.js
    git add .
    git commit -m "うっかり .env も入れた"
  `);
  assert.ok('.env' in commitTree(repo, headCommit(repo)), 'コミットに入っている');

  run(repo, 'git rm --cached .env');
  assert.equal(repo.workdir['.env'], 'secret=xxx\n', 'ファイルは残る');
  assert.ok(!('.env' in repo.index), 'index からは外れた');
  assert.ok(
    status(repo).staged.some((f) => f.path === '.env' && f.kind === 'deleted'),
    '削除としてステージされる'
  );
});

test('.gitignore は既にコミット済みのファイルには効かない（rm --cached で外して初めて効く）', () => {
  const repo = fresh();
  run(repo, `
    echo "secret=xxx" > .env
    git add .
    git commit -m "初回"
  `);
  // 後から .gitignore を足しても、追跡済みなので変更が出てしまう
  run(repo, `
    echo ".env" > .gitignore
    echo "secret=yyy" > .env
  `);
  assert.ok(
    status(repo).unstaged.some((f) => f.path === '.env'),
    '.gitignore を書いても追跡済みなら変更が出る'
  );

  run(repo, `
    git rm --cached .env
    git add .gitignore
    git commit -m ".env の追跡をやめる"
  `);
  const s = status(repo);
  assert.ok(!s.unstaged.some((f) => f.path === '.env'), 'もう変更として出ない');
  assert.ok(!s.untracked.includes('.env'), '無視されている');
  assert.equal(repo.workdir['.env'], 'secret=yyy\n', 'ファイル自体は手元に残る');
  assert.ok(!('.env' in commitTree(repo, headCommit(repo))), '新しいコミットには入っていない');
});

test('rm（--cached なし）はファイルごと消す', () => {
  const repo = fresh();
  run(repo, `
    echo "a" > a.txt
    git add .
    git commit -m "c1"
    git rm a.txt
  `);
  assert.ok(!('a.txt' in repo.workdir), 'ファイルが消える');
  assert.ok(!('a.txt' in repo.index));
});

test('rm はリポジトリの外では使えない', () => {
  const repo = fresh();
  run(repo, 'echo "a" > a.txt\ngit add .\ngit commit -m "c1"');
  run(repo, 'cd ..');
  const r = runLine(repo, 'git rm --cached a.txt');
  assert.equal(r.ok, false);
  assert.match(r.out, /not a git repository/);
});
