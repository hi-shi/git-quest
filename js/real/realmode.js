// 第8章「GitHub 実践」の画面。
// 擬似リポジトリではなく、本物の GitHub を相手にする。
// 各ステップで「対応する git コマンド」と「実際に呼ぶ API」を並べて見せるのが狙い。

import { GitHub, BRANCH_PREFIX, PATH_PREFIX, SafetyError } from './github.js';
import { getRealState, setRealState, clearRealState, resetRealProgress } from '../store.js';
import { markup } from '../ui/questview.js';

const DEFAULT_OWNER = 'hi-shi';
const DEFAULT_REPO = 'pasone';

/** 進行状況。ページを閉じても続きからできるように localStorage に置く。 */
function load() {
  const s = getRealState();
  return {
    token: s.token || '',
    owner: s.owner || DEFAULT_OWNER,
    repo: s.repo || DEFAULT_REPO,
    login: s.login || '',
    baseBranch: s.baseBranch || '',
    branch: s.branch || '',
    filePath: s.filePath || '',
    prNumber: s.prNumber || null,
    prUrl: s.prUrl || '',
    done: s.done || {},
  };
}

let logLines = [];

function log(text, kind) {
  logLines.push({ text, kind });
  if (logLines.length > 120) logLines = logLines.slice(-120);
  const el = document.getElementById('real-log');
  if (el) {
    renderLog(el);
    el.scrollTop = el.scrollHeight;
  }
}

function renderLog(el) {
  el.innerHTML = '';
  for (const l of logLines) {
    const d = document.createElement('div');
    if (l.kind) d.className = l.kind;
    d.textContent = l.text;
    el.appendChild(d);
  }
}

/**
 * `{owner}` `{repo}` を実際の値に置き換える。
 * プレースホルダのままだと「自分がどこを触っているのか」が結びつかないため。
 */
function realUrl(api, st) {
  const path = api
    .replace(/\{owner\}/g, st.owner || '{owner}')
    .replace(/\{repo\}/g, st.repo || '{repo}')
    .replace(/\{branch\}/g, st.branch || '{branch}')
    .replace(/\{number\}/g, st.prNumber || '{number}')
    .replace(/\{path\}/g, st.filePath || '{path}');
  // 「GET /user」のように メソッド + パス の形で書いてあるので、パス側だけ絶対 URL にする
  return path.replace(/(^|→ )(GET|POST|PUT|PATCH|DELETE) (\/\S*)/g, (m, lead, method, p) => {
    return `${lead}${method} https://api.github.com${p}`;
  });
}

