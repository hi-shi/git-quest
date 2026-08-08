// 簡易ロックの設定。このファイルは tools/set-password.mjs が書き換えます。
// 手で編集する必要はありません。
//
// hash は PBKDF2-SHA256 で伸ばした結果です。合言葉そのものは入っていませんが、
// 総当たりで破れる点に注意してください（本物の認証ではありません）。

export const GATE = {
  enabled: true,
  salt: "2ecff439d9a7e3b45f2e190f0de44286",
  iterations: 250000,
  hash: "51e1d1501e5d7290989145938caa3d026c2a4d735b937c432480cf4a89608c53",
  // ロック画面に出す案内文（合言葉そのものは書かないこと）
  hint: "",
};
