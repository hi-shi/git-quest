// 公開ページに簡易ロックをかける合言葉を設定する。
//
//   node tools/set-password.mjs                 対話式で入力（画面に表示されません）
//   node tools/set-password.mjs --off           ロックを解除する
//   node tools/set-password.mjs --hint "..."    ロック画面の案内文だけ変える
//
// 合言葉そのものはどこにも保存されません。PBKDF2 で伸ばしたハッシュだけを
// js/gate-config.js に書き込みます。
//
// 【重要】これは本物の認証ではありません。
// ハッシュは公開ページに含まれるため、総当たりで破れます。
// 短い合言葉・辞書に載っている単語は避けてください。
// また、リポジトリが public ならソースは誰でも読めます。

import { webcrypto as crypto } from 'node:crypto';
import { writeFileSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createInterface } from 'node:readline';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const CONFIG = join(ROOT, 'js', 'gate-config.js');
const ITERATIONS = 250000;

const toHex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
const fromHex = (hex) => {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
};

/** js/gate.js の derive() と同じ計算。ここがずれると解除できなくなる。 */
export async function derive(password, saltHex, iterations) {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(password),
    'PBKDF2',
    false,
    ['deriveBits']
  );
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt: fromHex(saltHex), iterations, hash: 'SHA-256' },
    key,
    256
  );
  return toHex(bits);
}

function write({ enabled, salt, iterations, hash, hint }) {
  const body = `// 簡易ロックの設定。このファイルは tools/set-password.mjs が書き換えます。
// 手で編集する必要はありません。
//
// hash は PBKDF2-SHA256 で伸ばした結果です。合言葉そのものは入っていませんが、
// 総当たりで破れる点に注意してください（本物の認証ではありません）。

export const GATE = {
  enabled: ${enabled},
  salt: ${JSON.stringify(salt)},
  iterations: ${iterations},
  hash: ${JSON.stringify(hash)},
  // ロック画面に出す案内文（合言葉そのものは書かないこと）
  hint: ${JSON.stringify(hint || '')},
};
`;
  writeFileSync(CONFIG, body);
}

function readCurrent() {
  try {
    const src = readFileSync(CONFIG, 'utf8');
    const pick = (key, re) => {
      const m = re.exec(src);
      return m ? m[1] : '';
    };
    return {
      enabled: /enabled:\s*true/.test(src),
      salt: pick('salt', /salt:\s*"([^"]*)"/),
      iterations: Number(pick('iterations', /iterations:\s*(\d+)/)) || ITERATIONS,
      hash: pick('hash', /hash:\s*"([^"]*)"/),
      hint: pick('hint', /hint:\s*"([^"]*)"/),
    };
  } catch {
    return { enabled: false, salt: '', iterations: ITERATIONS, hash: '', hint: '' };
  }
}

/** 画面に出さずに1行読む。 */
function askHidden(prompt) {
  return new Promise((resolve) => {
    const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    const onData = (char) => {
      // 入力中の文字を画面に出さない
      if (['\n', '\r', ''].includes(String(char))) process.stdin.removeListener('data', onData);
      else process.stdout.write('\x1b[2K\x1b[200D' + prompt + '*'.repeat(rl.line.length));
    };
    process.stdin.on('data', onData);
    rl.question(prompt, (answer) => {
      rl.close();
      process.stdout.write('\n');
      resolve(answer);
    });
  });
}

async function main() {
  const args = process.argv.slice(2);
  const current = readCurrent();

  if (args.includes('--off')) {
    // 古いハッシュを残さない。解除したのに前の合言葉の痕跡が公開ページに
    // 残り続けるのは筋が悪いので、まるごと消す。
    write({ enabled: false, salt: '', iterations: ITERATIONS, hash: '', hint: '' });
    console.log('ロックを解除しました（誰でも開けます）。以前のハッシュも消しました。');
    console.log('反映するには commit して push してください。');
    return;
  }

  const hintIdx = args.indexOf('--hint');
  if (hintIdx !== -1 && !args.includes('--set')) {
    const hint = args[hintIdx + 1] || '';
    write({ ...current, hint });
    console.log('案内文を更新しました:', hint || '(空)');
    return;
  }

  const password = await askHidden('合言葉を入力: ');
  if (!password) {
    console.error('入力が空です。中止しました。');
    process.exitCode = 1;
    return;
  }
  const again = await askHidden('もう一度: ');
  if (password !== again) {
    console.error('一致しませんでした。中止しました。');
    process.exitCode = 1;
    return;
  }
  if (password.length < 8) {
    console.warn('⚠ 8文字未満です。ハッシュは公開されるので、破られやすくなります。');
  }

  const salt = toHex(crypto.getRandomValues(new Uint8Array(16)));
  process.stdout.write('計算中…');
  const hash = await derive(password, salt, ITERATIONS);
  process.stdout.write('\n');

  const hintIdx2 = args.indexOf('--hint');
  const hint = hintIdx2 !== -1 ? args[hintIdx2 + 1] : current.hint;
  write({ enabled: true, salt, iterations: ITERATIONS, hash, hint });

  console.log('js/gate-config.js に書き込みました。合言葉そのものは保存していません。');
  console.log('');
  console.log('次の手順:');
  console.log('  git add js/gate-config.js');
  console.log('  git commit -m "ロックの合言葉を更新"');
  console.log('  git push');
  console.log('');
  console.log('※ これは「よそ見防止」です。本物の認証ではありません。');
  console.log('  秘密の情報はこのアプリに入れないでください。');
}

// import されたとき（テスト）は main を走らせない
if (process.argv[1] && process.argv[1].endsWith('set-password.mjs')) {
  main();
}