/** ステップ定義。step.run が実際の API 操作。 */
function steps(st) {
  const today = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  return [
    {
      id: 'auth',
      title: 'トークンで本人確認する（Authenticate）',
      git: '（git では ~/.gitconfig や認証情報マネージャの役割）',
      api: 'GET /user',
      desc: 'まずトークンが有効かを確かめます。あなたの GitHub ログイン名が返ってくれば成功です。',
      label: '認証を確認する',
      async run(gh) {
        const login = await gh.me();
        const info = await gh.repoInfo();
        setRealState({ login, baseBranch: info.default_branch });
        log(`ログイン名: ${login}`, 'r-ok');
        log(`リポジトリ: ${info.full_name}（既定ブランチ: ${info.default_branch}）`, 'r-ok');
        return { login, baseBranch: info.default_branch };
      },
      isDone: (s) => !!s.login,
    },
    {
      id: 'branch',
      title: '作業ブランチを作る（Create a branch）',
      git: 'git switch -c quest/…',
      api: 'POST /repos/{owner}/{repo}/git/refs',
      desc: `既定ブランチの先端から、あなた専用の作業ブランチを生やします。安全のため名前は必ず ${BRANCH_PREFIX} で始まります。`,
      label: 'ブランチを作る',
      async run(gh, s) {
        const branch = `${BRANCH_PREFIX}${(s.login || 'you').toLowerCase()}-${today}`;
        try {
          await gh.createBranch(branch, s.baseBranch);
          log(`ブランチ ${branch} を作りました`, 'r-ok');
        } catch (e) {
          if (e.status === 422) {
            log(`ブランチ ${branch} は既にあるので、それを使います`, 'r-ok');
          } else throw e;
        }
        setRealState({ branch });
        return { branch };
      },
      isDone: (s) => !!s.branch,
    },
    {
      id: 'commit',
      title: 'ファイルを作ってコミットする（Commit）',
      git: 'git add → git commit → git push',
      api: 'PUT /repos/{owner}/{repo}/contents/{path}',
      desc: `GitHub の contents API は、この3つを1回でやってしまいます。書き込み先は ${PATH_PREFIX} 配下に限定しています。`,
      label: 'コミットする',
      async run(gh, s) {
        const path = `${PATH_PREFIX}${(s.login || 'you').toLowerCase()}.md`;
        const now = new Date().toLocaleString('ja-JP');
        const content = `# ${s.login} の練習ファイル\n\nGit Quest 第8章から作成しました。\n\n- 作成日時: ${now}\n- ブランチ: ${s.branch}\n`;
        const res = await gh.putFile({
          path,
          branch: s.branch,
          content,
          message: '練習: ファイルを追加',
        });
        setRealState({ filePath: path });
        log(`コミット ${res.commit.sha.slice(0, 7)} を作りました → ${path}`, 'r-ok');
        return { filePath: path };
      },
      isDone: (s) => !!s.filePath,
    },
    {
      id: 'log',
      title: '履歴を確認する（Commit history）',
      git: 'git log --oneline',
      api: 'GET /repos/{owner}/{repo}/commits?sha={branch}',
      desc: 'いま作ったコミットが本当に GitHub に届いているか、履歴を取って確かめます。',
      label: '履歴を取得する',
      async run(gh, s) {
        const commits = await gh.listCommits(s.branch, 5);
        log('--- git log --oneline 相当 ---');
        for (const c of commits) {
          log(`${c.sha.slice(0, 7)} ${c.commit.message.split('\n')[0]}`);
        }
        setRealState({ done: { ...s.done, log: true } });
        return {};
      },
      isDone: (s) => !!(s.done && s.done.log),
    },
    {
      id: 'pr',
      title: 'Pull Request を出す（Open a pull request）',
      git: '（git 本体には無い。GitHub 独自の機能）',
      api: 'POST /repos/{owner}/{repo}/pulls',
      desc: 'PR は「この枝を取り込んでください」という提案です。マージはまだ起きません。',
      label: 'PR を作る',
      async run(gh, s) {
        const existing = await gh.listPulls(s.branch);
        const open = existing.find((p) => p.state === 'open');
        if (open) {
          setRealState({ prNumber: open.number, prUrl: open.html_url });
          log(`既に PR #${open.number} があります: ${open.html_url}`, 'r-ok');
          return { prNumber: open.number, prUrl: open.html_url };
        }
        const pr = await gh.createPull({
          title: `練習: ${s.login} の Git Quest 第8章`,
          body:
            'Git Quest（学習アプリ）の第8章から作成した練習用の Pull Request です。\n\n' +
            `- ブランチ: \`${s.branch}\`\n- 追加ファイル: \`${s.filePath}\`\n`,
          head: s.branch,
          base: s.baseBranch,
        });
        setRealState({ prNumber: pr.number, prUrl: pr.html_url });
        log(`PR #${pr.number} を作りました: ${pr.html_url}`, 'r-ok');
        return { prNumber: pr.number, prUrl: pr.html_url };
      },
      isDone: (s) => !!s.prNumber,
    },
    {
      id: 'comment',
      title: 'PR にコメントする（Review comment）',
      git: '（GitHub 上のやりとり）',
      api: 'POST /repos/{owner}/{repo}/issues/{number}/comments',
      desc: 'レビューのやりとりはここで行われます。PR のコメントは issue コメントと同じ API です。',
      label: 'コメントを書く',
      async run(gh, s) {
        await gh.commentOnPull(
          s.prNumber,
          'Git Quest の練習コメントです。ここでレビューのやりとりをします。'
        );
        setRealState({ done: { ...s.done, comment: true } });
        log(`PR #${s.prNumber} にコメントしました`, 'r-ok');
        return {};
      },
      isDone: (s) => !!(s.done && s.done.comment),
      needsPr: true,
    },
    {
      id: 'merge',
      title: 'PR をマージして片付ける（Merge & delete branch）',
      git: 'git merge + git branch -d + git push --delete',
      api:
        'PUT /repos/{owner}/{repo}/pulls/{number}/merge → ' +
        'DELETE /repos/{owner}/{repo}/git/refs/heads/{branch}',
      desc: 'マージすると変更が既定ブランチに入ります。役目を終えたブランチは消しておくのが習慣です。',
      label: 'マージしてブランチを削除',
      confirm: (s) =>
        `PR #${s.prNumber} を ${s.baseBranch} にマージし、ブランチ ${s.branch} を削除します。\n本当に実行しますか？`,
      async run(gh, s) {
        await gh.mergePull(s.prNumber, 'squash');
        log(`PR #${s.prNumber} をマージしました`, 'r-ok');
        await gh.deleteBranch(s.branch);
        log(`ブランチ ${s.branch} を削除しました`, 'r-ok');
        setRealState({ done: { ...s.done, merge: true } });
        return {};
      },
      isDone: (s) => !!(s.done && s.done.merge),
      needsPr: true,
    },
  ];
}

