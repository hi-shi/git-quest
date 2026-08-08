// 逆引きチートシート。
//
// 「やりたいこと」から引ける形にしてある。コマンド名を覚えていなくても、
// 困っている状況から辿り着けることを優先した。
// 学び終わったあとも開く価値のある画面にするのが狙い。

import { markup } from './questview.js';

/**
 * item: {want: やりたいこと, cmd: コマンド, note?: 補足, danger?: 取り返しがつかない}
 */
export const SECTIONS = [
  {
    title: '今どこにいるか確かめる',
    intro: 'git は「どこで打ったか」で結果が変わります。迷ったらまずこれ。',
    items: [
      { want: '今いるフォルダを知りたい', cmd: 'pwd' },
      { want: 'リポジトリの状態を知りたい', cmd: 'git status', note: '困ったら必ずこれ。何が起きているか全部書いてある' },
      { want: 'どのブランチにいるか知りたい', cmd: 'git branch', note: '`*` が今いるブランチ' },
      {
        want: '`not a git repository` と言われた',
        cmd: 'pwd',
        note: 'コマンドではなく居場所の問題。リポジトリの外にいる',
      },
    ],
  },
  {
    title: '記録する',
    items: [
      { want: 'このフォルダを git で管理したい', cmd: 'git init', note: '新規プロジェクトのときだけ。既存リポジトリの中では打たない' },
      { want: '変更をコミットしたい', cmd: 'git add .\ngit commit -m "何をしたか"' },
      { want: '一部のファイルだけコミットしたい', cmd: 'git add <file>' },
      {
        want: 'サブフォルダにいるけど全部入れたい',
        cmd: 'git add -A',
        note: '`.` は今いる場所より下だけ。`-A` はリポジトリ全体',
      },
      { want: '何が変わったか見たい', cmd: 'git diff', note: 'まだ add していない分。add 済みは `git diff --staged`' },
      { want: '履歴を見たい', cmd: 'git log --oneline --graph --all' },
    ],
  },
  {
    title: '間違えた・戻したい',
    intro: 'まだコミットしていないか、もうコミットしたかで手が変わります。',
    items: [
      { want: 'add したのを取り消したい', cmd: 'git restore --staged <file>', note: 'ファイルの中身は無事' },
      {
        want: 'ファイルの編集を捨てたい',
        cmd: 'git restore <file>',
        note: '編集内容は戻せない',
        danger: true,
      },
      { want: '直前のコミットにファイルを足したい', cmd: 'git add <file>\ngit commit --amend --no-edit' },
      { want: 'コミットメッセージを直したい', cmd: 'git commit --amend -m "新しいメッセージ"', note: 'push 済みなら使わない' },
      { want: 'コミットを取り消してやり直したい', cmd: 'git reset --soft HEAD~1', note: '変更はステージに残る' },
      { want: 'コミットも変更も全部捨てたい', cmd: 'git reset --hard HEAD~1', note: 'reflog から救えることが多い', danger: true },
      {
        want: '共有済みのコミットを打ち消したい',
        cmd: 'git revert <sha>',
        note: '歴史を消さずに逆の変更を積む。チーム作業ではこちら',
      },
    ],
  },
  {
    title: '消えた・迷子になった',
    intro: 'コミットさえしてあれば、たいてい取り戻せます。',
    items: [
      { want: 'reset --hard で消したコミットを戻したい', cmd: 'git reflog\ngit reset --hard HEAD@{1}' },
      { want: '消したブランチのコミットを救いたい', cmd: 'git reflog\ngit switch -c rescue <sha>' },
      { want: '`detached HEAD` と言われた', cmd: 'git switch -c <名前>', note: '今の場所にブランチを付けて救う。見るだけなら `git switch main` で戻ればよい' },
      { want: 'とにかく今の状態を保存したい', cmd: 'git add -A\ngit commit -m "WIP"', note: 'コミットしておけば reflog で救える' },
    ],
  },
  {
    title: 'ブランチ',
    items: [
      { want: '新しいブランチを作って移りたい', cmd: 'git switch -c <名前>' },
      { want: '既存のブランチに移りたい', cmd: 'git switch <名前>' },
      { want: '別のブランチの変更を取り込みたい', cmd: 'git merge <ブランチ>', note: '取り込む側に居ることを確認してから' },
      { want: '自分の作業を最新の上に載せ直したい', cmd: 'git rebase main', note: '共有済みのブランチではやらない' },
      { want: 'あのコミットだけ欲しい', cmd: 'git cherry-pick <sha>' },
      { want: '終わったブランチを消したい', cmd: 'git branch -d <名前>', note: '未マージなら止めてくれる' },
    ],
  },
  {
    title: 'コンフリクト',
    items: [
      { want: 'どのファイルが衝突したか', cmd: 'git status' },
      { want: '直したので続けたい（merge 中）', cmd: 'git add <file>\ngit commit' },
      { want: '直したので続けたい（rebase 中）', cmd: 'git add <file>\ngit rebase --continue', note: 'rebase は commit ではなく --continue' },
      { want: 'やめて元に戻したい', cmd: 'git merge --abort', note: 'rebase 中なら `git rebase --abort`' },
    ],
  },
  {
    title: 'origin とリモート',
    intro: '`origin` は URL に付けたあだ名です。git の予約語ではありません。',
    items: [
      { want: 'どの URL と繋がっているか知りたい', cmd: 'git remote -v', note: 'あだ名 → URL の対応表' },
      { want: 'リモートを登録したい', cmd: 'git remote add origin <url>', note: 'origin 以外の名前でもよい' },
      { want: 'あだ名を変えたい', cmd: 'git remote rename origin upstream' },
      {
        want: '`main` と `origin/main` の違いは？',
        cmd: 'git log --oneline --all',
        note: '`main` は自分のブランチ。`origin/main` は最後に fetch したときのリモートの位置を覚えた付箋',
      },
      { want: 'リモートのブランチ一覧を見たい', cmd: 'git branch -a' },
    ],
  },
  {
    title: '共有する',
    items: [
      { want: 'リモートを取ってきたい', cmd: 'git clone <url>' },
      { want: '送りたい（初回）', cmd: 'git push -u origin <ブランチ>' },
      { want: '送りたい（2回目以降）', cmd: 'git push' },
      { want: '最新を取り込みたい', cmd: 'git pull', note: '中身は fetch + merge' },
      { want: '取ってくるだけ、まだ取り込まない', cmd: 'git fetch', note: '`origin/*` だけ動く。ローカルのブランチも作業ツリーも無事' },
      { want: '特定のブランチだけ取ってきたい', cmd: 'git fetch origin <branch>', note: '`origin/<branch>` が更新される' },
      {
        want: '切り替えずに別ブランチを最新にしたい',
        cmd: 'git fetch origin <src>:<dst>',
        note: 'リモートの `<src>` をローカルの `<dst>` に直接書き込む。今いるブランチには使えない',
      },
      { want: 'fetch したものを取り込みたい', cmd: 'git merge origin/<branch>', note: '`git pull` = fetch + merge' },
      {
        want: 'push が rejected された',
        cmd: 'git pull\ngit push',
        note: 'リモートに自分の知らないコミットがある。`--force` は使わない',
      },
    ],
  },
  {
    title: 'いろいろ',
    items: [
      { want: '作業を一時的に退避したい', cmd: 'git stash', note: '戻すのは `git stash pop`' },
      { want: 'ファイルを無視したい', cmd: 'echo "<file>" >> .gitignore' },
      {
        want: '既にコミット済みのファイルを無視したい',
        cmd: 'git rm --cached <file>',
        note: '.gitignore だけでは効かない。--cached を忘れるとファイルごと消える',
      },
      { want: 'コマンドの意味を知りたい', cmd: 'git help <コマンド>' },
    ],
  },
];

