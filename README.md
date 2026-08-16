# Git Quest

git と GitHub のコマンド操作を、ステージ制のクエストで体に入れるための学習アプリです。
Android のブラウザで開いて「ホーム画面に追加」すると、アプリとして使えます（PWA）。

- **第1〜7章**: ブラウザの中に作った擬似 Git リポジトリを、実際にコマンドを打って動かします。オフラインで遊べます。
- **第8章**: 本物の GitHub リポジトリに対して、ブランチ作成 → コミット → Pull Request → マージまでを実行します。

コマンドを打つたびに **コミットグラフが動く** ので、`merge` と `rebase` の違いや
`reset --soft / --mixed / --hard` の効き方が目で見て分かります。

---

## 使ってみる

### スマホ（Android / iPhone）

1. アプリの URL をブラウザで開く
   （[合言葉つきで公開する](#合言葉つきで公開する)か、パソコンをつけっぱなしにしたくない場合以外は
   [スマホで使う（公開せずに）](#スマホで使う公開せずに)でも開けます）
2. メニューから「ホーム画面に追加」
3. ホーム画面のアイコンから起動すると、アドレスバーの無い全画面で動きます

一度開けば、あとは電波が無くても第1〜7章は遊べます（Service Worker がアプリを端末に置くため）。

### パソコンで動かす

`file://` で直接開くと ES モジュールが読めないので、簡単なサーバー越しに開きます。

```sh
python3 -m http.server 8000
# → http://localhost:8000 をブラウザで開く
```

`npm run serve` でも同じことができます。ビルドは不要です。

---

## 遊び方

画面下のタブで5つの画面を行き来します。

| タブ | 中身 |
| --- | --- |
| **>_ ターミナル** | コマンドを打つ場所。上の帯に「よく使うコマンド」が並ぶので、タップだけでも進められます |
| **⑂ グラフ** | コミットとブランチの図。打ったコマンドに合わせてその場で動きます |
| **▤ ファイル** | 「作業ツリー / ステージ / 直前のコミット」の3列比較。`add` と `commit` が何を動かすかが分かります |
| **◎ クエスト** | いまのステージの目標・ヒント・まとめ |
| **？ 逆引き** | やりたいこと → コマンドのチートシート。タップでコピーできます |

- 左上の **☰** でステージ一覧。クリア済みのステージにはいつでも戻れます
- 右上の **↻** でいまのステージをやり直し（何度失敗しても大丈夫です）
- 進捗はこの端末のブラウザにだけ保存されます

### 使えるコマンド

**git**: `init` `status` `add` `commit`（`-m` `-a` `--amend`）`log`（`--oneline` `--graph` `--all`）
`show` `diff`（`--staged`）`restore`（`--staged`）`reset`（`--soft` `--mixed` `--hard`）`revert` `clean`
`branch`（`-d` `-D` `-m` `-v`）`switch`（`-c`）`checkout`（`-b`）`merge`（`--no-ff` `--abort`）`tag`
`rebase`（`--onto` `--continue` `--abort`）`cherry-pick` `stash`（`push`/`pop`/`apply`/`list`/`drop`）
`remote`（`add` `rename` `-v`）`clone` `fetch`（`<remote> <src>:<dst>`）`pull`（`--rebase`）`push`（`-u` `--delete`）`config` `help`
`reflog`（消したコミットの救出）`rm`（`--cached`）

**シェル**: `cd` `pwd` `ls` `cat` `touch` `rm`（`-r`）`mv` `mkdir` `echo "x" > file`（`>>` で追記）`edit <file>` `clear`

git は「どこで打ったか」で結果が変わります。入力欄の上に現在地が常に出ていて、
「リポジトリのルート」「ルートの下」「リポジトリの外」が色で分かるようになっています。

`help` で一覧、`git help <コマンド>` で個別の説明（日本語）が出ます。
入力欄では **↑↓ で履歴**、**Tab で補完**（サブコマンド・ブランチ名・ファイル名）が使えます。

---

## 章立て

| 章 | 覚えること |
| --- | --- |
| 第1章 はじめの一歩 | `init` `add` `commit` `status` `log` — ステージという中継地点 |
| 第2章 いま どこにいるか | `pwd` `cd` `ls` — リポジトリのルートとサブディレクトリ、`git add .` の落とし穴 |
| 第3章 やり直しの術 | `diff` の読み方 / 2つの `diff` / `restore` / `reset` 3種 / `--amend` / `.gitignore` の落とし穴 / `reflog` で救出 |
| 第4章 ブランチ | `switch -c` / fast-forward と 3-way マージ / `branch -d` の安全装置 / detached HEAD からの救出 |
| 第5章 コンフリクト | 衝突を起こす → マーカーを消して解消 → `merge --abort` という逃げ道 |
| 第6章 歴史を整える | `rebase`（衝突時の `--continue`）/ `cherry-pick` / `stash` / `revert` |
| 第7章 リモート | `clone` / `fetch` と `pull` の違い / `push -u` / 拒否された push の直し方 / **origin の正体** / `fetch` の refspec |
| 第8章 GitHub 実践 | **基礎編**: 本物のリポジトリでブランチ → コミット → PR → コメント → マージ<br>**実務編**: レビュー（自分の PR は承認できない）/ main が進んだ状態の検知 / バックマージ / マージ3方式の選択 / CI が呼ぶ API |

第1〜7章で **37 ステージ**。すべて模範解答つきの自動テストで「本当にクリアできる」ことを検証しています。

---

## 第8章（本物の GitHub を触る）について

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
トークンを入れなくても、第1〜7章は全部遊べます。

---

## 開発

```sh
npm test          # エンジン・全ステージ・現在地・救出・ロックの自動テスト（205 件）
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
  shell.js       cd / ls / cat / echo > などのファイル操作
  paths.js       カレントディレクトリとリポジトリの位置（どこで打ったか）
  graph.js       コミット DAG のレーン割り当て
js/ui/         画面（ターミナル / グラフ / ファイル / クエスト / チートシート）
js/stages/     ステージ定義（データ駆動）
js/real/       第8章: GitHub REST クライアントと安全チェック
js/game.js     ステージ進行と目標判定
js/gate.js     公開ページ用の簡易ロック（gate-config.js に合言葉のハッシュ）
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

## スマホで使う（公開せずに）

Web に公開しなくても、同じ Wi-Fi につながっていればスマホから使えます。

**1. パソコンでこのフォルダを配信する**

```sh
python3 -m http.server 8000
```

**2. パソコンの IP アドレスを調べる**

```sh
# macOS
ipconfig getifaddr en0
# Linux
hostname -I | awk '{print $1}'
# Windows (PowerShell)
(Get-NetIPAddress -AddressFamily IPv4 -InterfaceAlias Wi-Fi).IPAddress
```

**3. スマホのブラウザで `http://<その IP>:8000` を開く**

例: `http://192.168.1.5:8000`

一度開くと Service Worker がアプリを端末に保存するので、
**そのあとはパソコンを切ってもオフラインで遊べます**（第8章を除く）。
ブラウザのメニューから「ホーム画面に追加」しておけば、アプリとして起動できます。

> この方法なら外部には一切公開されません。同じ Wi-Fi の中だけで完結します。

---

## 合言葉つきで公開する

GitHub Pages（無料）で公開しつつ、ページに簡易的なロックをかけられます。
パソコンをつけっぱなしにしなくてよいのが利点です。

### まず知っておいてほしいこと

このロックは **ブラウザの中だけで判定する「よそ見防止」** です。**本物の認証ではありません。**

- 合言葉そのものはコードに入っていません（PBKDF2 で 25 万回伸ばしたハッシュだけを置いています）が、
  **総当たりで試せば破れます**。短い・ありがちな合言葉ほど簡単に破れます
- **無料プランで Pages を使うにはリポジトリが public である必要があり、
  その場合アプリのソースは GitHub 上で誰でも読めます。**
  つまり「URL を踏んだ人にすぐ使われない」だけで、内容が秘密になるわけではありません
- 秘密にしたい情報は、絶対にこのアプリに入れないでください

「たまたま URL を知った人に使われたくない」「検索に出したくない」目的には十分です。
本当に人を絞りたいなら、Cloudflare Pages + Cloudflare Access（無料枠あり）など、
サーバー側で認証する仕組みを使ってください。

### 手順

**1. 合言葉を決める**

```sh
node tools/set-password.mjs
```

入力した文字は画面に出ません。合言葉そのものは保存されず、
`js/gate-config.js` にハッシュだけが書き込まれます。
ハッシュは公開されるので、**8文字以上で、辞書に無い文字列**にしてください。

ロック画面に出す案内文も付けられます（合言葉そのものは書かないこと）。

```sh
node tools/set-password.mjs --hint "いつもの合言葉です"
```

**2. リポジトリを public にする**

Settings → Danger Zone → Change repository visibility → Public

（無料プランでは private リポジトリの Pages が使えないためです）

**3. Pages を有効にする**

Settings → Pages → Source を **GitHub Actions** に

**4. push する**

```sh
git add js/gate-config.js
git commit -m "ロックの合言葉を設定"
git push
```

`main` に push すると自動で公開されます。
公開先は `https://<ユーザー名>.github.io/git-quest/` です。

スマホでその URL を開くと合言葉を聞かれ、一度入れれば同じ端末では覚えています。
「ホーム画面に追加」すればアプリとして起動できます。

### ロックを外す・止める

```sh
node tools/set-password.mjs --off    # ロックを外す（ハッシュも消える）
```

公開そのものを止めるなら Settings → Pages で Source を **None** に戻します。
`.github/workflows/pages.yml` の `on:` から `push:` の2行を消せば、
手動実行（Actions タブの Run workflow）のときだけ公開されるようになります。

### アプリの更新

新しい版を公開すると、開いている端末に「新しい版があります ［更新］」のバーが出ます。
**押すまで勝手にリロードはしません**（作業中に飛ぶと困るため）。「あとで」で閉じられます。

`sw.js` を変更したときは `CACHE` の値も上げてください。これが更新の目印になります。

### 検索避け

`robots.txt` と `<meta name="robots" content="noindex, nofollow">` を入れてあるので、
検索エンジンには載りません（行儀の良いクローラーに対してのみ有効です）。

---

## ライセンス

MIT
