// 擬似 Git リポジトリのデータモデル。
// 本物の git のオブジェクトモデル（blob / tree / commit と ref）を小さく再現する。
// UI からもテストからも import される、このアプリの中心。

/** 内容から短い sha を作る。FNV-1a を 2 周まわして 7 桁 hex に。 */
export function hashObject(type, payload) {
  const s = type + '\0' + payload;
  let h1 = 0x811c9dc5;
  let h2 = 0x01000193;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 0x01000193) >>> 0;
    h2 = Math.imul(h2 + c + 0x9e3779b9, 0x85ebca6b) >>> 0;
  }
  const hex = (h1 >>> 0).toString(16).padStart(8, '0') + (h2 >>> 0).toString(16).padStart(8, '0');
  return hex.slice(0, 7);
}

/** まっさらな（git init すらしていない）リポジトリ。 */
export function createRepo(opts = {}) {
  return {
    // --- どこにいるか（paths.js が扱う） ---
    projectName: opts.projectName || 'my-project',
    // いま居る場所（絶対パス）。既定はプロジェクトフォルダの直下。
    cwd: '/home/you/' + (opts.projectName || 'my-project'),
    // .git がある場所（プロジェクト相対）。'' = プロジェクト直下。null = まだ無い。
    gitRoot: null,
    // mkdir で作られた空のディレクトリ
    dirs: [],

    initialized: false,
    objects: Object.create(null), // sha -> {type, ...}
    refs: Object.create(null), // 'refs/heads/main' -> sha
    HEAD: { type: 'branch', ref: 'refs/heads/main' },
    index: null, // path -> sha （null = まだ git init していない）
    workdir: Object.create(null), // path -> 文字列の中身
    remotes: Object.create(null), // 'origin' -> {url, repo}
    stash: [],
    // HEAD がどこにいたかの履歴。消したつもりのコミットを救い出す命綱。
    reflog: [],
    MERGE_HEAD: null, // マージ中に相手側の sha を保持
    MERGE_MSG: null,
    REBASE: null, // {onto, todo:[sha...], current, originalBranch, originalHead}
    CHERRY_PICK: null, // {sha}
    conflicts: Object.create(null), // path -> {base, ours, theirs}
    ignore: [], // .gitignore のパターン
    config: { 'user.name': 'you', 'user.email': 'you@example.com' },
    clock: 0, // コミット時刻の代わり。同じ内容でも別コミットになるよう単調増加
    defaultBranch: opts.defaultBranch || 'main',
    isBare: !!opts.bare,
  };
}

/** git init 済みの空リポジトリ。 */
export function initRepo(opts = {}) {
  const repo = createRepo(opts);
  repo.initialized = true;
  repo.gitRoot = '';
  repo.index = Object.create(null);
  repo.HEAD = { type: 'branch', ref: 'refs/heads/' + repo.defaultBranch };
  return repo;
}

// ---------------------------------------------------------------- オブジェクト

export function writeBlob(repo, content) {
  const sha = hashObject('blob', content);
  repo.objects[sha] = { type: 'blob', content };
  return sha;
}

export function readBlob(repo, sha) {
  const o = repo.objects[sha];
  return o && o.type === 'blob' ? o.content : null;
}

/**
 * tree は {path: blobSha} のフラットな写像として保持する。
 * 本物の git は入れ子の tree だが、学習用としてはフラットの方が
 * 「index と tree は同じ形のスナップショット」という理解に直結する。
 */
export function writeTree(repo, entries) {
  const paths = Object.keys(entries).sort();
  const payload = paths.map((p) => p + '\0' + entries[p]).join('\n');
  const sha = hashObject('tree', payload);
  repo.objects[sha] = { type: 'tree', entries: { ...entries } };
  return sha;
}

export function readTree(repo, sha) {
  if (!sha) return Object.create(null);
  const o = repo.objects[sha];
  return o && o.type === 'tree' ? { ...o.entries } : Object.create(null);
}