// ---------------------------------------------------------------- 画面

export function renderRealMode(root, { onBack }) {
  const st = load();
  root.innerHTML = '';

  // --- 見出し
  const head = document.createElement('section');
  head.className = 'q-card';
  const h = document.createElement('h3');
  h.textContent = '第8章 GitHub 実践 — 本物のリポジトリを動かす';
  head.appendChild(h);
  const lead = document.createElement('p');
  lead.className = 'q-intro';
  lead.appendChild(
    markup(
      'ここまでは擬似リポジトリでした。この章では本物の GitHub API を呼びます。\n' +
        '各ステップに「対応する git コマンド」と「実際に呼ぶ API」を並べてあるので、見比べながら進めてください。'
    )
  );
  head.appendChild(lead);

  const logTip = document.createElement('p');
  logTip.className = 'fine';
  logTip.appendChild(
    markup('ボタンを押すと、実際に呼んだ URL と結果が「実行ログ」（ステップ一覧のすぐ上）に出ます。')
  );
  head.appendChild(logTip);
  root.appendChild(head);

  appendPrep(root);

  // --- 安全のための注意
  const warn = document.createElement('div');
  warn.className = 'warn-box';
  const warnTitle = document.createElement('strong');
  warnTitle.textContent = 'トークンの扱いについて';
  warn.appendChild(warnTitle);
  const ul = document.createElement('ul');
  ul.style.margin = '6px 0 0';
  ul.style.paddingLeft = '1.2em';
  for (const line of [
    'トークンはこの端末のブラウザ（localStorage）にだけ保存されます。共有端末では使わないでください。',
    'Fine-grained personal access token を作り、対象リポジトリを1つだけに絞ってください。',
    '権限は Contents / Pull requests / Issues の「Read and write」だけで足ります。',
    '有効期限は短め（7日など）にしておくと安心です。',
    `このアプリが書き込めるのは \`${BRANCH_PREFIX}\` で始まるブランチと \`${PATH_PREFIX}\` 配下のファイルだけです。既定ブランチや他のファイルには触れません。`,
  ]) {
    const li = document.createElement('li');
    li.appendChild(markup(line));
    ul.appendChild(li);
  }
  warn.appendChild(ul);
  root.appendChild(warn);

  // --- 接続設定
  const conf = document.createElement('section');
  conf.className = 'q-card';
  const ch = document.createElement('h3');
  ch.textContent = '接続設定';
  conf.appendChild(ch);

  const ownerInput = field(conf, 'オーナー（ユーザー名 or 組織名）', st.owner, 'hi-shi');
  const repoInput = field(conf, 'リポジトリ名', st.repo, 'pasone');
  const tokenInput = field(
    conf,
    'Personal Access Token',
    st.token,
    'github_pat_… または ghp_…',
    'password'
  );

  const help = document.createElement('p');
  help.className = 'fine';
  help.appendChild(
    markup(
      'トークンの作り方: GitHub の Settings → Developer settings → Personal access tokens → Fine-grained tokens → Generate new token'
    )
  );
  conf.appendChild(help);

  const confRow = document.createElement('div');
  confRow.className = 'q-actions';
  const saveBtn = document.createElement('button');
  saveBtn.className = 'primary-btn';
  saveBtn.textContent = '保存';
  saveBtn.addEventListener('click', () => {
    setRealState({
      owner: ownerInput.value.trim(),
      repo: repoInput.value.trim(),
      token: tokenInput.value.trim(),
    });
    log('接続設定を保存しました', 'r-ok');
    renderRealMode(root, { onBack });
  });
  confRow.appendChild(saveBtn);

  const forgetBtn = document.createElement('button');
  forgetBtn.className = 'ghost-btn';
  forgetBtn.textContent = 'トークンと進捗を消す';
  forgetBtn.addEventListener('click', () => {
    if (!confirm('保存したトークンと第8章の進捗を消します。よろしいですか？')) return;
    clearRealState();
    logLines = [];
    renderRealMode(root, { onBack });
  });
  confRow.appendChild(forgetBtn);
  conf.appendChild(confRow);
  root.appendChild(conf);

  // --- トークン未設定ならここで止める
  if (!st.token) {
    const locked = document.createElement('div');
    locked.className = 'locked';
    const big = document.createElement('div');
    big.className = 'big';
    big.textContent = '🔒';
    locked.appendChild(big);
    const p = document.createElement('p');
    p.textContent =
      'トークンを入力して保存すると、ここから先のステップが使えるようになります。第1〜7章はトークン無しで全部遊べます。';
    locked.appendChild(p);
    root.appendChild(locked);
    appendLog(root);
    appendBack(root, onBack);
    return;
  }

  // 実行ログはステップより前に置く。最後に置いていたときは存在に気づかれなかった。
  appendLog(root);

  // --- ステップ一覧
  const gh = new GitHub(st.token, st.owner, st.repo, (call) => {
    log(`${call.method} ${call.url} → ${call.ok ? 'OK' : 'NG'}${call.note ? ' : ' + call.note : ''}`,
      call.ok ? 'r-ok' : 'r-err');
  });

  const list = steps(st);
  list.forEach((step, i) => {
    const done = step.isDone(st);
    const prevDone = i === 0 || list[i - 1].isDone(st);

    const box = document.createElement('section');
    box.className = 'step' + (done ? ' done' : '');

    const sh = document.createElement('div');
    sh.className = 'step-head';
    const num = document.createElement('span');
    num.className = 'step-num';
    num.textContent = done ? '✓' : String(i + 1);
    sh.appendChild(num);
    sh.appendChild(document.createTextNode(step.title));
    box.appendChild(sh);

    const body = document.createElement('div');
    body.className = 'step-body';

    const map = document.createElement('div');
    map.className = 'api-map';
    const g = document.createElement('span');
    g.className = 'git-side';
    g.textContent = step.git;
    const arrow = document.createElement('span');
    arrow.className = 'arrow';
    arrow.textContent = '→';
    const a = document.createElement('span');
    a.className = 'api-side';
    a.textContent = step.api;
    map.append(g, arrow, a);
    body.appendChild(map);

    // プレースホルダを実際の値に展開したもの。押す前に「どこを触るのか」を見せる。
    const url = document.createElement('div');
    url.className = 'api-url';
    url.textContent = realUrl(step.api, st);
    body.appendChild(url);

    const d = document.createElement('p');
    d.style.margin = '0 0 10px';
    d.appendChild(markup(step.desc));
    body.appendChild(d);

    const btn = document.createElement('button');
    btn.className = done ? 'ghost-btn' : 'primary-btn';
    btn.textContent = done ? `${step.label}（もう一度）` : step.label;
    btn.disabled = !prevDone || (step.needsPr && !st.prNumber);
    btn.addEventListener('click', async () => {
      const current = load();
      if (step.confirm && !confirm(step.confirm(current))) return;
      btn.disabled = true;
      const original = btn.textContent;
      btn.textContent = '実行中…';
      try {
        await step.run(gh, current);
        renderRealMode(root, { onBack });
      } catch (e) {
        if (e instanceof SafetyError) log('安全チェックで停止: ' + e.message, 'r-err');
        else log('失敗: ' + e.message, 'r-err');
        btn.disabled = false;
        btn.textContent = original;
      }
    });
    body.appendChild(btn);

    box.appendChild(body);
    root.appendChild(box);
  });

  if (st.prUrl) {
    const link = document.createElement('p');
    link.style.margin = '4px 0 12px';
    const a = document.createElement('a');
    a.href = st.prUrl;
    a.target = '_blank';
    a.rel = 'noopener noreferrer';
    a.textContent = `作成した PR を GitHub で開く（#${st.prNumber}）`;
    a.style.color = 'var(--accent)';
    link.appendChild(a);
    root.appendChild(link);
  }

  appendRestart(root, onBack);
  appendPractice(root);
  appendBack(root, onBack);
}

