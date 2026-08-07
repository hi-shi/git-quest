// コミットグラフの SVG 描画。
// merge と rebase の違いが「絵で」分かることが、この画面の存在理由。

import { layoutGraph } from '../engine/graph.js';

const ROW_H = 54;
const LANE_W = 26;
const PAD_X = 18;
const PAD_Y = 22;
const R = 7;

const LANE_COLORS = ['--lane-0', '--lane-1', '--lane-2', '--lane-3', '--lane-4'];

function laneColor(lane) {
  return `var(${LANE_COLORS[lane % LANE_COLORS.length]})`;
}

export function renderGraph(container, legendEl, repo) {
  container.innerHTML = '';
  legendEl.innerHTML = '';

  if (!repo || !repo.initialized) {
    container.innerHTML =
      '<p class="graph-empty">まだリポジトリがありません。<br />ターミナルで <code>git init</code> を実行してください。</p>';
    return;
  }

  const { nodes, edges, lanes } = layoutGraph(repo);
  if (!nodes.length) {
    container.innerHTML =
      '<p class="graph-empty">まだコミットがありません。<br /><code>git add</code> → <code>git commit</code> で最初の1つを作りましょう。</p>';
    return;
  }

  const graphW = PAD_X * 2 + lanes * LANE_W;
  const textX = graphW + 6;
  const width = Math.max(320, textX + 260);
  const height = PAD_Y * 2 + nodes.length * ROW_H;

  const svg = el('svg', {
    width,
    height,
    viewBox: `0 0 ${width} ${height}`,
    xmlns: 'http://www.w3.org/2000/svg',
  });

  const cx = (lane) => PAD_X + lane * LANE_W + LANE_W / 2;
  const cy = (row) => PAD_Y + row * ROW_H + ROW_H / 2;

  // --- 線を先に敷く
  for (const e of edges) {
    const x1 = cx(e.fromLane);
    const y1 = cy(e.fromRow);
    const x2 = cx(e.toLane);
    const y2 = cy(e.toRow);
    const color = laneColor(e.fromLane === e.toLane ? e.fromLane : e.toLane);
    let d;
    if (x1 === x2) {
      d = `M ${x1} ${y1} L ${x2} ${y2}`;
    } else {
      // レーンをまたぐときは滑らかに曲げる（合流・分岐が視覚的に分かる）
      const my = y1 + (y2 - y1) * 0.45;
      d = `M ${x1} ${y1} C ${x1} ${my}, ${x2} ${my}, ${x2} ${y2}`;
    }
    svg.appendChild(
      el('path', { d, fill: 'none', stroke: color, 'stroke-width': 2, 'stroke-linecap': 'round' })
    );
  }

  // --- ノードとラベル
  for (const n of nodes) {
    const x = cx(n.lane);
    const y = cy(n.row);
    const color = laneColor(n.lane);

    if (n.isHead) {
      svg.appendChild(el('circle', { cx: x, cy: y, r: R + 4, fill: 'none', stroke: color, 'stroke-width': 1.5, opacity: 0.45 }));
    }
    svg.appendChild(
      el('circle', {
        cx: x,
        cy: y,
        r: R,
        fill: n.isMerge ? 'var(--bg)' : color,
        stroke: color,
        'stroke-width': n.isMerge ? 2.5 : 2,
      })
    );

    // ブランチ／タグの札
    let labelX = textX;
    for (const label of n.labels) {
      const isHead = label.startsWith('HEAD');
      const isRemote = label.startsWith('origin/');
      const isTag = label.startsWith('tag:');
      const fill = isHead
        ? 'var(--accent)'
        : isTag
          ? 'var(--yellow)'
          : isRemote
            ? 'var(--purple)'
            : 'var(--green)';
      const w = label.length * 6.2 + 12;
      const g = el('g', {});
      g.appendChild(
        el('rect', {
          x: labelX,
          y: y - 19,
          width: w,
          height: 15,
          rx: 7.5,
          fill: 'none',
          stroke: fill,
          'stroke-width': 1,
        })
      );
      const t = el('text', { x: labelX + 6, y: y - 8, class: 'g-label', fill });
      t.textContent = label;
      g.appendChild(t);
      svg.appendChild(g);
      labelX += w + 5;
    }

    const msg = el('text', { x: textX, y: y + (n.labels.length ? 6 : 2), class: 'g-msg' });
    msg.textContent = truncate(n.message, 26);
    svg.appendChild(msg);

    const sha = el('text', { x: textX, y: y + (n.labels.length ? 19 : 15), class: 'g-sha' });
    sha.textContent = n.sha + (n.isMerge ? '  (マージ)' : '');
    svg.appendChild(sha);
  }

  container.appendChild(svg);

  // --- 凡例
  const legend = [
    ['var(--accent)', 'HEAD（今いる場所）'],
    ['var(--green)', 'ローカルブランチ'],
    ['var(--purple)', 'origin/*（リモート）'],
    ['var(--yellow)', 'タグ'],
  ];
  for (const [color, text] of legend) {
    const item = document.createElement('span');
    item.className = 'legend-item';
    const dot = document.createElement('span');
    dot.className = 'legend-dot';
    dot.style.background = color;
    item.appendChild(dot);
    item.appendChild(document.createTextNode(text));
    legendEl.appendChild(item);
  }
  if (nodes.some((n) => n.isMerge)) {
    const item = document.createElement('span');
    item.className = 'legend-item';
    item.textContent = '◯（中抜き）= マージコミット';
    legendEl.appendChild(item);
  }
}

function el(tag, attrs) {
  const node = document.createElementNS('http://www.w3.org/2000/svg', tag);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, String(v));
  return node;
}

function truncate(s, n) {
  return s.length > n ? s.slice(0, n - 1) + '…' : s;
}