export function writeCommit(repo, { tree, parents, message, author, time }) {
  const t = time !== undefined ? time : ++repo.clock;
  const payload = [
    'tree ' + tree,
    ...parents.map((p) => 'parent ' + p),
    'author ' + (author || repo.config['user.name']) + ' ' + t,
    '',
    message,
  ].join('\n');
  const sha = hashObject('commit', payload);
  repo.objects[sha] = {
    type: 'commit',
    tree,
    parents: [...parents],
    message,
    author: author || repo.config['user.name'],
    time: t,
  };
  return sha;
}

export function readCommit(repo, sha) {
  const o = repo.objects[sha];
  return o && o.type === 'commit' ? o : null;
}

/** コミットのスナップショット（{path: blobSha}）を取り出す。 */
export function commitTree(repo, sha) {
  const c = readCommit(repo, sha);
  return c ? readTree(repo, c.tree) : Object.create(null);
}

// ---------------------------------------------------------------- ref / HEAD

export function headRef(repo) {
  return repo.HEAD.type === 'branch' ? repo.HEAD.ref : null;
}

export function currentBranch(repo) {
  const ref = headRef(repo);
  return ref ? ref.replace('refs/heads/', '') : null;
}

/** HEAD が指すコミット sha。まだコミットが無ければ null。 */
export function headCommit(repo) {
  if (repo.HEAD.type === 'detached') return repo.HEAD.sha;
  return repo.refs[repo.HEAD.ref] || null;
}

export function setHeadCommit(repo, sha) {
  if (repo.HEAD.type === 'detached') repo.HEAD.sha = sha;
  else repo.refs[repo.HEAD.ref] = sha;
}

export function listBranches(repo) {
  return Object.keys(repo.refs)
    .filter((r) => r.startsWith('refs/heads/'))
    .map((r) => r.replace('refs/heads/', ''))
    .sort();
}

export function listRemoteBranches(repo) {
  return Object.keys(repo.refs)
    .filter((r) => r.startsWith('refs/remotes/'))
    .map((r) => r.replace('refs/remotes/', ''))
    .sort();
}

export function listTags(repo) {
  return Object.keys(repo.refs)
    .filter((r) => r.startsWith('refs/tags/'))
    .map((r) => r.replace('refs/tags/', ''))
    .sort();
}

/**
 * リビジョン指定を sha に解決する。
 * HEAD / HEAD~2 / HEAD^ / ブランチ名 / origin/main / タグ / 生の sha に対応。
 */
export function resolveRev(repo, rev) {
  if (!rev) return null;

  // HEAD@{2} のような reflog 参照。消えたコミットを取り戻すときに使う。
  const reflogRef = /^HEAD@\{(\d+)\}$/.exec(rev);
  if (reflogRef) {
    const entry = (repo.reflog || [])[Number(reflogRef[1])];
    return entry ? entry.sha : null;
  }

  let m = /^(.*?)([~^])(\d*)$/.exec(rev);
  if (m) {
    const base = resolveRev(repo, m[1]);
    if (!base) return null;
    const n = m[3] === '' ? 1 : parseInt(m[3], 10);
    let sha = base;
    if (m[2] === '~') {
      for (let i = 0; i < n; i++) {
        const c = readCommit(repo, sha);
        if (!c || !c.parents.length) return null;
        sha = c.parents[0];
      }
    } else {
      const c = readCommit(repo, sha);
      if (!c) return null;
      sha = c.parents[n - 1];
      if (!sha) return null;
    }
    return sha;
  }
  if (rev === 'HEAD') return headCommit(repo);
  if (repo.refs['refs/heads/' + rev]) return repo.refs['refs/heads/' + rev];
  if (repo.refs['refs/remotes/' + rev]) return repo.refs['refs/remotes/' + rev];
  if (repo.refs['refs/tags/' + rev]) return repo.refs['refs/tags/' + rev];
  if (repo.refs[rev]) return repo.refs[rev];
  if (repo.objects[rev] && repo.objects[rev].type === 'commit') return rev;
  // 短縮 sha の前方一致
  const hits = Object.keys(repo.objects).filter(
    (s) => s.startsWith(rev) && repo.objects[s].type === 'commit'
  );
  return hits.length === 1 ? hits[0] : null;
}

// ---------------------------------------------------------------- 履歴の探索