export function renderCheatsheet(root, { onBack }) {
  root.innerHTML = '';

  const head = document.createElement('section');
  head.className = 'q-card';
  const h = document.createElement('h3');
  h.textContent = '逆引きチートシート';
  head.appendChild(h);
  const lead = document.createElement('p');
  lead.className = 'q-intro';
  lead.textContent =
    'コマンド名ではなく「やりたいこと」から引けます。行をタップするとコマンドをコピーできます。';
  head.appendChild(lead);
  root.appendChild(head);

  for (const section of SECTIONS) {
    const card = document.createElement('section');
    card.className = 'q-card';

    const title = document.createElement('h3');
    title.textContent = section.title;
    card.appendChild(title);

    if (section.intro) {
      const intro = document.createElement('p');
      intro.className = 'cs-intro';
      intro.textContent = section.intro;
      card.appendChild(intro);
    }

    for (const item of section.items) {
      const row = document.createElement('button');
      row.type = 'button';
      row.className = 'cs-row' + (item.danger ? ' danger' : '');

      const want = document.createElement('div');
      want.className = 'cs-want';
      want.appendChild(markup(item.want)); // `...` を code として出す
      row.appendChild(want);

      const cmd = document.createElement('div');
      cmd.className = 'cs-cmd';
      cmd.textContent = item.cmd;
      row.appendChild(cmd);

      if (item.note) {
        const note = document.createElement('div');
        note.className = 'cs-note';
        note.appendChild(markup(item.note));
        row.appendChild(note);
      }

      const copied = document.createElement('span');
      copied.className = 'cs-copied';
      copied.textContent = 'コピーしました';
      copied.hidden = true;
      row.appendChild(copied);

      row.addEventListener('click', async () => {
        try {
          await navigator.clipboard.writeText(item.cmd);
          copied.hidden = false;
          setTimeout(() => (copied.hidden = true), 1400);
        } catch {
          // クリップボードが使えない環境もある。その場合は選択できる形で出す
          copied.textContent = 'コピーできませんでした（長押しで選択してください）';
          copied.hidden = false;
          setTimeout(() => {
            copied.hidden = true;
            copied.textContent = 'コピーしました';
          }, 2200);
        }
      });

      card.appendChild(row);
    }
    root.appendChild(card);
  }

  const foot = document.createElement('div');
  foot.className = 'q-actions';
  const back = document.createElement('button');
  back.className = 'ghost-btn';
  back.textContent = 'クエストに戻る';
  back.addEventListener('click', onBack);
  foot.appendChild(back);
  root.appendChild(foot);
}
