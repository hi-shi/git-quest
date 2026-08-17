// 全ステージの定義。
//
// 1ステージ = {id, title, intro, setup(repo), goals[], hints[], teach[], wantedCommands[]}
//   setup       : 開始状態を作る。runLine を使ってコマンドで組み立てる
//   goals[].check(repo, ctx) : 達成判定。ctx.history に実行したコマンド行が入る
//   wantedCommands : 想定した解法。通らなくてもクリアはできる（別解の提示に使う）

import { createRepo, initRepo, headCommit, currentBranch, readCommit, status, resolveRev, isAncestor, commitTree, readBlob, listBranches, ancestors, isIgnored } from '../engine/repo.js';
import { runLine } from '../engine/shell.js';
import { cwdRel, inRepo } from '../engine/paths.js';

/**
 * setup 用: コマンド列を流す。想定外の失敗は気づけるように投げる。
 * 行頭 `!` は「失敗するのが正しい」行（衝突させたい merge など）。
 * ctx を渡すと clone の相手役（ctx.remote）が使える。
 */
function seed(repo, script, ctx) {
  for (const raw of script.trim().split('\n')) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const expectFail = line.startsWith('!');
    const l = expectFail ? line.slice(1).trim() : line;
    const r = runLine(repo, l, { remoteFactory: () => (ctx ? ctx.remote : null) });
    if (!r.ok && !expectFail) throw new Error(`[stage setup] 失敗: ${l}\n${r.out}`);
    if (r.ok && expectFail) throw new Error(`[stage setup] 失敗するはずが成功: ${l}`);
  }
}

// --------------------------------------------------------- 判定に使う小道具

const usedCommand = (ctx, re) => ctx.history.some((h) => re.test(h));
const fileHas = (repo, path, text) => (repo.workdir[path] || '').includes(text);
const committed = (repo, path) => path in commitTree(repo, headCommit(repo));
const commitCount = (repo) => (headCommit(repo) ? ancestors(repo, headCommit(repo)).size : 0);
const msgOf = (repo, rev = 'HEAD') => {
  const sha = resolveRev(repo, rev);
  const c = sha && readCommit(repo, sha);
  return c ? c.message : '';
};
const clean = (repo) => {
  const s = status(repo);
  return !s.staged.length && !s.unstaged.length && !s.conflicted.length;
};

// =================================================================== 第1章

const ch1 = {
  id: 'ch1',
  title: '第1章 はじめの一歩',
  subtitle: 'git init / add / commit / status / log',
  blurb: 'git がやっていることは「今のフォルダの写真を撮って並べる」だけ。まずはその1枚目を撮ります。',
  stages: [
    {
      id: 'ch1-1',
      title: '記録をはじめる',
      intro:
        'あなたは新しいプロジェクトのフォルダにいます。まだ git は何も知りません。\nこのフォルダを git の管理下に置いて、最初のファイルを1つ作りましょう。',
      setup(repo) {
        // まっさらな状態から
      },
      goals: [
        { text: 'git のリポジトリを作る（.git ができる）', check: (r) => r.initialized },
        {
          text: 'hello.txt というファイルを作る',
          check: (r) => 'hello.txt' in r.workdir,
        },
      ],
      hints: [
        '`git init` でこのフォルダが git の管理下に入ります。',
        'ファイルを作るには `echo "こんにちは" > hello.txt`。`touch hello.txt` でも空ファイルが作れます。',
        '`ls` で今あるファイル、`git status` で git から見た状態が確認できます。',
      ],
      teach: [
        '`git init` は `.git` という隠しフォルダを作るだけのコマンドです。ここに履歴が全部入ります。',
        'ファイルを作っただけでは git は何も記録しません。git から見ると「まだ知らないファイル（untracked）」の状態です。',
      ],
      wantedCommands: [/^git init/, /^(echo|touch)/],
    },
    {
      id: 'ch1-2',
      title: 'ステージという中継地点',
      intro:
        'ファイルはできましたが、まだ記録されていません。\ngit は「記録したいものを一度ステージ（index）に載せてから、まとめてコミットする」という2段構えです。\nhello.txt をステージに載せてみましょう。',
      setup(repo) {
        seed(repo, `
          git init
          echo "こんにちは" > hello.txt
        `);
      },
      goals: [
        {
          text: 'hello.txt をステージに載せる',
          check: (r) => status(r).staged.some((f) => f.path === 'hello.txt'),
        },
        {
          text: 'git status でステージ済みになったことを確認する',
          check: (r, ctx) => usedCommand(ctx, /^git status/),
        },
      ],
      hints: [
        '`git add hello.txt` でステージに載ります。',
        '`git add .` なら「今あるもの全部」をまとめて載せられます。',
        '載ったあとに `git status` を打つと、緑色の "Changes to be committed" に出てきます。',
      ],
      teach: [
        'ステージ（index）は「次の写真に写すものを並べる台」です。',
        'いきなりコミットせずステージを挟むおかげで、変更の一部だけをコミットする、といったことができます。',
      ],
      wantedCommands: [/^git add/, /^git status/],
    },
    {
      id: 'ch1-3',
      title: '最初のコミット',
      intro:
        'ステージに載ったものを、1つの記録として確定させます。これがコミットです。\nメッセージは「何をしたか」が後から分かるように書きます。',
      setup(repo) {
        seed(repo, `
          git init
          echo "こんにちは" > hello.txt
          git add hello.txt
        `);
      },
      goals: [
        {
          text: 'メッセージ付きでコミットする',
          check: (r) => commitCount(r) >= 1 && msgOf(r).length > 0,
        },
        {
          text: 'hello.txt がコミットに含まれている',
          check: (r) => committed(r, 'hello.txt'),
        },
        {
          text: '作業ツリーがきれいになった（コミットし残しが無い）',
          check: (r) => clean(r),
        },
      ],
      hints: [
        '`git commit -m "最初のコミット"` の形で打ちます。',
        'メッセージは日本語でも大丈夫です。ダブルクォートで囲むのを忘れずに。',
        'コミット後に `git status` を打つと "nothing to commit, working tree clean" になります。',
      ],
      teach: [
        'コミットは「その瞬間のフォルダ全体のスナップショット」＋「1つ前へのリンク」です。',
        'メッセージは未来の自分へのメモ。「修正」だけだと後で困ります。「ログイン画面のtypoを修正」のように書きましょう。',
      ],
      wantedCommands: [/^git commit/],
    },
    {
      id: 'ch1-4',
      title: '履歴を読む',
      intro:
        '既に3つのコミットがあります。履歴を眺めて、さらに1つ自分のコミットを積んでみましょう。',
      setup(repo) {
        seed(repo, `
          git init
          echo "# レシピ帳" > README.md
          git add .
          git commit -m "プロジェクト開始"
          echo "カレー: 玉ねぎ、にんじん、じゃがいも" > recipes.txt
          git add .
          git commit -m "カレーのレシピを追加"
          echo "カレー: 玉ねぎ、にんじん、じゃがいも" > recipes.txt
          echo "肉じゃが: じゃがいも、牛肉、しらたき" >> recipes.txt
          git add .
          git commit -m "肉じゃがのレシピを追加"
        `);
      },
      goals: [
        {
          text: 'git log で履歴を表示する',
          check: (r, ctx) => usedCommand(ctx, /^git log/),
        },
        {
          text: 'recipes.txt に新しいレシピを1行追記する',
          check: (r) => (r.workdir['recipes.txt'] || '').trim().split('\n').length >= 3,
        },
        {
          text: '追記をコミットして、履歴が4つになる',
          check: (r) => commitCount(r) >= 4 && clean(r),
        },
      ],
      hints: [
        '`git log` で履歴が見られます。`git log --oneline` なら1行ずつのコンパクト表示。',
        '追記は `>>` を使います: `echo "味噌汁: だし、味噌、豆腐" >> recipes.txt`（`>` だと上書きになるので注意）',
        '追記したら `git add recipes.txt` → `git commit -m "味噌汁のレシピを追加"`。',
      ],
      teach: [
        'コミットは数珠つなぎです。各コミットが「1つ前」を指していて、それを辿ったものが履歴になります。',
        '`git log --oneline --graph --all` は普段使いの決まり文句。状態画面（⊞）のグラフでも同じものが見られます。',
      ],
      wantedCommands: [/^git log/, /^git add/, /^git commit/],
    },
  ],
};


// =================================================================== 現在地の章

