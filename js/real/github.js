// GitHub REST クライアント。
//
// 本物のリポジトリを触るので、この層で「触ってよい範囲」を機械的に制限する。
// UI 側のうっかりでは、決められた範囲の外に書き込めないようにするのが狙い。

const API = 'https://api.github.com';

/** 書き込みを許すブランチ名の接頭辞。 */
export const BRANCH_PREFIX = 'quest/';
/** 書き込みを許すファイルの置き場所。 */
export const PATH_PREFIX = 'git-quest-playground/';

export class SafetyError extends Error {
  constructor(message) {
    super(message);
    this.name = 'SafetyError';
  }
}

export function assertWritableBranch(branch) {
  if (typeof branch !== 'string' || !branch.startsWith(BRANCH_PREFIX)) {
    throw new SafetyError(
      `安全のため、書き込めるのは "${BRANCH_PREFIX}" で始まるブランチだけです（指定: ${branch}）`
    );
  }
  if (branch.includes('..') || branch.endsWith('/')) {
    throw new SafetyError(`ブランチ名が不正です: ${branch}`);
  }
}

export function assertWritablePath(path) {
  if (typeof path !== 'string' || !path.startsWith(PATH_PREFIX)) {
    throw new SafetyError(
      `安全のため、書き込めるのは "${PATH_PREFIX}" 配下のファイルだけです（指定: ${path}）`
    );
  }
  if (path.includes('..')) throw new SafetyError(`パスが不正です: ${path}`);
}

export class GitHub {
  /**
   * @param {string} token 個人アクセストークン
   * @param {string} owner
   * @param {string} repo
   * @param {(entry:{method:string,url:string,ok:boolean,note?:string})=>void} [onCall] 呼んだ API を UI に見せる
   */
  constructor(token, owner, repo, onCall) {
    this.token = token;
    this.owner = owner;
    this.repo = repo;
    this.onCall = onCall || (() => {});
  }

  get base() {
    return `${API}/repos/${this.owner}/${this.repo}`;
  }

