// コミット DAG を「レーン（横位置）＋行（縦位置）」に割り当てる。
// 描画は graphview.js が担当。ここは純粋な座標計算なのでテストしやすい。

import { readCommit, commitList, headCommit } from './repo.js';
import { refLabels } from './commands.js';

/**
 * @returns {{nodes: Array, edges: Array, lanes: number}}
 *   nodes: {sha, row, lane, message, parents, labels, isHead, isMerge}
 *   edges: {from: sha, to: sha, fromRow, fromLane, toRow, toLane}
 */
export function layoutGraph(repo, { tips } = {}) {
  const allTips =
    tips ||
    Object.entries(repo.refs)
      .filter(([r]) => !r.startsWith('refs/tags/'))
      .map(([, s]) => s)
      .concat(headCommit(repo) ? [headCommit(repo)] : []);

  const order = commitList(repo, allTips.filter(Boolean)); // 新しい順
  const rowOf = new Map();
  order.forEach((sha, i) => rowOf.set(sha, i));

  const labels = refLabels(repo);
  const head = headCommit(repo);

  // レーン割り当て: 上（新しい方）から降りていき、各アクティブな線に列を割り当てる。
  const laneOf = new Map();
  /** @type {Array<string|null>} lane index -> そのレーンが次に待っている sha */
  const active = [];

  const takeLane = (sha) => {
    const existing = active.indexOf(sha);
    if (existing !== -1) return existing;
    const free = active.indexOf(null);
    if (free !== -1) {
      active[free] = sha;
      return free;
    }
    active.push(sha);
    return active.length - 1;
  };

  for (const sha of order) {
    const lane = takeLane(sha);
    laneOf.set(sha, lane);
    const c = readCommit(repo, sha);
    // このレーンは消費された。親をレーンに乗せる
    active[lane] = null;
    const parents = c ? c.parents : [];
    parents.forEach((p, i) => {
      if (!rowOf.has(p)) return;
      if (active.includes(p)) return; // 既に別レーンで待っている
      if (i === 0) active[lane] = p; // 第1親は同じレーンを引き継ぐ
      else takeLane(p);
    });
    // 使い終わった末尾の空きレーンを畳む
    while (active.length && active[active.length - 1] === null) active.pop();
  }

  const nodes = order.map((sha) => {
    const c = readCommit(repo, sha);
    return {
      sha,
      row: rowOf.get(sha),
      lane: laneOf.get(sha) || 0,
      message: c ? c.message : '',
      author: c ? c.author : '',
      parents: c ? c.parents : [],
      labels: labels[sha] || [],
      isHead: sha === head,
      isMerge: c ? c.parents.length > 1 : false,
    };
  });

  const edges = [];
  for (const n of nodes) {
    for (const p of n.parents) {
      if (!rowOf.has(p)) continue;
      edges.push({
        from: n.sha,
        to: p,
        fromRow: n.row,
        fromLane: n.lane,
        toRow: rowOf.get(p),
        toLane: laneOf.get(p) || 0,
      });
    }
  }

  const lanes = nodes.reduce((m, n) => Math.max(m, n.lane + 1), 1);
  return { nodes, edges, lanes };
}