/** sha から辿れる全祖先（自分含む）。 */
export function ancestors(repo, sha) {
  const seen = new Set();
  const stack = sha ? [sha] : [];
  while (stack.length) {
    const s = stack.pop();
    if (!s || seen.has(s)) continue;
    seen.add(s);
    const c = readCommit(repo, s);
    if (c) stack.push(...c.parents);
  }
  return seen;
}

export function isAncestor(repo, maybeAncestor, sha) {
  if (!maybeAncestor || !sha) return false;
  return ancestors(repo, sha).has(maybeAncestor);
}

/** 2つのコミットの共通祖先（merge base）。時刻が新しいものを優先。 */
export function mergeBase(repo, a, b) {
  if (!a || !b) return null;
  const aAll = ancestors(repo, a);
  const common = [...ancestors(repo, b)].filter((s) => aAll.has(s));
  if (!common.length) return null;
  common.sort((x, y) => (readCommit(repo, y).time || 0) - (readCommit(repo, x).time || 0));
  return common[0];
}

/** 新しい順のコミット列。 */
export function commitList(repo, tips) {
  const seen = new Set();
  for (const t of tips) for (const s of ancestors(repo, t)) seen.add(s);
  return [...seen]
    .filter((s) => readCommit(repo, s))
    .sort((a, b) => {
      const d = readCommit(repo, b).time - readCommit(repo, a).time;
      return d !== 0 ? d : a < b ? 1 : -1;
    });
}

/** `sha` にはあって `exclude` から辿れないコミットを、古い順で返す（rebase / cherry-pick 用）。 */
export function commitsBetween(repo, exclude, sha) {
  const ex = ancestors(repo, exclude);
  return [...ancestors(repo, sha)]
    .filter((s) => !ex.has(s) && readCommit(repo, s))
    .sort((a, b) => readCommit(repo, a).time - readCommit(repo, b).time);
}

// ---------------------------------------------------------------- 作業ツリー

export function isIgnored(repo, path) {
  return repo.ignore.some((pat) => {
    if (pat === '') return false;
    if (pat.endsWith('/')) return path.startsWith(pat);
    if (pat.startsWith('*')) return path.endsWith(pat.slice(1));
    if (pat.endsWith('*')) return path.startsWith(pat.slice(0, -1));
    return path === pat || path.startsWith(pat + '/');
  });
}

export function refreshIgnore(repo) {
  const gi = repo.workdir['.gitignore'];
  repo.ignore = gi
    ? gi
        .split('\n')
        .map((l) => l.trim())
        .filter((l) => l && !l.startsWith('#'))
    : [];
}

/**
 * 作業ツリーのうち、リポジトリの中にあるものだけを
 * 「リポジトリルートからの相対パス」に直して返す。
 * 通常 gitRoot はプロジェクト直下なのでそのままだが、
 * サブディレクトリに作られた（入れ子）場合はここでずれを吸収する。
 */
export function repoWorkdir(repo) {
  const root = repo.gitRoot;
  if (!root) return repo.workdir;
  const out = Object.create(null);
  const prefix = root + '/';
  for (const [p, content] of Object.entries(repo.workdir)) {
    if (p.startsWith(prefix)) out[p.slice(prefix.length)] = content;
  }
  return out;
}

/** リポジトリ相対パス → 作業ツリー（プロジェクト相対）のキー。 */
export function toWorkKey(repo, repoRel) {
  return repo.gitRoot ? repo.gitRoot + '/' + repoRel : repoRel;
}

/** リポジトリの外にあるファイル。作業ツリーを作り直すときに巻き添えにしないため。 */
export function outsideRepo(repo) {
  const root = repo.gitRoot;
  if (!root) return Object.create(null);
  const out = Object.create(null);
  const prefix = root + '/';
  for (const [p, c] of Object.entries(repo.workdir)) {
    if (!p.startsWith(prefix)) out[p] = c;
  }
  return out;
}

/**
 * 作業ツリー / index / HEAD の3者を比較した状態。
 * git status の表示も、ステージのクリア判定もこれ1本で作る。
 */
