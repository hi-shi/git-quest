// ステージ進行のロジック。UI からもテストからも同じ経路で使う。

import { runLine } from './engine/shell.js';
import { cwdRel, inRepo } from './engine/paths.js';
import { buildStage, findStage, ALL_STAGES, stageIndex } from './stages/index.js';

/**
 * ステージを1つ開始する。
 * @returns {{stage, repo, ctx, cleared:boolean, goalState:boolean[]}}
 */
export function startStage(stageId) {
  const stage = findStage(stageId);
  if (!stage) throw new Error('unknown stage: ' + stageId);
  const { repo, ctx } = buildStage(stage);
  const session = { stage, repo, ctx, cleared: false, goalState: stage.goals.map(() => false) };
  evaluate(session);
  return session;
}

/**
 * 1コマンド実行し、目標の達成状況を更新する。
 * @returns {{result: object, newlyCleared: boolean, newlyDone: number[]}}
 */
export function execute(session, line) {
  const { repo, ctx, stage } = session;
  const trimmed = line.trim();
  ctx.history.push(trimmed);

  // 実行前の居場所。「どこで打ったか」を判定に使うため先に控える。
  const whereBefore = cwdRel(repo);
  const inRepoBefore = inRepo(repo);

  const result = runLine(repo, trimmed, {
    remoteFactory: () => ctx.remote,
  });

  // 「拒否された push を体験する」系の判定に使う印
  if (/^git push/.test(trimmed) && !result.ok && /non-fast-forward/.test(result.out)) {
    ctx.rejectedPush = true;
  }

  recordWhere(session, trimmed, result, { whereBefore, inRepoBefore });

  // evaluate() が session.cleared を書き換えるので、比較用の値は必ず先に取っておく
  const { newlyDone, newlyCleared } = revalidate(session);
  return { result, newlyCleared, newlyDone, stage };
}

/**
 * コマンド以外の操作（編集パネルでの保存など）のあとに達成判定だけ回す。
 * @returns {{newlyCleared:boolean, newlyDone:number[]}}
 */
export function revalidate(session) {
  const before = [...session.goalState];
  const wasCleared = session.cleared;
  evaluate(session);
  return {
    newlyDone: session.goalState.map((v, i) => (v && !before[i] ? i : -1)).filter((i) => i >= 0),
    newlyCleared: session.cleared && !wasCleared,
  };
}

/**
 * 「どこで何をしたか」を記録する。
 * 現在地の章の判定はコマンド名だけでは足りず、打った場所が要る。
 */
function recordWhere(session, line, result, { whereBefore, inRepoBefore }) {
  const { repo, ctx } = session;
  const here = cwdRel(repo);

  // 訪れた場所の履歴
  ctx.cwdHistory = ctx.cwdHistory || [whereBefore];
  if (here !== ctx.cwdHistory[ctx.cwdHistory.length - 1]) ctx.cwdHistory.push(here);
  repo.cwdHistory = ctx.cwdHistory; // ステージ判定から repo 経由でも見えるように

  ctx.visited = ctx.visited || [];
  if (here !== null && here !== '' && !ctx.visited.includes(here)) ctx.visited.push(here);

  // その場所で ls を打ったか
  if (/^ls\b/.test(line) && result.ok) {
    ctx.lsIn = ctx.lsIn || [];
    const at = whereBefore;
    if (at !== null && !ctx.lsIn.includes(at)) ctx.lsIn.push(at);
  }

  // リポジトリの外に出たか / 外で git が失敗したか / 戻って成功したか
  if (!inRepo(repo)) ctx.wasOutsideRepo = true;
  if (/^git\s/.test(line) && !inRepoBefore && !result.ok && /not a git repository/.test(result.out)) {
    ctx.gitFailedOutside = true;
  }
  if (/^git status/.test(line) && inRepoBefore && result.ok && ctx.gitFailedOutside) {
    ctx.gitOkAfterReturn = true;
  }

  // サブディレクトリから add したか
  if (/^git add\b/.test(line) && result.ok && whereBefore) ctx.addedFromSub = true;

  // 入れ子リポジトリの作成を止められたか
  if (/^git init\b/.test(line) && !result.ok && /入れ子/.test(result.out)) ctx.blockedInit = true;

  // 今いるブランチへの直接 fetch が拒否されたか
  if (/^git fetch\b/.test(line) && !result.ok && /refusing to fetch/.test(result.out)) {
    ctx.refusedFetch = true;
  }
}

function evaluate(session) {
  const { stage, repo, ctx } = session;
  session.goalState = stage.goals.map((g, i) => {
    // 一度達成した目標は下げない（試行錯誤で消えてしまうと理不尽なため）
    if (session.goalState && session.goalState[i]) return true;
    try {
      return !!g.check(repo, ctx);
    } catch {
      return false;
    }
  });
  session.cleared = session.goalState.every(Boolean);
}

/** 想定した手順を踏んだか（別解の提示に使う）。 */
export function usedIntendedPath(session) {
  const wanted = session.stage.wantedCommands || [];
  return wanted.every((re) => session.ctx.history.some((h) => re.test(h)));
}

export function nextStageId(stageId) {
  const i = stageIndex(stageId);
  return i >= 0 && i + 1 < ALL_STAGES.length ? ALL_STAGES[i + 1].id : null;
}

export { ALL_STAGES, findStage, stageIndex };