const chCwd = {
  id: 'chcwd',
  title: '第2章 いま どこにいるか',
  subtitle: 'pwd / cd / ls — リポジトリのルートとサブディレクトリ',
  blurb:
    'git は「今いる場所」で結果が変わります。事故の多くはコマンドを間違えたのではなく、打った場所を間違えたことで起きます。',
  stages: [
    {
      id: 'cwd-1',
      title: '現在地を確かめる',
      intro:
        'このプロジェクトには src と docs というフォルダがあります。\n中に入って、また戻ってきてください。画面下の「📁」の表示が変わるのを見てみましょう。',
      setup(repo) {
        seed(repo, `
          git init
          echo "# メモ帳アプリ" > README.md
          mkdir src
          echo "console.log('hi')" > src/app.js
          mkdir docs
          echo "使い方" > docs/guide.md
          git add .
          git commit -m "最初のコミット"
        `);
      },
      goals: [
        { text: 'pwd で今いる場所を確かめる', check: (r, ctx) => usedCommand(ctx, /^pwd/) },
        { text: 'src フォルダの中に入る', check: (r, ctx) => ctx.visited && ctx.visited.includes('src') },
        {
          text: 'src の中で ls を実行して、中身が違うことを確かめる',
          check: (r, ctx) => (ctx.lsIn || []).includes('src'),
        },
        { text: 'リポジトリのルートに戻る', check: (r) => cwdRel(r) === '' && (r.cwdHistory || []).length > 1 },
      ],
      hints: [
        '`pwd` は「今いる場所」を絶対パスで表示します。',
        '`cd src` で中に入れます。入ったら `ls` を打つと、ルートとは違うものが並びます。',
        '`cd ..` で1つ上に戻れます。`..` は「親フォルダ」という意味です。',
      ],
      teach: [
        '`pwd` = print working directory。「今どこにいるか」を出すコマンドです。',
        '`cd` で移動すると、それ以降のコマンドはすべてその場所を基準に動きます。',
        '画面下の 📁 が現在地です。「リポジトリのルート」か「ルートの下」かが常に出ているので、コマンドを打つ前に見る癖をつけてください。',
      ],
      wantedCommands: [/^pwd/, /^cd src/, /^ls/, /^cd \.\./],
    },
    {
      id: 'cwd-2',
      title: 'リポジトリの外では git は使えない',
      intro:
        'git が使えるのは「.git のあるフォルダとその下」だけです。\n一歩外に出ると何もできません。実際に出て、確かめてから戻ってきてください。',
      setup(repo) {
        seed(repo, `
          git init
          echo "# 家計簿" > README.md
          git add .
          git commit -m "最初のコミット"
        `);
      },
      goals: [
        {
          text: 'リポジトリの外（ホーム）に出る',
          check: (r, ctx) => ctx.wasOutsideRepo === true,
        },
        {
          text: '外で git status を打って、失敗することを確かめる',
          check: (r, ctx) => ctx.gitFailedOutside === true,
        },
        {
          text: 'リポジトリに戻って git status が通ることを確かめる',
          check: (r, ctx) => inRepo(r) && ctx.gitOkAfterReturn === true,
        },
      ],
      hints: [
        '`cd ..` でプロジェクトフォルダの外（ホーム）に出られます。',
        'そこで `git status` を打つと `not a git repository` になります。エラーに「いる場所」も出ます。',
        '`cd my-project` で戻れます。戻ってからもう一度 `git status` を打ってみてください。',
      ],
      teach: [
        'git は今いる場所から**上に向かって** `.git` を探します。見つからなければ「リポジトリではない」と言います。',
        '`not a git repository` が出たら、コマンドの綴りではなく **今どこにいるか** をまず疑ってください。`pwd` の出番です。',
        '逆に言えば、リポジトリの中ならどのサブフォルダからでも git は使えます。',
      ],
      wantedCommands: [/^cd/, /^git status/],
    },
    {
      id: 'cwd-3',
      title: '`git add .` の「.」はどこ？',
      intro:
        'ここが一番の事故ポイントです。\nsrc の中で `git add .` を打つと、何が入って何が入らないでしょうか。まず試してから、全部入れてください。',
      setup(repo) {
        seed(repo, `
          git init
          echo "# ブログ" > README.md
          git add .
          git commit -m "最初のコミット"
          echo "設定を追加" > config.json
          mkdir src
          echo "本体" > src/main.js
          echo "部品" > src/parts.js
          cd src
        `);
      },
      goals: [
        {
          text: 'src の中で git add . を実行する',
          check: (r, ctx) => ctx.addedFromSub === true,
        },
        {
          text: 'git status で config.json が入っていないことに気づく',
          check: (r, ctx) => usedCommand(ctx, /^git status/),
        },
        {
          text: 'config.json も含めて、全部をステージに載せる',
          check: (r) => {
            const staged = status(r).staged.map((f) => f.path);
            return (
              staged.includes('config.json') &&
              staged.includes('src/main.js') &&
              staged.includes('src/parts.js')
            );
          },
        },
      ],
      hints: [
        'まず `git add .` を打ってから `git status` を見てください。src の中のものだけが入っています。',
        '`.` は「今いるフォルダ」という意味です。src にいるなら src の下だけが対象になります。',
        'ルートに戻って（`cd ..`）から `git add .` を打つか、その場から `git add -A` を打てば全部入ります。',
      ],
      teach: [
        '`git add .` の `.` は **今いるフォルダ**。サブディレクトリで打つと、その下しか入りません。',
        '`git add -A` はどこで打っても**リポジトリ全体**が対象です。ここが `.` との決定的な違いです。',
        '「add したのにコミットに入っていない」の多くはこれが原因です。**commit の前に必ず `git status`** を見る習慣をつけてください。',
      ],
      wantedCommands: [/^git add/, /^git status/],
    },
    {
      id: 'cwd-4',
      title: 'うっかり git init',
      intro:
        'サブディレクトリで `git init` を打ってしまうと、リポジトリの中にリポジトリができます。\n外側の git からは中身が見えなくなり、とても分かりにくい事故になります。試してみてください。',
      setup(repo) {
        seed(repo, `
          git init
          echo "# 会社サイト" > README.md
          git add .
          git commit -m "最初のコミット"
          mkdir themes
          echo "テーマ" > themes/dark.css
          cd themes
        `);
      },
      goals: [
        {
          text: 'themes の中で git init を試して、止められることを確かめる',
          check: (r, ctx) => ctx.blockedInit === true,
        },
        {
          text: 'リポジトリのルートがどこかを確かめる',
          check: (r, ctx) => usedCommand(ctx, /^(pwd|git status)/),
        },
        {
          text: 'ルートに戻って themes をコミットする',
          check: (r) => {
            const tree = commitTree(r, headCommit(r));
            return 'themes/dark.css' in tree;
          },
        },
      ],
      hints: [
        'まず `git init` を打ってみてください。このアプリは止めてくれます（本物の git は止めてくれません）。',
        '`pwd` で今いる場所、`git status` でリポジトリのルートが分かります。',
        '`cd ..` でルートに戻り、`git add .` → `git commit -m "テーマを追加"`。',
      ],
      teach: [
        '**本物の git は入れ子リポジトリを黙って作ります。** これが厄介なところです。',
        '入れ子ができると、外側から見て中身が丸ごと1つの塊のように扱われ、変更が追えなくなります。',
        '`git init` を打つ前には必ず `pwd` を。「新しいプロジェクトを始めるとき以外は init しない」と覚えておくと安全です。',
      ],
      wantedCommands: [/^git init/, /^cd \.\./, /^git commit/],
    },
  ],
};

// =================================================================== 第2章

