// node --test git-quest/test/stages.test.js
//
// 全ステージについて「模範解答を流したら本当にクリアできるか」を検証する。
// ステージを足したらここにも解答を足すこと。解答が無いステージはテストが落ちる。

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { ALL_STAGES, CHAPTERS } from '../js/stages/index.js';
import { startStage, execute, usedIntendedPath } from '../js/game.js';

/** stageId -> 模範解答のコマンド列 */
const SOLUTIONS = {
  // ---- 第1章
  'ch1-1': ['git init', 'echo "こんにちは" > hello.txt', 'git status'],
  'ch1-2': ['git add hello.txt', 'git status'],
  'ch1-3': ['git commit -m "最初のコミット"', 'git status'],
  'ch1-4': [
    'git log --oneline',
    'echo "味噌汁: だし、味噌、豆腐" >> recipes.txt',
    'git add recipes.txt',
    'git commit -m "味噌汁のレシピを追加"',
  ],

  // ---- 現在地の章
  'cwd-1': ['pwd', 'cd src', 'ls', 'cd ..', 'pwd'],
  'cwd-2': ['cd ..', 'git status', 'cd my-project', 'git status'],
  'cwd-3': [
    'git add .',
    'git status',
    'cd ..',
    'git add .',
    'git status',
  ],
  'cwd-4': ['git init', 'pwd', 'cd ..', 'git add .', 'git commit -m "テーマを追加"'],

  // ---- 第2章
  'ch2-0': ['git diff', 'echo "port: 8080" >> config.txt', 'git add notes.txt'],
  'ch2-1': ['git diff', 'git diff --staged'],
  'ch2-2': ['git restore --staged secret.txt', 'git status'],
  'ch2-3': ['git reset --soft HEAD~1', 'git status'],
  'ch2-4': ['git reset --hard HEAD', 'ls'],
  'ch2-5': ['git add login.test.js', 'git commit --amend -m "ログイン機能とテストを追加"'],
  'ch2-6': ['echo "*.log" > .gitignore', 'echo "secrets.env" >> .gitignore', 'git status'],
  'ch2-7': [
    'echo ".env" > .gitignore',
    'git rm --cached .env',
    'git add .gitignore',
    'git commit -m ".env の追跡をやめる"',
    'git status',
  ],
  'ch2-8': ['git reflog', 'git reset --hard HEAD@{1}', 'git log --oneline'],

  // ---- 第3章
  'ch3-1': ['git switch -c feature/dark-mode', 'git branch'],
  'ch3-2': ['git merge feature/dark-mode'],
  'ch3-3': ['git merge feature/search'],
  'ch3-4': ['git branch -d feature/search', 'git branch -d feature/wip', 'git branch'],
  'ch3-5': ['git status', 'git switch -c rescue', 'git branch'],

  // ---- 第4章
  'ch4-1': ['git merge feature/copy', 'git status', 'cat index.html'],
  'ch4-2': [
    'echo "タイトル: 山田商店 公式サイト — ようこそ！" > index.html',
    'git add index.html',
    'git commit -m "マージ: タイトルの表記を統一"',
  ],
  'ch4-3': ['git merge --abort', 'cat config.yml'],

  // ---- 第5章
  'ch5-1': ['git rebase main', 'git log --oneline'],
  'ch5-2': [
    'git rebase main',
    'echo "バージョン: 2.1-beta" > version.txt',
    'git add version.txt',
    'git rebase --continue',
  ],
  'ch5-3': ['git log --oneline --all', 'git cherry-pick hotfix~1'],
  'ch5-4': [
    'git stash',
    'git switch main',
    'echo "緊急修正" > hotfix.js',
    'git add .',
    'git commit -m "緊急修正"',
    'git switch feature/chart',
    'git stash pop',
  ],
  'ch5-5': ['git revert HEAD'],

  // ---- 第6章
  'ch6-1': [
    'git clone https://github.com/team/awesome-app.git',
    'ls',
    'git remote -v',
  ],
  'ch6-2': [
    'echo "私の作業" > my-work.md',
    'git add .',
    'git commit -m "作業メモを追加"',
    'git push -u origin main',
  ],
  'ch6-3': ['git fetch', 'ls', 'git merge origin/main'],
  'ch6-4': ['git push', 'git pull', 'git push'],
  'ch6-5': [
    'git remote -v',
    'git remote rename origin upstream',
    'git branch -a',
  ],
  'ch6-6': [
    'git log --oneline --all',
    'git fetch',
    'git log --oneline --all',
    'ls',
  ],
  'ch6-7': [
    'git fetch origin release',
    'git fetch origin release:staging',
    'git fetch origin main:main',
    'git branch',
  ],
};

