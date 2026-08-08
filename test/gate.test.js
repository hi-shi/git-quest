// node --test test/gate.test.js
//
// 簡易ロックの検証。
// tools/set-password.mjs（設定側）と js/gate.js（判定側）が同じ計算をしていないと
// 「正しい合言葉なのに入れない」という最悪の壊れ方をするので、そこを固定する。

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { derive } from '../tools/set-password.mjs';
import { GATE } from '../js/gate-config.js';

const SALT = '000102030405060708090a0b0c0d0e0f';

test('derive は同じ入力に対して常に同じ結果を返す', async () => {
  const a = await derive('correct horse battery staple', SALT, 1000);
  const b = await derive('correct horse battery staple', SALT, 1000);
  assert.equal(a, b);
  assert.match(a, /^[0-9a-f]{64}$/, '256bit の hex になっている');
});

test('合言葉・ソルト・反復回数のどれが違っても結果が変わる', async () => {
  const base = await derive('pass-one', SALT, 1000);
  assert.notEqual(await derive('pass-two', SALT, 1000), base, '合言葉が違えば別');
  assert.notEqual(await derive('pass-one', 'ffffffffffffffffffffffffffffffff', 1000), base, 'ソルトが違えば別');
  assert.notEqual(await derive('pass-one', SALT, 1001), base, '反復回数が違えば別');
});

test('既知のテストベクタと一致する（本物の PBKDF2 であることの確認）', async () => {
  // PBKDF2-SHA256, password="git-quest", salt=上記16バイト, 1000回, 32バイト。
  // この期待値は Python の hashlib.pbkdf2_hmac で独立に計算したもの:
  //   hashlib.pbkdf2_hmac('sha256', b'git-quest',
  //                       bytes.fromhex('000102030405060708090a0b0c0d0e0f'), 1000, 32).hex()
  // 自作実装どうしで辻褄が合っているだけ、という状態を防ぐために外部の実装と突き合わせている。
  const got = await derive('git-quest', SALT, 1000);
  assert.equal(got, '99fe24cd37b7a42846ee60c1a192d140980fd3a7267f83603c4c3c8d7783245f');
});

test('js/gate.js と tools/set-password.mjs が同じ PBKDF2 の設定を使っている', () => {
  const gate = readFileSync(new URL('../js/gate.js', import.meta.url), 'utf8');
  const setter = readFileSync(new URL('../tools/set-password.mjs', import.meta.url), 'utf8');

  for (const [name, src] of [['gate.js', gate], ['set-password.mjs', setter]]) {
    assert.match(src, /name:\s*'PBKDF2'/, `${name}: PBKDF2 を使っている`);
    assert.match(src, /hash:\s*'SHA-256'/, `${name}: SHA-256 を使っている`);
    assert.match(src, /deriveBits\(\s*$|deriveBits\(/m, `${name}: deriveBits を呼んでいる`);
    assert.match(src, /,\s*\n?\s*256\s*\n?\s*\)/, `${name}: 256bit 取り出している`);
  }
});

test('gate-config.js は既定でロック無効（ローカルでそのまま遊べる）', () => {
  // 合言葉を設定したあとは enabled: true になるので、その場合は形が正しいかだけ見る
  if (!GATE.enabled) {
    assert.equal(GATE.hash, '', '無効なら hash は空');
    return;
  }
  assert.match(GATE.salt, /^[0-9a-f]{32}$/, 'ソルトが 16 バイトの hex');
  assert.match(GATE.hash, /^[0-9a-f]{64}$/, 'ハッシュが 32 バイトの hex');
  assert.ok(GATE.iterations >= 100000, `反復回数が少なすぎる: ${GATE.iterations}`);
});

test('gate-config.js に平文の合言葉が書き込まれない', () => {
  const src = readFileSync(new URL('../js/gate-config.js', import.meta.url), 'utf8');
  // 設定ファイルに入ってよいのは真偽値・数値・hex・案内文だけ
  assert.ok(!/password/i.test(src.replace(/\/\/.*$/gm, '')), '平文らしきキーが無い');
});