const ch2 = {
  id: 'ch2',
  title: '第3章 やり直しの術',
  subtitle: 'diff / restore / reset / --amend / .gitignore',
  blurb: 'git を怖がる一番の理由は「間違えたときに戻せるか分からない」こと。ここで戻し方を全部覚えます。',
  stages: [
    {
      id: 'ch2-0',
      title: 'diff の読み方',
      intro:
        'diff は暗号みたいに見えますが、覚えるのは「行の1文字目」だけです。\n' +
        'まず `git diff` を打って、出てきたものを下の対応表と見比べてください。\n' +
        '\n' +
        '【見出し（ファイルの話）】\n' +
        '・`diff --git a/config.txt b/config.txt` … ここから下は config.txt の差分\n' +
        '・`--- a/config.txt` … a は「変更前」。マイナス3つが目印\n' +
        '・`+++ b/config.txt` … b は「変更後」。プラス3つが目印\n' +
        '・`@@ -1,3 +1,2 @@` … 変更前の1行目から3行分が、変更後は1行目から2行分になった\n' +
        '\n' +
        '【本文（行の話）】\n' +
        '・`-` で始まる行 … 変更前にあって、今は無い行\n' +
        '・`+` で始まる行 … 新しく増えた行\n' +
        '・空白で始まる行 … 変わっていない行（場所の目印として一緒に出る）\n' +
        '\n' +
        '今回、config.txt には直した覚えのない削除が混ざっています。diff から見つけて戻してください。',
      setup(repo) {
        seed(repo, `
          git init
          echo "host: localhost" > config.txt
          echo "debug: false" >> config.txt
          echo "port: 8080" >> config.txt
          echo "買うもの" > notes.txt
          echo "- ねぎ" >> notes.txt
          echo "- 豆腐" >> notes.txt
          git add .
          git commit -m "初版"
          echo "host: localhost" > config.txt
          echo "debug: true" >> config.txt
          echo "買うもの" > notes.txt
          echo "- ねぎ" >> notes.txt
          echo "- 豆腐" >> notes.txt
          echo "- 味噌" >> notes.txt
        `);
      },
      goals: [
        { text: 'git diff で差分を表示する', check: (r, ctx) => usedCommand(ctx, /^git diff/) },
        {
          text: '`-` の行を手がかりに、config.txt から消えた行を書き戻す',
          check: (r) => fileHas(r, 'config.txt', 'port: 8080'),
        },
        {
          text: '意図した変更（notes.txt）だけをステージに載せる',
          check: (r) => status(r).staged.some((f) => f.path === 'notes.txt'),
        },
      ],
      hints: [
        '`git diff` を打つと config.txt と notes.txt の2ファイル分が続けて出ます。`diff --git` の行が「ここから別のファイル」の合図です。',
        'config.txt は `-` が2行、`+` が1行。`debug: false` → `debug: true` は書き換えたつもりの変更なので、余っている `-port: 8080` が消えてしまった行です。',
        '書き戻すのは `echo "port: 8080" >> config.txt`。最後の行だったので `>>`（追記）で元どおりになります。',
        '最後に `git add notes.txt`。`git add .` にすると全部載ってしまうので、ファイル名を指定します。',
      ],
      teach: [
        '見るのは各行の1文字目だけ。`-` は「消えた」、`+` は「増えた」、空白は「そのまま」。',
        '`---` / `+++` は3つ重なっているのが目印で、行の増減ではなく「変更前 / 変更後のファイル名」の見出しです。a が古い方、b が新しい方。',
        '1行の書き換えは「`-` 古い行」と「`+` 新しい行」の2行に分かれて出ます。しかも同じかたまりの中では `-` が先にまとまり、`+` が後にまとまります。「1対1で並ぶ」とは限らないので、`-` と `+` の行数を数えて読みます。',
        '`@@ -1,3 +1,2 @@` は「変更前は1行目から3行、変更後は1行目から2行」。読み飛ばして構いませんが、長いファイルで場所を掴むのに使えます。',
        '本物の git では `--- a/…` の上に `index e4d8393..405eaba 100644` という行も出ます。中身の ID なので、読み飛ばして大丈夫です。',
      ],
      wantedCommands: [/^git diff/, /^git add /],
    },
    {
      id: 'ch2-1',
      title: '2つの diff',
      intro:
        'app.js を編集 → add → さらに編集、と進めたので、いま同じファイルの中身が3か所に別々に残っています。\n' +
        '\n' +
        '　直前のコミット … `const version = 1;`\n' +
        '　ステージ　　　 … `const version = 2;`\n' +
        '　作業ツリー　　 … `const version = 3;`\n' +
        '\n' +
        '2つの diff は、このうち隣り合う2か所を比べています。どちらがどこを見ているのか、両方打って確かめてください。',
      setup(repo) {
        seed(repo, `
          git init
          echo "const version = 1;" > app.js
          git add .
          git commit -m "初版"
          echo "const version = 2;" > app.js
          git add app.js
          echo "const version = 3;" > app.js
        `);
      },
      goals: [
        { text: 'git diff を実行する（作業ツリー ↔ ステージ）', check: (r, ctx) => usedCommand(ctx, /^git diff\s*$/) },
        {
          text: 'git diff --staged を実行する（ステージ ↔ 直前のコミット）',
          check: (r, ctx) => usedCommand(ctx, /^git diff (--staged|--cached)/),
        },
      ],
      hints: [
        'まず `git diff` だけを打ってみてください。手前の2か所（ステージ ↔ 作業ツリー）を比べるので、version 2 と 3 の差が出ます。',
        '次に `git diff --staged`。奥の2か所（コミット ↔ ステージ）なので、version 1 と 2 の差です。',
        '`git diff HEAD` も試してみてください。両区間をまとめた 1 → 3 の差が出ます。',
      ],
      teach: [
        '`git diff` = 作業ツリー ↔ ステージ。「まだ add していない変更」。',
        '`git diff --staged` = ステージ ↔ 直前のコミット。「add したけどまだ commit していない変更」。',
        '次に `git commit` で記録されるのは `--staged` の方だけ。`git diff` に出ている分は手元に残ります。',
        '状態画面（⊞）の3列表示が、まさにこの3つの場所です。app.js をタップすると2つの差分が並んで見られます。',
      ],
      wantedCommands: [/^git diff/],
    },
    {
      id: 'ch2-2',
      title: 'ステージから降ろす',
      intro:
        '間違えて secret.txt（パスワードのメモ）まで `git add .` してしまいました。\nコミットする前に、ステージから降ろしてください。ファイル自体は消さないように。',
      setup(repo) {
        seed(repo, `
          git init
          echo "# メモ帳" > README.md
          git add .
          git commit -m "初期化"
          echo "更新した内容" > README.md
          echo "password: hunter2" > secret.txt
          git add .
        `);
      },
      goals: [
        {
          text: 'secret.txt をステージから降ろす',
          check: (r) => !status(r).staged.some((f) => f.path === 'secret.txt'),
        },
        {
          text: 'secret.txt 自体は消さずに残す',
          check: (r) => 'secret.txt' in r.workdir,
        },
        {
          text: 'README.md の変更はステージに残したまま',
          check: (r) => status(r).staged.some((f) => f.path === 'README.md'),
        },
      ],
      hints: [
        '`git restore --staged secret.txt` でステージからだけ外れます。',
        '`--staged` を付け忘れると作業ツリーの方が巻き戻ってしまうので注意。',
        '（古い書き方だと `git reset HEAD secret.txt` でも同じことができます）',
      ],
      teach: [
        '`git restore --staged <file>` = ステージだけを直前のコミットの状態に戻す。ファイルの中身は無傷。',
        '`git restore <file>`（--staged なし）= 作業ツリーの編集を捨てる。こちらは戻せないので慎重に。',
      ],
      wantedCommands: [/^git restore --staged/],
    },
    {
      id: 'ch2-3',
      title: 'reset の3つの深さ',
      intro:
        '「まだコミットしたくなかった」というときの戻し方です。\n直前のコミットを取り消しつつ、変更内容はステージに残った状態にしてください。',
      setup(repo) {
        seed(repo, `
          git init
          echo "v1" > feature.js
          git add .
          git commit -m "土台"
          echo "v2 (まだ途中)" > feature.js
          git add .
          git commit -m "うっかりコミットしてしまった"
        `);
      },
      goals: [
        {
          text: 'コミットが1つに戻っている',
          check: (r) => commitCount(r) === 1,
        },
        {
          text: '変更内容はステージに残っている',
          check: (r) => status(r).staged.some((f) => f.path === 'feature.js'),
        },
        {
          text: 'ファイルの中身は v2 のまま',
          check: (r) => fileHas(r, 'feature.js', 'v2'),
        },
      ],
      hints: [
        '`git reset --soft HEAD~1` を使います。',
        'HEAD~1 は「HEAD の1つ前」という意味です。',
        '--soft は HEAD だけを動かします。ステージも作業ツリーもそのまま残ります。',
      ],
      teach: [
        '`--soft` … HEAD だけ戻す（ステージ・作業ツリーはそのまま）→ コミットし直したいとき',
        '`--mixed`（既定）… HEAD とステージを戻す（作業ツリーはそのまま）→ add からやり直したいとき',
        '`--hard` … 3つ全部戻す → 編集内容ごと捨てたいとき。**戻せません**',
      ],
      wantedCommands: [/^git reset --soft/],
    },
    {
      id: 'ch2-4',
      title: '--hard の破壊力',
      intro:
        '今度は逆に「この編集は全部なかったことにしたい」場合です。\n作業ツリーの変更を丸ごと捨てて、直前のコミットの状態に戻してください。\n※ memo.txt（まだ一度も add していないメモ）は消えないことも確認しましょう。',
      setup(repo) {
        seed(repo, `
          git init
          echo "きれいなコード" > app.js
          git add .
          git commit -m "動く状態"
          echo "壊れたコード" > app.js
          git add app.js
          echo "もっと壊れたコード" > app.js
          echo "個人メモ: あとで消す" > memo.txt
        `);
      },
      goals: [
        {
          text: 'app.js が「きれいなコード」に戻っている',
          check: (r) => fileHas(r, 'app.js', 'きれいなコード'),
        },
        {
          text: 'ステージも作業ツリーもきれいになっている',
          check: (r) => clean(r),
        },
        {
          text: 'memo.txt は消えずに残っている（未追跡ファイルは --hard でも消えない）',
          check: (r) => 'memo.txt' in r.workdir,
        },
      ],
      hints: [
        '`git reset --hard HEAD` です。HEAD = 今いるコミット。',
        '`git reset --hard` だけでも同じ意味になります。',
        '一度も add していないファイルは git の管理外なので、--hard でも触られません。',
      ],
      teach: [
        '`--hard` で消えるのは「git が知っているファイルの変更」だけ。未追跡ファイルは残ります。',
        '未追跡ファイルまで消したいときは `git clean -f`。こちらも戻せません。',
      ],
      wantedCommands: [/^git reset --hard/],
    },
    {
      id: 'ch2-5',
      title: 'コミットの書き直し',
      intro:
        'コミットメッセージを打ち間違えました。しかも1ファイル入れ忘れています。\n新しいコミットを積まずに、直前のコミットを作り直してください。',
      setup(repo) {
        seed(repo, `
          git init
          echo "土台" > base.js
          git add .
          git commit -m "土台"
          echo "ログイン処理" > login.js
          git add login.js
          git commit -m "ログイン機能を追加"
          echo "ログインのテスト" > login.test.js
        `);
      },
      goals: [
        {
          text: 'login.test.js が直前のコミットに含まれている',
          check: (r) => committed(r, 'login.test.js'),
        },
        {
          text: 'コミット数は2つのまま（新しいコミットを積んでいない）',
          check: (r) => commitCount(r) === 2,
        },
        {
          text: 'メッセージが「ログイン機能を追加」から変わっている',
          check: (r) => msgOf(r) !== 'ログイン機能を追加' && msgOf(r).length > 0,
        },
      ],
      hints: [
        'まず入れ忘れたファイルをステージに: `git add login.test.js`',
        '次に `git commit --amend -m "ログイン機能とテストを追加"`。',
        'amend は「直前のコミットを作り直す」コマンドです。',
      ],
      teach: [
        '`--amend` は直前のコミットを新しい sha で作り直します。歴史が書き換わります。',
        'だから **push 済みのコミットには使わない** のが原則。手元だけの直前コミットを整えるのに使います。',
      ],
      wantedCommands: [/^git commit --amend/],
    },
    {
      id: 'ch2-6',
      title: '記録しないものを決める',
      intro:
        'ビルド結果やパスワードファイルは、履歴に入れたくありません。\n.gitignore を作って、*.log と secrets.env を git から見えなくしてください。',
      setup(repo) {
        seed(repo, `
          git init
          echo "console.log('hi')" > app.js
          git add .
          git commit -m "アプリ本体"
          echo "2026-08-07 起動" > debug.log
          echo "API_KEY=xxxx" > secrets.env
          echo "新機能" > feature.js
        `);
      },
      goals: [
        {
          text: '.gitignore を作る',
          check: (r) => '.gitignore' in r.workdir,
        },
        {
          text: 'debug.log が untracked 一覧から消える',
          check: (r) => !status(r).untracked.includes('debug.log'),
        },
        {
          text: 'secrets.env も untracked 一覧から消える',
          check: (r) => !status(r).untracked.includes('secrets.env'),
        },
        {
          text: 'feature.js はちゃんと untracked に残っている（無視しすぎない）',
          check: (r) => status(r).untracked.includes('feature.js'),
        },
      ],
      hints: [
        '`echo "*.log" > .gitignore` で1行目を作ります。',
        '2行目は追記です: `echo "secrets.env" >> .gitignore`',
        '`git status` で debug.log と secrets.env が消えたか確認しましょう。',
      ],
      teach: [
        '.gitignore に書いたパターンに合うファイルは、git が「無かったこと」にします。',
        '注意: **既にコミット済みのファイルには効きません**。一度 `git rm --cached` で外す必要があります。',
        '.gitignore 自体はコミットします。チーム全員で共有する設定だからです。',
      ],
      wantedCommands: [/^(echo|touch).*\.gitignore/],
    },
    {
      id: 'ch2-7',
      title: '追跡をやめる（.gitignore の落とし穴）',
      intro:
        'うっかり .env（パスワードの入ったファイル）をコミットしてしまいました。\n.gitignore に書けば消える…と思いきや、**既に追跡されているファイルには効きません**。\n追跡をやめさせてください。ファイル自体は手元に残す必要があります。',
      setup(repo) {
        seed(repo, `
          git init
          echo "console.log('app')" > app.js
          echo "DB_PASSWORD=hunter2" > .env
          git add .
          git commit -m "初回コミット（.env も入ってしまった）"
        `);
      },
      goals: [
        {
          text: '.gitignore に .env を書く',
          check: (r) => (r.workdir['.gitignore'] || '').includes('.env'),
        },
        {
          text: '.env の追跡をやめる（ファイルは消さない）',
          check: (r) => !('.env' in r.index) && '.env' in r.workdir,
        },
        {
          text: 'コミットして、.env が git から見えなくなる',
          check: (r) => {
            const tree = commitTree(r, headCommit(r));
            const s = status(r);
            return (
              !('.env' in tree) &&
              !s.untracked.includes('.env') &&
              !s.unstaged.some((f) => f.path === '.env') &&
              '.env' in r.workdir
            );
          },
        },
      ],
      hints: [
        'まず `echo ".env" > .gitignore` で無視する設定を書きます。ただし、これだけでは効きません。',
        '`git rm --cached .env` で「追跡だけ」やめます。`--cached` を付けないとファイルごと消えるので注意。',
        '`git add .gitignore` → `git commit -m ".env の追跡をやめる"` で確定します。',
      ],
      teach: [
        '.gitignore が効くのは **まだ追跡されていないファイル** だけです。一度コミットしたものは対象外。',
        '`git rm --cached <file>` = index から外すが、ファイルは手元に残す。この組み合わせが定番の直し方。',
        '**注意**: 一度コミットしたパスワードは、追跡をやめても**過去のコミットには残り続けます**。本当に漏れた秘密は、必ず作り直してください（無効化して新しいものを発行する）。',
      ],
      wantedCommands: [/^git rm --cached/, /^git commit/],
    },
    {
      id: 'ch2-8',
      title: '消したコミットを取り戻す（reflog）',
      intro:
        '`git reset --hard` で大事なコミットを消してしまいました。\nもう戻せない…ように見えますが、git は HEAD が通ってきた道を覚えています。取り戻してください。',
      setup(repo) {
        seed(repo, `
          git init
          echo "土台" > base.txt
          git add .
          git commit -m "土台を作る"
          echo "3日かけた機能" > feature.js
          echo "そのテスト" > feature.test.js
          git add .
          git commit -m "検索機能を実装"
          git reset --hard HEAD~1
        `);
      },
      goals: [
        {
          text: 'git reflog で HEAD の履歴を見る',
          check: (r, ctx) => usedCommand(ctx, /^git reflog/),
        },
        {
          text: '消えたコミットを取り戻す（feature.js が戻る）',
          check: (r) => 'feature.js' in r.workdir && 'feature.test.js' in r.workdir,
        },
        {
          text: '取り戻した内容が今のブランチから辿れる',
          check: (r) => {
            const tree = commitTree(r, headCommit(r));
            return 'feature.js' in tree;
          },
        },
      ],
      hints: [
        'まず `git reflog` を打ってください。「検索機能を実装」の行があるはずです。',
        '左端の sha か `HEAD@{1}` が、消えたコミットを指しています。',
        '`git reset --hard HEAD@{1}` で戻せます。`git switch -c rescue HEAD@{1}` で別ブランチとして救う手もあります。',
      ],
      teach: [
        '`git reflog` は **HEAD が通ってきた場所の履歴**です。コミットは reset や branch -D では消えず、しばらく残っています。',
        'つまり「コミットさえしてあれば、たいていのやらかしは取り戻せる」。これが git を怖がらずに使うための一番の安心材料です。',
        '逆に **コミットしていない変更は reflog にも残りません**。不安な作業の前ほど、こまめにコミットしてください。',
        '（reflog の記録は数週間で消えます。永久ではありません）',
      ],
      wantedCommands: [/^git reflog/, /^git (reset|switch)/],
    },
  ],
};

