// アプリの入口。画面遷移とコマンド実行ループ。
// 状態はセッション1つに集約し、コマンドを打つたびに全ビューを描き直す。

import {
  startStage,
  execute,
  revalidate,
  usedIntendedPath,
  nextStageId,
  ALL_STAGES,
  findStage,
} from './game.js';
import { Terminal } from './ui/terminal.js';
import { renderGraph } from './ui/graphview.js';
import { renderFiles } from './ui/filesview.js';
import { renderQuest, renderChapterList, markup } from './ui/questview.js';
import { renderRealMode } from './real/realmode.js';
import {
  isCleared,
  markCleared,
  setCurrent,
  getCurrent,
  getHintsUsed,
  setHintsUsed,
  resetProgress,
} from './store.js';
import { hasConflictMarkers } from './engine/diff.js';
import { ensureUnlocked } from './gate.js';
import { refreshIgnore } from './engine/repo.js';

const $ = (id) => document.getElementById(id);

const els = {
  stageChapter: $('stage-chapter'),
  stageName: $('stage-name'),
  goalbar: $('goalbar'),
  termOutput: $('term-output'),
  termForm: $('term-form'),
  termInput: $('term-input'),
  chips: $('chips'),
  graphScroll: $('graph-scroll'),
  graphLegend: $('graph-legend'),
  filesGrid: $('files-grid'),
  fileDetail: $('file-detail'),
  questBody: $('quest-body'),
  realBody: $('real-body'),
  drawer: $('drawer'),
  chapterList: $('chapter-list'),
  drawerProgress: $('drawer-progress'),
  editor: $('editor'),
  editorName: $('editor-name'),
  editorHelp: $('editor-help'),
  editorText: $('editor-text'),
  editorTools: $('editor-tools'),
  clearModal: $('clear-modal'),
  clearTitle: $('clear-title'),
  clearTeach: $('clear-teach'),
  clearNote: $('clear-note'),
  clearNext: $('clear-next'),
  tabBadge: $('tab-quest-badge'),
};

const state = {
  session: null,
  view: 'terminal',
  selectedFile: null,
  editingFile: null,
  hintsRevealed: 0,
};

const terminal = new Terminal(
  { output: els.termOutput, form: els.termForm, input: els.termInput, chips: els.chips },
  handleCommand
);

// ---------------------------------------------------------------- ステージ制御

function loadStage(stageId, { fresh = false } = {}) {
  // 前のステージの演出が開いたままにならないように閉じる
  els.clearModal.hidden = true;
  els.editor.hidden = true;
  state.editingFile = null;

  state.session = startStage(stageId);
  state.selectedFile = null;
  state.hintsRevealed = fresh ? 0 : getHintsUsed(stageId);
  setCurrent(stageId);

  terminal.clear();
  terminal.bind(state.session.repo);

  const { stage } = state.session;
  terminal.write({ kind: 'sys', text: `── ${stage.chapterTitle} / ${stage.title} ──` });
  terminal.write({ kind: 'sys', text: stage.intro });
  terminal.write({
    kind: 'sys',
    text: '目標はクエスト画面（下部タブの ◎）に出ています。困ったら `help` か、ヒントを開いてください。',
  });

  renderAll();
  showView('terminal');
}

function handleCommand(line) {
  const session = state.session;
  if (!session) return;

  terminal.write({ kind: 'cmd', text: line });
  const { result, newlyCleared, newlyDone } = execute(session, line);

  if (result.clear) {
    terminal.clear();
  } else {
    if (result.out) terminal.write({ kind: result.ok ? 'out' : 'error', text: result.out });
    if (result.hint) terminal.write({ kind: 'hint', text: result.hint });
  }

  if (result.editFile) openEditor(result.editFile);

  for (const i of newlyDone) {
    terminal.write({ kind: 'goal', text: session.stage.goals[i].text });
  }

  terminal.bind(session.repo);
  renderAll();

  if (newlyCleared) onStageCleared();
}

function onStageCleared() {
  const session = state.session;
  markCleared(session.stage.id);

  els.clearTitle.textContent = session.stage.title;
  els.clearTeach.innerHTML = '';
  for (const line of session.stage.teach) {
    const p = document.createElement('p');
    p.appendChild(markup(line));
    els.clearTeach.appendChild(p);
  }

  els.clearNote.textContent = usedIntendedPath(session)
    ? ''
    : '別のやり方でクリアしました。想定していた手順もヒントに載っているので、目を通しておくと引き出しが増えます。';

  const next = nextStageId(session.stage.id);
  els.clearNext.textContent = next ? '次のステージへ' : '第7章（GitHub 実践）へ';
  els.clearNext.dataset.next = next || 'real';

  els.clearModal.hidden = false;
  terminal.write({ kind: 'goal', text: 'ステージクリア！' });
}