  async request(method, url, body) {
    const res = await fetch(url.startsWith('http') ? url : API + url, {
      method,
      headers: {
        Accept: 'application/vnd.github+json',
        Authorization: 'Bearer ' + this.token,
        'X-GitHub-Api-Version': '2022-11-28',
        ...(body ? { 'Content-Type': 'application/json' } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });

    const text = await res.text();
    let data = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      data = { message: text };
    }

    this.onCall({
      method,
      url: url.replace(API, ''),
      ok: res.ok,
      note: res.ok ? '' : data && data.message ? data.message : `HTTP ${res.status}`,
    });

    if (!res.ok) {
      const msg = (data && data.message) || `HTTP ${res.status}`;
      const err = new Error(explain(res.status, msg));
      err.status = res.status;
      err.data = data;
      throw err;
    }
    return data;
  }

  // ---- 読み取り

  /** 認証確認。ログイン名を返す。 */
  async me() {
    const u = await this.request('GET', '/user');
    return u.login;
  }

  async repoInfo() {
    return this.request('GET', this.base);
  }

  async listBranches() {
    return this.request('GET', `${this.base}/branches?per_page=100`);
  }

  async getRef(branch) {
    return this.request('GET', `${this.base}/git/ref/heads/${encodeURIComponent(branch)}`);
  }

  async listCommits(branch, perPage = 10) {
    return this.request(
      'GET',
      `${this.base}/commits?sha=${encodeURIComponent(branch)}&per_page=${perPage}`
    );
  }

  /** ファイルの現在の sha（更新に必要）。無ければ null。 */
  async getFileSha(path, branch) {
    try {
      const data = await this.request(
        'GET',
        `${this.base}/contents/${encodePath(path)}?ref=${encodeURIComponent(branch)}`
      );
      return data && data.sha ? data.sha : null;
    } catch (e) {
      if (e.status === 404) return null;
      throw e;
    }
  }

  async listPulls(head) {
    const q = head ? `?head=${this.owner}:${encodeURIComponent(head)}&state=all` : '?state=open';
    return this.request('GET', `${this.base}/pulls${q}`);
  }

  async getPull(number) {
    return this.request('GET', `${this.base}/pulls/${number}`);
  }

  /**
   * 2つのブランチの進み具合。`ahead_by` / `behind_by` が返る。
   * PR 画面の「This branch is out-of-date with the base branch」の中身。
   */
  async compare(base, head) {
    return this.request(
      'GET',
      `${this.base}/compare/${encodeURIComponent(base)}...${encodeURIComponent(head)}`
    );
  }

  /** GitHub Actions の実行履歴。Actions を使っていないリポジトリでは空で返る。 */
  async listWorkflowRuns(perPage = 5) {
    return this.request('GET', `${this.base}/actions/runs?per_page=${perPage}`);
  }

  // ---- 書き込み（ここから先は必ず安全チェックを通す）

  /** `git switch -c` 相当。base の先端から新しいブランチを生やす。 */
  async createBranch(branch, baseBranch) {
    assertWritableBranch(branch);
    const baseRef = await this.getRef(baseBranch);
    return this.request('POST', `${this.base}/git/refs`, {
      ref: 'refs/heads/' + branch,
      sha: baseRef.object.sha,
    });
  }

  /** `git add` + `git commit` + `git push` 相当。1ファイルを作成／更新する。 */
  async putFile({ path, branch, content, message }) {
    assertWritableBranch(branch);
    assertWritablePath(path);
    const sha = await this.getFileSha(path, branch);
    return this.request('PUT', `${this.base}/contents/${encodePath(path)}`, {
      message,
      content: toBase64(content),
      branch,
      ...(sha ? { sha } : {}),
    });
  }

  async createPull({ title, body, head, base }) {
    assertWritableBranch(head);
    return this.request('POST', `${this.base}/pulls`, { title, body, head, base });
  }

  async commentOnPull(number, body) {
    return this.request('POST', `${this.base}/issues/${number}/comments`, { body });
  }

  async mergePull(number, method = 'squash') {
    return this.request('PUT', `${this.base}/pulls/${number}/merge`, { merge_method: method });
  }

  /**
   * バックマージ。`base` に `head` を取り込む（向きがふだんと逆）。
   * PR 画面の `Update branch` ボタンと同じ操作。書き込み先は base 側なのでそこを守る。
   */
  async mergeIntoBranch(base, head, message) {
    assertWritableBranch(base);
    return this.request('POST', `${this.base}/merges`, {
      base,
      head,
      commit_message: message,
    });
  }

  /** PR にレビューを付ける。event は APPROVE / REQUEST_CHANGES / COMMENT。 */
  async reviewPull(number, event, body) {
    return this.request('POST', `${this.base}/pulls/${number}/reviews`, { event, body });
  }

  async deleteBranch(branch) {
    assertWritableBranch(branch);
    return this.request('DELETE', `${this.base}/git/refs/heads/${encodeURIComponent(branch)}`);
  }
}

function encodePath(path) {
  return path.split('/').map(encodeURIComponent).join('/');
}

/** UTF-8 を base64 に（日本語を含む本文でも壊れないように）。 */
export function toBase64(text) {
  const bytes = new TextEncoder().encode(text);
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}

function explain(status, message) {
  if (status === 401) {
    return `認証に失敗しました（401）。トークンが間違っているか、期限切れです。\n${message}`;
  }
  if (status === 403) {
    return `権限がありません（403）。トークンの権限に Contents / Pull requests / Issues の write が入っているか確認してください。\n${message}`;
  }
  if (status === 404) {
    return `見つかりません（404）。リポジトリ名が正しいか、トークンがそのリポジトリを含んでいるか確認してください。\n${message}`;
  }
  if (status === 405) {
    return `この操作は許可されていません（405）。リポジトリの Settings → General → Pull Requests で、そのマージ方式が無効になっているか、まだマージできる状態ではありません。\n${message}`;
  }
  if (status === 422) {
    return `リクエストが受け付けられませんでした（422）。同じ名前のブランチや PR が既にある可能性があります。\n${message}`;
  }
  return `${message}（HTTP ${status}）`;
}