// =================================================================== 第3章

const ch3 = {
  id: 'ch3',
  title: '第4章 ブランチ',
  subtitle: 'switch -c / merge / fast-forward / branch -d',
  blurb: '本番を壊さずに実験するための仕組み。状態画面のグラフを開きながら進めると、何が起きているか一目で分かります。',
  stages: [
    {
      id: 'ch3-1',
      title: '枝を伸ばす',
      intro:
        '新機能を試したいけれど、main を壊したくありません。\nfeature/dark-mode という枝を作って、そこに切り替えてください。',
      setup(repo) {
        seed(repo, `
          git init
          echo "body { color: black; }" > style.css
          git add .
          git commit -m "基本のスタイル"
          echo "body { color: black; }" > style.css
          echo "h1 { font-size: 2em; }" >> style.css
          git add .
          git commit -m "見出しのスタイル"
        `);
      },
      goals: [
        {
          text: 'feature/dark-mode ブランチが存在する',
          check: (r) => listBranches(r).includes('feature/dark-mode'),
        },
        {
          text: 'そのブランチに切り替わっている',
          check: (r) => currentBranch(r) === 'feature/dark-mode',
        },
        {
          text: 'main と同じコミットから始まっている',
          check: (r) =>
            r.refs['refs/heads/feature/dark-mode'] === r.refs['refs/heads/main'] ||
            isAncestor(r, r.refs['refs/heads/main'], r.refs['refs/heads/feature/dark-mode']),
        },
      ],
      hints: [
        '`git switch -c feature/dark-mode` で「作って切り替え」が一度にできます。',
        '`git branch feature/dark-mode` は作るだけで切り替わりません。',
        '`git branch` で今あるブランチ一覧、`*` が今いる場所です。',
      ],
      teach: [
        'ブランチは「コミットを指す付箋」でしかありません。作ってもファイルは1バイトもコピーされません。',
        'だから git のブランチは軽い。気軽に作って気軽に消せます。',
        '状態画面のグラフを見ると、main と feature/dark-mode が同じコミットを指しているのが分かります。',
      ],
      wantedCommands: [/^git switch -c|^git checkout -b/],
    },
    {
      id: 'ch3-2',
      title: '早送りマージ',
      intro:
        'feature/dark-mode で作業が終わりました。main に取り込みましょう。\nmain 側では何も変えていないので、これは「早送り」になります。',
      setup(repo) {
        seed(repo, `
          git init
          echo "body { color: black; }" > style.css
          git add .
          git commit -m "基本のスタイル"
          git switch -c feature/dark-mode
          echo "body { color: white; background: #111; }" > style.css
          git add .
          git commit -m "ダークモードの配色"
          echo "@media (prefers-color-scheme: dark) {}" > dark.css
          git add .
          git commit -m "メディアクエリを追加"
          git switch main
        `);
      },
      goals: [
        {
          text: 'main に切り替わっている',
          check: (r) => currentBranch(r) === 'main',
        },
        {
          text: 'main が feature/dark-mode の内容を持っている',
          check: (r) =>
            r.refs['refs/heads/main'] === r.refs['refs/heads/feature/dark-mode'],
        },
        {
          text: 'マージコミットは作られていない（早送りになっている）',
          check: (r) => {
            const h = headCommit(r);
            return h ? readCommit(r, h).parents.length === 1 : false;
          },
        },
      ],
      hints: [
        '取り込む側（main）にいることを確認してから `git merge feature/dark-mode`。',
        '「取り込みたい枝の名前」を merge に渡します。今いる枝の名前ではありません。',
        '出力に "Fast-forward" と出れば成功です。',
      ],
      teach: [
        'main が枝分かれ後に1つも進んでいない場合、git は付箋を前にずらすだけで済ませます。これが fast-forward。',
        '新しいコミットは作られないので、履歴は一直線のままです。',
        'あえてマージの記録を残したいときは `git merge --no-ff <branch>`。',
      ],
      wantedCommands: [/^git merge/],
    },
    {
      id: 'ch3-3',
      title: '本当のマージ',
      intro:
        '今度は main 側も進んでいます。両方の枝に別々の変更があるので、git は新しい「マージコミット」を作ります。\nfeature/search を main に取り込んでください。',
      setup(repo) {
        seed(repo, `
          git init
          echo "# アプリ" > README.md
          git add .
          git commit -m "初期化"
          git switch -c feature/search
          echo "function search(q) {}" > search.js
          git add .
          git commit -m "検索機能を追加"
          git switch main
          echo "# アプリ" > README.md
          echo "使い方は docs を参照" >> README.md
          git add .
          git commit -m "READMEを更新"
        `);
      },
      goals: [
        {
          text: 'マージコミットができている（親が2つ）',
          check: (r) => {
            const h = headCommit(r);
            return h ? readCommit(r, h).parents.length === 2 : false;
          },
        },
        {
          text: '両方の変更が揃っている',
          check: (r) => 'search.js' in r.workdir && fileHas(r, 'README.md', 'docs'),
        },
        { text: 'main にいる', check: (r) => currentBranch(r) === 'main' },
      ],
      hints: [
        '`git merge feature/search` を main の上で実行します。',
        '違うファイルを触っているので、衝突せずに自動で1つにまとまります。',
        '状態画面のグラフを見ると、2本の線が1点に合流しているはずです。',
      ],
      teach: [
        '両方が進んでいるときは「3-way マージ」。分岐点・自分・相手の3つを見比べて統合します。',
        'できたマージコミットは親を2つ持ちます。グラフで線が合流するのはこれが理由です。',
      ],
      wantedCommands: [/^git merge/],
    },
    {
      id: 'ch3-4',
      title: '片付ける',
      intro:
        'マージが済んだ枝は消して構いません。逆に、まだマージしていない枝は git が守ってくれます。\nfeature/search（マージ済み）を消し、feature/wip（未マージ）は守られることを確認してください。',
      setup(repo) {
        seed(repo, `
          git init
          echo "# アプリ" > README.md
          git add .
          git commit -m "初期化"
          git switch -c feature/search
          echo "function search(q) {}" > search.js
          git add .
          git commit -m "検索機能"
          git switch main
          git merge feature/search
          git switch -c feature/wip
          echo "途中の実験" > experiment.js
          git add .
          git commit -m "実験中"
          git switch main
        `);
      },
      goals: [
        {
          text: 'feature/search を削除する',
          check: (r) => !listBranches(r).includes('feature/search'),
        },
        {
          text: 'feature/wip を -d で消そうとして止められる（未マージの保護を体験）',
          check: (r, ctx) =>
            ctx.history.some((h) => /^git branch -d feature\/wip/.test(h)) ,
        },
        {
          text: 'feature/wip は残っている',
          check: (r) => listBranches(r).includes('feature/wip'),
        },
      ],
      hints: [
        '`git branch -d feature/search` で消せます（マージ済みなので通ります）。',
        '次に `git branch -d feature/wip` を試してください。エラーになるのが正解です。',
        '本当に捨てたいときだけ大文字の `-D`。ここでは使わないでください。',
      ],
      teach: [
        '`-d` は「マージ済みなら消す」という安全な削除。未マージなら止めてくれます。',
        '`-D` は問答無用。コミットが迷子になります（しばらくは `git reflog` で救えますが、当てにしないこと）。',
      ],
      wantedCommands: [/^git branch -d/],
    },
    {
      id: 'ch3-5',
      title: '迷子のコミット（detached HEAD）',
      intro:
        '過去のコミットを見に行ったまま作業してコミットしてしまいました。\nいま HEAD はどのブランチにも乗っていません（分離 HEAD）。このままブランチに戻ると、この作業は迷子になります。\n救い出してください。',
      setup(repo) {
        seed(repo, `
          git init
          echo "v1" > app.js
          git add .
          git commit -m "初版"
          echo "v2" > app.js
          git add .
          git commit -m "改良版"
          git checkout HEAD~1
          echo "分離HEADで書いた大事な修正" > hotfix.js
          git add .
          git commit -m "重要なバグ修正"
        `);
      },
      goals: [
        {
          text: '今の状態を確認する（分離 HEAD であることに気づく）',
          check: (r, ctx) => usedCommand(ctx, /^git (status|log|branch)/),
        },
        {
          text: 'この作業にブランチを付けて救い出す',
          check: (r) => {
            if (r.HEAD.type !== 'branch') return false;
            const tree = commitTree(r, headCommit(r));
            return 'hotfix.js' in tree;
          },
        },
        {
          text: 'ブランチ一覧に、救い出したブランチが出る',
          check: (r) => listBranches(r).length >= 2,
        },
      ],
      hints: [
        '`git status` を打つと `HEAD detached at ...` と出ます。ブランチ名がありません。',
        '`git switch -c rescue` で、今いる場所にブランチを付けられます（-c は「作る」）。',
        'ブランチを付けずに `git switch main` で戻ると、このコミットはどこからも辿れなくなります（reflog でなら救えます）。',
      ],
      teach: [
        '分離 HEAD = HEAD がブランチではなくコミットを直接指している状態。過去を見に行ったときになります。',
        '**見るだけなら問題ありません。** 問題はそこでコミットしたとき。ブランチが付いていないので、離れた瞬間に迷子になります。',
        '救い方は簡単で、**離れる前に `git switch -c <名前>`**。離れてしまっても `git reflog` から取り戻せます。',
        '元に戻るだけなら `git switch main` でOK。「detached HEAD」と出ても慌てないことが大事です。',
      ],
      wantedCommands: [/^git (status|log|branch)/, /^git switch -c/],
    },
  ],
};