// ---------------------------------------------------------------- 描画

function renderAll() {
  const session = state.session;
  if (!session) return;
  const { stage, repo, goalState, cleared } = session;

  // 第7章は擬似リポジトリの外なので、見出しも目標の帯も専用の表示にする
  if (state.view === 'real') {
    els.stageChapter.textContent = '第7章 GitHub 実践';
    els.stageName.textContent = '本物のリポジトリを動かす';
    els.goalbar.innerHTML = '';
    const pip = document.createElement('span');
    pip.className = 'goal-pip wide';
    pip.textContent = '擬似リポジトリではなく、実際の GitHub API を呼びます';
    els.goalbar.appendChild(pip);
    els.tabBadge.hidden = true;
    return;
  }

  els.stageChapter.textContent = stage.chapterTitle;
  els.stageName.textContent = stage.title;

  // 目標の帯
  els.goalbar.innerHTML = '';
  stage.goals.forEach((g, i) => {
    const pip = document.createElement('span');
    pip.className = 'goal-pip' + (goalState[i] ? ' done' : '');
    const mark = document.createElement('span');
    mark.className = 'mark';
    mark.textContent = goalState[i] ? '✓' : '○';
    pip.appendChild(mark);
    pip.appendChild(document.createTextNode(g.text));
    els.goalbar.appendChild(pip);
  });

  terminal.renderChips(repo, stage);

  if (state.view === 'graph') renderGraph(els.graphScroll, els.graphLegend, repo);
  if (state.view === 'files') {
    renderFiles(els.filesGrid, els.fileDetail, repo, {
      selected: state.selectedFile,
      onSelect: (p) => {
        state.selectedFile = state.selectedFile === p ? null : p;
        renderAll();
      },
      onEdit: openEditor,
    });
  }
  if (state.view === 'quest') renderQuestView();

  els.tabBadge.hidden = cleared || state.view === 'quest';
}

function renderQuestView() {
  const session = state.session;
  renderQuest(els.questBody, session, state.hintsRevealed, {
    hasNext: true,
    onRevealHint: () => {
      state.hintsRevealed = Math.min(state.hintsRevealed + 1, session.stage.hints.length);
      setHintsUsed(session.stage.id, state.hintsRevealed);
      renderQuestView();
    },
    onRestart: () => loadStage(session.stage.id, { fresh: false }),
    onGoTerminal: () => showView('terminal'),
    onNext: () => goNext(),
  });
}

function goNext() {
  const next = nextStageId(state.session.stage.id);
  if (next) loadStage(next, { fresh: true });
  else showView('real');
}

// ---------------------------------------------------------------- 画面切替

function showView(name) {
  state.view = name;
  for (const v of document.querySelectorAll('.view')) {
    v.classList.toggle('is-active', v.id === 'view-' + name);
  }
  for (const t of document.querySelectorAll('.tab')) {
    t.classList.toggle('is-active', t.dataset.view === name);
  }
  if (name === 'real') {
    renderRealMode(els.realBody, { onBack: () => showView('quest') });
  }
  renderAll();
  if (name === 'terminal') terminal.scrollToEnd();
}

for (const tab of document.querySelectorAll('.tab')) {
  tab.addEventListener('click', () => showView(tab.dataset.view));
}

// ---------------------------------------------------------------- 引き出し

function openDrawer() {
  renderChapterList(els.chapterList, els.drawerProgress, {
    currentId: state.session ? state.session.stage.id : null,
    isDone: isCleared,
    onPick: (id) => {
      closeDrawer();
      loadStage(id, { fresh: true });
    },
    onOpenReal: () => {
      closeDrawer();
      showView('real');
    },
  });
  els.drawer.hidden = false;
}

function closeDrawer() {
  els.drawer.hidden = true;
}

$('btn-menu').addEventListener('click', openDrawer);
for (const el of els.drawer.querySelectorAll('[data-close]')) {
  el.addEventListener('click', closeDrawer);
}
$('btn-restart').addEventListener('click', () => {
  if (state.session) loadStage(state.session.stage.id, { fresh: false });
});
$('btn-reset-progress').addEventListener('click', () => {
  if (!confirm('クリア記録をすべて消します。よろしいですか？')) return;
  resetProgress();
  closeDrawer();
  loadStage(ALL_STAGES[0].id, { fresh: true });
});

