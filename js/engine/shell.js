// ファイル操作のシェルコマンド。
//
// 「ファイルを編集した」という実感がないと add / commit の意味が分からないので、
// 最低限の ls / cat / echo > / touch / rm / mv / mkdir を用意する。
// さらに cd / pwd を持たせて「今どこにいるか」を意識できるようにしている。
// git の事故はコマンドそのものより「どこで打ったか」で起きるため。

import { refreshIgnore, status, isIgnored } from './repo.js';
import { runGit } from './commands.js';
import { tokenize, extractRedirect } from './parser.js';
import {
  HOME,
  toAbsolute,
  toProjectRel,
  displayPath,
  isDir,
  isFile,
  listDir,
  allDirs,
  cwdRel,
  inRepo,
  repoDirAbs,
} from './paths.js';

const ok = (out = '', hint) => ({ ok: true, out, hint });
const err = (out, hint) => ({ ok: false, out, hint });

/**
 * ファイル引数をプロジェクト相対パスに解決する。
 * 相対パスは今いる場所から見た位置になる。ここが cd の効いてくるところ。
 */
function resolveFileArg(repo, arg) {
  const abs = toAbsolute(repo, arg);
  const rel = toProjectRel(repo, abs);
  if (rel === null) {
    return {
      error: `${arg}: プロジェクトフォルダの外は触れません（${displayPath(repo, abs)}）`,
      hint: `このアプリで扱えるのは ${displayPath(repo, toAbsolute(repo, '/'))} 配下だけです。`,
    };
  }
  if (rel === '') return { error: `${arg}: フォルダです` };
  return { rel };
}

// ---------------------------------------------------------------- 移動

function cmdCd(repo, args) {
  const target = args.find((a) => !a.startsWith('-'));
  const abs = toAbsolute(repo, target === undefined ? '~' : target);

  if (!isDir(repo, abs)) {
    if (isFile(repo, abs)) return err(`cd: ${target}: フォルダではありません`);
    if (!abs.startsWith(HOME)) {
      return err(
        `cd: ${target}: そんなフォルダはありません`,
        `このアプリで動けるのは ${HOME} の中だけです。`
      );
    }
    return err(`cd: ${target}: そんなフォルダはありません`, '`ls` で今ある中身を確認できます。');
  }

  const wasInRepo = inRepo(repo);
  repo.cwd = abs;
  const nowInRepo = inRepo(repo);

  const lines = [displayPath(repo)];
  let hint;
  if (wasInRepo && !nowInRepo) {
    hint =
      'リポジトリの外に出ました。ここで git コマンドを打っても「not a git repository」になります。';
  } else if (!wasInRepo && nowInRepo) {
    hint = 'リポジトリの中に入りました。ここからは git コマンドが使えます。';
  } else if (nowInRepo) {
    const rootAbs = repoDirAbs(repo);
    if (abs !== rootAbs) {
      hint = `リポジトリのルートは ${displayPath(repo, rootAbs)} です。ここで \`git add .\` を打つと、この下だけが対象になります。`;
    }
  }
  return ok(lines.join('\n'), hint);
}

function cmdPwd(repo) {
  return ok(repo.cwd);
}

// ---------------------------------------------------------------- 一覧・閲覧