// =================================================================== 第4章

const ch4 = {
  id: 'ch4',
  title: '第5章 コンフリクト',
  subtitle: '衝突の発生と解消 / merge --abort',
  blurb: '一番怖がられる場面。でも仕組みが分かれば、ただの「どっちを残すか選ぶ作業」です。',
  stages: [
    {
      id: 'ch4-1',
      title: '衝突を起こす',
      intro:
        '2人が同じ行を別々に書き換えました。\nmain に feature/copy をマージして、わざと衝突させてください。まずは体験することが目的です。',
      setup(repo) {
        seed(repo, `
          git init
          echo "タイトル: わたしのサイト" > index.html
          git add .
          git commit -m "初版"
          git switch -c feature/copy
          echo "タイトル: ようこそ！最高のサイトへ" > index.html
          git add .
          git commit -m "キャッチコピーを変更"
          git switch main
          echo "タイトル: 山田商店 公式サイト" > index.html
          git add .
          git commit -m "正式名称に変更"
        `);
      },
      goals: [
        {
          text: 'マージを試みて衝突が発生する',
          check: (r) => !!r.MERGE_HEAD,
        },
        {
          text: 'git status で衝突しているファイルを確認する',
          check: (r, ctx) => usedCommand(ctx, /^git status/),
        },
        {
          text: 'cat か edit で、ファイルの中のマーカーを見る',
          check: (r, ctx) => usedCommand(ctx, /^(cat|edit|vim|nano) index\.html/),
        },
      ],
      hints: [
        '`git merge feature/copy` を実行します。CONFLICT と出れば成功です。',
        '`git status` を打つと "Unmerged paths" に index.html が出ます。',
        '`cat index.html` でファイルの中身を見てみましょう。見慣れない記号が入っています。',
      ],
      teach: [
        'git は同じ行への別々の変更を自動では決められないので、両方の案をファイルに書き込んで人間に判断を委ねます。',
        '`<<<<<<< HEAD` から `=======` までが自分の版、`=======` から `>>>>>>>` までが相手の版です。',
        'この状態では、まだ何も壊れていません。`git merge --abort` でいつでも元に戻せます。',
      ],
      wantedCommands: [/^git merge/, /^git status/],
    },
    {
      id: 'ch4-2',
      title: '衝突を解消する',
      intro:
        '衝突した状態から始まります。\nマーカーを取り除いて、残したい内容だけにしてから、マージを完了させてください。\n（`edit index.html` で編集パネルが開きます）',
      setup(repo) {
        seed(repo, `
          git init
          echo "タイトル: わたしのサイト" > index.html
          git add .
          git commit -m "初版"
          git switch -c feature/copy
          echo "タイトル: ようこそ！最高のサイトへ" > index.html
          git add .
          git commit -m "キャッチコピーを変更"
          git switch main
          echo "タイトル: 山田商店 公式サイト" > index.html
          git add .
          git commit -m "正式名称に変更"
          !git merge feature/copy
        `);
      },
      goals: [
        {
          text: 'index.html からコンフリクトマーカーが消えている',
          check: (r) => !/^(<<<<<<<|=======|>>>>>>>)/m.test(r.workdir['index.html'] || ''),
        },
        {
          text: '解消済みとして add する',
          check: (r) => !r.conflicts['index.html'],
        },
        {
          text: 'マージコミットを作って完了させる',
          check: (r) => {
            const h = headCommit(r);
            return !r.MERGE_HEAD && h && readCommit(r, h).parents.length === 2;
          },
        },
      ],
      hints: [
        '`edit index.html` で編集パネルが開きます。マーカーの行（<<<<<<< / ======= / >>>>>>>）を消してください。',
        'どちらか一方を残しても、両方を混ぜた新しい文にしても構いません。決めるのはあなたです。',
        '編集を保存したら `git add index.html` → `git commit -m "マージ: タイトルの表記を統一"`。',
      ],
      teach: [
        '解消の手順は3つだけ: ①ファイルを直す ②`git add` で「直した」と宣言 ③`git commit`。',
        '`git add` が「解消済みマーク」を兼ねています。だから add を忘れるとコミットできません。',
        'マーカーを消し忘れたまま add しようとすると、このアプリは止めてくれます（本物の git は通してしまうので要注意）。',
      ],
      wantedCommands: [/^(edit|echo)/, /^git add/, /^git commit/],
    },
    {
      id: 'ch4-3',
      title: '逃げ道を知る',
      intro:
        '衝突がややこしすぎて、今は手を付けたくない。そんなときのための撤退コマンドがあります。\nマージを中止して、開始前の状態に戻してください。',
      setup(repo) {
        seed(repo, `
          git init
          echo "設定A" > config.yml
          echo "設定B" >> config.yml
          echo "設定C" >> config.yml
          git add .
          git commit -m "初期設定"
          git switch -c refactor
          echo "設定A（改）" > config.yml
          echo "設定B（改）" >> config.yml
          echo "設定C（改）" >> config.yml
          git add .
          git commit -m "設定を全面的に書き換え"
          git switch main
          echo "設定A2" > config.yml
          echo "設定B2" >> config.yml
          echo "設定C2" >> config.yml
          git add .
          git commit -m "設定を微調整"
          !git merge refactor
        `);
      },
      goals: [
        {
          text: 'マージを中止する',
          check: (r) => !r.MERGE_HEAD && Object.keys(r.conflicts).length === 0,
        },
        {
          text: 'config.yml が main の状態に戻っている',
          check: (r) => fileHas(r, 'config.yml', '設定A2') && !/<<<</.test(r.workdir['config.yml'] || ''),
        },
        {
          text: 'main の先端はマージ前のまま',
          check: (r) => {
            const h = headCommit(r);
            return h ? readCommit(r, h).parents.length === 1 : false;
          },
        },
      ],
      hints: [
        '`git merge --abort` の一発です。',
        '中止しても失うものはありません。マージ開始前の状態にきれいに戻ります。',
        'あとで落ち着いてから、もう一度 `git merge refactor` をやり直せます。',
      ],
      teach: [
        '`git merge --abort` は「なかったこと」にするコマンド。衝突で焦ったらまずこれを思い出してください。',
        'rebase 中なら `git rebase --abort`、cherry-pick 中なら `git cherry-pick --abort`。同じ考え方です。',
      ],
      wantedCommands: [/^git merge --abort/],
    },
  ],
};

// =================================================================== 第5章