/** 解答を流して最終状態を返す。 */
function play(stageId, { allowFail = [] } = {}) {
  const session = startStage(stageId);
  const lines = SOLUTIONS[stageId];
  assert.ok(lines, `${stageId} の模範解答が未定義`);
  for (const line of lines) {
    const { result } = execute(session, line);
    if (!result.ok && !allowFail.some((re) => re.test(line))) {
      // 失敗が想定されているステージ（push 拒否など）以外は落とす
      const expectFail =
        /^(git push|git branch -d feature\/wip|git merge feature\/copy|git rebase main)/.test(line) ||
        // 現在地の章は「失敗を体験する」のが目的のステージがある
        (stageId === 'cwd-2' && /^git status/.test(line)) ||
        (stageId === 'cwd-4' && /^git init/.test(line)) ||
        // 「拒否されることを確かめる」のが目的
        (stageId === 'ch6-7' && /^git fetch origin main:main/.test(line));
      if (!expectFail) {
        assert.fail(`${stageId}: 「${line}」が失敗\n${result.out}\n${result.hint || ''}`);
      }
    }
  }
  return session;
}

test('全ステージに模範解答が用意されている', () => {
  const missing = ALL_STAGES.filter((s) => !SOLUTIONS[s.id]).map((s) => s.id);
  assert.deepEqual(missing, [], '解答が無いステージ: ' + missing.join(', '));
});

test('模範解答に対応するステージが存在する（消したステージの解答が残っていない）', () => {
  const ids = new Set(ALL_STAGES.map((s) => s.id));
  const orphans = Object.keys(SOLUTIONS).filter((id) => !ids.has(id));
  assert.deepEqual(orphans, []);
});

for (const stage of ALL_STAGES) {
  test(`[${stage.id}] ${stage.title} — 模範解答でクリアできる`, () => {
    const session = play(stage.id);
    const unmet = session.stage.goals
      .map((g, i) => (session.goalState[i] ? null : g.text))
      .filter(Boolean);
    assert.deepEqual(unmet, [], `未達成の目標:\n - ${unmet.join('\n - ')}`);
    assert.equal(session.cleared, true);
  });

  test(`[${stage.id}] 開始直後はクリア済みでない`, () => {
    const session = startStage(stage.id);
    assert.equal(session.cleared, false, '最初から全目標達成になっている（判定条件が緩すぎる）');
  });

  test(`[${stage.id}] 模範解答が wantedCommands を満たす`, () => {
    const session = play(stage.id);
    assert.equal(
      usedIntendedPath(session),
      true,
      `wantedCommands: ${(stage.wantedCommands || []).map(String).join(', ')}\n実行: ${session.ctx.history.join(' / ')}`
    );
  });
}

test('クリアした瞬間に newlyCleared がちょうど1回だけ立つ', () => {
  // UI のクリア演出はこのフラグだけを頼りにしているので、必ず1回きりであること
  for (const stage of ALL_STAGES) {
    const session = startStage(stage.id);
    let count = 0;
    for (const line of SOLUTIONS[stage.id]) {
      if (execute(session, line).newlyCleared) count++;
    }
    assert.equal(count, 1, `${stage.id}: newlyCleared が ${count} 回（1回であるべき）`);
    // クリア後に別のコマンドを打っても再度は立たない
    assert.equal(execute(session, 'git status').newlyCleared, false, `${stage.id}: 二重発火`);
  }
});

test('newlyDone は新しく達成した目標だけを返す', () => {
  const session = startStage('ch1-1');
  const first = execute(session, 'git init');
  assert.deepEqual(first.newlyDone, [0], 'git init で1つ目だけが達成される');
  const again = execute(session, 'git status');
  assert.deepEqual(again.newlyDone, [], '同じ目標が二度報告されない');
  const second = execute(session, 'echo "hi" > hello.txt');
  assert.deepEqual(second.newlyDone, [1]);
});

test('章の構成が壊れていない', () => {
  assert.equal(CHAPTERS.length, 7);
  for (const ch of CHAPTERS) {
    assert.ok(ch.title && ch.subtitle && ch.blurb, `${ch.id} のメタ情報が欠けている`);
    assert.ok(ch.stages.length > 0);
    for (const s of ch.stages) {
      assert.ok(s.intro && s.intro.length > 10, `${s.id}: intro が短すぎる`);
      assert.ok(s.goals.length > 0, `${s.id}: 目標が無い`);
      assert.ok(s.hints.length >= 2, `${s.id}: ヒントが少ない`);
      assert.ok(s.teach.length >= 1, `${s.id}: まとめが無い`);
      for (const g of s.goals) {
        assert.equal(typeof g.check, 'function', `${s.id}: check が関数でない`);
        assert.ok(g.text, `${s.id}: 目標の説明文が無い`);
      }
    }
  }
});

test('ステージ id が重複していない', () => {
  const ids = ALL_STAGES.map((s) => s.id);
  assert.equal(new Set(ids).size, ids.length);
});