function appendLog(root) {
  const wrap = document.createElement('section');
  wrap.className = 'q-card';
  const h = document.createElement('h3');
  h.textContent = '実行ログ（押したボタンが呼んだ URL がそのまま出ます）';
  wrap.appendChild(h);
  const log = document.createElement('div');
  log.className = 'real-log';
  log.id = 'real-log';
  renderLog(log);
  if (!logLines.length) log.textContent = '（まだ何も実行していません）';
  wrap.appendChild(log);
  root.appendChild(wrap);
}

function appendBack(root, onBack) {
  const row = document.createElement('div');
  row.className = 'q-actions';
  const b = document.createElement('button');
  b.className = 'ghost-btn';
  // 「クエストに戻る」だと直前に開いていた章（第7章など）に戻り、戻り先が分からなかった
  b.textContent = '章の一覧に戻る';
  b.addEventListener('click', onBack);
  row.appendChild(b);
  root.appendChild(row);
}

/** 練習用リポジトリの用意のしかた。既定の pasone が無い人はここで詰まる。 */
function appendPrep(root) {
  const wrap = document.createElement('details');
  wrap.className = 'q-card prep-box';
  const sum = document.createElement('summary');
  sum.textContent = '練習用のリポジトリを用意する（初めての人はここから）';
  wrap.appendChild(sum);

  const p = document.createElement('p');
  p.className = 'fine';
  p.appendChild(
    markup(
      'この章は本物のリポジトリに書き込みます。仕事のリポジトリではなく、' +
        '「練習用に新しく1つ作る」のがおすすめです。空のままだと API が失敗するので、README だけは入れてください。'
    )
  );
  wrap.appendChild(p);

  const ol = document.createElement('ol');
  ol.className = 'prep-steps';
  for (const line of [
    'GitHub の右上「＋」→ `New repository`（新しいリポジトリ）',
    '`Repository name`（リポジトリ名）に `git-quest-practice` など好きな名前を入れる',
    '`Public`（公開）／ `Private`（非公開）はどちらでも動きます。迷うなら `Private`',
    '`Add a README file`（README ファイルを追加）に 必ずチェックを入れる（空のリポジトリだとブランチが無く、API が失敗します）',
    '`Create repository`（リポジトリを作成）を押す',
    'できた URL `github.com/<オーナー>/<リポジトリ名>` の2つを、下の「接続設定」に入れる',
  ]) {
    const li = document.createElement('li');
    li.appendChild(markup(line));
    ol.appendChild(li);
  }
  wrap.appendChild(ol);

  const note = document.createElement('p');
  note.className = 'fine';
  note.appendChild(
    markup(
      'トークンを作るときは、`Repository access`（リポジトリへのアクセス）で ' +
        '`Only select repositories`（選択したリポジトリのみ）を選び、いま作ったリポジトリだけを指定してください。'
    )
  );
  wrap.appendChild(note);
  root.appendChild(wrap);
}

