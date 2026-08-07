// コマンド行を argv に分解する。クォートとリダイレクト（> >>）に対応。

export function tokenize(line) {
  const tokens = [];
  let cur = '';
  let quote = null;
  let has = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (quote) {
      if (ch === quote) quote = null;
      else if (ch === '\\' && quote === '"' && i + 1 < line.length) cur += line[++i];
      else cur += ch;
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      has = true;
      continue;
    }
    if (ch === ' ' || ch === '\t') {
      if (cur || has) tokens.push(cur);
      cur = '';
      has = false;
      continue;
    }
    if (ch === '>' ) {
      if (cur || has) tokens.push(cur);
      cur = '';
      has = false;
      if (line[i + 1] === '>') {
        tokens.push('>>');
        i++;
      } else tokens.push('>');
      continue;
    }
    cur += ch;
  }
  if (cur || has) tokens.push(cur);
  if (quote) throw new Error('引用符が閉じていません: ' + quote);
  return tokens;
}

/**
 * argv から短/長オプションを取り出す。
 * @param {string[]} argv
 * @param {{withValue?: string[]}} spec 値を1つ取るオプション名（'-m' など）
 */
export function parseFlags(argv, spec = {}) {
  const withValue = new Set(spec.withValue || []);
  const flags = Object.create(null);
  const args = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--') {
      args.push(...argv.slice(i + 1));
      break;
    }
    if (a.startsWith('--')) {
      const eq = a.indexOf('=');
      if (eq > 0) {
        flags[a.slice(0, eq)] = a.slice(eq + 1);
      } else if (withValue.has(a)) {
        flags[a] = argv[++i];
      } else {
        flags[a] = true;
      }
    } else if (a.startsWith('-') && a.length > 1 && !/^-\d/.test(a)) {
      if (withValue.has(a)) {
        flags[a] = argv[++i];
      } else if (a.length > 2 && !withValue.has(a)) {
        // -am "msg" のような束ねた短縮形をばらす
        let consumed = false;
        for (const c of a.slice(1)) {
          const f = '-' + c;
          if (withValue.has(f)) {
            flags[f] = argv[++i];
            consumed = true;
          } else flags[f] = true;
        }
        if (consumed) continue;
      } else {
        flags[a] = true;
      }
    } else {
      args.push(a);
    }
  }
  return { flags, args };
}

/** リダイレクト（> file / >> file）を切り出す。 */
export function extractRedirect(tokens) {
  const idx = tokens.findIndex((t) => t === '>' || t === '>>');
  if (idx === -1) return { tokens, redirect: null };
  return {
    tokens: tokens.slice(0, idx),
    redirect: { append: tokens[idx] === '>>', path: tokens[idx + 1] },
  };
}
