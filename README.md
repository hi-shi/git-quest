# Git Quest

git と GitHub のコマンド操作を、ステージ制のクエストで体に入れるための学習アプリです。
Android のブラウザで開いて「ホーム画面に追加」すると、アプリとして使えます（PWA）。

- **第1〜6章**: ブラウザの中に作った擬似 Git リポジトリを、実際にコマンドを打って動かします。オフラインで遊べます。
- **第7章**: 本物の GitHub リポジトリに対して、ブランチ作成 → コミット → Pull Request → マージまでを実行します。

コマンドを打つたびに **コミットグラフが動く** ので、`merge` と `rebase` の違いや
`reset --soft / --mixed / --hard` の効き方が目で見て分かります。

> **置き場所について**
> このアプリは専用リポジトリのルートに置かれる前提で書かれています。
> いまは `hi-shi/pasone` の `git-quest/` 配下にあるので、専用リポジトリへ移す手順を
> [専用リポジトリへ移す](#専用リポジトリへ移す) に書いてあります。
> 下のコマンド例は移したあと（＝アプリがルートにある状態）のものです。

---

## 使ってみる

### スマホ（Android / iPhone）

1. 公開 URL をブラウザで開く（下の「GitHub Pages で公開する」を参照）
2. メニューから「ホーム画面に追加」
3. ホーム画面のアイコンから起動すると、アドレスバーの無い全画面で動きます

一度開けば、あとは電波が無くても第1〜6章は遊べます（Service Worker がアプリを端末に置くため）。

### パソコンで動かす

`file://` で直接開くと ES モジュールが読めないので、簡単なサーバー越しに開きます。

```sh
python3 -m http.server 8000
# → http://localhost:8000 をブラウザで開く
```

`npm run serve` でも同じことができます。ビルドは不要です。

---

## 遊び方

画面下のタブで4つの画面を行き来します。

| タブ | 中身 |
| --- | --- |
| **ターミナル** | コマンドを打つ場所。上の帯に「よく使うコマンド」が並ぶので、タップだけでも進められます |
| **グラフ** | コミットとブランチの図。打ったコマンドに合わせてその場で動きます |
| **ファイル** | 「作業ツリー / ステージ / 直前のコミット」の3列比較。`add` と `commit` が何を動かすかが分かります |
| **クエスト** | いまのステージの目標・ヒント・まとめ |

- 左上の **☰** でステージ一覧。クリア済みのステージにはいつでも戻れます
- 右上の **↻** でいまのステージをやり直し（何度失敗しても大丈夫です）
- 進捗はこの端末のブラウザにだけ保存されます

### 使えるコマンド

**git**: `init` `status` `add` `commit`（`-m` `-a` `--amend`）`log`（`--oneline` `--graph` `--all`）
`show` `diff`（`--staged`）`restore`（`--staged`）`reset`（`--soft` `--mixed` `--hard`）`revert` `clean`
`branch`（`-d` `-D` `-m` `-v`）`switch`（`-c`）`checkout`（`-b`）`merge`（`--no-ff` `--abort`）`tag`
`rebase`（`--onto` `--continue` `--abort`）`cherry-pick` `stash`（`push`/`pop`/`apply`/`list`/`drop`）
`remote`（`add` `-v`）`clone` `fetch` `pull`（`--rebase`）`push`（`-u` `--delete`）`config` `help`

**シェル**: `ls` `cat` `touch` `rm` `mv` `mkdir` `echo "x" > file`（`>>` で追記）`edit <file>` `clear`

`help` で一覧、`git help <コマンド>` で個別の説明（日本語）が出ます。
入力欄では **↑↓ で履歴**、**Tab で補完**（サブコマンド・ブランチ名・ファイル名）が使えます。

---

## 章立て

| 章 | 覚えること |
| --- | --- |
| 第1章 はじめの一歩 | `init` `add` `commit` `status` `log` — ステージという中継地点 |
| 第2章 やり直しの術 | 2つの `diff` / `restore` / `reset` 3種の違い / `--amend` / `.gitignore` |
| 第3章 ブランチ | `switch -c` / fast-forward と 3-way マージ / `branch -d` の安全装置 |
| 第4章 コンフリクト | 衝突を起こす → マーカーを消して解消 → `merge --abort` という逃げ道 |
| 第5章 歴史を整える | `rebase`（衝突時の `--continue`）/ `cherry-pick` / `stash` / `revert` |
| 第6章 リモート | `clone` / `fetch` と `pull` の違い / `push -u` / 拒否された push の直し方 |
| 第7章 GitHub 実践 | 本物のリポジトリでブランチ → コミット → PR → コメント → マージ |

第1〜6章で **24 ステージ**。すべて模範解答つきの自動テストで「本当にクリアできる」ことを検証しています。

---

## 第7章（本物の GitHub を触る）について

この章だけは実際の GitHub API を呼びます。使うにはアクセストークンが要ります。

### トークンの作り方

1. GitHub → Settings → Developer settings → Personal access tokens → **Fine-grained tokens**
2. **Repository access** で、対象を **このリポジトリ1つだけ** に絞る
3. **Permissions** は次の3つを **Read and write** にするだけで足ります
   - Contents
   - Pull requests
   - Issues
4. 有効期限は短め（7日など）にしておくと安心です

作ったトークンをアプリの「接続設定」に入れて保存します。

### 安全のための制限

本物のリポジトリを触るので、アプリ側で書き込める範囲を機械的に制限しています。

- 書き込めるブランチは **`quest/` で始まるものだけ**
- 書き込めるファイルは **`git-quest-playground/` 配下だけ**
- 既定ブランチ（`main` など）や他のファイルには一切書き込みません
- force push に相当する操作は実装していません
- マージとブランチ削除の前には確認ダイアログが出ます

この制限は `js/real/github.js` の `assertWritableBranch` / `assertWritablePath` で強制しています。

**トークンの保管について**: トークンはこの端末のブラウザ（localStorage）にだけ保存されます。
共有端末では使わないでください。画面の「トークンと進捗を消す」でいつでも削除できます。
トークンを入れなくても、第1〜6章は全部遊べます。

---

## 開発

```sh
npm test          # 擬似 Git エンジンと全ステージの自動テスト（127 件）
npm run icons     # アイコン PNG を再生成
npm run serve     # ローカルで開く
```

ビルドツールも依存パッケージもありません。素の ES モジュールと CSS だけです。

### 構成

```
js/engine/     擬似 Git の本体（ブラウザにも node にも依存しない純粋な JS）
  repo.js        データモデル: objects / refs / HEAD / index / workdir
  diff.js        行単位の diff と 3-way マージ
  parser.js      コマンド行 → argv
  commands.js    git サブコマンドの実装
  shell.js       ls / cat / echo > などのファイル操作
  graph.js       コミット DAG のレーン割り当て
js/ui/         画面（ターミナル / グラフ / ファイル / クエスト）
js/stages/     ステージ定義（データ駆動）
js/real/       第7章: GitHub REST クライアントと安全チェック
js/game.js     ステージ進行と目標判定
test/          node --test（外部依存なし）
```

### ステージを足すには

`js/stages/index.js` に定義を足し、`test/stages.test.js` の `SOLUTIONS` に模範解答を書きます。
解答を書かないとテストが落ちるので、「クリアできないステージ」が紛れ込みません。

```js
{
  id: 'ch3-5',
  title: 'ステージ名',
  intro: '状況の説明',
  setup(repo) { seed(repo, `git init\n…`); },   // 開始状態をコマンドで組み立てる
  goals: [{ text: '達成すること', check: (repo, ctx) => /* 判定 */ }],
  hints: ['段階的なヒント', '…'],
  teach: ['クリア後に見せるまとめ'],
  wantedCommands: [/^git …/],                    // 想定した解法（別解でもクリアはできる）
}
```

---

## 専用リポジトリへ移す

いまは `hi-shi/pasone` の `git-quest/` 配下にありますが、
アプリ本体がルートに来る専用リポジトリに移すと、Pages の公開 URL が
`https://<ユーザー名>.github.io/git-quest/` と素直になり、
同梱のワークフローもそのまま動きます。

**1. GitHub で空のリポジトリを作る**

[新規リポジトリ作成ページ](https://github.com/new)で `git-quest` という名前で作ります。
**README も .gitignore も追加しない**（空のまま）でください。

**2. 手元で次を実行する**

```sh
git clone --branch claude/git-github-learning-game-yl0pi2 \
  https://github.com/hi-shi/pasone.git git-quest-move
cd git-quest-move

# git-quest/ の中身だけを取り出して main ブランチにする
git subtree split --prefix=git-quest -b main
git checkout main

# 新しいリポジトリに送る
git remote set-url origin https://github.com/hi-shi/git-quest.git
git push -u origin main
```

`git subtree split` はコミット履歴を保ったまま、
サブディレクトリの中身をリポジトリのルートに引き上げてくれます。
`.github/workflows/pages.yml` も `git-quest/.github/` に置いてあるので一緒に移動します。

**3. 動作を確認する**

```sh
npm test                  # 127 件通ればOK
python3 -m http.server 8000
```

そのあと下の「GitHub Pages で公開する」に進みます。

---

## GitHub Pages で公開する

`.github/workflows/pages.yml` が入っているので、リポジトリ設定を1回変えるだけで公開できます。

1. リポジトリの **Settings → Pages** を開く
2. **Source** を **GitHub Actions** にする
3. 既定ブランチに push すると自動で公開されます

公開先は `https://<ユーザー名>.github.io/git-quest/` です。

> **private リポジトリの場合**
> GitHub Pages を private リポジトリで使うには有料プラン（Pro / Team 以上）が必要です。
> 無料プランなら、リポジトリを public にするか、
> Pages を使わずに手元で `python3 -m http.server` して同じ Wi-Fi のスマホから
> `http://<パソコンのIP>:8000` で開く手もあります。

---

## ライセンス

MIT
