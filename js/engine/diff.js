// 行単位の diff と 3-way マージ。
// コンフリクトの体験がこのアプリの山場なので、マーカーの形は本物に合わせる。

function splitLines(text) {
  if (text === '' || text == null) return [];
  return text.replace(/\n$/, '').split('\n');
}

/** 最長共通部分列。行数は高々数十行なので素直な DP で十分。 */
function lcs(a, b) {
  const n = a.length;
  const m = b.length;
  const dp = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }
  const out = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      out.push({ type: 'same', line: a[i] });
      i++;
      j++;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      out.push({ type: 'del', line: a[i] });
      i++;
    } else {
      out.push({ type: 'add', line: b[j] });
      j++;
    }
  }
  while (i < n) out.push({ type: 'del', line: a[i++] });
  while (j < m) out.push({ type: 'add', line: b[j++] });
  return out;
}

/** ' -/+' 付きの行配列。UI とターミナル出力の両方で使う。 */
export function diffLines(oldText, newText) {
  return lcs(splitLines(oldText), splitLines(newText));
}

/** unified diff の範囲表記。行数が1のときは本物同様 `,1` を省く。 */
function range(start, count) {
  return count === 1 ? String(start) : `${start},${count}`;
}

/**
 * git diff 風のテキスト（変更のあった部分だけ、前後3行の文脈つき）。
 * `@@ -1,4 +1,5 @@` の行番号も本物と同じ形で出す。diff の読み方を教える章があるので、
 * ここが本物とズレていると学んだ読み方がそのまま使えなくなる。
 */
export function formatDiff(path, oldText, newText) {
  const parts = diffLines(oldText, newText);
  if (parts.every((p) => p.type === 'same')) return '';

  // 各行が旧ファイル / 新ファイルの何行目にあたるかを先に数える（@@ の数字に使う）。
  let oldNo = 0;
  let newNo = 0;
  const at = parts.map((p) => {
    if (p.type !== 'add') oldNo++;
    if (p.type !== 'del') newNo++;
    return { old: oldNo, new: newNo };
  });

  const CONTEXT = 3;
  const keep = new Set();
  parts.forEach((p, i) => {
    if (p.type !== 'same') for (let k = i - CONTEXT; k <= i + CONTEXT; k++) keep.add(k);
  });

  const out = [`diff --git a/${path} b/${path}`, `--- a/${path}`, `+++ b/${path}`];
  let i = 0;
  while (i < parts.length) {
    if (!keep.has(i)) {
      i++;
      continue;
    }
    const start = i;
    while (i < parts.length && keep.has(i)) i++;
    const hunk = parts.slice(start, i);

    // 追加だけのハンクは旧側が 0 行になる。その場合の開始行は「直前までの行数」。
    const fo = hunk.findIndex((p) => p.type !== 'add');
    const fn = hunk.findIndex((p) => p.type !== 'del');
    const oldStart = fo >= 0 ? at[start + fo].old : at[start].old;
    const newStart = fn >= 0 ? at[start + fn].new : at[start].new;
    const oldCount = hunk.filter((p) => p.type !== 'add').length;
    const newCount = hunk.filter((p) => p.type !== 'del').length;

    out.push(`@@ -${range(oldStart, oldCount)} +${range(newStart, newCount)} @@`);
    for (const p of hunk) {
      out.push((p.type === 'add' ? '+' : p.type === 'del' ? '-' : ' ') + p.line);
    }
  }
  return out.join('\n');
}

/**
 * 3-way マージ。共通祖先 base に対して ours / theirs の変更を突き合わせる。
 * 片方だけが変えたハンクは自動採用、両方が同じ場所を変えたら衝突。
 * @returns {{clean:boolean, text:string}}
 */
export function mergeText(base, ours, theirs, { ourLabel = 'HEAD', theirLabel = 'theirs' } = {}) {
  if (ours === theirs) return { clean: true, text: ours };
  if (base === ours) return { clean: true, text: theirs };
  if (base === theirs) return { clean: true, text: ours };

  const b = splitLines(base);
  const o = splitLines(ours);
  const t = splitLines(theirs);

  // base を軸に、ours / theirs それぞれの「base の各行がどうなったか」を並べる
  const oOps = alignToBase(b, o);
  const tOps = alignToBase(b, t);

  const out = [];
  let clean = true;
  let i = 0; // base の行番号
  while (i <= b.length) {
    const oIns = oOps.inserts[i] || [];
    const tIns = tOps.inserts[i] || [];
    // base の行 i より前に挿入された行
    if (oIns.length || tIns.length) {
      if (sameArr(oIns, tIns)) {
        out.push(...oIns);
      } else if (!oIns.length) {
        out.push(...tIns);
      } else if (!tIns.length) {
        out.push(...oIns);
      } else {
        clean = false;
        out.push(`<<<<<<< ${ourLabel}`, ...oIns, '=======', ...tIns, `>>>>>>> ${theirLabel}`);
      }
    }
    if (i === b.length) break;
    const oLine = oOps.lines[i]; // null = 削除された
    const tLine = tOps.lines[i];
    const oChanged = oLine !== b[i];
    const tChanged = tLine !== b[i];
    if (!oChanged && !tChanged) out.push(b[i]);
    else if (oChanged && !tChanged) {
      if (oLine !== null) out.push(oLine);
    } else if (!oChanged && tChanged) {
      if (tLine !== null) out.push(tLine);
    } else if (oLine === tLine) {
      if (oLine !== null) out.push(oLine);
    } else {
      clean = false;
      out.push(`<<<<<<< ${ourLabel}`);
      if (oLine !== null) out.push(oLine);
      out.push('=======');
      if (tLine !== null) out.push(tLine);
      out.push(`>>>>>>> ${theirLabel}`);
    }
    i++;
  }
  return { clean, text: out.join('\n') + (out.length ? '\n' : '') };
}

function sameArr(a, b) {
  return a.length === b.length && a.every((x, i) => x === b[i]);
}

/**
 * base の各行が side でどうなったかを求める。
 * lines[i]  : base[i] に対応する side の行（削除されたら null、変更されたら新しい行）
 * inserts[i]: base[i] の直前に挿入された行の配列（i = base.length なら末尾追加）
 */
function alignToBase(base, side) {
  const parts = lcs(base, side);
  const lines = new Array(base.length).fill(null);
  const inserts = Object.create(null);
  let bi = 0;
  let pending = [];
  for (const p of parts) {
    if (p.type === 'same') {
      if (pending.length) {
        inserts[bi] = (inserts[bi] || []).concat(pending);
        pending = [];
      }
      lines[bi] = p.line;
      bi++;
    } else if (p.type === 'del') {
      // base のこの行は side で消えた。直後に add が続けば「変更」とみなす
      if (pending.length) {
        inserts[bi] = (inserts[bi] || []).concat(pending);
        pending = [];
      }
      lines[bi] = null;
      bi++;
    } else {
      pending.push(p.line);
    }
  }
  if (pending.length) inserts[bi] = (inserts[bi] || []).concat(pending);

  // del の直後の挿入は「その行の書き換え」に寄せる（マーカーが素直な形になる）
  for (let i = 0; i < base.length; i++) {
    if (lines[i] === null && inserts[i + 1] && inserts[i + 1].length) {
      lines[i] = inserts[i + 1].shift();
      if (!inserts[i + 1].length) delete inserts[i + 1];
    }
  }
  return { lines, inserts };
}

/** テキストにコンフリクトマーカーが残っているか。 */
export function hasConflictMarkers(text) {
  return /^<<<<<<< /m.test(text) || /^=======$/m.test(text) || /^>>>>>>> /m.test(text);
}
