// 第7章「GitHub 実践」の画面。
// 擬似リポジトリではなく、本物の GitHub を相手にする。
// 各ステップで「対応する git コマンド」と「実際に呼ぶ API」を並べて見せるのが狙い。

import { GitHub, BRANCH_PREFIX, PATH_PREFIX, SafetyError } from './github.js';
import { getRealState, setRealState, clearRealState } from '../store.js';
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

/** ステップ定義。step.run が実際の API 操作。 */
function steps(st) {
  const today = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  return [
    {
      id: 'auth',
      title: 'トークンで本人確認する',
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
      title: '作業ブランチを作る',
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
      title: 'ファイルを作ってコミットする',
      git: 'git add → git commit → git push',
      api: 'PUT /repos/{owner}/{repo}/contents/{path}',
      desc: `GitHub の contents API は、この3つを1回でやってしまいます。書き込み先は ${PATH_PREFIX} 配下に限定しています。`,
      label: 'コミットする',
      async run(gh, s) {
        const path = `${PATH_PREFIX}${(s.login || 'you').toLowerCase()}.md`;
        const now = new Date().toLocaleString('ja-JP');
        const content = `# ${s.login} の練習ファイル\n\nGit Quest 第7章から作成しました。\n\n- 作成日時: ${now}\n- ブランチ: ${s.branch}\n`;
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
      title: '履歴を確認する',
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
      title: 'Pull Request を出す',
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
          title: `練習: ${s.login} の Git Quest 第7章`,
          body:
            'Git Quest（学習アプリ）の第7章から作成した練習用の Pull Request です。\n\n' +
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
      title: 'PR にコメントする',
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
      title: 'PR をマージして片付ける',
      git: 'git merge + git branch -d + git push --delete',
      api: 'PUT /pulls/{number}/merge → DELETE /git/refs/heads/{branch}',
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
  h.textContent = '第7章 GitHub 実践 — 本物のリポジトリを動かす';
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
  root.appendChild(head);

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
    if (!confirm('保存したトークンと第7章の進捗を消します。よろしいですか？')) return;
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
      'トークンを入力して保存すると、ここから先のステップが使えるようになります。第1〜6章はトークン無しで全部遊べます。';
    locked.appendChild(p);
    root.appendChild(locked);
    appendLog(root);
    appendBack(root, onBack);
    return;
  }

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

  appendLog(root);
  appendBack(root, onBack);
}

function appendLog(root) {
  const wrap = document.createElement('section');
  wrap.className = 'q-card';
  const h = document.createElement('h3');
  h.textContent = '実行ログ（呼んだ API がそのまま出ます）';
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
  b.textContent = 'クエストに戻る';
  b.addEventListener('click', onBack);
  row.appendChild(b);
  root.appendChild(row);
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