function cmdLs(repo, args) {
  const flags = args.filter((a) => a.startsWith('-')).join('');
  const all = flags.includes('a');
  const long = flags.includes('l');
  const target = args.find((a) => !a.startsWith('-'));
  const abs = toAbsolute(repo, target);

  if (isFile(repo, abs)) return ok(target);
  if (!isDir(repo, abs)) return err(`ls: ${target}: そんなファイルやフォルダはありません`);

  const { dirs, files } = listDir(repo, abs);
  const visible = (name) => all || !name.startsWith('.');
  const shownDirs = dirs.filter(visible);
  const shownFiles = files.filter(visible);

  if (!shownDirs.length && !shownFiles.length) return ok('（このフォルダは空です）');

  const base = toProjectRel(repo, abs);
  const prefix = base ? base + '/' : '';

  if (long) {
    const s = repo.gitRoot !== null ? status(repo) : { untracked: [] };
    const untracked = new Set(s.untracked);
    const rows = [
      ...shownDirs.map((d) => `  ${'-'.padStart(5)}  ${d}/`),
      ...shownFiles.map((f) => {
        const rel = prefix + f;
        const size = String((repo.workdir[rel] || '').length).padStart(5);
        const mark = untracked.has(rel) ? '?' : isIgnored(repo, rel) ? '!' : ' ';
        return `${mark} ${size}  ${f}`;
      }),
    ];
    return ok(rows.join('\n'));
  }
  return ok([...shownDirs.map((d) => d + '/'), ...shownFiles].join('  '));
}

function cmdCat(repo, args) {
  const paths = args.filter((a) => !a.startsWith('-'));
  if (!paths.length) return err('usage: cat <file>');
  const out = [];
  for (const p of paths) {
    const r = resolveFileArg(repo, p);
    if (r.error) return err(`cat: ${r.error}`, r.hint);
    if (!(r.rel in repo.workdir)) return err(`cat: ${p}: そんなファイルはありません`);
    out.push(repo.workdir[r.rel]);
  }
  return ok(out.join('\n').replace(/\n$/, ''));
}

// ---------------------------------------------------------------- 作成・削除

function cmdTouch(repo, args) {
  const paths = args.filter((a) => !a.startsWith('-'));
  if (!paths.length) return err('usage: touch <file>');
  for (const p of paths) {
    const r = resolveFileArg(repo, p);
    if (r.error) return err(`touch: ${r.error}`, r.hint);
    if (!(r.rel in repo.workdir)) repo.workdir[r.rel] = '';
  }
  refreshIgnore(repo);
  return ok(
    `作成: ${paths.join(', ')}`,
    '新しいファイルはまだ git に追跡されていません（untracked）。'
  );
}

function cmdRm(repo, args) {
  const paths = args.filter((a) => !a.startsWith('-'));
  const recursive = args.some((a) => /^-.*r/i.test(a));
  if (!paths.length) return err('usage: rm <file>');

  const removed = [];
  for (const p of paths) {
    const abs = toAbsolute(repo, p);
    const rel = toProjectRel(repo, abs);
    if (rel === null || rel === '') return err(`rm: ${p}: 消せません`);

    if (rel in repo.workdir) {
      delete repo.workdir[rel];
      removed.push(p);
      continue;
    }
    if (isDir(repo, abs)) {
      if (!recursive) return err(`rm: ${p}: フォルダです`, 'フォルダごと消すなら `rm -r`。');
      for (const key of Object.keys(repo.workdir)) {
        if (key === rel || key.startsWith(rel + '/')) {
          delete repo.workdir[key];
          removed.push(key);
        }
      }
      repo.dirs = (repo.dirs || []).filter((d) => d !== rel && !d.startsWith(rel + '/'));
      continue;
    }
    return err(`rm: ${p}: そんなファイルはありません`);
  }
  refreshIgnore(repo);
  return ok(
    `削除: ${removed.join(', ')}`,
    '削除も「変更」です。`git add` して初めてコミットに反映されます。'
  );
}

function cmdMv(repo, args) {
  const paths = args.filter((a) => !a.startsWith('-'));
  if (paths.length !== 2) return err('usage: mv <src> <dest>');
  const from = resolveFileArg(repo, paths[0]);
  if (from.error) return err(`mv: ${from.error}`, from.hint);
  if (!(from.rel in repo.workdir)) return err(`mv: ${paths[0]}: そんなファイルはありません`);

  const destAbs = toAbsolute(repo, paths[1]);
  // 移動先がフォルダなら、その中に元の名前で置く
  const destRel = isDir(repo, destAbs)
    ? (toProjectRel(repo, destAbs) ? toProjectRel(repo, destAbs) + '/' : '') +
      from.rel.split('/').pop()
    : toProjectRel(repo, destAbs);
  if (destRel === null || destRel === '') return err(`mv: ${paths[1]}: そこには置けません`);

  repo.workdir[destRel] = repo.workdir[from.rel];
  delete repo.workdir[from.rel];
  refreshIgnore(repo);
  return ok(`${from.rel} → ${destRel}`);
}

