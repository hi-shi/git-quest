// 簡易ロックの設定。このファイルは tools/set-password.mjs が書き換えます。
// 手で編集する必要はありません。
//
// hash は PBKDF2-SHA256 で伸ばした結果です。合言葉そのものは入っていませんが、
// 総当たりで破れる点に注意してください（本物の認証ではありません）。

export const GATE = {
  enabled: false,
  salt: "",
  iterations: 250000,
  hash: "",
  // ロック画面に出す案内文（合言葉そのものは書かないこと）
  hint: "",
};
