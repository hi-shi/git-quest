// node --test test/cwd.test.js
//
// 「今どこにいるか」の振る舞い。
// git の事故はコマンドそのものより **どこで打ったか** で起きるので、
// そこを再現できているかをここで固定する。

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { createRepo, status, headCommit, commitTree } from '../js/engine/repo.js';
import { runLine } from '../js/engine/shell.js';
import { displayPath, cwdRel, inRepo, listDir } from '../js/engine/paths.js';

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

// ------------------------------------------------------------------ 基本

test('起動時はプロジェクトフォルダの直下にいる', () => {
  const repo = createRepo();
  assert.equal(runLine(repo, 'pwd').out, '/home/you/my-project');
  assert.equal(displayPath(repo), '~/my-project');
  assert.equal(cwdRel(repo), '');
});

test('cd で移動でき、pwd に反映される', () => {
  const repo = fresh();
  run(repo, `
    mkdir src
    echo "code" > src/app.js
    cd src
  `);
  assert.equal(runLine(repo, 'pwd').out, '/home/you/my-project/src');
  assert.equal(cwdRel(repo), 'src');

  run(repo, 'cd ..');
  assert.equal(cwdRel(repo), '');
});

test('存在しないフォルダには cd できない', () => {
  const repo = fresh();
  const r = runLine(repo, 'cd nowhere');
  assert.equal(r.ok, false);
  assert.match(r.out, /そんなフォルダはありません/);
  assert.equal(cwdRel(repo), '', '失敗しても現在地は動かない');
});

test('ファイルには cd できない', () => {
  const repo = fresh();
  run(repo, 'echo "x" > a.txt');
  const r = runLine(repo, 'cd a.txt');
  assert.equal(r.ok, false);
  assert.match(r.out, /フォルダではありません/);
});