const ch5 = {
  id: 'ch5',
  title: '第6章 歴史を整える',
  subtitle: 'rebase / cherry-pick / stash / revert',
  blurb: 'マージ以外の合流のしかた。使い分けができると一人前です。',
  stages: [
    {
      id: 'ch5-1',
      title: 'rebase で一直線に',
      intro:
        'feature ブランチの作業中に main が進みました。\nマージコミットを作らず、自分のコミットを main の先端の上に「載せ直して」ください。',
      setup(repo) {
        seed(repo, `
          git init
          echo "土台" > core.js
          git add .
          git commit -m "土台"
          git switch -c feature/api
          echo "GET /users" > api.js
          git add .
          git commit -m "ユーザーAPI"
          echo "GET /users" > api.js
          echo "POST /users" >> api.js
          git add .
          git commit -m "ユーザー作成API"
          git switch main
          echo "土台（バグ修正済み）" > core.js
          git add .
          git commit -m "土台のバグを修正"
          git switch feature/api
        `);
      },
      goals: [
        {
          text: 'main の先端が feature/api の祖先になっている',
          check: (r) => isAncestor(r, r.refs['refs/heads/main'], r.refs['refs/heads/feature/api']),
        },
        {
          text: '履歴にマージコミットが無い（一直線）',
          check: (r) => {
            let sha = r.refs['refs/heads/feature/api'];
            while (sha) {
              const c = readCommit(r, sha);
              if (!c) break;
              if (c.parents.length > 1) return false;
              sha = c.parents[0];
            }
            return true;
          },
        },
        {
          text: '両方の変更が揃っている',
          check: (r) => fileHas(r, 'core.js', 'バグ修正済み') && fileHas(r, 'api.js', 'POST'),
        },
      ],
      hints: [
        'feature/api にいる状態で `git rebase main`。',
        '「main の上に自分を載せ直す」ので、引数は載せたい土台（main）です。',
        '完了後に状態画面のグラフを見ると、線が1本になっているはずです。',
      ],
      teach: [
        'rebase は自分のコミットを1つずつ取り出して、新しい土台の上に作り直します。だから **sha が全部変わります**。',
        'merge = 合流の記録が残る / rebase = 履歴がきれい。チームの方針に従うのが一番です。',
        '**鉄則**: 他の人と共有済みのブランチは rebase しない。相手の履歴と食い違います。',
      ],
      wantedCommands: [/^git rebase/],
    },
    {
      id: 'ch5-2',
      title: 'rebase 中の衝突',
      intro:
        'rebase の途中で衝突しました。merge のときと少しだけ手順が違います。\n解消して rebase を完了させてください。',
      setup(repo) {
        seed(repo, `
          git init
          echo "バージョン: 1.0" > version.txt
          git add .
          git commit -m "初版"
          git switch -c feature/bump
          echo "バージョン: 1.1-beta" > version.txt
          git add .
          git commit -m "ベータ版に上げる"
          git switch main
          echo "バージョン: 2.0" > version.txt
          git add .
          git commit -m "メジャーバージョンアップ"
          git switch feature/bump
        `);
      },
      goals: [
        {
          text: 'rebase を開始する',
          check: (r, ctx) => usedCommand(ctx, /^git rebase (main|origin\/main)/),
        },
        {
          text: 'rebase が完了している（進行中でない）',
          check: (r, ctx) => r.REBASE === null && usedCommand(ctx, /^git rebase/),
        },
        {
          text: 'main のコミットが祖先になっている',
          check: (r) => isAncestor(r, r.refs['refs/heads/main'], r.refs['refs/heads/feature/bump']),
        },
        {
          text: 'version.txt にマーカーが残っていない',
          check: (r) => !/<<<</.test(r.workdir['version.txt'] || ''),
        },
      ],
      hints: [
        '`git rebase main` で開始 → 衝突して止まります。',
        '`edit version.txt` でマーカーを消し、残したい内容にします（例: `echo "バージョン: 2.1-beta" > version.txt`）。',
        '`git add version.txt` してから、**commit ではなく** `git rebase --continue`。',
      ],
      teach: [
        'merge の衝突は `git commit` で締めますが、rebase の衝突は `git rebase --continue` で締めます。',
        'rebase は複数のコミットを順に適用するので、コミットごとに何回も止まることがあります。その都度 --continue。',
        '嫌になったら `git rebase --abort`。いつでも開始前に戻れます。',
      ],
      wantedCommands: [/^git rebase/, /^git add/, /^git rebase --continue/],
    },
    {
      id: 'ch5-3',
      title: '1つだけ持ってくる',
      intro:
        'hotfix ブランチには3つのコミットがありますが、main に今すぐ欲しいのは「セキュリティ修正」の1つだけです。\nそのコミットだけを main に持ってきてください。',
      setup(repo) {
        seed(repo, `
          git init
          echo "アプリ本体" > app.js
          git add .
          git commit -m "初版"
          git switch -c hotfix
          echo "実験1" > exp1.js
          git add .
          git commit -m "実験コード（まだ入れたくない）"
          echo "入力値をエスケープする" > security.js
          git add .
          git commit -m "セキュリティ修正"
          echo "実験2" > exp2.js
          git add .
          git commit -m "別の実験（まだ入れたくない）"
          git switch main
        `);
      },
      goals: [
        {
          text: 'main に security.js がある',
          check: (r) => 'security.js' in r.workdir,
        },
        {
          text: '実験用ファイルは来ていない',
          check: (r) => !('exp1.js' in r.workdir) && !('exp2.js' in r.workdir),
        },
        {
          text: 'main にいて、コミットが2つになっている',
          check: (r) => currentBranch(r) === 'main' && commitCount(r) === 2,
        },
      ],
      hints: [
        'まず `git log --oneline --all` で「セキュリティ修正」のコミット sha を調べます。',
        '`git cherry-pick <その sha>` で、そのコミットの変更だけが今の枝に載ります。',
        '`git cherry-pick hotfix~1` のような相対指定でも大丈夫です。',
      ],
      teach: [
        'cherry-pick は「あのコミットの変更だけ欲しい」ときの道具。緊急のバグ修正を本番枝に運ぶ場面が典型です。',
        '元のコミットとは別の sha になります。同じ変更を持つ「コピー」だからです。',
      ],
      wantedCommands: [/^git cherry-pick/],
    },
    {
      id: 'ch5-4',
      title: '作業を棚上げする',
      intro:
        '機能を書いている途中で「今すぐ本番のバグを直して」と言われました。\n中途半端な変更をコミットせずに退避し、main で修正して、戻ってきて作業を再開してください。',
      setup(repo) {
        seed(repo, `
          git init
          echo "アプリ本体" > app.js
          git add .
          git commit -m "初版"
          git switch -c feature/chart
          echo "グラフ描画（書きかけ" > chart.js
          git add .
          git commit -m "グラフの下書き"
          echo "グラフ描画（書きかけ、まだ動かない" > chart.js
        `);
      },
      goals: [
        {
          text: '作業中の変更を stash に退避する',
          check: (r, ctx) => usedCommand(ctx, /^git stash($| push| save)/),
        },
        {
          text: 'main で hotfix.js を作ってコミットする',
          check: (r) => {
            const mainSha = r.refs['refs/heads/main'];
            return mainSha ? 'hotfix.js' in commitTree(r, mainSha) : false;
          },
        },
        {
          text: 'feature/chart に戻って stash を復元する',
          check: (r) =>
            currentBranch(r) === 'feature/chart' &&
            fileHas(r, 'chart.js', 'まだ動かない') &&
            r.stash.length === 0,
        },
      ],
      hints: [
        '`git stash` で退避 → 作業ツリーがコミット直後の状態に戻ります。',
        '`git switch main` → `echo "修正" > hotfix.js` → `git add .` → `git commit -m "緊急修正"`。',
        '`git switch feature/chart` で戻り、`git stash pop` で書きかけを復元します。',
      ],
      teach: [
        'stash は「引き出しに一時的にしまう」機能。コミットしたくない中途半端な変更の避難先です。',
        '`pop` は取り出して引き出しから消す、`apply` は取り出しても残す。`git stash list` で中身が見られます。',
        'しまったまま忘れがちなので、使ったらなるべく早く取り出しましょう。',
      ],
      wantedCommands: [/^git stash/, /^git switch/, /^git stash pop/],
    },
    {
      id: 'ch5-5',
      title: '公開済みの取り消し方',
      intro:
        '既にチームに共有したコミットに問題が見つかりました。\n歴史を書き換えず（reset を使わず）、そのコミットを打ち消してください。',
      setup(repo) {
        seed(repo, `
          git init
          echo "正しい計算" > calc.js
          git add .
          git commit -m "計算処理"
          echo "画面表示" > view.js
          git add .
          git commit -m "画面表示を追加"
          echo "壊れた計算" > calc.js
          git add .
          git commit -m "計算処理をリファクタ（実はバグ入り）"
        `);
      },
      goals: [
        {
          text: 'calc.js が「正しい計算」に戻っている',
          check: (r) => fileHas(r, 'calc.js', '正しい計算'),
        },
        {
          text: 'コミットが4つに増えている（歴史を消さずに打ち消した）',
          check: (r) => commitCount(r) === 4,
        },
        {
          text: 'バグ入りコミットも履歴に残っている',
          check: (r) => {
            let sha = headCommit(r);
            while (sha) {
              const c = readCommit(r, sha);
              if (!c) return false;
              if (c.message.includes('リファクタ')) return true;
              sha = c.parents[0];
            }
            return false;
          },
        },
      ],
      hints: [
        '`git revert HEAD` を使います。',
        'revert は「逆の変更をする新しいコミット」を積みます。歴史は1つも消えません。',
        'reset は歴史を消してしまうので、共有済みのブランチでは使えません。',
      ],
      teach: [
        '**手元だけのやり直し → reset / amend**、**共有済みのやり直し → revert**。この使い分けが実務での分かれ目です。',
        'revert なら他の人の手元と食い違いません。「間違えた」という事実も履歴に残りますが、それが誠実で安全です。',
      ],
      wantedCommands: [/^git revert/],
    },
  ],
};

// =================================================================== 第6章

/** 第6章で clone / push する相手役のリポジトリを作る。 */
export function makeTeamRemote() {
  const remote = initRepo();
  seed(remote, `
    echo "# チームプロジェクト" > README.md
    git add .
    git commit -m "リポジトリを作成"
    echo "MIT License" > LICENSE
    git add .
    git commit -m "ライセンスを追加"
  `);
  remote.defaultBranch = 'main';
  return remote;
}

/** 同僚が裏でコミットを積んだ状態にする。 */
function advanceRemote(remote, script) {
  seed(remote, script);
}

const REMOTE_URL = 'https://github.com/team/awesome-app.git';