// ---------------------------------------------------------------- 編集パネル

function openEditor(path) {
  const repo = state.session.repo;
  if (!(path in repo.workdir)) repo.workdir[path] = '';
  state.editingFile = path;
  // ファイル画面の「編集」ボタンから開いた場合も、`edit <file>` を打ったのと同じ扱いにする
  const asCommand = `edit ${path}`;
  if (state.session.ctx.history[state.session.ctx.history.length - 1] !== asCommand) {
    state.session.ctx.history.push(asCommand);
  }
  els.editorName.textContent = path;
  els.editorText.value = repo.workdir[path];

  const conflicted = !!repo.conflicts[path];
  els.editorHelp.textContent = conflicted
    ? '衝突しています。<<<<<<< / ======= / >>>>>>> の行を消して、残したい内容だけにしてください。保存したあと git add を忘れずに。'
    : '内容を書き換えて保存すると、作業ツリーのファイルが変わります（= エディタで編集したのと同じ）。';

  // 編集を助ける補助ボタン
  els.editorTools.innerHTML = '';
  if (conflicted) {
    const c = repo.conflicts[path];
    addTool('自分の版だけ残す', () => (els.editorText.value = c.ours));
    addTool('相手の版だけ残す', () => (els.editorText.value = c.theirs));
    addTool('マーカー行を消す', () => {
      els.editorText.value = els.editorText.value
        .split('\n')
        .filter((l) => !/^(<{7}|={7}$|>{7})/.test(l))
        .join('\n');
    });
  }
  addTool('全部消す', () => (els.editorText.value = ''));

  els.editor.hidden = false;
  requestAnimationFrame(() => els.editorText.focus());
}

function addTool(label, fn) {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'chip';
  b.textContent = label;
  b.addEventListener('click', fn);
  els.editorTools.appendChild(b);
}

function closeEditor() {
  els.editor.hidden = true;
  state.editingFile = null;
}

$('editor-save').addEventListener('click', () => {
  const path = state.editingFile;
  if (!path) return closeEditor();
  const repo = state.session.repo;
  let text = els.editorText.value;
  if (text && !text.endsWith('\n')) text += '\n';
  repo.workdir[path] = text;
  refreshIgnore(repo);

  closeEditor();
  terminal.write({ kind: 'cmd', text: `edit ${path}` });
  terminal.write({ kind: 'out', text: `${path} を保存しました` });
  if (repo.conflicts[path] && !hasConflictMarkers(text)) {
    terminal.write({
      kind: 'hint',
      text: `マーカーが消えました。あとは \`git add ${path}\` で「解消した」と git に伝えます。`,
    });
  }

  // 編集もファイルを変える操作なので、達成判定を回す
  const { newlyCleared, newlyDone } = revalidate(state.session);
  for (const i of newlyDone) {
    terminal.write({ kind: 'goal', text: state.session.stage.goals[i].text });
  }
  renderAll();
  if (newlyCleared) onStageCleared();
});

$('editor-cancel').addEventListener('click', closeEditor);
for (const el of els.editor.querySelectorAll('[data-close-editor]')) {
  el.addEventListener('click', closeEditor);
}

// ---------------------------------------------------------------- クリア演出

$('clear-stay').addEventListener('click', () => {
  els.clearModal.hidden = true;
});
els.clearNext.addEventListener('click', () => {
  els.clearModal.hidden = true;
  const next = els.clearNext.dataset.next;
  if (next && next !== 'real') loadStage(next, { fresh: true });
  else showView('real');
});
for (const el of els.clearModal.querySelectorAll('[data-close-clear]')) {
  el.addEventListener('click', () => {
    els.clearModal.hidden = true;
  });
}

// ---------------------------------------------------------------- 起動

function firstUnclearedStage() {
  const saved = getCurrent();
  if (saved && findStage(saved)) return saved;
  const next = ALL_STAGES.find((s) => !isCleared(s.id));
  return (next || ALL_STAGES[0]).id;
}

// 合言葉が設定されていれば、解除されるまでアプリを起動しない
await ensureUnlocked();
loadStage(firstUnclearedStage());

// Service Worker（オフライン動作）。file:// で開いたときは登録しない。
if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js').catch(() => {
      /* オフライン対応が無くてもアプリ自体は動く */
    });
  });
}

// デバッグ／自動テストから触れるように最小限だけ公開する
window.__gitQuest = {
  run: (line) => handleCommand(line),
  get session() {
    return state.session;
  },
  loadStage,
  showView,
};
