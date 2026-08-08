// 合言葉によるロック画面。
//
// 【この仕組みの限界を正しく理解してください】
// これはブラウザの中だけで判定する「よそ見防止」です。本物の認証ではありません。
//
//  - 合言葉そのものはコードに入っていませんが（PBKDF2 のハッシュだけを置いています）、
//    総当たりで試せば破れます。短い・ありがちな合言葉ほど簡単に破れます。
//  - リポジトリが public なら、アプリのソースは GitHub 上で誰でも読めます。
//    つまり「URL を知った人が中身を使えない」だけで、内容が秘密になるわけではありません。
//  - 秘密にしたい情報は、絶対にこのアプリに入れないでください。
//
// それでも「たまたま URL を踏んだ人に使われない」「検索に出ても入れない」
// という目的には十分役に立ちます。

import { GATE } from './gate-config.js';

const STORAGE_KEY = 'git-quest:unlocked:v1';

/** 文字列 → Uint8Array */
const bytes = (s) => new TextEncoder().encode(s);

/** Uint8Array / ArrayBuffer → hex 文字列 */
function toHex(buf) {
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** hex 文字列 → Uint8Array */
function fromHex(hex) {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
}

/**
 * PBKDF2-SHA256 で合言葉を伸ばす。
 * 反復回数を多くしてあるので、ハッシュが公開されていても総当たりに時間がかかります。
 * tools/set-password.mjs と同じ計算をしていること（同じ結果になること）が重要です。
 */
export async function derive(password, saltHex, iterations) {
  const key = await crypto.subtle.importKey('raw', bytes(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt: fromHex(saltHex), iterations, hash: 'SHA-256' },
    key,
    256
  );
  return toHex(bits);
}

/** 総当たりで1文字ずつ比べて速さの差から漏れないように、時間を揃えて比較する。 */
function equals(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

function alreadyUnlocked() {
  try {
    return localStorage.getItem(STORAGE_KEY) === GATE.hash;
  } catch {
    return false;
  }
}

function rememberUnlock() {
  try {
    localStorage.setItem(STORAGE_KEY, GATE.hash);
  } catch {
    /* 保存できない環境では毎回入力してもらう */
  }
}

/**
 * ロックがかかっていれば、解除されるまで待つ。
 * ロックが無効なら即座に解決する。
 */
export function ensureUnlocked() {
  if (!GATE.enabled || !GATE.hash) return Promise.resolve();
  if (alreadyUnlocked()) return Promise.resolve();
  return showLockScreen();
}

function showLockScreen() {
  return new Promise((resolve) => {
    const overlay = document.createElement('div');
    overlay.className = 'gate';
    overlay.innerHTML = '';

    const panel = document.createElement('form');
    panel.className = 'gate-panel';

    const icon = document.createElement('div');
    icon.className = 'gate-icon';
    icon.textContent = '🔒';
    panel.appendChild(icon);

    const title = document.createElement('h1');
    title.className = 'gate-title';
    title.textContent = 'Git Quest';
    panel.appendChild(title);

    const lead = document.createElement('p');
    lead.className = 'gate-lead';
    lead.textContent = GATE.hint || '合言葉を入力してください。';
    panel.appendChild(lead);

    const input = document.createElement('input');
    input.type = 'password';
    input.className = 'gate-input';
    input.placeholder = '合言葉';
    input.autocomplete = 'current-password';
    input.setAttribute('aria-label', '合言葉');
    panel.appendChild(input);

    const button = document.createElement('button');
    button.type = 'submit';
    button.className = 'gate-btn';
    button.textContent = '入る';
    panel.appendChild(button);

    const msg = document.createElement('p');
    msg.className = 'gate-msg';
    msg.setAttribute('role', 'status');
    panel.appendChild(msg);

    const note = document.createElement('p');
    note.className = 'gate-note';
    note.textContent =
      'この鍵はブラウザの中だけで確認する簡易的なものです。秘密の情報は入っていません。';
    panel.appendChild(note);

    overlay.appendChild(panel);
    document.body.appendChild(overlay);
    requestAnimationFrame(() => input.focus());

    let busy = false;
    panel.addEventListener('submit', async (e) => {
      e.preventDefault();
      if (busy) return;
      const value = input.value;
      if (!value) return;

      busy = true;
      button.disabled = true;
      button.textContent = '確認中…';
      msg.textContent = '';
      msg.className = 'gate-msg';

      // 反復回数が多いので数百ミリ秒かかります
      let digest;
      try {
        digest = await derive(value, GATE.salt, GATE.iterations);
      } catch (err) {
        msg.textContent = 'この端末では確認できませんでした: ' + err.message;
        msg.className = 'gate-msg error';
        busy = false;
        button.disabled = false;
        button.textContent = '入る';
        return;
      }

      if (equals(digest, GATE.hash)) {
        rememberUnlock();
        overlay.remove();
        resolve();
        return;
      }

      msg.textContent = '合言葉が違います。';
      msg.className = 'gate-msg error';
      input.value = '';
      input.focus();
      busy = false;
      button.disabled = false;
      button.textContent = '入る';
    });
  });
}
