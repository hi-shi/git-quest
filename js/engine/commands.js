// git サブコマンドの実装。
// すべて {ok, out, hint} を返し、repo を直接書き換える。
// エラー文は本物の git に寄せたうえで、hint に日本語の一言を添える。

import {
  initRepo,
  hashObject,
  writeBlob,
  readBlob,
  writeTree,
  readTree,
  writeCommit,
  readCommit,
  commitTree,
  headCommit,
  setHeadCommit,
  headRef,
  currentBranch,
  listBranches,
  listRemoteBranches,
  listTags,
  resolveRev,
  ancestors,
  isAncestor,
  mergeBase,
  commitList,
  commitsBetween,
  status,
  isClean,
  checkoutCommit,
  checkoutIndexToWorkdir,
  trackedPaths,
  refreshIgnore,
  isIgnored,
  createRepo,
} from './repo.js';
import { mergeText, formatDiff, hasConflictMarkers } from './diff.js';
import { parseFlags } from './parser.js';

const ok = (out = '', hint) => ({ ok: true, out, hint });
const err = (out, hint) => ({ ok: false, out, hint });

function needRepo(repo) {
  if (!repo.initialized) {
    return err(
      'fatal: not a git repository (or any of the parent directories): .git',
      'まず `git init` でリポジトリを作りましょう。'
    );
  }
  return null;
}

function needCommit(repo) {
  if (!headCommit(repo)) {
    return err(
      "fatal: your current branch '" + (currentBranch(repo) || 'HEAD') + "' does not have any commits yet",
      'まだ1つもコミットがありません。`git add` してから `git commit -m "..."` を。'
    );
  }
  return null;
}

// ---------------------------------------------------------------- init / config

function cmdInit(repo) {
  if (repo.initialized) return ok('Reinitialized existing Git repository in /playground/.git/');
  const fresh = initRepo({ defaultBranch: repo.defaultBranch });
  fresh.workdir = repo.workdir;
  Object.assign(repo, fresh);
  refreshIgnore(repo);
  return ok(
    `Initialized empty Git repository in /playground/.git/\n（.git ができました。ここからこのフォルダの変更が記録できます）`
  );
}

function cmdConfig(repo, argv) {
  const { args } = parseFlags(argv);
  if (args.length === 0) {
    return ok(Object.entries(repo.config).map(([k, v]) => `${k}=${v}`).join('\n'));
  }
  if (args.length === 1) return ok(repo.config[args[0]] ?? '');
  repo.config[args[0]] = args.slice(1).join(' ');
  return ok('');
}

// ---------------------------------------------------------------- status

function cmdStatus(repo, argv) {
  const guard = needRepo(repo);
  if (guard) return guard;
  const { flags } = parseFlags(argv);
  const s = status(repo);
  const short = flags['-s'] || flags['--short'];

  if (short) {
    const lines = [];
    for (const f of s.conflicted) lines.push('UU ' + f);
    for (const f of s.staged) lines.push(kindLetter(f.kind) + ' ' + f.path);
    for (const f of s.unstaged) lines.push(' ' + kindLetter(f.kind) + ' ' + f.path);
    for (const f of s.untracked) lines.push('?? ' + f);
    return ok(lines.join('\n') || '');
  }

  const out = [];
  const br = currentBranch(repo);
  out.push(br ? `On branch ${br}` : `HEAD detached at ${(headCommit(repo) || '').slice(0, 7)}`);

  const upstream = br && repo.refs['refs/remotes/origin/' + br] !== undefined ? 'origin/' + br : null;
  if (upstream) {
    const local = headCommit(repo);
    const remote = repo.refs['refs/remotes/origin/' + br];
    const ahead = commitsBetween(repo, remote, local).length;
    const behind = commitsBetween(repo, local, remote).length;
    if (ahead && behind) out.push(`Your branch and '${upstream}' have diverged,`, `and have ${ahead} and ${behind} different commits each.`);
    else if (ahead) out.push(`Your branch is ahead of '${upstream}' by ${ahead} commit(s).`);
    else if (behind) out.push(`Your branch is behind '${upstream}' by ${behind} commit(s).`);
    else out.push(`Your branch is up to date with '${upstream}'.`);
  }

  if (repo.MERGE_HEAD) out.push('', 'You have unmerged paths.', '  (fix conflicts and run "git commit")');
  if (repo.REBASE) out.push('', `interactive rebase in progress; onto ${repo.REBASE.onto.slice(0, 7)}`);

  if (s.conflicted.length) {
    out.push('', 'Unmerged paths:', '  (use "git add <file>..." to mark resolution)');
    for (const f of s.conflicted) out.push(`\tboth modified:   ${f}`);
  }
  if (s.staged.length) {
    out.push('', 'Changes to be committed:', '  (use "git restore --staged <file>..." to unstage)');
    for (const f of s.staged) out.push(`\t${kindLabel(f.kind)}${f.path}`);
  }
  if (s.unstaged.length) {
    out.push(
      '',
      'Changes not staged for commit:',
      '  (use "git add <file>..." to update what will be committed)'
    );
    for (const f of s.unstaged) out.push(`\t${kindLabel(f.kind)}${f.path}`);
  }
  if (s.untracked.length) {
    out.push('', 'Untracked files:', '  (use "git add <file>..." to include in what will be committed)');
    for (const f of s.untracked) out.push(`\t${f}`);
  }
  if (!s.staged.length && !s.unstaged.length && !s.untracked.length && !s.conflicted.length) {
    out.push('', 'nothing to commit, working tree clean');
  }
  return ok(out.join('\n'));
}

function kindLabel(kind) {
  return { new: 'new file:   ', modified: 'modified:   ', deleted: 'deleted:    ' }[kind] || '';
}
function kindLetter(kind) {
  return { new: 'A', modified: 'M', deleted: 'D' }[kind] || '?';
}

// ---------------------------------------------------------------- add / restore