export function status(repo) {
  refreshIgnore(repo);
  const head = commitTree(repo, headCommit(repo));
  const index = repo.index || Object.create(null);
  const work = repoWorkdir(repo);
  const staged = []; // index と HEAD の差 = コミット予定
  const unstaged = []; // 作業ツリーと index の差
  const untracked = [];
  const conflicted = Object.keys(repo.conflicts).sort();

  const allPaths = new Set([...Object.keys(head), ...Object.keys(index), ...Object.keys(work)]);
  for (const p of [...allPaths].sort()) {
    if (conflicted.includes(p)) continue;
    const inHead = p in head;
    const inIndex = p in index;
    const inWork = p in work;

    if (inIndex && !inHead) staged.push({ path: p, kind: 'new' });
    else if (!inIndex && inHead) staged.push({ path: p, kind: 'deleted' });
    else if (inIndex && inHead && head[p] !== index[p]) staged.push({ path: p, kind: 'modified' });

    if (inIndex && inWork) {
      const sha = hashObject('blob', work[p]);
      if (sha !== index[p]) unstaged.push({ path: p, kind: 'modified' });
    } else if (inIndex && !inWork) {
      unstaged.push({ path: p, kind: 'deleted' });
    } else if (!inIndex && inWork) {
      if (!isIgnored(repo, p)) untracked.push(p);
    }
  }
  return { staged, unstaged, untracked, conflicted };
}

export function isClean(repo) {
  const s = status(repo);
  return !s.staged.length && !s.unstaged.length && !s.conflicted.length;
}

/** index に載っているパス、あるいは HEAD に載っているパス = 追跡中のファイル。 */
export function trackedPaths(repo) {
  const set = new Set(Object.keys(repo.index || {}));
  for (const p of Object.keys(commitTree(repo, headCommit(repo)))) set.add(p);
  return set;
}

/**
 * index の内容をそのまま作業ツリーに書き戻す（reset --hard の後半）。
 * `wasTracked` に入っていない = 一度も add されていないファイルだけが生き残る。
 */
export function checkoutIndexToWorkdir(repo, wasTracked = new Set()) {
  const work = repoWorkdir(repo);
  const next = Object.create(null);
  for (const p of Object.keys(work)) {
    if (!wasTracked.has(p)) next[p] = work[p];
  }
  for (const p of Object.keys(repo.index)) {
    next[p] = readBlob(repo, repo.index[p]) ?? '';
  }
  const rebuilt = outsideRepo(repo);
  for (const [p, c] of Object.entries(next)) rebuilt[toWorkKey(repo, p)] = c;
  repo.workdir = rebuilt;
  refreshIgnore(repo);
}

/** あるコミットのスナップショットを index と作業ツリーに展開する。 */
export function checkoutCommit(repo, sha, { keepUntracked = true } = {}) {
  const tree = commitTree(repo, sha);
  const work = repoWorkdir(repo);
  const untracked = keepUntracked
    ? Object.keys(work).filter((p) => !(p in repo.index) && !(p in tree))
    : [];
  const kept = Object.create(null);
  for (const p of untracked) kept[p] = work[p];

  repo.index = Object.create(null);
  const next = Object.create(null);
  for (const p of Object.keys(tree)) {
    repo.index[p] = tree[p];
    next[p] = readBlob(repo, tree[p]) ?? '';
  }
  for (const p of Object.keys(kept)) next[p] = kept[p];

  // リポジトリの外のファイルは触らない
  const rebuilt = outsideRepo(repo);
  for (const [p, c] of Object.entries(next)) rebuilt[toWorkKey(repo, p)] = c;
  repo.workdir = rebuilt;
  refreshIgnore(repo);
}

/** 作業ツリーの現在の中身から index 用の写像を作る（全ファイル add 相当）。 */
export function workdirToEntries(repo, paths) {
  const entries = Object.create(null);
  for (const p of paths) entries[p] = writeBlob(repo, repo.workdir[p]);
  return entries;
}

/** リポジトリの deep copy。ステージのやり直しやテストで使う。 */
export function cloneState(repo) {
  return JSON.parse(JSON.stringify(repo));
}