function cmdMkdir(repo, args) {
  const paths = args.filter((a) => !a.startsWith('-'));
  if (!paths.length) return err('usage: mkdir <dir>');
  const made = [];
  for (const p of paths) {
    const abs = toAbsolute(repo, p);
    const rel = toProjectRel(repo, abs);
    if (rel === null || rel === '') return err(`mkdir: ${p}: そこには作れません`);
    if (!repo.dirs) repo.dirs = [];
    if (!repo.dirs.includes(rel)) repo.dirs.push(rel);
    made.push(rel);
  }
  return ok(
    `フォルダを作成: ${made.join(', ')}`,
    'git は空のフォルダを記録しません。中にファイルを作って初めてコミットできます。'
  );
}

function cmdEcho(repo, args, redirect) {
  const text = args.join(' ');
  if (!redirect) return ok(text);
  if (!redirect.path) return err('構文エラー: > の後にファイル名が要ります');

  const r = resolveFileArg(repo, redirect.path);
  if (r.error) return err(r.error, r.hint);

  const line = text.endsWith('\n') ? text : text + '\n';
  repo.workdir[r.rel] = redirect.append ? (repo.workdir[r.rel] || '') + line : line;
  refreshIgnore(repo);
  return ok(
    `${redirect.path} に書き込みました`,
    redirect.append ? '>> は追記、> は上書きです。' : '> は上書きです。追記したいときは >>。'
  );
}

// ---------------------------------------------------------------- 実行

/**
 * コマンド行を1つ実行する。
 * @returns {{ok:boolean, out:string, hint?:string, editFile?:string}}
 */
export function runLine(repo, line, ctx = {}) {
  let tokens;
  try {
    tokens = tokenize(line);
  } catch (e) {
    return err(e.message);
  }
  if (!tokens.length) return ok('');

  const { tokens: t, redirect } = extractRedirect(tokens);
  const cmd = t[0];
  const args = t.slice(1);

  switch (cmd) {
    case 'git':
      return runGit(repo, args, ctx);
    case 'cd':
      return cmdCd(repo, args);
    case 'pwd':
      return cmdPwd(repo);
    case 'ls':
      return cmdLs(repo, args);
    case 'cat':
      return cmdCat(repo, args);
    case 'touch':
      return cmdTouch(repo, args);
    case 'rm':
      return cmdRm(repo, args);
    case 'mv':
      return cmdMv(repo, args);
    case 'mkdir':
      return cmdMkdir(repo, args);
    case 'echo':
      return cmdEcho(repo, args, redirect);
    case 'edit':
    case 'vim':
    case 'nano':
    case 'code': {
      if (!args[0]) return err('usage: edit <file>');
      const r = resolveFileArg(repo, args[0]);
      if (r.error) return err(`edit: ${r.error}`, r.hint);
      if (!(r.rel in repo.workdir)) repo.workdir[r.rel] = '';
      return { ok: true, out: `${args[0]} を編集パネルで開きます`, editFile: r.rel };
    }
    case 'clear':
      return { ok: true, out: '', clear: true };
    case 'help':
      return runGit(repo, ['help'], ctx);
    default:
      return err(
        `${cmd}: command not found`,
        '`help` で使えるコマンドの一覧が出ます。git のコマンドは `git ...` から始めます。'
      );
  }
}

export const SHELL_COMMANDS = [
  'cd',
  'pwd',
  'ls',
  'cat',
  'touch',
  'rm',
  'mv',
  'mkdir',
  'echo',
  'edit',
  'clear',
  'help',
];

export { allDirs, cwdRel, displayPath };
