// 「今どこにいるか」を扱う層。
//
// git の事故の多くは、コマンドそのものではなく **どこで打ったか** で起きます。
//   - リポジトリの外で打っていた
//   - サブディレクトリにいるのに `git add .` で全部入ったと思い込んだ
//   - うっかりサブディレクトリで `git init` して入れ子のリポジトリを作った
// これらを体験できるように、擬似シェルにカレントディレクトリを持たせます。
//
// 座標系が3つあるので、混同しないように名前で区別しています。
//   絶対パス       : /home/you/my-project/src/app.js
//   プロジェクト相対: src/app.js        （repo.workdir のキー）
//   リポジトリ相対  : src/app.js        （index / tree のキー。gitRoot からの相対）
// 通常は gitRoot がプロジェクト直下なので後ろ2つは一致しますが、
// 入れ子リポジトリを作るとずれます。そこが学びどころなので分けてあります。

export const HOME = '/home/you';

/** プロジェクトフォルダの絶対パス。 */
export function projectDir(repo) {
  return HOME + '/' + (repo.projectName || 'my-project');
}

/** `a//b/./c/../d` のような形を正規化する。先頭の / は保つ。 */
export function normalize(path) {
  const absolute = path.startsWith('/');
  const parts = [];
  for (const seg of path.split('/')) {
    if (!seg || seg === '.') continue;
    if (seg === '..') {
      if (parts.length) parts.pop();
      continue;
    }
    parts.push(seg);
  }
  return (absolute ? '/' : '') + parts.join('/');
}

/**
 * シェルの引数を絶対パスにする。
 * `~` はホーム、`/` 始まりは絶対、それ以外は cwd からの相対。
 */
export function toAbsolute(repo, arg) {
  if (!arg || arg === '.') return repo.cwd;
  if (arg === '~') return HOME;
  if (arg.startsWith('~/')) return normalize(HOME + '/' + arg.slice(2));
  if (arg.startsWith('/')) return normalize(arg);
  return normalize(repo.cwd + '/' + arg);
}

/**
 * 絶対パスをプロジェクト相対に。プロジェクトの外なら null。
 * プロジェクト直下そのものは '' を返す。
 */
export function toProjectRel(repo, abs) {
  const dir = projectDir(repo);
  if (abs === dir) return '';
  if (abs.startsWith(dir + '/')) return abs.slice(dir.length + 1);
  return null;
}

/** プロジェクト相対パスを絶対パスに。 */
export function toAbs(repo, rel) {
  return rel ? projectDir(repo) + '/' + rel : projectDir(repo);
}

/** いま居る場所のプロジェクト相対パス。プロジェクトの外にいれば null。 */
export function cwdRel(repo) {
  return toProjectRel(repo, repo.cwd);
}

/** `~/my-project/src` の形。プロンプト表示用。 */
export function displayPath(repo, abs = repo.cwd) {
  return abs === HOME ? '~' : abs.startsWith(HOME + '/') ? '~/' + abs.slice(HOME.length + 1) : abs;
}

// ---------------------------------------------------------------- リポジトリの位置

/**
 * いま居る場所から見て、どのリポジトリの中にいるか。
 * 本物の git と同じく、上に向かって .git を探す動きを再現している。
 * @returns {boolean}
 */
export function inRepo(repo) {
  if (repo.gitRoot === null || repo.gitRoot === undefined) return false;
  const here = cwdRel(repo);
  if (here === null) return false; // プロジェクトの外
  if (repo.gitRoot === '') return true; // プロジェクト全体がリポジトリ
  return here === repo.gitRoot || here.startsWith(repo.gitRoot + '/');
}

/** リポジトリの絶対パス（.git のある場所）。無ければ null。 */
export function repoDirAbs(repo) {
  if (repo.gitRoot === null || repo.gitRoot === undefined) return null;
  return toAbs(repo, repo.gitRoot);
}

/** プロジェクト相対 → リポジトリ相対（index / tree のキー）。 */
export function projectRelToRepoRel(repo, projRel) {
  if (!repo.gitRoot) return projRel;
  if (projRel === repo.gitRoot) return '';
  if (projRel.startsWith(repo.gitRoot + '/')) return projRel.slice(repo.gitRoot.length + 1);
  return null; // リポジトリの外のファイル
}

/** リポジトリ相対 → プロジェクト相対。 */
export function repoRelToProjectRel(repo, repoRel) {
  if (!repo.gitRoot) return repoRel;
  return repoRel ? repo.gitRoot + '/' + repoRel : repo.gitRoot;
}

/** いま居る場所を、リポジトリのルートから見た相対パスで。ルートなら ''。 */
export function cwdInRepo(repo) {
  const here = cwdRel(repo);
  if (here === null) return null;
  return projectRelToRepoRel(repo, here);
}

/**
 * リポジトリ相対パスを、いま居る場所から見た表示に変える。
 * 本物の git status と同じく、サブディレクトリにいると `../` が付く。
 */
export function displayRepoPath(repo, repoRel) {
  const here = cwdInRepo(repo);
  if (!here) return repoRel;
  if (repoRel === here || repoRel.startsWith(here + '/')) {
    return repoRel.slice(here.length + 1) || '.';
  }
  // 上の階層にあるものは ../ を付けて示す
  const up = here.split('/').length;
  return '../'.repeat(up) + repoRel;
}

// ---------------------------------------------------------------- ディレクトリ

/**
 * 存在するディレクトリの一覧（プロジェクト相対）。
 * ファイルのパスから導かれるものと、mkdir で作られたものの両方。
 */
export function allDirs(repo) {
  const dirs = new Set(['']);
  for (const d of repo.dirs || []) {
    let acc = '';
    for (const seg of d.split('/')) {
      acc = acc ? acc + '/' + seg : seg;
      dirs.add(acc);
    }
  }
  for (const p of Object.keys(repo.workdir)) {
    const segs = p.split('/');
    segs.pop();
    let acc = '';
    for (const seg of segs) {
      acc = acc ? acc + '/' + seg : seg;
      dirs.add(acc);
    }
  }
  return dirs;
}

/** その絶対パスはディレクトリとして存在するか。 */
export function isDir(repo, abs) {
  if (abs === HOME) return true;
  const rel = toProjectRel(repo, abs);
  if (rel === null) return false;
  return allDirs(repo).has(rel);
}

/** その絶対パスはファイルとして存在するか。 */
export function isFile(repo, abs) {
  const rel = toProjectRel(repo, abs);
  return rel !== null && rel !== '' && rel in repo.workdir;
}

/**
 * ディレクトリの中身を1階層だけ返す。
 * @returns {{dirs: string[], files: string[]}} 名前だけ（パスではない）
 */
export function listDir(repo, abs) {
  if (abs === HOME) {
    return { dirs: [repo.projectName || 'my-project'], files: [] };
  }
  const base = toProjectRel(repo, abs);
  if (base === null) return { dirs: [], files: [] };
  const prefix = base ? base + '/' : '';

  const dirs = new Set();
  const files = [];
  for (const p of Object.keys(repo.workdir)) {
    if (!p.startsWith(prefix)) continue;
    const rest = p.slice(prefix.length);
    if (!rest) continue;
    const slash = rest.indexOf('/');
    if (slash === -1) files.push(rest);
    else dirs.add(rest.slice(0, slash));
  }
  for (const d of allDirs(repo)) {
    if (!d.startsWith(prefix) || d === base) continue;
    const rest = d.slice(prefix.length);
    const slash = rest.indexOf('/');
    dirs.add(slash === -1 ? rest : rest.slice(0, slash));
  }
  return { dirs: [...dirs].sort(), files: files.sort() };
}