/** もう一度やり直すための導線。トークンは残す。 */
function appendRestart(root, onBack) {
  const wrap = document.createElement('section');
  wrap.className = 'q-card';
  const h = document.createElement('h3');
  h.textContent = 'もう一度やるには';
  wrap.appendChild(h);

  const p = document.createElement('p');
  p.className = 'fine';
  p.appendChild(
    markup(
      '進捗を消すと、ステップ1からやり直せます。トークンと接続設定は残るので入力し直す必要はありません。\n' +
        'ブランチ名には日付が入るので、日を改めれば新しいブランチと PR がもう一度作られます。' +
        '同じ日にやり直した場合は、前のブランチが残っていればそれを再利用します。'
    )
  );
  wrap.appendChild(p);

  const row = document.createElement('div');
  row.className = 'q-actions';
  const b = document.createElement('button');
  b.className = 'primary-btn';
  b.textContent = '第8章を最初からやり直す';
  b.addEventListener('click', () => {
    if (!confirm('第8章の進捗を消して、ステップ1からやり直します。\nトークンと接続設定は残ります。')) return;
    resetRealProgress();
    logLines = [];
    renderRealMode(root, { onBack });
  });
  row.appendChild(b);
  wrap.appendChild(row);
  root.appendChild(wrap);
}