function matchPaths(repo, patterns, pool) {
  const out = new Set();
  for (const pat of patterns) {
    if (pat === '.' || pat === '-A' || pat === '*') {
      for (const p of pool) out.add(p);
      continue;
    }
    if (pat.includes('*')) {
      const re = new RegExp('^' + pat.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*') + '$');
      for (const p of pool) if (re.test(p)) out.add(p);
      continue;
    }
    if (pool.includes(pat)) out.add(pat);
    else for (const p of pool) if (p.startsWith(pat + '/')) out.add(p);
  }
  return [...out];
}

function cmdAdd(repo, argv) {
  const guard = needRepo(repo);
  if (guard) return guard;
  const { flags, args } = parseFlags(argv);
  const patterns = args.length ? args : flags['-A'] || flags['--all'] ? ['.'] : [];
  if (!patterns.length) {
    return err('Nothing specified, nothing added.', 'ファイル名か `.`（全部）を指定してください。例: `git add .`');
  }
  const pool = [...new Set([...Object.keys(repo.workdir), ...Object.keys(repo.index)])];
  const targets = matchPaths(repo, patterns, pool).filter(
    (p) => !isIgnored(repo, p) || p in repo.index
  );
  if (!targets.length) {
    return err(
      `fatal: pathspec '${patterns[0]}' did not match any files`,
      'そのファイルは見つかりません。`ls` で確認してみましょう。'
    );
  }
  const resolved = [];
  for (const p of targets) {
    if (p in repo.workdir) {
      if (repo.conflicts[p]) {
        if (hasConflictMarkers(repo.workdir[p])) {
          return err(
            `error: '${p}' にコンフリクトマーカーが残っています`,
            '<<<<<<< ======= >>>>>>> の行を消して、残したい内容だけにしてから add してください。'
          );
        }
        delete repo.conflicts[p];
        resolved.push(p);
      }
      repo.index[p] = writeBlob(repo, repo.workdir[p]);
    } else {
      delete repo.index[p]; // 消えたファイルの削除をステージ
    }
  }
  refreshIgnore(repo);
  const msg = [`${targets.length} 件をステージしました: ${targets.join(', ')}`];
  if (resolved.length) msg.push(`コンフリクト解消済み: ${resolved.join(', ')}`);
  return ok(msg.join('\n'), 'ステージ（index）は「次のコミットに入れる箱」です。`git status` で確認を。');
}

function cmdRestore(repo, argv) {
  const guard = needRepo(repo);
  if (guard) return guard;
  const { flags, args } = parseFlags(argv, { withValue: ['--source'] });
  if (!args.length) return err('fatal: you must specify path(s) to restore');
  const staged = flags['--staged'] || flags['-S'];
  const head = commitTree(repo, headCommit(repo));
  const pool = [...new Set([...Object.keys(repo.workdir), ...Object.keys(repo.index), ...Object.keys(head)])];
  const targets = matchPaths(repo, args, pool);
  if (!targets.length) return err(`error: pathspec '${args[0]}' did not match any file(s) known to git`);

  for (const p of targets) {
    if (staged) {
      // index を HEAD の状態に戻す（作業ツリーはそのまま）
      if (p in head) repo.index[p] = head[p];
      else delete repo.index[p];
    } else {
      // 作業ツリーを index の状態に戻す
      if (p in repo.index) repo.workdir[p] = readBlob(repo, repo.index[p]) ?? '';
      else delete repo.workdir[p];
    }
  }
  refreshIgnore(repo);
  return ok(
    staged
      ? `ステージから外しました: ${targets.join(', ')}`
      : `作業ツリーの変更を捨てました: ${targets.join(', ')}`,
    staged
      ? '--staged は index だけを戻します。ファイルの中身は消えません。'
      : '--staged なしは作業ツリーを戻します。編集内容は失われるので注意。'
  );
}

// ---------------------------------------------------------------- commit

function cmdCommit(repo, argv) {
  const guard = needRepo(repo);
  if (guard) return guard;
  const { flags, args } = parseFlags(argv, { withValue: ['-m', '--message'] });
  const amend = !!flags['--amend'];
  const all = !!flags['-a'] || !!flags['--all'];
  let message = flags['-m'] || flags['--message'] || (args.length ? args.join(' ') : null);

  if (Object.keys(repo.conflicts).length) {
    return err(
      'error: Committing is not possible because you have unmerged files.',
      'まだ解消していない衝突があります。編集 → `git add <file>` を先に。'
    );
  }

  if (all) {
    for (const p of Object.keys(repo.index)) {
      if (p in repo.workdir) repo.index[p] = writeBlob(repo, repo.workdir[p]);
      else delete repo.index[p];
    }
  }

  const parentSha = headCommit(repo);
  if (amend) {
    if (!parentSha) return err('fatal: You have nothing to amend.');
    const old = readCommit(repo, parentSha);
    if (!message) message = old.message;
    const tree = writeTree(repo, repo.index);
    const sha = writeCommit(repo, { tree, parents: old.parents, message });
    setHeadCommit(repo, sha);
    return ok(
      `[${currentBranch(repo) || 'HEAD'} ${sha}] ${message}\n（直前のコミットを作り直しました。sha が ${parentSha} → ${sha} に変わっています）`,
      '--amend は歴史を書き換えます。push 済みのコミットには使わないのが原則。'
    );
  }

  const s = status(repo);
  if (!s.staged.length && !repo.MERGE_HEAD) {
    const untrackedNote = s.untracked.length
      ? `\nUntracked files:\n${s.untracked.map((f) => '\t' + f).join('\n')}`
      : '';
    return err(
      `On branch ${currentBranch(repo)}\nnothing added to commit but untracked files present${untrackedNote}`,
      'ステージが空です。先に `git add <file>` を実行しましょう。'
    );
  }
  if (!message) {
    return err(
      'Aborting commit due to empty commit message.',
      'メッセージが要ります。`git commit -m "何をしたか"` の形で。'
    );
  }

  const parents = [parentSha].filter(Boolean);
  if (repo.MERGE_HEAD) parents.push(repo.MERGE_HEAD);
  const tree = writeTree(repo, repo.index);
  const sha = writeCommit(repo, { tree, parents, message });
  setHeadCommit(repo, sha);

  const wasMerge = !!repo.MERGE_HEAD;
  repo.MERGE_HEAD = null;
  repo.MERGE_MSG = null;

  const nFiles = s.staged.length;
  const out = [
    `[${currentBranch(repo) || 'detached HEAD'} ${sha}] ${message}`,
    ` ${nFiles} file(s) changed`,
  ];
  if (wasMerge) out.push('（マージコミットができました。親が2つあります）');

  if (repo.REBASE) {
    return continueRebase(repo, out.join('\n'));
  }
  return ok(out.join('\n'));
}

// ---------------------------------------------------------------- log / show / diff

function cmdLog(repo, argv) {
  const guard = needRepo(repo) || needCommit(repo);
  if (guard) return guard;
  const { flags, args } = parseFlags(argv, { withValue: ['-n'] });
  const oneline = flags['--oneline'];
  const all = flags['--all'];
  const graph = flags['--graph'];
  const limit = flags['-n'] ? parseInt(flags['-n'], 10) : Infinity;

  let tips;
  if (all) tips = Object.entries(repo.refs).filter(([r]) => !r.startsWith('refs/tags/')).map(([, s]) => s);
  else if (args.length) tips = args.map((a) => resolveRev(repo, a)).filter(Boolean);
  else tips = [headCommit(repo)];

  const list = commitList(repo, tips).slice(0, limit);
  const labels = refLabels(repo);
  const out = [];
  for (const sha of list) {
    const c = readCommit(repo, sha);
    const deco = labels[sha] ? ` (${labels[sha].join(', ')})` : '';
    if (oneline) out.push(`${graph ? '* ' : ''}${sha}${deco} ${c.message}`);
    else {
      out.push(`commit ${sha}${deco}`);
      if (c.parents.length > 1) out.push(`Merge: ${c.parents.map((p) => p.slice(0, 7)).join(' ')}`);
      out.push(`Author: ${c.author}`, '', '    ' + c.message, '');
    }
  }
  return ok(out.join('\n').trimEnd());
}

/** sha -> ['HEAD -> main', 'origin/main', 'tag: v1'] */
export function refLabels(repo) {
  const map = Object.create(null);
  const head = headCommit(repo);
  const hRef = headRef(repo);
  for (const [ref, sha] of Object.entries(repo.refs)) {
    if (!sha) continue;
    let label;
    if (ref.startsWith('refs/heads/')) label = ref.replace('refs/heads/', '');
    else if (ref.startsWith('refs/remotes/')) label = ref.replace('refs/remotes/', '');
    else if (ref.startsWith('refs/tags/')) label = 'tag: ' + ref.replace('refs/tags/', '');
    else continue;
    if (ref === hRef) label = 'HEAD -> ' + label;
    (map[sha] = map[sha] || []).push(label);
  }
  if (repo.HEAD.type === 'detached' && head) (map[head] = map[head] || []).unshift('HEAD');
  return map;
}

function cmdShow(repo, argv) {
  const guard = needRepo(repo) || needCommit(repo);
  if (guard) return guard;
  const { args } = parseFlags(argv);
  const sha = resolveRev(repo, args[0] || 'HEAD');
  if (!sha) return err(`fatal: ambiguous argument '${args[0]}': unknown revision`);
  const c = readCommit(repo, sha);
  const cur = commitTree(repo, sha);
  const prev = c.parents.length ? commitTree(repo, c.parents[0]) : Object.create(null);
  const out = [`commit ${sha}`, `Author: ${c.author}`, '', '    ' + c.message, ''];
  for (const p of new Set([...Object.keys(prev), ...Object.keys(cur)])) {
    if (prev[p] === cur[p]) continue;
    const d = formatDiff(p, prev[p] ? readBlob(repo, prev[p]) : '', cur[p] ? readBlob(repo, cur[p]) : '');
    if (d) out.push(d);
  }
  return ok(out.join('\n'));
}

function cmdDiff(repo, argv) {
  const guard = needRepo(repo);
  if (guard) return guard;
  const { flags, args } = parseFlags(argv);
  const staged = flags['--staged'] || flags['--cached'];
  const out = [];

  if (args.length === 2) {
    const a = resolveRev(repo, args[0]);
    const b = resolveRev(repo, args[1]);
    if (!a || !b) return err('fatal: unknown revision');
    const ta = commitTree(repo, a);
    const tb = commitTree(repo, b);
    for (const p of new Set([...Object.keys(ta), ...Object.keys(tb)])) {
      if (ta[p] === tb[p]) continue;
      out.push(formatDiff(p, ta[p] ? readBlob(repo, ta[p]) : '', tb[p] ? readBlob(repo, tb[p]) : ''));
    }
    return ok(out.filter(Boolean).join('\n') || '');
  }

  if (staged) {
    const head = commitTree(repo, headCommit(repo));
    for (const p of new Set([...Object.keys(head), ...Object.keys(repo.index)])) {
      if (head[p] === repo.index[p]) continue;
      out.push(
        formatDiff(
          p,
          head[p] ? readBlob(repo, head[p]) : '',
          repo.index[p] ? readBlob(repo, repo.index[p]) : ''
        )
      );
    }
    return ok(
      out.filter(Boolean).join('\n') || '',
      '--staged は「ステージ済み ↔ 直前のコミット」の差分です。'
    );
  }

  for (const p of new Set([...Object.keys(repo.index), ...Object.keys(repo.workdir)])) {
    if (isIgnored(repo, p) && !(p in repo.index)) continue;
    if (!(p in repo.index)) continue; // 未追跡ファイルは diff に出ない
    const idx = readBlob(repo, repo.index[p]) ?? '';
    const wd = p in repo.workdir ? repo.workdir[p] : '';
    if (idx === wd) continue;
    out.push(formatDiff(p, idx, wd));
  }
  return ok(
    out.filter(Boolean).join('\n') || '',
    'オプション無しの diff は「作業ツリー ↔ ステージ」。まだ add していない変更だけが出ます。'
  );
}

// ---------------------------------------------------------------- branch / switch

function cmdBranch(repo, argv) {
  const guard = needRepo(repo);
  if (guard) return guard;
  const { flags, args } = parseFlags(argv, { withValue: ['-m', '--move'] });

  if (flags['-d'] || flags['-D'] || flags['--delete']) {
    const name = args[0];
    const ref = 'refs/heads/' + name;
    if (!(ref in repo.refs)) return err(`error: branch '${name}' not found.`);
    if (name === currentBranch(repo)) {
      return err(
        `error: Cannot delete branch '${name}' checked out at '/playground'`,
        '今いるブランチは消せません。先に別のブランチへ `git switch` を。'
      );
    }
    if (!flags['-D'] && !isAncestor(repo, repo.refs[ref], headCommit(repo))) {
      return err(
        `error: The branch '${name}' is not fully merged.\nIf you are sure you want to delete it, run 'git branch -D ${name}'.`,
        'まだマージされていないコミットが失われます。本当に消すなら大文字の -D。'
      );
    }
    const gone = repo.refs[ref];
    delete repo.refs[ref];
    return ok(`Deleted branch ${name} (was ${gone}).`);
  }

  if (flags['-m'] || flags['--move']) {
    const from = args.length > 1 ? args[0] : currentBranch(repo);
    const to = flags['-m'] === true || flags['--move'] === true ? args[args.length - 1] : flags['-m'] || flags['--move'];
    const fromRef = 'refs/heads/' + from;
    if (!(fromRef in repo.refs)) return err(`error: refname ${from} not found`);
    repo.refs['refs/heads/' + to] = repo.refs[fromRef];
    delete repo.refs[fromRef];
    if (headRef(repo) === fromRef) repo.HEAD = { type: 'branch', ref: 'refs/heads/' + to };
    return ok(`ブランチ名を変更: ${from} → ${to}`);
  }

  if (!args.length) {
    const verbose = flags['-v'] || flags['-vv'];
    const cur = currentBranch(repo);
    const lines = listBranches(repo).map((b) => {
      let line = (b === cur ? '* ' : '  ') + b;
      if (verbose) {
        const sha = repo.refs['refs/heads/' + b];
        const c = readCommit(repo, sha);
        const up = repo.refs['refs/remotes/origin/' + b] !== undefined ? ` [origin/${b}]` : '';
        line += ` ${sha}${up} ${c ? c.message : ''}`;
      }
      return line;
    });
    if (flags['-a'] || flags['--all']) {
      for (const r of listRemoteBranches(repo)) lines.push('  remotes/' + r);
    }
    return ok(lines.join('\n') || '（ブランチはまだありません。コミットすると作られます）');
  }

  // ブランチ作成
  const name = args[0];
  if ('refs/heads/' + name in repo.refs) {
    return err(`fatal: a branch named '${name}' already exists`);
  }
  const start = args[1] ? resolveRev(repo, args[1]) : headCommit(repo);
  if (!start) return needCommit(repo) || err('fatal: not a valid object name');
  repo.refs['refs/heads/' + name] = start;
  return ok(
    `ブランチ ${name} を ${start} に作りました（まだ切り替えてはいません）`,
    '切り替えるには `git switch ' + name + '`。作成と切替を同時なら `git switch -c ' + name + '`。'
  );
}

function cmdSwitch(repo, argv, { legacy = false } = {}) {
  const guard = needRepo(repo);
  if (guard) return guard;
  const { flags, args } = parseFlags(argv);
  const create = flags['-c'] || flags['-C'] || flags['-b'] || flags['-B'];
  const detach = flags['--detach'];
  let target = args[0];

  if (flags['-'] === true || target === '-') {
    return err('（このアプリでは `-` での直前ブランチ戻りは未対応です。ブランチ名を指定してください）');
  }
  if (!target) return err('fatal: missing branch or commit argument');

  if (create) {
    if ('refs/heads/' + target in repo.refs) {
      return err(
        `fatal: a branch named '${target}' already exists`,
        '既にあるブランチへ移るなら -c を外して `git switch ' + target + '`。'
      );
    }
    const start = args[1] ? resolveRev(repo, args[1]) : headCommit(repo);
    if (!start) return needCommit(repo);
    repo.refs['refs/heads/' + target] = start;
    repo.HEAD = { type: 'branch', ref: 'refs/heads/' + target };
    return ok(
      `Switched to a new branch '${target}'\n（作業ツリーはそのまま。今の場所から枝が伸びました）`
    );
  }

  const ref = 'refs/heads/' + target;
  let sha;
  if (ref in repo.refs) sha = repo.refs[ref];
  else {
    sha = resolveRev(repo, target);
    if (!sha) {
      // origin/foo から追跡ブランチを自動生成
      const remoteRef = 'refs/remotes/origin/' + target;
      if (remoteRef in repo.refs) {
        repo.refs[ref] = repo.refs[remoteRef];
        sha = repo.refs[ref];
        repo.HEAD = { type: 'branch', ref };
        checkoutCommit(repo, sha);
        return ok(
          `branch '${target}' set up to track 'origin/${target}'.\nSwitched to a new branch '${target}'`
        );
      }
      return err(
        `fatal: invalid reference: ${target}`,
        legacy
          ? 'ブランチ名を確認しましょう。`git branch` で一覧が見られます。'
          : 'そのブランチはありません。新しく作るなら `git switch -c ' + target + '`。'
      );
    }
  }

  const s = status(repo);
  const head = commitTree(repo, headCommit(repo));
  const target_ = commitTree(repo, sha);
  const dirty = [...s.staged, ...s.unstaged].map((f) => f.path);
  const clobbered = dirty.filter((p) => head[p] !== target_[p]);
  if (clobbered.length) {
    return err(
      `error: Your local changes to the following files would be overwritten by checkout:\n${clobbered
        .map((p) => '\t' + p)
        .join('\n')}\nPlease commit your changes or stash them before you switch branches.`,
      '未コミットの変更が消えてしまうので止めました。`git commit` か `git stash` を先に。'
    );
  }

  if (ref in repo.refs && !detach) repo.HEAD = { type: 'branch', ref };
  else repo.HEAD = { type: 'detached', sha };
  checkoutCommit(repo, sha);

  if (repo.HEAD.type === 'detached') {
    return ok(
      `Note: switching to '${target}'.\nYou are in 'detached HEAD' state.`,
      'HEAD がブランチから外れています。ここでコミットするとどのブランチにも属しません。'
    );
  }
  return ok(`Switched to branch '${target}'`);
}

// ---------------------------------------------------------------- merge

function cmdMerge(repo, argv) {
  const guard = needRepo(repo) || needCommit(repo);
  if (guard) return guard;
  const { flags, args } = parseFlags(argv, { withValue: ['-m'] });

  if (flags['--abort']) {
    if (!repo.MERGE_HEAD) return err('fatal: There is no merge to abort (MERGE_HEAD missing).');
    repo.MERGE_HEAD = null;
    repo.conflicts = Object.create(null);
    checkoutCommit(repo, headCommit(repo));
    return ok('マージを中止して、開始前の状態に戻しました。');
  }
  if (repo.MERGE_HEAD) {
    return err(
      'fatal: You have not concluded your merge (MERGE_HEAD exists).',
      '進行中のマージがあります。解消して `git commit`、やめるなら `git merge --abort`。'
    );
  }
  if (!args.length) return err('fatal: No commit specified and merge.defaultToUpstream not set');

  const theirName = args[0];
  const theirs = resolveRev(repo, theirName);
  if (!theirs) return err(`merge: ${theirName} - not something we can merge`);
  const ours = headCommit(repo);

  if (theirs === ours || isAncestor(repo, theirs, ours)) {
    return ok('Already up to date.', 'マージ相手の変更は既に取り込み済みです。');
  }

  if (!isClean(repo)) {
    return err(
      'error: Your local changes would be overwritten by merge.',
      '先に commit か stash をしてから merge しましょう。'
    );
  }

  // 早送り
  if (isAncestor(repo, ours, theirs) && !flags['--no-ff']) {
    setHeadCommit(repo, theirs);
    checkoutCommit(repo, theirs);
    return ok(
      `Updating ${ours.slice(0, 7)}..${theirs.slice(0, 7)}\nFast-forward\n（枝分かれしていないので、ラベルを前に進めただけ。マージコミットはできません）`,
      'これが fast-forward。あえてマージコミットを作りたいときは `--no-ff`。'
    );
  }

  const base = mergeBase(repo, ours, theirs);
  const baseTree = commitTree(repo, base);
  const ourTree = commitTree(repo, ours);
  const theirTree = commitTree(repo, theirs);
  const merged = Object.create(null);
  const conflicts = [];
  const allPaths = new Set([
    ...Object.keys(baseTree),
    ...Object.keys(ourTree),
    ...Object.keys(theirTree),
  ]);

  for (const p of allPaths) {
    const b = baseTree[p] ? readBlob(repo, baseTree[p]) : null;
    const o = ourTree[p] ? readBlob(repo, ourTree[p]) : null;
    const t = theirTree[p] ? readBlob(repo, theirTree[p]) : null;
    if (o === null && t === null) continue;
    if (o === null) {
      if (b === null || b === t) merged[p] = writeBlob(repo, t);
      else conflicts.push({ path: p, base: b, ours: '', theirs: t, kind: 'delete/modify' });
      continue;
    }
    if (t === null) {
      if (b === null || b === o) {
        if (b !== null) continue; // theirs が削除、ours は無変更 → 削除を採用
        merged[p] = writeBlob(repo, o);
      } else conflicts.push({ path: p, base: b, ours: o, theirs: '', kind: 'modify/delete' });
      continue;
    }
    const r = mergeText(b ?? '', o, t, { ourLabel: 'HEAD', theirLabel: theirName });
    if (r.clean) merged[p] = writeBlob(repo, r.text);
    else conflicts.push({ path: p, base: b ?? '', ours: o, theirs: t, text: r.text });
  }

  // index / 作業ツリーを更新
  const keepUntracked = Object.keys(repo.workdir).filter((p) => !(p in repo.index) && !allPaths.has(p));
  const kept = Object.create(null);
  for (const p of keepUntracked) kept[p] = repo.workdir[p];
  repo.index = Object.create(null);
  repo.workdir = Object.create(null);
  for (const p of Object.keys(merged)) {
    repo.index[p] = merged[p];
    repo.workdir[p] = readBlob(repo, merged[p]);
  }
  for (const c of conflicts) {
    repo.workdir[c.path] = c.text !== undefined ? c.text : conflictMarkerText(c, theirName);
    repo.conflicts[c.path] = { base: c.base, ours: c.ours, theirs: c.theirs };
  }
  for (const p of Object.keys(kept)) repo.workdir[p] = kept[p];
  refreshIgnore(repo);

  if (conflicts.length) {
    repo.MERGE_HEAD = theirs;
    repo.MERGE_MSG = `Merge branch '${theirName}'`;
    return err(
      conflicts.map((c) => `CONFLICT (content): Merge conflict in ${c.path}`).join('\n') +
        '\nAutomatic merge failed; fix conflicts and then commit the result.',
      '衝突したファイルを `edit <ファイル名>` で開き、マーカーを消して → `git add` → `git commit`。'
    );
  }

  const msg = flags['-m'] || `Merge branch '${theirName}'`;
  const tree = writeTree(repo, repo.index);
  const sha = writeCommit(repo, { tree, parents: [ours, theirs], message: msg });
  setHeadCommit(repo, sha);
  return ok(
    `Merge made by the 'ort' strategy.\n[${currentBranch(repo)} ${sha}] ${msg}\n（親が2つあるマージコミットができました）`
  );
}

function conflictMarkerText(c, theirName) {
  return `<<<<<<< HEAD\n${c.ours}=======\n${c.theirs}>>>>>>> ${theirName}\n`;
}

// ---------------------------------------------------------------- reset / revert

function cmdReset(repo, argv) {
  const guard = needRepo(repo);
  if (guard) return guard;
  const { flags, args } = parseFlags(argv);
  const mode = flags['--soft'] ? 'soft' : flags['--hard'] ? 'hard' : 'mixed';
  const target = args[0] ? resolveRev(repo, args[0]) : headCommit(repo);
  if (args[0] && !target) {
    return err(
      `fatal: ambiguous argument '${args[0]}': unknown revision or path not in the working tree.`,
      'HEAD~1 や ブランチ名、コミット sha を指定します。'
    );
  }

  const wasTracked = trackedPaths(repo);
  const before = headCommit(repo);
  setHeadCommit(repo, target);

  if (mode === 'soft') {
    return ok(
      `HEAD は ${target} に移動。index と作業ツリーはそのまま。\n（直前のコミット内容がステージ済みとして残っています）`,
      '--soft = HEAD だけ動かす。コミットし直したいときに便利。'
    );
  }

  const tree = commitTree(repo, target);
  repo.index = Object.create(null);
  for (const p of Object.keys(tree)) repo.index[p] = tree[p];

  if (mode === 'mixed') {
    refreshIgnore(repo);
    return ok(
      `Unstaged changes after reset:\nHEAD は ${target} に移動。ステージは巻き戻し、作業ツリーはそのまま。`,
      '--mixed（既定）= HEAD と index を戻す。ファイルの中身は消えません。'
    );
  }

  checkoutIndexToWorkdir(repo, wasTracked);
  repo.conflicts = Object.create(null);
  repo.MERGE_HEAD = null;
  return ok(
    `HEAD is now at ${target} ${readCommit(repo, target) ? readCommit(repo, target).message : ''}\n（HEAD・ステージ・作業ツリーの3つ全部を巻き戻しました。${before} の変更は消えました）`,
    '--hard は編集内容が消えます。迷ったら --hard 以外を。'
  );
}

function cmdRevert(repo, argv) {
  const guard = needRepo(repo) || needCommit(repo);
  if (guard) return guard;
  const { args } = parseFlags(argv);
  const sha = resolveRev(repo, args[0]);
  if (!sha) return err(`fatal: bad revision '${args[0]}'`);
  const c = readCommit(repo, sha);
  const before = c.parents.length ? commitTree(repo, c.parents[0]) : Object.create(null);
  const after = commitTree(repo, sha);
  const cur = { ...repo.index };
  for (const p of new Set([...Object.keys(before), ...Object.keys(after)])) {
    if (before[p] === after[p]) continue;
    if (before[p] === undefined) delete cur[p];
    else cur[p] = before[p];
  }
  repo.index = cur;
  const wasTracked = trackedPaths(repo);
  checkoutIndexToWorkdir(repo, wasTracked);
  const msg = `Revert "${c.message}"`;
  const tree = writeTree(repo, repo.index);
  const newSha = writeCommit(repo, { tree, parents: [headCommit(repo)], message: msg });
  setHeadCommit(repo, newSha);
  return ok(
    `[${currentBranch(repo)} ${newSha}] ${msg}\n（打ち消すコミットを新しく積みました。歴史は書き換えていません）`,
    'revert は歴史を消さずに「逆の変更」を足します。公開済みブランチの安全なやり直し方。'
  );
}

// ---------------------------------------------------------------- rebase / cherry-pick

function cmdRebase(repo, argv) {
  const guard = needRepo(repo) || needCommit(repo);
  if (guard) return guard;
  const { flags, args } = parseFlags(argv, { withValue: ['--onto'] });

  if (flags['--abort']) {
    if (!repo.REBASE) return err('fatal: No rebase in progress?');
    const st = repo.REBASE;
    repo.refs[st.originalBranch] = st.originalHead;
    repo.HEAD = { type: 'branch', ref: st.originalBranch };
    repo.REBASE = null;
    repo.conflicts = Object.create(null);
    checkoutCommit(repo, st.originalHead);
    return ok('rebase を中止し、開始前の状態に戻しました。');
  }
  if (flags['--continue']) {
    if (!repo.REBASE) return err('fatal: No rebase in progress?');
    if (Object.keys(repo.conflicts).length) {
      return err(
        'error: 未解消のコンフリクトがあります。',
        '編集して `git add <file>` してから `git rebase --continue`。'
      );
    }
    const st = repo.REBASE;
    const c = readCommit(repo, st.current);
    const tree = writeTree(repo, repo.index);
    const sha = writeCommit(repo, { tree, parents: [headCommit(repo)], message: c.message });
    setHeadCommit(repo, sha);
    return continueRebase(repo, `${st.current} を ${sha} として適用しました。`);
  }
  if (repo.REBASE) {
    return err(
      'fatal: It seems that there is already a rebase directory.',
      '進行中の rebase があります。`git rebase --continue` か `--abort`。'
    );
  }
  if (!isClean(repo)) {
    return err(
      'error: cannot rebase: You have unstaged changes.',
      '先に commit か stash をしてください。'
    );
  }

  const upstreamName = args[0];
  if (!upstreamName) return err('fatal: 対象を指定してください。例: `git rebase main`');
  const upstream = resolveRev(repo, upstreamName);
  if (!upstream) return err(`fatal: invalid upstream '${upstreamName}'`);
  const onto = flags['--onto'] ? resolveRev(repo, flags['--onto']) : upstream;
  const branchRef = headRef(repo);
  if (!branchRef) return err('fatal: 分離 HEAD 状態では rebase できません。');

  const todo = commitsBetween(repo, upstream, headCommit(repo));
  if (!todo.length) {
    return ok(
      `Current branch ${currentBranch(repo)} is up to date.`,
      '付け替える必要のあるコミットがありません。'
    );
  }

  repo.REBASE = {
    onto,
    todo,
    index: 0,
    current: null,
    originalBranch: branchRef,
    originalHead: headCommit(repo),
    log: [`Rebasing (${todo.length} commits) onto ${onto}`],
  };
  setHeadCommit(repo, onto);
  checkoutCommit(repo, onto);
  return continueRebase(repo, '');
}

/** rebase の todo を順に適用する。衝突したら止めてユーザーに渡す。 */
function continueRebase(repo, prefix) {
  const st = repo.REBASE;
  if (!st) return ok(prefix);
  const lines = prefix ? [prefix] : [];

  while (st.index < st.todo.length) {
    const sha = st.todo[st.index];
    st.index++;
    st.current = sha;
    const res = applyCommitOnto(repo, sha, readCommit(repo, sha).message);
    if (res.conflict) {
      lines.push(
        `Auto-merging ...`,
        `CONFLICT (content): Merge conflict in ${res.conflict.join(', ')}`,
        `error: could not apply ${sha}... ${readCommit(repo, sha).message}`
      );
      return {
        ok: false,
        out: lines.join('\n'),
        hint: '衝突を直して `git add <file>` → `git rebase --continue`。やめるなら `git rebase --abort`。',
      };
    }
    lines.push(`  ${sha} → ${res.sha}  ${readCommit(repo, sha).message}`);
  }

  // 全部適用できた。元のブランチを先端へ移す
  const finalSha = headCommit(repo);
  repo.refs[st.originalBranch] = finalSha;
  repo.HEAD = { type: 'branch', ref: st.originalBranch };
  repo.REBASE = null;
  lines.push(
    `Successfully rebased and updated ${st.originalBranch}.`,
    '（sha が全部変わったことに注目。rebase は「同じ変更の新しいコミット」を作り直しています）'
  );
  return ok(lines.join('\n'));
}

/**
 * 1つのコミットの変更を、現在の HEAD の上に適用する（cherry-pick / rebase の共通処理）。
 * @returns {{sha?:string, conflict?:string[]}}
 */
function applyCommitOnto(repo, sha, message) {
  const c = readCommit(repo, sha);
  const parent = c.parents[0];
  const baseTree = parent ? commitTree(repo, parent) : Object.create(null);
  const theirTree = commitTree(repo, sha);
  const ourTree = commitTree(repo, headCommit(repo));

  const result = Object.create(null);
  const conflicts = [];
  const paths = new Set([
    ...Object.keys(baseTree),
    ...Object.keys(theirTree),
    ...Object.keys(ourTree),
  ]);
  for (const p of paths) {
    const b = baseTree[p] ? readBlob(repo, baseTree[p]) : null;
    const t = theirTree[p] ? readBlob(repo, theirTree[p]) : null;
    const o = ourTree[p] ? readBlob(repo, ourTree[p]) : null;
    if (b === t) {
      // このコミットは p を触っていない → ours をそのまま
      if (o !== null) result[p] = ourTree[p];
      continue;
    }
    if (o === null) {
      if (t !== null) result[p] = writeBlob(repo, t);
      continue;
    }
    if (t === null) continue; // 削除を適用
    if (o === b) {
      result[p] = writeBlob(repo, t);
      continue;
    }
    const m = mergeText(b ?? '', o, t, { ourLabel: 'HEAD', theirLabel: sha + ' (' + message + ')' });
    if (m.clean) result[p] = writeBlob(repo, m.text);
    else {
      conflicts.push(p);
      result[p] = writeBlob(repo, m.text);
      repo.conflicts[p] = { base: b ?? '', ours: o, theirs: t };
    }
  }

  const untracked = Object.keys(repo.workdir).filter((p) => !(p in repo.index) && !paths.has(p));
  const kept = Object.create(null);
  for (const p of untracked) kept[p] = repo.workdir[p];
  repo.index = Object.create(null);
  repo.workdir = Object.create(null);
  for (const p of Object.keys(result)) {
    repo.index[p] = result[p];
    repo.workdir[p] = readBlob(repo, result[p]);
  }
  for (const p of Object.keys(kept)) repo.workdir[p] = kept[p];
  refreshIgnore(repo);

  if (conflicts.length) {
    // 衝突中は index からその行を外す（未解決の印）
    for (const p of conflicts) delete repo.index[p];
    return { conflict: conflicts };
  }
  const tree = writeTree(repo, repo.index);
  const newSha = writeCommit(repo, { tree, parents: [headCommit(repo)], message });
  setHeadCommit(repo, newSha);
  return { sha: newSha };
}

function cmdCherryPick(repo, argv) {
  const guard = needRepo(repo) || needCommit(repo);
  if (guard) return guard;
  const { flags, args } = parseFlags(argv);
  if (flags['--abort']) {
    repo.CHERRY_PICK = null;
    repo.conflicts = Object.create(null);
    checkoutCommit(repo, headCommit(repo));
    return ok('cherry-pick を中止しました。');
  }
  if (flags['--continue']) {
    if (!repo.CHERRY_PICK) return err('error: no cherry-pick in progress');
    if (Object.keys(repo.conflicts).length) return err('error: 未解消のコンフリクトがあります。');
    const src = repo.CHERRY_PICK.sha;
    const tree = writeTree(repo, repo.index);
    const sha = writeCommit(repo, {
      tree,
      parents: [headCommit(repo)],
      message: readCommit(repo, src).message,
    });
    setHeadCommit(repo, sha);
    repo.CHERRY_PICK = null;
    return ok(`[${currentBranch(repo)} ${sha}] ${readCommit(repo, src).message}`);
  }

  const src = resolveRev(repo, args[0]);
  if (!src) return err(`fatal: bad revision '${args[0]}'`);
  const c = readCommit(repo, src);
  const res = applyCommitOnto(repo, src, c.message);
  if (res.conflict) {
    repo.CHERRY_PICK = { sha: src };
    return err(
      `CONFLICT (content): Merge conflict in ${res.conflict.join(', ')}\nerror: could not apply ${src}... ${c.message}`,
      '直して `git add` → `git cherry-pick --continue`。'
    );
  }
  return ok(
    `[${currentBranch(repo)} ${res.sha}] ${c.message}\n（元の ${src} とは別の sha になります。同じ変更の"コピー"です）`,
    'cherry-pick は1つのコミットだけを今の枝に持ってくるコマンド。'
  );
}

// ---------------------------------------------------------------- stash

function cmdStash(repo, argv) {
  const guard = needRepo(repo) || needCommit(repo);
  if (guard) return guard;
  const { args } = parseFlags(argv);
  const sub = args[0] || 'push';

  if (sub === 'list') {
    if (!repo.stash.length) return ok('（stash は空です）');
    return ok(
      repo.stash
        .map((s, i) => `stash@{${i}}: WIP on ${s.branch}: ${s.message}`)
        .reverse()
        .join('\n')
    );
  }

  if (sub === 'push' || sub === 'save') {
    if (isClean(repo)) return ok('No local changes to save');
    repo.stash.push({
      branch: currentBranch(repo),
      message: readCommit(repo, headCommit(repo))?.message || '',
      index: { ...repo.index },
      workdir: { ...repo.workdir },
      head: headCommit(repo),
    });
    const wasTracked = trackedPaths(repo);
    checkoutCommit(repo, headCommit(repo), { keepUntracked: true });
    void wasTracked;
    return ok(
      `Saved working directory and index state WIP on ${currentBranch(repo)}\n（作業中の変更を退避しました。作業ツリーはコミット直後の状態です）`,
      '戻すときは `git stash pop`。'
    );
  }

  if (sub === 'pop' || sub === 'apply') {
    if (!repo.stash.length) return err('No stash entries found.');
    const s = sub === 'pop' ? repo.stash.pop() : repo.stash[repo.stash.length - 1];
    for (const p of Object.keys(s.workdir)) repo.workdir[p] = s.workdir[p];
    repo.index = { ...s.index };
    refreshIgnore(repo);
    return ok(
      `退避していた変更を戻しました${sub === 'pop' ? '（stash からは削除）' : '（stash には残っています）'}`
    );
  }
  if (sub === 'drop') {
    if (!repo.stash.length) return err('No stash entries found.');
    repo.stash.pop();
    return ok('stash を1件捨てました。');
  }
  return err(`error: unknown stash subcommand: ${sub}`, '使えるのは push / pop / apply / list / drop。');
}

// ---------------------------------------------------------------- tag

function cmdTag(repo, argv) {
  const guard = needRepo(repo);
  if (guard) return guard;
  const { flags, args } = parseFlags(argv, { withValue: ['-m'] });
  if (flags['-d']) {
    const ref = 'refs/tags/' + args[0];
    if (!(ref in repo.refs)) return err(`error: tag '${args[0]}' not found.`);
    delete repo.refs[ref];
    return ok(`Deleted tag '${args[0]}'`);
  }
  if (!args.length) return ok(listTags(repo).join('\n') || '（タグはまだありません）');
  const sha = args[1] ? resolveRev(repo, args[1]) : headCommit(repo);
  if (!sha) return needCommit(repo);
  repo.refs['refs/tags/' + args[0]] = sha;
  return ok(
    `タグ ${args[0]} を ${sha} に付けました`,
    'タグは動かない目印。リリース地点に付けるのが定番です。'
  );
}

// ---------------------------------------------------------------- remote / clone

function getRemote(repo, name = 'origin') {
  return repo.remotes[name] || null;
}

function copyObjects(from, to, tip) {
  for (const sha of ancestors(from, tip)) {
    const c = from.objects[sha];
    if (!c) continue;
    to.objects[sha] = JSON.parse(JSON.stringify(c));
    if (c.type === 'commit') {
      const tree = from.objects[c.tree];
      if (tree) {
        to.objects[c.tree] = JSON.parse(JSON.stringify(tree));
        for (const blobSha of Object.values(tree.entries)) {
          if (from.objects[blobSha]) to.objects[blobSha] = JSON.parse(JSON.stringify(from.objects[blobSha]));
        }
      }
    }
  }
}

function cmdRemote(repo, argv) {
  const guard = needRepo(repo);
  if (guard) return guard;
  const { flags, args } = parseFlags(argv);
  const sub = args[0];

  if (!sub || flags['-v']) {
    const lines = [];
    for (const [name, r] of Object.entries(repo.remotes)) {
      if (flags['-v']) lines.push(`${name}\t${r.url} (fetch)`, `${name}\t${r.url} (push)`);
      else lines.push(name);
    }
    return ok(lines.join('\n') || '（リモートはまだ登録されていません）');
  }
  if (sub === 'add') {
    const name = args[1];
    const url = args[2];
    if (!name || !url) return err('usage: git remote add <name> <url>');
    if (repo.remotes[name]) return err(`error: remote ${name} already exists.`);
    repo.remotes[name] = { url, repo: createRepo({ bare: true }) };
    repo.remotes[name].repo.initialized = true;
    repo.remotes[name].repo.index = Object.create(null);
    return ok(
      `リモート ${name} を登録しました → ${url}\n（まだ何も送っていません。送るのは \`git push\`）`
    );
  }
  if (sub === 'remove' || sub === 'rm') {
    delete repo.remotes[args[1]];
    for (const ref of Object.keys(repo.refs)) {
      if (ref.startsWith('refs/remotes/' + args[1] + '/')) delete repo.refs[ref];
    }
    return ok(`リモート ${args[1]} を削除しました`);
  }
  return err(`error: Unknown subcommand: ${sub}`);
}

function cmdClone(repo, argv, ctx) {
  const { args } = parseFlags(argv);
  const url = args[0];
  if (!url) return err('fatal: You must specify a repository to clone.');
  const source = ctx && ctx.remoteFactory ? ctx.remoteFactory(url) : null;
  if (!source) {
    return err(
      `fatal: repository '${url}' does not exist`,
      'このステージで clone できる URL はクエスト画面に書かれています。'
    );
  }
  const fresh = initRepo({ defaultBranch: source.defaultBranch || 'main' });
  fresh.remotes.origin = { url, repo: source };
  for (const [ref, sha] of Object.entries(source.refs)) {
    if (!ref.startsWith('refs/heads/')) continue;
    copyObjects(source, fresh, sha);
    fresh.refs['refs/remotes/origin/' + ref.replace('refs/heads/', '')] = sha;
  }
  const def = source.defaultBranch || 'main';
  const tip = source.refs['refs/heads/' + def];
  if (tip) {
    fresh.refs['refs/heads/' + def] = tip;
    fresh.HEAD = { type: 'branch', ref: 'refs/heads/' + def };
    checkoutCommit(fresh, tip);
  }
  Object.assign(repo, fresh);
  return ok(
    `Cloning into '${url.split('/').pop().replace(/\.git$/, '')}'...\nremote: Enumerating objects...\nリモートの内容を丸ごと取得しました。\n（clone = init + remote add + fetch + switch を一度にやるコマンド）`
  );
}

function cmdFetch(repo, argv) {
  const guard = needRepo(repo);
  if (guard) return guard;
  const remote = getRemote(repo);
  if (!remote) return err('fatal: No remote repository specified.', '先に `git remote add origin <url>`。');
  const lines = [`From ${remote.url}`];
  let changed = 0;
  for (const [ref, sha] of Object.entries(remote.repo.refs)) {
    if (!ref.startsWith('refs/heads/')) continue;
    const name = ref.replace('refs/heads/', '');
    const trackRef = 'refs/remotes/origin/' + name;
    if (repo.refs[trackRef] !== sha) {
      copyObjects(remote.repo, repo, sha);
      const old = repo.refs[trackRef];
      repo.refs[trackRef] = sha;
      lines.push(`   ${(old || '').slice(0, 7)}..${sha}  ${name} -> origin/${name}`);
      changed++;
    }
  }
  if (!changed) return ok('（すでに最新です）');
  lines.push(
    '',
    'origin/* の位置だけ更新しました。作業ツリーは変わっていません。',
    'ローカルブランチに取り込むには `git merge origin/<branch>` か `git pull`。'
  );
  return ok(lines.join('\n'));
}

function cmdPull(repo, argv) {
  const guard = needRepo(repo);
  if (guard) return guard;
  const { flags } = parseFlags(argv);
  const f = cmdFetch(repo, []);
  if (!f.ok) return f;
  const br = currentBranch(repo);
  const trackRef = 'refs/remotes/origin/' + br;
  if (!(trackRef in repo.refs)) {
    return err(
      `There is no tracking information for the current branch.`,
      '追跡先が未設定です。`git push -u origin ' + br + '` で紐づけましょう。'
    );
  }
  const sub = flags['--rebase'] ? cmdRebase(repo, ['origin/' + br]) : cmdMerge(repo, ['origin/' + br]);
  return {
    ok: sub.ok,
    out: f.out + '\n' + sub.out,
    hint: flags['--rebase']
      ? 'pull --rebase は「取ってきて、自分の分を上に載せ直す」。歴史が一直線になります。'
      : sub.hint || 'pull = fetch + merge。中で2つのことをやっています。',
  };
}

function cmdPush(repo, argv) {
  const guard = needRepo(repo) || needCommit(repo);
  if (guard) return guard;
  const { flags, args } = parseFlags(argv);
  const remote = getRemote(repo, args[0] || 'origin');
  if (!remote) {
    return err(
      'fatal: No configured push destination.',
      '`git remote add origin <url>` でリモートを登録してから。'
    );
  }
  const br = args[1] || currentBranch(repo);
  if (!br) return err('fatal: 分離 HEAD からは push できません。');

  if (flags['--delete']) {
    delete remote.repo.refs['refs/heads/' + br];
    delete repo.refs['refs/remotes/origin/' + br];
    return ok(` - [deleted]         ${br}`);
  }

  const local = repo.refs['refs/heads/' + br];
  if (!local) return err(`error: src refspec ${br} does not match any`);
  const remoteSha = remote.repo.refs['refs/heads/' + br];

  if (remoteSha === local) {
    if (flags['-u'] || flags['--set-upstream']) {
      repo.refs['refs/remotes/origin/' + br] = local;
      return ok(`branch '${br}' set up to track 'origin/${br}'.\nEverything up-to-date`);
    }
    return ok('Everything up-to-date');
  }

  if (remoteSha && !isAncestor(repo, remoteSha, local) && !flags['--force'] && !flags['-f']) {
    return err(
      ` ! [rejected]        ${br} -> ${br} (non-fast-forward)\nerror: failed to push some refs to '${remote.url}'\nhint: Updates were rejected because the tip of your current branch is behind its remote counterpart.`,
      'リモートに自分の知らないコミットがあります。まず `git pull`（または `git pull --rebase`）を。'
    );
  }

  copyObjects(repo, remote.repo, local);
  remote.repo.refs['refs/heads/' + br] = local;
  if (!remote.repo.defaultBranch) remote.repo.defaultBranch = br;
  repo.refs['refs/remotes/origin/' + br] = local;

  const lines = [
    `To ${remote.url}`,
    `   ${(remoteSha || '').slice(0, 7)}..${local}  ${br} -> ${br}`,
  ];
  if (flags['-u'] || flags['--set-upstream']) {
    lines.push(`branch '${br}' set up to track 'origin/${br}'.`);
    lines.push('（-u で追跡先を覚えたので、次からは `git push` だけで済みます）');
  }
  return ok(lines.join('\n'));
}

// ---------------------------------------------------------------- clean / help

function cmdClean(repo, argv) {
  const guard = needRepo(repo);
  if (guard) return guard;
  const { flags } = parseFlags(argv);
  if (!flags['-f'] && !flags['-fd'] && !flags['--force']) {
    return err(
      'fatal: clean.requireForce defaults to true and neither -i, -n, nor -f given; refusing to clean',
      '本当に消すなら `git clean -f`。未追跡ファイルが消えます。'
    );
  }
  const s = status(repo);
  for (const p of s.untracked) delete repo.workdir[p];
  return ok(s.untracked.map((p) => `Removing ${p}`).join('\n') || '（消す未追跡ファイルはありません）');
}

const HELP = {
  init: ['git init', '今いるフォルダを git の管理下に置きます。.git が作られます。'],
  add: ['git add <file> / git add .', '変更をステージ（次のコミットに入れる箱）に載せます。'],
  commit: ['git commit -m "メッセージ"', 'ステージの内容を1つの記録として確定します。'],
  status: ['git status', '作業ツリー・ステージ・HEAD の食い違いを見ます。困ったらまずこれ。'],
  log: ['git log --oneline --graph --all', 'コミットの履歴を見ます。'],
  diff: ['git diff / git diff --staged', '無印は「作業ツリー↔ステージ」、--staged は「ステージ↔コミット」。'],
  restore: ['git restore <file> / --staged <file>', '変更の取り消し。--staged はステージから外すだけ。'],
  reset: ['git reset --soft|--mixed|--hard <rev>', 'HEAD を戻す。soft=HEADのみ / mixed=+ステージ / hard=+作業ツリー。'],
  revert: ['git revert <sha>', '打ち消すコミットを新しく積みます。歴史は消しません。'],
  branch: ['git branch / -d <name>', 'ブランチの一覧・作成・削除。'],
  switch: ['git switch <name> / -c <name>', 'ブランチを切り替え。-c で作って切り替え。'],
  merge: ['git merge <branch>', '別のブランチの変更を今のブランチに取り込みます。'],
  rebase: ['git rebase <base>', '自分のコミットを base の上に付け替えます。sha は作り直されます。'],
  'cherry-pick': ['git cherry-pick <sha>', 'そのコミット1つ分の変更だけを今の枝に持ってきます。'],
  stash: ['git stash / git stash pop', '作業中の変更を一時的に退避／復元します。'],
  tag: ['git tag <name>', 'コミットに動かない目印を付けます。'],
  remote: ['git remote add origin <url> / -v', 'リモートの登録と確認。'],
  clone: ['git clone <url>', 'リモートを丸ごと手元に持ってきます。'],
  fetch: ['git fetch', 'リモートの最新を取得。origin/* だけ動き、作業ツリーは変わりません。'],
  pull: ['git pull / --rebase', 'fetch + merge（または rebase）。'],
  push: ['git push -u origin <branch>', '手元のコミットをリモートに送ります。'],
};

function cmdHelp(repo, argv) {
  const { args } = parseFlags(argv);
  if (args.length && HELP[args[0]]) {
    const [usage, desc] = HELP[args[0]];
    return ok(`使い方: ${usage}\n\n${desc}`);
  }
  const lines = ['使えるコマンド:', ''];
  for (const [name, [usage, desc]] of Object.entries(HELP)) {
    lines.push(`  ${name.padEnd(12)} ${desc}`);
    void usage;
  }
  lines.push(
    '',
    '  詳しくは `git help <コマンド名>`（例: git help reset）',
    '  シェル: ls / cat / touch / echo "x" > file / rm / mv / mkdir / edit <file> / clear'
  );
  return ok(lines.join('\n'));
}

// ---------------------------------------------------------------- ディスパッチ

const TABLE = {
  init: cmdInit,
  config: cmdConfig,
  status: cmdStatus,
  add: cmdAdd,
  stage: cmdAdd,
  restore: cmdRestore,
  unstage: (r, a) => cmdRestore(r, ['--staged', ...a]),
  commit: cmdCommit,
  log: cmdLog,
  show: cmdShow,
  diff: cmdDiff,
  branch: cmdBranch,
  switch: cmdSwitch,
  checkout: (r, a) => {
    // checkout はブランチ切替とファイル復元を兼ねる古いコマンド
    const { flags, args } = parseFlags(a);
    if (flags['--'] || (args.length && !(('refs/heads/' + args[0]) in r.refs) && args[0] in r.workdir)) {
      return cmdRestore(r, args);
    }
    return cmdSwitch(r, a, { legacy: true });
  },
  merge: cmdMerge,
  reset: cmdReset,
  revert: cmdRevert,
  rebase: cmdRebase,
  'cherry-pick': cmdCherryPick,
  stash: cmdStash,
  tag: cmdTag,
  remote: cmdRemote,
  clone: cmdClone,
  fetch: cmdFetch,
  pull: cmdPull,
  push: cmdPush,
  clean: cmdClean,
  help: cmdHelp,
};

/**
 * git サブコマンドを実行する。
 * @param {object} repo
 * @param {string[]} argv 'git' を除いた残り
 * @param {object} ctx {remoteFactory} など
 */
export function runGit(repo, argv, ctx = {}) {
  if (!argv.length) return cmdHelp(repo, []);
  const sub = argv[0];
  const rest = argv.slice(1);

  if (rest.includes('--help') || rest.includes('-h')) return cmdHelp(repo, [sub]);

  const fn = TABLE[sub];
  if (!fn) {
    const close = Object.keys(TABLE).filter((k) => k.startsWith(sub.slice(0, 2)));
    return err(
      `git: '${sub}' is not a git command. See 'git help'.`,
      close.length ? `もしかして: ${close.join(', ')}` : '`git help` で一覧が見られます。'
    );
  }
  return fn(repo, rest, ctx);
}

export { HELP };