const ch6 = {
  id: 'ch6',
  title: '第7章 リモート',
  subtitle: 'clone / fetch / pull / push / 追跡ブランチ',
  blurb: '手元とサーバーは別のリポジトリ。この章では、両者がどう同期するのかを追いかけます。',
  stages: [
    {
      id: 'ch6-1',
      title: 'clone してくる',
      intro:
        `チームのリポジトリに参加します。\n${REMOTE_URL} を手元に取ってきてください。`,
      setup(repo, ctx) {
        ctx.remote = makeTeamRemote();
      },
      remoteUrl: REMOTE_URL,
      goals: [
        {
          text: 'clone が成功してファイルが手元にある',
          check: (r) => 'README.md' in r.workdir && 'LICENSE' in r.workdir,
        },
        {
          text: 'origin が登録されている',
          check: (r) => !!r.remotes.origin,
        },
        {
          text: 'origin/main（リモート追跡ブランチ）がある',
          check: (r) => 'refs/remotes/origin/main' in r.refs,
        },
        {
          text: 'git remote -v でリモートの URL を確認する',
          check: (r, ctx) => usedCommand(ctx, /^git remote -v/),
        },
      ],
      hints: [
        `\`git clone ${REMOTE_URL}\` を実行します。`,
        '`ls` で取ってきたファイルを確認してみましょう。',
        '`git remote -v` で「どこと繋がっているか」が見られます。',
      ],
      teach: [
        'clone は `init` + `remote add origin` + `fetch` + `switch` を一度にやるコマンドです。',
        '`origin` は単なる既定の名前。リモートの URL に付けたあだ名にすぎません。',
        '`origin/main` は「最後に確認したときのリモートの main の位置」を覚えている付箋です。手元の `main` とは別物。',
      ],
      wantedCommands: [/^git clone/, /^git remote -v/],
    },
    {
      id: 'ch6-2',
      title: '送る（push -u）',
      intro:
        '手元で1つコミットを作り、リモートに送ってください。\n初回は `-u` を付けて、追跡先を覚えさせるのが定石です。',
      setup(repo, ctx) {
        ctx.remote = makeTeamRemote();
        seed(repo, `git clone ${REMOTE_URL}`, ctx);
      },
      remoteUrl: REMOTE_URL,
      goals: [
        {
          text: '新しいファイルを作ってコミットする',
          check: (r) => commitCount(r) >= 3,
        },
        {
          text: 'リモートに反映されている',
          check: (r) =>
            r.remotes.origin &&
            r.remotes.origin.repo.refs['refs/heads/main'] === r.refs['refs/heads/main'],
        },
        {
          text: 'origin/main も手元の main と同じ位置になっている',
          check: (r) => r.refs['refs/remotes/origin/main'] === r.refs['refs/heads/main'],
        },
        {
          text: '-u（--set-upstream）を使う',
          check: (r, ctx) => usedCommand(ctx, /^git push (-u|--set-upstream)/),
        },
      ],
      hints: [
        '例: `echo "私の作業" > my-work.md` → `git add .` → `git commit -m "作業メモを追加"`。',
        '`git push -u origin main` で送信＋追跡先の設定。',
        '送信後に `git status` を見ると "up to date with origin/main" になります。',
      ],
      teach: [
        'push は「手元のコミットをリモートにコピーして、リモートの付箋を進める」操作です。',
        '`-u` を一度付けておくと、次からは `git push` だけで済みます。',
        'push が終わると `origin/main` も一緒に進みます。手元の記録が更新されたからです。',
      ],
      wantedCommands: [/^git push/],
    },
    {
      id: 'ch6-3',
      title: 'fetch と pull の違い',
      intro:
        'あなたが作業している間に、同僚がリモートに2つコミットを積みました。\nまず `git fetch` だけを実行して、作業ツリーが変わらないことを確かめてから、取り込んでください。',
      setup(repo, ctx) {
        ctx.remote = makeTeamRemote();
        seed(repo, `git clone ${REMOTE_URL}`, ctx);
        advanceRemote(ctx.remote, `
          echo "同僚が書いた設定" > config.json
          git add .
          git commit -m "設定ファイルを追加"
          echo "# チームプロジェクト" > README.md
          echo "セットアップ手順は docs/setup.md へ" >> README.md
          git add .
          git commit -m "READMEにセットアップ手順を追記"
        `);
      },
      remoteUrl: REMOTE_URL,
      goals: [
        {
          text: 'git fetch を実行する',
          check: (r, ctx) => usedCommand(ctx, /^git fetch/),
        },
        {
          text: 'origin/main が進んでいる',
          check: (r) => r.refs['refs/remotes/origin/main'] !== undefined,
        },
        {
          text: '同僚の変更を手元の main に取り込む',
          check: (r) => 'config.json' in r.workdir && fileHas(r, 'README.md', 'セットアップ手順'),
        },
        {
          text: '手元の main と origin/main が揃っている',
          check: (r) => r.refs['refs/heads/main'] === r.refs['refs/remotes/origin/main'],
        },
      ],
      hints: [
        'まず `git fetch` → そのあと `ls` してください。config.json はまだ出てきません。',
        '`git log --oneline --all` を見ると、origin/main だけが先にいるのが分かります。',
        '取り込むには `git merge origin/main`（または最初から `git pull`）。',
      ],
      teach: [
        '`fetch` = 取ってくるだけ。`origin/*` の付箋が動くだけで、手元のブランチも作業ツリーも無傷です。',
        '`pull` = `fetch` + `merge`。便利ですが、中で2つのことが起きていると知っておくのが大事。',
        '「何が来ているか先に確認したい」ときは fetch、「早く追いつきたい」ときは pull。',
      ],
      wantedCommands: [/^git fetch/, /^git (merge|pull)/],
    },
    {
      id: 'ch6-4',
      title: 'push が拒否されたら',
      intro:
        'あなたがコミットしている間に、同僚もリモートを進めていました。\nこの状態で push すると拒否されます。まず push して拒否を体験し、それから正しく解決してください。',
      setup(repo, ctx) {
        ctx.remote = makeTeamRemote();
        seed(repo, `git clone ${REMOTE_URL}`, ctx);
        seed(repo, `
          echo "私の新機能" > my-feature.js
          git add .
          git commit -m "新機能を実装"
        `);
        advanceRemote(ctx.remote, `
          echo "同僚の修正" > their-fix.js
          git add .
          git commit -m "バグを修正"
        `);
      },
      remoteUrl: REMOTE_URL,
      goals: [
        {
          text: 'push を試して拒否される（non-fast-forward を体験）',
          check: (r, ctx) => ctx.rejectedPush === true,
        },
        {
          text: '同僚の変更を取り込む',
          check: (r) => 'their-fix.js' in r.workdir,
        },
        {
          text: 'push が成功してリモートに自分の変更が届いている',
          check: (r) => {
            const rem = r.remotes.origin;
            if (!rem) return false;
            const tip = rem.repo.refs['refs/heads/main'];
            return tip ? 'my-feature.js' in commitTree(rem.repo, tip) : false;
          },
        },
      ],
      hints: [
        'まず `git push` を実行してください。`! [rejected]` と出るのが正解です。',
        '拒否されたのは「リモートに自分の知らないコミットがあるから」。まず `git pull` で取り込みます。',
        '取り込んだら、もう一度 `git push`。今度は通ります。（`git pull --rebase` でも解決できます）',
      ],
      teach: [
        'push の拒否は git の親切です。強引に通すと同僚のコミットが消えます。',
        '解決の型は一つ: **pull してから push**。`--force` は、自分専用のブランチ以外では使わないこと。',
        '`git pull --rebase` を使うと、無駄なマージコミットを作らずに済みます。チームによってはこちらが標準です。',
      ],
      wantedCommands: [/^git push/, /^git pull/],
    },
    {
      id: 'ch6-5',
      title: 'origin ってなに？',
      intro:
        '`origin` は git の予約語ではありません。**リモートの URL に付けた、ただのあだ名**です。\n本当にあだ名なのか、名前を変えて確かめてみましょう。',
      setup(repo, ctx) {
        ctx.remote = makeTeamRemote();
        seed(repo, `git clone ${REMOTE_URL}`, ctx);
      },
      remoteUrl: REMOTE_URL,
      goals: [
        {
          text: 'git remote -v で「あだ名 → URL」の対応を見る',
          check: (r, ctx) => usedCommand(ctx, /^git remote -v/),
        },
        {
          text: 'origin を upstream という名前に変える',
          check: (r) => !!r.remotes.upstream && !r.remotes.origin,
        },
        {
          text: '追跡ブランチも upstream/* に変わったことを確認する',
          check: (r, ctx) =>
            Object.keys(r.refs).some((ref) => ref.startsWith('refs/remotes/upstream/')) &&
            usedCommand(ctx, /^git branch -a|^git branch --all/),
        },
      ],
      hints: [
        '`git remote -v` を打つと、`origin` の右に URL が出ます。これが対応表です。',
        '`git remote rename origin upstream` で改名できます。',
        '`git branch -a` で追跡ブランチの一覧が見られます。`origin/main` が `upstream/main` になっているはずです。',
      ],
      teach: [
        '`origin` は `git clone` が自動で付ける **既定のあだ名**です。特別な意味はありません。',
        'あだ名 → URL の対応は `git remote -v` で確認できます。困ったらまずこれ。',
        '実務では複数のリモートを持つことがあります（例: 自分のフォークが `origin`、本家が `upstream`）。だから名前で区別できることが大事なのです。',
      ],
      wantedCommands: [/^git remote -v/, /^git remote rename/, /^git branch -a/],
    },
    {
      id: 'ch6-6',
      title: 'origin/main と main は別物',
      intro:
        '`main` と `origin/main` は名前が似ていますが、まったく別のものです。\n同僚がリモートを進めました。`git fetch` を打って、**どちらが動いてどちらが動かないか**を確かめてください。',
      setup(repo, ctx) {
        ctx.remote = makeTeamRemote();
        seed(repo, `git clone ${REMOTE_URL}`, ctx);
        advanceRemote(ctx.remote, `
          echo "同僚が書いた機能" > teammate.js
          git add .
          git commit -m "同僚の新機能"
        `);
      },
      remoteUrl: REMOTE_URL,
      goals: [
        {
          text: 'fetch する前に、main と origin/main が同じ位置にあることを見る',
          check: (r, ctx) => usedCommand(ctx, /^git log|^git branch -a|^git status/),
        },
        {
          text: 'git fetch を実行する',
          check: (r, ctx) => usedCommand(ctx, /^git fetch/),
        },
        {
          text: 'origin/main だけが進み、main は動いていないことを確認する',
          check: (r, ctx) =>
            r.refs['refs/remotes/origin/main'] !== r.refs['refs/heads/main'] &&
            usedCommand(ctx, /^git (log|branch -a|status)/),
        },
        {
          text: '作業ツリーにも同僚のファイルが無いことを確認する',
          check: (r, ctx) => !('teammate.js' in r.workdir) && usedCommand(ctx, /^ls/),
        },
      ],
      hints: [
        'まず `git log --oneline --all` を打つと、main と origin/main が同じところにいます。',
        '`git fetch` のあと、もう一度 `git log --oneline --all`。origin/main だけが先に進んでいます。',
        '`ls` してみてください。同僚のファイルはまだ手元にありません。状態画面（⊞）でも確認できます。',
      ],
      teach: [
        '`main` = **あなたのブランチ**。あなたがコミットしたときだけ動きます。',
        '`origin/main` = **最後に確認したときのリモートの main の位置**を覚えている付箋。`fetch` したときだけ動きます。',
        'だから `fetch` しても手元のファイルは1つも変わりません。「見に行っただけ」だからです。',
        '取り込むには `git merge origin/main`。`git pull` はこの2つ（fetch + merge）をまとめて実行しています。',
      ],
      wantedCommands: [/^git fetch/, /^git log|^git branch -a/, /^ls/],
    },
    {
      id: 'ch6-7',
      title: 'fetch に引数を付ける',
      intro:
        '`git fetch` は引数の付け方で意味が変わります。3つの形を順に試して、違いを見てください。\n最後の形だけが、あなたのローカルブランチを直接書き換えます。',
      setup(repo, ctx) {
        ctx.remote = makeTeamRemote();
        seed(repo, `git clone ${REMOTE_URL}`, ctx);
        seed(ctx.remote, `
          git switch -c release
          echo "リリース版" > release.txt
          git add .
          git commit -m "リリース準備"
          git switch main
          echo "本流の更新" > main-work.txt
          git add .
          git commit -m "main を更新"
        `);
      },
      remoteUrl: REMOTE_URL,
      goals: [
        {
          text: 'ブランチを指定して取ってくる（git fetch origin release）',
          check: (r, ctx) => usedCommand(ctx, /^git fetch origin release\s*$/),
        },
        {
          text: 'origin/release ができている',
          check: (r) => 'refs/remotes/origin/release' in r.refs,
        },
        {
          text: 'src:dst の形で、ローカルに staging ブランチを作る',
          check: (r) => 'refs/heads/staging' in r.refs,
        },
        {
          text: '今いるブランチへの直接 fetch は拒否されることを確かめる',
          check: (r, ctx) => ctx.refusedFetch === true,
        },
      ],
      hints: [
        '`git fetch origin release` … release だけを取ってきて `origin/release` を作ります。',
        '`git fetch origin release:staging` … リモートの release を、**ローカルの staging ブランチ**に直接書き込みます。',
        '`git fetch origin main:main` を試してください。今いるブランチには書き込めないので拒否されます。',
      ],
      teach: [
        '`git fetch origin <branch>` … そのブランチだけを `origin/<branch>` に取ってくる。安全。',
        '`git fetch origin <src>:<dst>` … リモートの `<src>` を **ローカルの `<dst>`** に直接書き込む。`origin/*` を経由しません。',
        '`:` を使う形は、切り替えずに別ブランチを最新にしたいときに便利です。ただし**自分の作業を上書きしうる**ので、普段は `origin/*` 経由（引数なしの fetch）で十分です。',
        '今いるブランチには直接 fetch できません（作業ツリーと食い違うため）。そこは `git pull` の役目です。',
      ],
      wantedCommands: [/^git fetch origin/],
    },
  ],
};