test('ls は今いるフォルダの中身だけを1階層分見せる', () => {
  const repo = fresh();
  run(repo, `
    echo "root" > README.md
    mkdir src
    echo "a" > src/a.js
    echo "b" > src/lib/b.js
  `);
  const atRoot = runLine(repo, 'ls').out;
  assert.match(atRoot, /README\.md/);
  assert.match(atRoot, /src\//);
  assert.ok(!atRoot.includes('a.js'), 'サブフォルダの中身までは出さない');

  run(repo, 'cd src');
  const inSrc = runLine(repo, 'ls').out;
  assert.match(inSrc, /a\.js/);
  assert.match(inSrc, /lib\//);
  assert.ok(!inSrc.includes('README'), '親のファイルは出さない');
});

// ------------------------------------------------------------------ 相対パス

test('ファイル操作は今いる場所からの相対で解決される', () => {
  const repo = fresh();
  run(repo, `
    mkdir src
    cd src
    echo "console.log(1)" > app.js
  `);
  assert.equal(repo.workdir['src/app.js'], 'console.log(1)\n', 'src の中に作られる');
  assert.ok(!('app.js' in repo.workdir), 'ルートには作られない');

  // 親のファイルには ../ で届く
  run(repo, 'echo "readme" > ../README.md');
  assert.equal(repo.workdir['README.md'], 'readme\n');

  assert.equal(runLine(repo, 'cat app.js').out, 'console.log(1)');
  assert.equal(runLine(repo, 'cat ../README.md').out, 'readme');
});

test('プロジェクトの外にはファイルを作れない', () => {
  const repo = fresh();
  const r = runLine(repo, 'echo "x" > ../../etc/passwd');
  assert.equal(r.ok, false);
  assert.match(r.out, /プロジェクトフォルダの外/);
});

// ------------------------------------------------------------------ 事故の再現

test('リポジトリの外に出ると git コマンドが失敗する', () => {
  const repo = fresh();
  run(repo, `
    echo "a" > a.txt
    git add .
    git commit -m "c1"
  `);
  assert.equal(inRepo(repo), true);

  const moved = run(repo, 'cd ..');
  assert.equal(cwdRel(repo), null, 'プロジェクトの外（ホーム）にいる');
  assert.equal(inRepo(repo), false);
  assert.match(moved.hint, /リポジトリの外/, '外に出たことを知らせる');

  const r = runLine(repo, 'git status');
  assert.equal(r.ok, false);
  assert.match(r.out, /not a git repository/);
  assert.match(r.out, /いる場所: ~/, 'どこにいるかを教える');
  assert.match(r.hint, /cd ~\/my-project/, '戻り方を教える');
});

test('サブディレクトリでの `git add .` はその下だけが対象になる', () => {
  const repo = fresh();
  run(repo, `
    echo "root file" > root.txt
    mkdir src
    echo "src file" > src/app.js
    mkdir docs
    echo "doc" > docs/guide.md
    cd src
    git add .
  `);
  const s = status(repo);
  const staged = s.staged.map((f) => f.path);
  assert.deepEqual(staged, ['src/app.js'], 'src の下だけがステージされる');
  assert.ok(s.untracked.includes('root.txt'), 'ルートのファイルは残る');
  assert.ok(s.untracked.includes('docs/guide.md'), '別フォルダも残る');
});

test('ルートに戻って `git add .` すれば全部入る', () => {
  const repo = fresh();
  run(repo, `
    echo "root file" > root.txt
    mkdir src
    echo "src file" > src/app.js
    cd src
    git add .
    cd ..
    git add .
  `);
  const staged = status(repo).staged.map((f) => f.path).sort();
  assert.deepEqual(staged, ['root.txt', 'src/app.js']);
});

test('サブディレクトリからでも -A ならリポジトリ全体が対象', () => {
  const repo = fresh();
  run(repo, `
    echo "root file" > root.txt
    mkdir src
    echo "src file" > src/app.js
    cd src
    git add -A
  `);
  const staged = status(repo).staged.map((f) => f.path).sort();
  assert.deepEqual(staged, ['root.txt', 'src/app.js'], '`.` と違って全体が入る');
});

test('git status はサブディレクトリにいることを教え、相対パスで表示する', () => {
  const repo = fresh();
  run(repo, `
    echo "root" > root.txt
    mkdir src
    echo "code" > src/app.js
    git add .
    git commit -m "c1"
    echo "changed" > src/app.js
    cd src
  `);
  const out = runLine(repo, 'git status').out;
  assert.match(out, /いま ~\/my-project\/src にいます/, '居場所を明示する');
  assert.match(out, /git add \./, '`.` の意味を注意している');
  assert.match(out, /\tmodified:   app\.js/, 'src/app.js ではなく app.js と出る');
});

test('サブディレクトリから見ると、上の階層の変更は ../ 付きで出る', () => {
  const repo = fresh();
  run(repo, `
    echo "root" > root.txt
    mkdir src
    echo "code" > src/app.js
    git add .
    git commit -m "c1"
    echo "changed" > root.txt
    cd src
  `);
  const out = runLine(repo, 'git status').out;
  assert.match(out, /\.\.\/root\.txt/, '上にあるものは ../ が付く');
});

test('既にリポジトリの中で git init すると止められる（入れ子リポジトリの防止）', () => {
  const repo = fresh();
  run(repo, `
    echo "a" > a.txt
    git add .
    git commit -m "c1"
    mkdir sub
    echo "b" > sub/b.txt
    cd sub
  `);
  const r = runLine(repo, 'git init');
  assert.equal(r.ok, false);
  assert.match(r.out, /既に .* のリポジトリの中です/);
  assert.match(r.out, /入れ子/);
  assert.equal(repo.gitRoot, '', 'リポジトリの位置は変わらない');
});

test('リポジトリの外では git init が通り、そこがルートになる', () => {
  const repo = createRepo();
  run(repo, `
    mkdir app
    cd app
    git init
  `);
  assert.equal(repo.gitRoot, 'app');
  assert.equal(inRepo(repo), true);

  // 親に戻るとリポジトリの外
  run(repo, 'cd ..');
  assert.equal(inRepo(repo), false);
  assert.equal(runLine(repo, 'git status').ok, false);
});

test('入れ子の外側にあるファイルは、内側のリポジトリの操作で消えない', () => {
  const repo = createRepo();
  run(repo, `
    echo "外のファイル" > outside.txt
    mkdir app
    cd app
    git init
    echo "中のファイル" > inside.txt
    git add .
    git commit -m "c1"
    echo "変更" > inside.txt
    git reset --hard HEAD
  `);
  assert.equal(repo.workdir['outside.txt'], '外のファイル\n', 'リポジトリ外は無傷');
  assert.equal(repo.workdir['app/inside.txt'], '中のファイル\n', '中身は巻き戻る');
});

// ------------------------------------------------------------------ その他

test('cd でリポジトリのルートに戻ると案内が消える', () => {
  const repo = fresh();
  run(repo, 'mkdir src');
  const into = run(repo, 'cd src');
  assert.match(into.hint, /リポジトリのルートは/, 'サブにいると注意が出る');
  const back = run(repo, 'cd ..');
  assert.equal(back.hint, undefined, 'ルートでは注意不要');
});

test('cd ~ でホームに戻れる', () => {
  const repo = fresh();
  run(repo, 'mkdir a/b');
  run(repo, 'cd a/b');
  assert.equal(cwdRel(repo), 'a/b');
  run(repo, 'cd ~');
  assert.equal(repo.cwd, '/home/you');
  run(repo, 'cd my-project');
  assert.equal(cwdRel(repo), '');
});

test('ホームにはプロジェクトフォルダだけが見える', () => {
  const repo = fresh();
  run(repo, 'cd ..');
  const { dirs, files } = listDir(repo, '/home/you');
  assert.deepEqual(dirs, ['my-project']);
  assert.deepEqual(files, []);
});

test('rm -r でフォルダごと消せる', () => {
  const repo = fresh();
  run(repo, `
    mkdir tmp
    echo "a" > tmp/a.txt
    echo "b" > tmp/b.txt
  `);
  const noFlag = runLine(repo, 'rm tmp');
  assert.equal(noFlag.ok, false);
  assert.match(noFlag.hint, /rm -r/);

  run(repo, 'rm -r tmp');
  assert.ok(!('tmp/a.txt' in repo.workdir));
  assert.ok(!('tmp/b.txt' in repo.workdir));
});

test('コミットしたファイルはサブディレクトリ込みで記録される', () => {
  const repo = fresh();
  run(repo, `
    mkdir src
    echo "code" > src/app.js
    echo "readme" > README.md
    git add .
    git commit -m "c1"
  `);
  const tree = commitTree(repo, headCommit(repo));
  assert.deepEqual(Object.keys(tree).sort(), ['README.md', 'src/app.js']);
});

test('cd してもブランチ操作は同じリポジトリに効く', () => {
  const repo = fresh();
  run(repo, `
    echo "a" > a.txt
    git add .
    git commit -m "c1"
    mkdir src
    cd src
    git switch -c feature
  `);
  assert.equal(repo.refs['refs/heads/feature'], repo.refs['refs/heads/main']);
  assert.equal(cwdRel(repo), 'src', 'ブランチを切り替えても場所は変わらない');
});
