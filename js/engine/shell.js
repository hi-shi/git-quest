// ファイル操作のシェルコマンド。
// 「ファイルを編集した」という実感がないと add / commit の意味が分からないので、
// 最低限の ls / cat / echo > / touch / rm / mv / mkdir を用意する。

import { refreshIgnore, status, isIgnored } from './repo.js';
import { runGit } from './commands.js';
import { tokenize, extractRedirect } from './parser.js';

const ok = (out = '', hint) => ({ ok: true, out, hint });
const err = (out, hint) => ({ ok: false, out, hint });

function cmdLs(repo, args) {
  const all = args.includes('-a') || args.includes('-la') || args.includes('-al');
  const paths = Object.keys(repo.workdir)
    .filter((p) => all || !p.startsWith('.'))
    .sort();
  if (!paths.length) return ok('（フォルダは空です）');
  if (args.includes('-l') || args.includes('-la') || args.includes('-al')) {
    const s = repo.initialized ? status(repo) : { untracked: paths };
    const untracked = new Set(s.untracked);
    return ok(
      paths
        .map((p) => {
          const size = String(repo.workdir[p].length).padStart(5);
          const mark = untracked.has(p) ? '?' : isIgnored(repo, p) ? '!' : ' ';
          return `${mark} ${size}  ${p}`;
        })
        .join('\n')
    );
  }
  return ok(paths.join('  '));
}

function cmdCat(repo, args) {
  if (!args.length) return err('usage: cat <file>');
  const out = [];
  for (const p of args) {
    if (!(p in repo.workdir)) return err(`cat: ${p}: No such file or directory`);
    out.push(repo.workdir[p]);
  }
  return ok(out.join('\n').replace(/\n$/, ''));
}

function cmdTouch(repo, args) {
  if (!args.length) return err('usage: touch <file>');
  for (const p of args) if (!(p in repo.workdir)) repo.workdir[p] = '';
  refreshIgnore(repo);
  return ok(`作成: ${args.join(', ')}`, '新しいファイルはまだ git に追跡されていません（untracked）。');
}

function cmdRm(repo, args) {
  const paths = args.filter((a) => !a.startsWith('-'));
  if (!paths.length) return err('usage: rm <file>');
  const missing = paths.filter((p) => !(p in repo.workdir));
  if (missing.length) return err(`rm: ${missing[0]}: No such file or directory`);
  for (const p of paths) delete repo.workdir[p];
  refreshIgnore(repo);
  return ok(`削除: ${paths.join(', ')}`, '削除も「変更」です。`git add` して初めてコミットに反映されます。');
}

function cmdMv(repo, args) {
  if (args.length !== 2) return err('usage: mv <src> <dest>');
  const [from, to] = args;
  if (!(from in repo.workdir)) return err(`mv: ${from}: No such file or directory`);
  repo.workdir[to] = repo.workdir[from];
  delete repo.workdir[from];
  refreshIgnore(repo);
  return ok(`${from} → ${to}`);
}

function cmdMkdir(repo, args) {
  // このアプリはパス文字列だけを扱うので、ディレクトリは .keep で表現する
  for (const d of args.filter((a) => !a.startsWith('-'))) {
    repo.workdir[d.replace(/\/$/, '') + '/.keep'] = '';
  }
  return ok('（このアプリではフォルダはパスの一部として扱われます）');
}

function cmdEcho(repo, args, redirect) {
  const text = args.join(' ');
  if (!redirect) return ok(text);
  const p = redirect.path;
  if (!p) return err('構文エラー: > の後にファイル名が要ります');
  const line = text.endsWith('\n') ? text : text + '\n';
  repo.workdir[p] = redirect.append ? (repo.workdir[p] || '') + line : line;
  refreshIgnore(repo);
  return ok(
    `${p} に書き込みました`,
    redirect.append ? '>> は追記、> は上書きです。' : '> は上書きです。追記したいときは >>。'
  );
}

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
    case 'code':
      if (!args[0]) return err('usage: edit <file>');
      if (!(args[0] in repo.workdir)) repo.workdir[args[0]] = '';
      return { ok: true, out: `${args[0]} を編集パネルで開きます`, editFile: args[0] };
    case 'pwd':
      return ok('/playground');
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

export const SHELL_COMMANDS = ['ls', 'cat', 'touch', 'rm', 'mv', 'mkdir', 'echo', 'edit', 'clear', 'help'];