// =================================================================== 第8章

/**
 * 修了試験。ここまでの章と違い「打つコマンド」を教えない。
 * 目指す状態だけを示し、そこへ辿り着く道は自分で組み立てる。
 * 判定も最終状態だけを見るので、別のやり方でも通る。
 */
const chExam = {
  id: 'exam',
  title: '第8章 修了試験',
  subtitle: '総合演習 / 自由練習',
  blurb:
    'ここからは手順を教えません。「こういう状態にしてください」だけが示されるので、使うコマンドは自分で決めてください。判定は最終状態だけを見るので、思いついたやり方で構いません。',
  stages: [
    {
      id: 'exam-1',
      title: '散らかったリポジトリを片付ける',
      intro:
        '前任者から引き継いだリポジトリが散らかっています。次の状態にしてください。手順は示しません。\n' +
        '\n' +
        '　1. `debug.log` と `secret.env` は git の管理から外す（消さずに、status にも出ないようにする）\n' +
        '　2. app.js の編集をコミットする\n' +
        '　3. 使っていないブランチ `feature/old` を消す\n' +
        '　4. 最後に `git status` が「何も無い」状態になっている\n' +
        '\n' +
        'まず `git status` と `git branch` で、いまどうなっているかを確かめるところから。',
      setup(repo) {
        seed(repo, `
          git init
          echo "# 家計簿アプリ" > README.md
          echo "console.log('start');" > app.js
          git add .
          git commit -m "初版"
          git branch feature/old
          echo "console.log('合計を計算');" >> app.js
          git add app.js
          echo "2026-08-17 起動しました" > debug.log
          echo "DB_PASSWORD=hunter2" > secret.env
        `);
      },
      goals: [
        {
          text: 'debug.log と secret.env が status に出なくなっている',
          check: (r) => isIgnored(r, 'debug.log') && isIgnored(r, 'secret.env'),
        },
        {
          text: 'app.js の編集がコミットに入っている',
          check: (r) => {
            const head = commitTree(r, headCommit(r));
            return !!head['app.js'] && readBlob(r, head['app.js']).includes('合計を計算');
          },
        },
        {
          text: 'feature/old が消えている',
          check: (r) => !listBranches(r).includes('feature/old'),
        },
        {
          text: 'git status に何も残っていない（未追跡も含めて）',
          check: (r) => clean(r) && !status(r).untracked.length,
        },
        {
          text: 'debug.log と secret.env はファイルとして残っている',
          check: (r) => 'debug.log' in r.workdir && 'secret.env' in r.workdir,
        },
      ],
      hints: [
        'まず `git status` で「何がステージに乗っていて、何が未追跡か」を見てください。`git branch` でブランチも確認。',
        '管理から外すのは第3章でやった `.gitignore` です。作った `.gitignore` 自体はコミットが必要です（さもないと未追跡のまま残ります）。',
        'ブランチの削除は第4章の `git branch -d`。今いるブランチは消せないので、`main` にいることを確かめてから。',
        '答え: `echo "debug.log" > .gitignore` → `echo "secret.env" >> .gitignore` → `git add .` → `git commit -m "片付け"` → `git branch -d feature/old`。',
      ],
      teach: [
        '「status がきれい」は、staged / unstaged / 未追跡のどれも無い状態です。未追跡を消すには、コミットするか無視するかの2択。',
        '`.gitignore` を作っただけでは片付きません。`.gitignore` 自身がコミットされて初めて、他の人の手元でも同じ扱いになります。',
        'ファイルを消さずに管理から外す、が今回の要点です。`rm` してしまうと必要なファイルを失います。',
      ],
    },
    {
      id: 'exam-2',
      title: '履歴を一直線にして取り込む',
      intro:
        'feature/chart を main に取り込みます。ただし、あとから履歴を読む人のために次の条件を満たしてください。手順は示しません。\n' +
        '\n' +
        '　1. feature/chart の変更が main に入っている\n' +
        '　2. 履歴にマージコミットが1つも無い（枝分かれの跡が残っていない）\n' +
        '　3. 取り込み済みの feature/chart は消えている\n' +
        '　4. `git status` がきれい\n' +
        '\n' +
        '`git log --oneline --graph --all` と「⊞ 状態」のグラフで、形を確かめながら進めてください。',
      setup(repo) {
        seed(repo, `
          git init
          echo "# ダッシュボード" > README.md
          git add .
          git commit -m "初版"
          git switch -c feature/chart
          echo "円グラフを描く" > chart.js
          git add .
          git commit -m "円グラフを追加"
          git switch main
          echo "月ごとの集計" > summary.js
          git add .
          git commit -m "集計を追加"
        `);
      },
      goals: [
        {
          text: 'main に chart.js が入っている',
          check: (r) => committed(r, 'chart.js') && currentBranch(r) === 'main',
        },
        {
          text: '履歴にマージコミットが無い（親が2つのコミットが無い）',
          check: (r) => {
            const head = headCommit(r);
            if (!head) return false;
            return [...ancestors(r, head)].every((sha) => readCommit(r, sha).parents.length <= 1);
          },
        },
        {
          text: 'feature/chart が消えている',
          check: (r) => !listBranches(r).includes('feature/chart'),
        },
        { text: 'git status がきれい', check: (r) => clean(r) },
      ],
      hints: [
        'そのまま `git merge` するとマージコミットができてしまいます。第6章でやった、枝の付け根を付け替える方法を思い出してください。',
        '付け替えるのは feature/chart 側です。`feature/chart` に移ってから main を土台にし直すと、main から見て一直線に繋がります。',
        'そのあと main に戻ってマージすると、付け替え済みなので fast-forward になり、マージコミットは作られません。',
        '答え: `git switch feature/chart` → `git rebase main` → `git switch main` → `git merge feature/chart` → `git branch -d feature/chart`。',
      ],
      teach: [
        'rebase してから merge すると fast-forward になり、履歴が一直線に保たれます。「rebase して取り込む」と呼ばれる形です。',
        'cherry-pick でも同じ状態に持っていけます。コミットが1つなら手数はほぼ同じです。',
        'どちらが良いかはチームの方針次第です。マージコミットを残す形にも「いつ取り込んだか」が分かる利点があります。',
      ],
    },
    {
      id: 'exam-3',
      title: '自由練習',
      intro:
        '試験はここまでです。最後は自由に触る場所です。目標も手順もありません。\n' +
        '\n' +
        '壊しても大丈夫です。右上の ↻ でいつでも最初の状態に戻せます。\n' +
        '`git reset --hard` や `git rebase` のような、本番では緊張する操作をここで試しておくと度胸がつきます。\n' +
        '`help` で使えるコマンドの一覧、`git help <コマンド>` で個別の説明が出ます。\n' +
        '\n' +
        '一応の目標として、「10回コマンドを打つ」と「最後に status をきれいにする」の2つだけ置いてあります。',
      setup(repo) {
        seed(repo, `
          git init
          echo "# 練習帳" > README.md
          echo "ここは自由に書き換えてください" > memo.txt
          git add .
          git commit -m "初版"
          git commit --amend -m "初版"
        `);
      },
      goals: [
        {
          text: '何でもいいので、コマンドを10回実行する',
          check: (r, ctx) => ctx.history.length >= 10,
        },
        {
          text: '最後に git status をきれいにする（未追跡も残さない）',
          check: (r) => clean(r) && !status(r).untracked.length,
        },
      ],
      hints: [
        '思いつかないときは、ブランチを切って別々に編集し、わざと衝突させて解消してみてください。第5章の復習になります。',
        '`git reflog` を眺めると、自分がやったことが全部残っているのが分かります。消したつもりのコミットも辿れます。',
        '散らかしたら `git add -A` → `git commit`、または `git restore` と `git clean -f` で片付けられます。',
      ],
      teach: [
        'ここまでで、ふだんの開発で使うコマンドはひと通り触りました。あとは実際のリポジトリで手を動かすのがいちばん早く身につきます。',
        '本物の GitHub を触る第9章が残っています。トークンを用意すれば、PR とレビューまで通して体験できます。',
        '迷ったら「？ 逆引き」のチートシートから引いてください。やりたいことからコマンドを探せます。',
      ],
    },
  ],
};

export const CHAPTERS = [ch1, chCwd, ch2, ch3, ch4, ch5, ch6, chExam];

/** 全ステージを1本のリストに。 */
export const ALL_STAGES = CHAPTERS.flatMap((ch) =>
  ch.stages.map((s) => ({ ...s, chapterId: ch.id, chapterTitle: ch.title }))
);

export function findStage(id) {
  return ALL_STAGES.find((s) => s.id === id) || null;
}

export function stageIndex(id) {
  return ALL_STAGES.findIndex((s) => s.id === id);
}

/**
 * ステージの開始状態を作る。
 * @returns {{repo: object, ctx: object}}
 */
export function buildStage(stage) {
  const repo = createRepo();
  const ctx = { history: [], remote: null, rejectedPush: false };
  if (stage.setup) stage.setup(repo, ctx);
  return { repo, ctx };
}
