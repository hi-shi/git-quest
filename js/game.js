// ステージ進行のロジック。UI からもテストからも同じ経路で使う。

import { runLine } from './engine/shell.js';
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

  const result = runLine(repo, trimmed, {
    remoteFactory: () => ctx.remote,
  });

  // 「拒否された push を体験する」系の判定に使う印
  if (/^git push/.test(trimmed) && !result.ok && /non-fast-forward/.test(result.out)) {
    ctx.rejectedPush = true;
  }

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