/**
 * 「この章でやったことは実務のどこに当たるのか」。
 * API を直接叩く場面は限られるので、そこを正直に書いた上で実際の流れに繋ぐ。
 */
function appendPractice(root) {
  const wrap = document.createElement('details');
  wrap.className = 'q-card prep-box';
  const sum = document.createElement('summary');
  sum.textContent = 'これは実務のどこで使う？（API と、ふだんの PR の流れ）';
  wrap.appendChild(sum);

  const blocks = [
    [
      'GitHub API を手で叩くことは、ふだんはありません',
      [
        'ふだんの開発は `git` コマンドと GitHub の画面で完結します。この章で API を使ったのは、' +
          '画面のボタンの裏で何が起きているかを見せるためです。',
        'API が出てくるのは「人がやると手間な作業を自動化するとき」です。' +
          '例: CI/CD（GitHub Actions が PR の状態を読み書きする）、' +
          'PR を作ると Slack に通知する、Jira のチケットと PR を結びつける、' +
          '複数リポジトリに同じ設定ファイルを一括で配る、リリースノートを自動生成する、など。',
        'つまり、自分で書くことは少なくても、使っているツールは全部これを呼んでいます。' +
          'CI が落ちたときにログの API 呼び出しを読めると、原因に辿り着きやすくなります。',
      ],
    ],
    [
      'ふだんのチーム開発の流れ',
      [
        '1. 作業ブランチを切る（`git switch -c feature/…`）',
        '2. コミットして push する',
        '3. `Pull request`（プルリクエスト）を出す — この章の PR ステップに当たります',
        '4. レビュアーが見て `Approve`（承認）／ `Request changes`（変更を要求）を返す',
        '5. 指摘を直して push すると、PR に自動で反映される（PR を作り直す必要はありません）',
        '6. 承認と CI が揃ったらマージする',
        '7. 役目を終えたブランチを削除する',
      ],
    ],
    [
      'マージの3つの方式（GitHub のボタンの選択肢）',
      [
        '`Create a merge commit`（マージコミットを作る）… 履歴がそのまま残る。第5章の 3-way マージと同じ',
        '`Squash and merge`（まとめて1つに）… 作業中の細かいコミットを1つに潰す。この章ではこれを使っています',
        '`Rebase and merge`（つなぎ直す）… 第6章の rebase。履歴が一直線になる',
        'どれを使うかはチームの決まりごとです。迷ったら周りに合わせてください。',
      ],
    ],
    [
      'バックマージ（back merge）',
      [
        '自分の作業中に、`main` が他の人のマージで進んでしまうことがあります。' +
          'そのまま放置すると、いざマージするときに衝突がまとめて出ます。',
        'そこで「`main` の内容を自分の作業ブランチに取り込み直す」のがバックマージです。' +
          '向きが「main → 作業ブランチ」で、ふだんと逆なのでこの名前で呼ばれます。',
        'やり方は2つ。`git merge main`（履歴は増えるが安全）か `git rebase main`（履歴は綺麗だが、' +
          '共有済みブランチでやると他の人が困る）。GitHub の PR 画面の `Update branch` ボタンも同じことをします。',
        '衝突の直し方は第5章、rebase 中の `--continue` は第6章でやったとおりです。',
      ],
    ],
  ];

  for (const [title, lines] of blocks) {
    const h = document.createElement('h4');
    h.className = 'practice-h';
    h.textContent = title;
    wrap.appendChild(h);
    const ul = document.createElement('ul');
    ul.className = 'practice-list';
    for (const line of lines) {
      const li = document.createElement('li');
      li.appendChild(markup(line));
      ul.appendChild(li);
    }
    wrap.appendChild(ul);
  }
  root.appendChild(wrap);
}

function field(parent, label, value, placeholder, type = 'text') {
  const wrap = document.createElement('div');
  wrap.className = 'field';
  const l = document.createElement('label');
  l.textContent = label;
  wrap.appendChild(l);
  const input = document.createElement('input');
  input.type = type;
  input.value = value || '';
  input.placeholder = placeholder || '';
  input.autocomplete = type === 'password' ? 'off' : 'on';
  input.spellcheck = false;
  wrap.appendChild(input);
  parent.appendChild(wrap);
  return input;
}
