// 進捗の保存。localStorage が使えない環境（プライベートモード等）でも落ちないようにする。

const KEY = 'git-quest:progress:v1';

const memoryFallback = { cleared: [], current: null, hintsUsed: {} };
let usingMemory = false;

function read() {
  if (usingMemory) return memoryFallback;
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return { cleared: [], current: null, hintsUsed: {} };
    const parsed = JSON.parse(raw);
    return {
      cleared: Array.isArray(parsed.cleared) ? parsed.cleared : [],
      current: parsed.current || null,
      hintsUsed: parsed.hintsUsed || {},
    };
  } catch {
    usingMemory = true;
    return memoryFallback;
  }
}

function write(state) {
  if (usingMemory) {
    Object.assign(memoryFallback, state);
    return;
  }
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
  } catch {
    usingMemory = true;
    Object.assign(memoryFallback, state);
  }
}

export function getProgress() {
  return read();
}

export function isCleared(stageId) {
  return read().cleared.includes(stageId);
}

export function markCleared(stageId) {
  const s = read();
  if (!s.cleared.includes(stageId)) s.cleared.push(stageId);
  write(s);
}

export function setCurrent(stageId) {
  const s = read();
  s.current = stageId;
  write(s);
}

export function getCurrent() {
  return read().current;
}

export function getHintsUsed(stageId) {
  return read().hintsUsed[stageId] || 0;
}

export function setHintsUsed(stageId, n) {
  const s = read();
  s.hintsUsed[stageId] = n;
  write(s);
}

export function resetProgress() {
  write({ cleared: [], current: null, hintsUsed: {} });
}

// ---------------------------------------------------------------- 実践モード

const REAL_KEY = 'git-quest:real:v1';

export function getRealState() {
  try {
    return JSON.parse(localStorage.getItem(REAL_KEY) || '{}');
  } catch {
    return {};
  }
}

export function setRealState(patch) {
  try {
    const cur = getRealState();
    localStorage.setItem(REAL_KEY, JSON.stringify({ ...cur, ...patch }));
  } catch {
    /* 保存できない環境では毎回入力してもらう */
  }
}

export function clearRealState() {
  try {
    localStorage.removeItem(REAL_KEY);
  } catch {
    /* noop */
  }
}

/** 第9章の進捗だけを消す。接続設定（トークン・オーナー・リポジトリ）は残す。 */
export function resetRealProgress() {
  try {
    const { token, owner, repo } = getRealState();
    localStorage.setItem(REAL_KEY, JSON.stringify({ token, owner, repo }));
  } catch {
    /* noop */
  }
}
