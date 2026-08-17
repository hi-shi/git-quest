// 第9章「GitHub 実践」の画面。
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
    // 実務編
    wBranch: s.wBranch || '',
    wPr: s.wPr || null,
    wPrUrl: s.wPrUrl || '',
    wMatePr: s.wMatePr || null,
    wBehind: s.wBehind === undefined ? null : s.wBehind,
    wBackmerged: !!s.wBackmerged,
    wReviewed: !!s.wReviewed,
    wMerged: s.wMerged || '',
    wSawCi: !!s.wSawCi,
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
function realUrl(api, st, vars) {
  const table = {
    owner: st.owner,
    repo: st.repo,
    branch: st.branch,
    number: st.prNumber,
    path: st.filePath,
    base: st.baseBranch,
    ...(vars || {}), // 実務編は自分のブランチ・PR 番号で上書きする
  };
  const path = api.replace(/\{(\w+)\}/g, (m, key) => table[key] || m);
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
        const content = `# ${s.login} の練習ファイル\n\nGit Quest 第9章から作成しました。\n\n- 作成日時: ${now}\n- ブランチ: ${s.branch}\n`;
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
          title: `練習: ${s.login} の Git Quest 第9章`,
          body:
            'Git Quest（学習アプリ）の第9章から作成した練習用の Pull Request です。\n\n' +
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

/**
 * 実務編。チームでの流れ（PR → レビュー → バックマージ → 方式を選んでマージ）を
 * 読み物ではなく実際に動かしてなぞる。同僚役のブランチもこちらで作るので、
 * ひとりでも「main が進んでしまった」状況を再現できる。
 */
function workSteps(st) {
  const today = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const who = (st.login || 'you').toLowerCase();
  const mine = `${BRANCH_PREFIX}${who}-work-${today}`;
  const mate = `${BRANCH_PREFIX}${who}-teammate-${today}`;

  return [
    {
      id: 'w-branch',
      title: '自分の作業を始める（Feature branch → Pull request）',
      git: 'git switch -c → commit → push → PR',
      api: 'POST /repos/{owner}/{repo}/pulls',
      desc:
        'ふだんの作業の入り口です。作業ブランチを切って、ファイルを1つ足して、PR を出すところまでを一気にやります。ここは基礎編でやったことの繰り返しなので、まとめて実行します。',
      label: 'ブランチとPRを作る',
      async run(gh, s) {
        await ensureBranch(gh, mine, s.baseBranch);
        const path = `${PATH_PREFIX}${who}-work.md`;
        await gh.putFile({
          path,
          branch: mine,
          content: `# ${s.login} の作業\n\n実務編で作ったファイルです。\n`,
          message: '作業: ファイルを追加',
        });
        const pr = await ensurePull(gh, {
          title: `実務編: ${s.login} の作業`,
          body: 'Git Quest 実務編。レビューとバックマージを練習するための PR です。',
          head: mine,
          base: s.baseBranch,
        });
        setRealState({ wBranch: mine, wPr: pr.number, wPrUrl: pr.html_url });
        log(`作業ブランチ ${mine} と PR #${pr.number} を用意しました`, 'r-ok');
        return {};
      },
      isDone: (s) => !!s.wPr,
      needsAuth: true,
    },
    {
      id: 'w-mate',
      title: 'その間に main が進む（同僚のマージ）',
      git: '（他の人が作業してマージした状態）',
      api: 'PUT /repos/{owner}/{repo}/pulls/{number}/merge',
      desc:
        'あなたがレビューを待っている間に、同僚の PR が先にマージされました。ここでは同僚役のブランチを作り、PR を出して、マージするところまでを自動でやります。これで既定ブランチがあなたの作業より先に進みます。',
      label: '同僚の変更をマージする',
      async run(gh, s) {
        await ensureBranch(gh, mate, s.baseBranch);
        const path = `${PATH_PREFIX}${who}-teammate.md`;
        await gh.putFile({
          path,
          branch: mate,
          content: `# 同僚の作業\n\n実務編で「main が進んだ」状況を作るためのファイルです。\n`,
          message: '同僚: ファイルを追加',
        });
        const pr = await ensurePull(gh, {
          title: `実務編: 同僚の作業（${s.login}）`,
          body: 'Git Quest 実務編。main を進めるための PR です。',
          head: mate,
          base: s.baseBranch,
        });
        await gh.mergePull(pr.number, 'squash');
        log(`同僚の PR #${pr.number} をマージしました → ${s.baseBranch} が進みました`, 'r-ok');
        await gh.deleteBranch(mate).catch(() => {});
        setRealState({ wMatePr: pr.number });
        return {};
      },
      isDone: (s) => !!s.wMatePr,
      needsWorkPr: true,
    },
    {
      id: 'w-behind',
      title: '自分の PR が遅れたことを確かめる（out-of-date）',
      git: 'git fetch → git log main..HEAD / HEAD..main',
      api: 'GET /repos/{owner}/{repo}/compare/{base}...{branch}',
      vars: { branch: st.wBranch || mine },
      desc:
        'PR 画面に「This branch is out-of-date with the base branch」と出るのがこの状態です。compare API は、2つのブランチがどれだけ進んでいる／遅れているかをそのまま返します。',
      label: '進み具合を調べる',
      async run(gh, s) {
        const c = await gh.compare(s.baseBranch, s.wBranch);
        log(`--- ${s.baseBranch} と ${s.wBranch} の比較 ---`);
        log(`あなたの方が進んでいる分（ahead_by）: ${c.ahead_by} コミット`);
        log(`あなたが遅れている分（behind_by）: ${c.behind_by} コミット`, c.behind_by ? 'r-err' : 'r-ok');
        if (c.behind_by > 0) {
          log('→ 同僚のマージ分だけ遅れています。この状態が「バックマージが要る」合図です。');
        }
        setRealState({ wBehind: c.behind_by });
        return {};
      },
      isDone: (s) => s.wBehind !== null && s.wBehind !== undefined,
      needsWorkPr: true,
    },
    {
      id: 'w-backmerge',
      title: 'バックマージする（Update branch）',
      git: 'git switch <作業ブランチ> → git merge main',
      api: 'POST /repos/{owner}/{repo}/merges',
      vars: { branch: st.wBranch || mine },
      desc:
        '既定ブランチの内容を、自分の作業ブランチに取り込み直します。向きが「main → 作業ブランチ」でふだんと逆なので、バックマージと呼ばれます。PR 画面の Update branch ボタンと同じ操作です。取り込んだあと、もう一度 compare して遅れが消えたことを確かめます。',
      label: 'main を取り込む',
      async run(gh, s) {
        try {
          await gh.mergeIntoBranch(s.wBranch, s.baseBranch, `Merge ${s.baseBranch} into ${s.wBranch}`);
          log(`${s.baseBranch} を ${s.wBranch} に取り込みました`, 'r-ok');
        } catch (e) {
          // 既に最新なら 204（本文なし）や「Already merged」が返る
          if (e.status === 204 || /already merged/i.test(e.message)) {
            log('既に最新でした（取り込むものがありません）', 'r-ok');
          } else throw e;
        }
        const c = await gh.compare(s.baseBranch, s.wBranch);
        log(`取り込み後の behind_by: ${c.behind_by}`, c.behind_by ? 'r-err' : 'r-ok');
        if (c.behind_by === 0) log('→ 遅れが解消しました。安心してマージできます。', 'r-ok');
        setRealState({ wBackmerged: true, wBehind: c.behind_by });
        return {};
      },
      isDone: (s) => !!s.wBackmerged,
      needsWorkPr: true,
    },
    {
      id: 'w-review',
      title: 'レビューする（Approve は自分では押せない）',
      git: '（git 本体には無い。GitHub の機能）',
      api: 'POST /repos/{owner}/{repo}/pulls/{number}/reviews',
      vars: { number: st.wPr || '{number}' },
      desc:
        'まず自分の PR を Approve（承認）してみます。GitHub はこれを拒否します — 承認は必ず他の人が行うものだからです。拒否を確かめたあと、Comment としてレビューを残します。実務ではここで指摘が付き、直して push すると PR に自動で反映されます（PR を作り直す必要はありません）。',
      label: '承認を試す → コメントを残す',
      async run(gh, s) {
        try {
          await gh.reviewPull(s.wPr, 'APPROVE', '自分で承認できるか試します');
          log('承認できてしまいました（このリポジトリの設定では自己承認が通るようです）', 'r-ok');
        } catch (e) {
          log(`想定どおり拒否されました: ${e.data && e.data.message ? e.data.message : e.message}`, 'r-ok');
          log('→ 承認は他の人が行うもの。これがレビューが仕組みとして成り立つ理由です。');
        }
        await gh.reviewPull(s.wPr, 'COMMENT', 'Git Quest 実務編のレビューコメントです。ここで指摘のやりとりをします。');
        log(`PR #${s.wPr} にレビュー（Comment）を付けました`, 'r-ok');
        setRealState({ wReviewed: true });
        return {};
      },
      isDone: (s) => !!s.wReviewed,
      needsWorkPr: true,
    },
    {
      id: 'w-merge',
      title: 'マージ方式を選んでマージする（3つの違い）',
      git: 'git merge / git merge --squash / git rebase',
      api: 'PUT /repos/{owner}/{repo}/pulls/{number}/merge',
      vars: { number: st.wPr || '{number}' },
      desc:
        'GitHub のマージボタンには3つの選択肢があります。どれを選んでも結果の中身は同じで、違いは履歴の残り方です。1つ選んで実行すると、マージ後の履歴を取ってきて見せます。',
      label: 'マージする',
      choices: [
        { value: 'merge', label: 'Create a merge commit', note: 'マージコミットを作る（第5章の 3-way マージ）' },
        { value: 'squash', label: 'Squash and merge', note: '細かいコミットを1つに潰す' },
        { value: 'rebase', label: 'Rebase and merge', note: 'つなぎ直して一直線にする（第6章の rebase）' },
      ],
      confirm: (s, method) =>
        `PR #${s.wPr} を ${method} 方式で ${s.baseBranch} にマージし、ブランチ ${s.wBranch} を削除します。\n本当に実行しますか？`,
      async run(gh, s, method) {
        try {
          await gh.mergePull(s.wPr, method);
        } catch (e) {
          if (e.status === 405) {
            // リポジトリ側でその方式が無効なことがある。何が起きたか分かるように言い添える
            log(`${method} 方式はこのリポジトリでは使えない設定のようです`, 'r-err');
            log('→ Settings → General → Pull Requests の Allow … merging を確認するか、別の方式を選んでください。');
          }
          throw e;
        }
        log(`PR #${s.wPr} を ${method} 方式でマージしました`, 'r-ok');
        await gh.deleteBranch(s.wBranch).catch(() => {});
        log(`ブランチ ${s.wBranch} を削除しました`, 'r-ok');
        const commits = await gh.listCommits(s.baseBranch, 5);
        log(`--- マージ後の ${s.baseBranch} の履歴 ---`);
        for (const c of commits) log(`${c.sha.slice(0, 7)} ${c.commit.message.split('\n')[0]}`);
        log(
          method === 'squash'
            ? '→ 作業中のコミットが1つにまとまっているのが分かります。'
            : method === 'rebase'
              ? '→ マージコミットが増えず、一直線に並んでいます。'
              : '→ マージコミットが1つ増えています。'
        );
        setRealState({ wMerged: method });
        return {};
      },
      isDone: (s) => !!s.wMerged,
      needsWorkPr: true,
    },
    {
      id: 'w-ci',
      title: '自動化が呼んでいる API を見る（CI/CD）',
      git: '（人ではなくツールが呼ぶ）',
      api: 'GET /repos/{owner}/{repo}/actions/runs',
      desc:
        'ここまで手で押してきた API は、実務ではツールが自動で呼びます。GitHub Actions の実行履歴を取ってみると、あなたのリポジトリで動いている自動処理がそのまま見えます。「業務で API を使う」の実体はこれです。',
      label: '実行履歴を取得する',
      async run(gh, s) {
        try {
          const runs = await gh.listWorkflowRuns(5);
          if (!runs.total_count) {
            log('このリポジトリでは GitHub Actions がまだ動いていません（total_count: 0）', 'r-ok');
            log('→ Actions を設定すると、push のたびにツールが同じ API を呼んでテストや公開を行います。');
          } else {
            log(`--- 直近の自動実行（全 ${runs.total_count} 件） ---`);
            for (const r of runs.workflow_runs || []) {
              log(`${r.conclusion || r.status}  ${r.name}  ${r.head_branch}  ${r.created_at}`);
            }
            log('→ これを動かしているのも、あなたがいま押してきたのと同じ REST API です。');
          }
        } catch (e) {
          if (e.status === 403 || e.status === 404) {
            log('このトークンでは Actions を読めません（権限か、Actions 未使用のリポジトリです）', 'r-ok');
          } else throw e;
        }
        setRealState({ wSawCi: true });
        return {};
      },
      isDone: (s) => !!s.wSawCi,
    },
  ];
}

/** 既にあれば作らない。同じ日にやり直しても止まらないようにする。 */
async function ensureBranch(gh, branch, baseBranch) {
  try {
    await gh.createBranch(branch, baseBranch);
    log(`ブランチ ${branch} を作りました`, 'r-ok');
  } catch (e) {
    if (e.status === 422) log(`ブランチ ${branch} は既にあるので、それを使います`, 'r-ok');
    else throw e;
  }
}

/** 同じブランチの open な PR があれば使い回す。 */
async function ensurePull(gh, { title, body, head, base }) {
  const existing = await gh.listPulls(head);
  const open = existing.find((p) => p.state === 'open');
  if (open) {
    log(`既に PR #${open.number} があるので、それを使います`, 'r-ok');
    return open;
  }
  return gh.createPull({ title, body, head, base });
}

// ---------------------------------------------------------------- 画面

export function renderRealMode(root, { onBack }) {
  const st = load();
  root.innerHTML = '';

  // --- 見出し
  const head = document.createElement('section');
  head.className = 'q-card';
  const h = document.createElement('h3');
  h.textContent = '第9章 GitHub 実践 — 本物のリポジトリを動かす';
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
    if (!confirm('保存したトークンと第9章の進捗を消します。よろしいですか？')) return;
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
      'トークンを入力して保存すると、ここから先のステップが使えるようになります。第1〜8章はトークン無しで全部遊べます。';
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

  const redraw = () => renderRealMode(root, { onBack });

  appendSectionTitle(root, '基礎編', 'git のふだんの操作が、API ではどう表されるかを1つずつ確かめます。');
  renderSteps(root, steps(st), st, gh, redraw);
  appendPrLink(root, st.prUrl, st.prNumber, '作成した PR を GitHub で開く');

  appendSectionTitle(
    root,
    '実務編 — チームでの流れをなぞる',
    'ここからは、実際の仕事で毎日起きることを順番に体験します。' +
      '同僚役のブランチもこちらで作るので、ひとりでも「レビュー待ちの間に main が進んでしまった」状況を再現できます。'
  );
  renderSteps(root, workSteps(st), st, gh, redraw);
  appendPrLink(root, st.wPrUrl, st.wPr, '実務編の PR を GitHub で開く');

  appendRestart(root, onBack);
  appendPractice(root);
  appendBack(root, onBack);
}

/** ステップ一覧を描く。基礎編と実務編で同じ見た目を使う。 */
function renderSteps(root, list, st, gh, redraw) {
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
    url.textContent = realUrl(step.api, st, step.vars);
    body.appendChild(url);

    const d = document.createElement('p');
    d.style.margin = '0 0 10px';
    d.appendChild(markup(step.desc));
    body.appendChild(d);

    const blocked =
      !prevDone ||
      (step.needsAuth && !st.baseBranch) ||
      (step.needsPr && !st.prNumber) ||
      (step.needsWorkPr && !st.wPr);

    /** 実行の共通処理。choices があるときは選んだ値を渡す。 */
    const runStep = async (btn, choice) => {
      const current = load();
      if (step.confirm && !confirm(step.confirm(current, choice))) return;
      const original = btn.textContent;
      btn.disabled = true;
      btn.textContent = '実行中…';
      try {
        await step.run(gh, current, choice);
        redraw();
      } catch (e) {
        if (e instanceof SafetyError) log('安全チェックで停止: ' + e.message, 'r-err');
        else log('失敗: ' + e.message, 'r-err');
        btn.disabled = false;
        btn.textContent = original;
      }
    };

    if (step.choices) {
      // マージ方式のように「どれか1つを選んで実行する」ステップ
      for (const c of step.choices) {
        const row = document.createElement('div');
        row.className = 'choice-row';
        const btn = document.createElement('button');
        btn.className = done ? 'ghost-btn' : 'primary-btn';
        btn.textContent = done && st.wMerged === c.value ? `${c.label}（実行済み）` : c.label;
        btn.disabled = blocked;
        btn.addEventListener('click', () => runStep(btn, c.value));
        row.appendChild(btn);
        const note = document.createElement('span');
        note.className = 'choice-note';
        note.textContent = c.note;
        row.appendChild(note);
        body.appendChild(row);
      }
    } else {
      const btn = document.createElement('button');
      btn.className = done ? 'ghost-btn' : 'primary-btn';
      btn.textContent = done ? `${step.label}（もう一度）` : step.label;
      btn.disabled = blocked;
      btn.addEventListener('click', () => runStep(btn));
      body.appendChild(btn);
    }

    box.appendChild(body);
    root.appendChild(box);
  });
}

function appendSectionTitle(root, title, desc) {
  const wrap = document.createElement('section');
  wrap.className = 'q-card section-title';
  const h = document.createElement('h3');
  h.textContent = title;
  wrap.appendChild(h);
  const p = document.createElement('p');
  p.className = 'fine';
  p.appendChild(markup(desc));
  wrap.appendChild(p);
  root.appendChild(wrap);
}

function appendPrLink(root, prUrl, number, label) {
  if (!prUrl) return;
  const link = document.createElement('p');
  link.style.margin = '4px 0 12px';
  const a = document.createElement('a');
  a.href = prUrl;
  a.target = '_blank';
  a.rel = 'noopener noreferrer';
  a.textContent = `${label}（#${number}）`;
  a.style.color = 'var(--accent)';
  link.appendChild(a);
  root.appendChild(link);
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
  b.textContent = '第9章を最初からやり直す';
  b.addEventListener('click', () => {
    if (!confirm('第9章の進捗を消して、ステップ1からやり直します。\nトークンと接続設定は残ります。')) return;
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
  sum.textContent = 'まとめ: 実務のどこで使う？（上の実務編でやったことの整理）';
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
