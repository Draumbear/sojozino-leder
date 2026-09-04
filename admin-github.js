// Minimal client-side GitHub Contents API wrapper used by admin.html.
// Nothing here is sent anywhere except api.github.com — the token lives
// only in this browser's localStorage.

// Netlify rebuilds — and bills credits — on every push to the connected branch,
// so a dashboard that commits per save would burn a deploy per edited product.
// Every write below therefore carries this marker, which Netlify honours by
// skipping the build entirely. The "Publiceer wijzigingen" button calls
// publish(), the one commit that leaves the marker off and actually deploys.
// (GitHub Pages ignores the marker and publishes each commit as before.)
const SKIP_DEPLOY_MARKER = '[skip netlify]';
// Trailer naming the dashboard screen a save came from, e.g. 'products/tties'.
const TARGET_PREFIX = '[target: ';

// Sojozino's site is hosted on Netlify, so deferred publishing is on.
const DEFER_PUBLISH = true;

const GH_STORAGE_KEY = 'sojozino-admin-github';

const GitHubStore = {
  load() {
    try { return JSON.parse(localStorage.getItem(GH_STORAGE_KEY)) || null; }
    catch { return null; }
  },
  save(cfg) { localStorage.setItem(GH_STORAGE_KEY, JSON.stringify(cfg)); },
  clear() { localStorage.removeItem(GH_STORAGE_KEY); }
};

// The marker only counts as its own line. A substring test would treat any
// commit that merely mentions '[skip netlify]' -- a developer commit whose
// message explains this very mechanism, say -- as one of her unpublished
// saves, listing engineering prose to her as if she had written it. (Netlify's
// own detection IS a substring match, so such a commit also silently skips its
// own deploy: don't put the literal marker in a commit message.)
function isDeferredSave(message) {
  return (message || '').split('\n').some(line => line.trim() === SKIP_DEPLOY_MARKER);
}

// GitHub answers "Resource not accessible by personal access token" to every
// kind of permission problem, which tells you nothing about which one. This
// turns a failed request into something actionable, naming both the step that
// failed and the setting that fixes it.
// Plain text, no markup: these strings land in textContent (the connect panel
// and the toasts), where tags would show up literally.
const TOKEN_HELP = 'Ga naar github.com/settings/tokens, open dit token, en zet bij "Repository permissions" de rechten voor "Contents" op "Read and write". Controleer ook dat deze repository bij "Repository access" is aangevinkt.';

function accessError(status, githubMessage, step) {
  if (status === 401) {
    return new Error(`Je token wordt niet meer aanvaard (verlopen of ingetrokken). Maak een nieuw token en verbind opnieuw.`);
  }
  if (status === 403 || status === 404) {
    return new Error(`Geen toestemming om ${step}. ${TOKEN_HELP}`);
  }
  return new Error(githubMessage || `Er ging iets mis bij ${step} (${status}).`);
}

function utf8ToBase64(str) {
  return btoa(unescape(encodeURIComponent(str)));
}
function base64ToUtf8(b64) {
  return decodeURIComponent(escape(atob(b64)));
}

// Monotonic-ish uniqueifier for upload paths. Date.now() alone can collide
// when several files are prepared back-to-back with no network wait between
// them (batch commits removed that natural spacing).
let uploadSeq = 0;
function uniqueUploadName(safeName) {
  uploadSeq += 1;
  return `${Date.now()}-${uploadSeq}-${safeName}`;
}

// Re-encodes an image File as WebP, capped to a reasonable web size.
// SVGs are left alone (already small/vector). Falls back to the original
// file if the browser can't decode/encode it (e.g. no WebP support).
async function toWebP(file, { maxDimension = 1800, quality = 0.82 } = {}) {
  if (!file.type || !file.type.startsWith('image/') || file.type === 'image/svg+xml') return file;
  try {
    const bitmap = await createImageBitmap(file);
    let { width, height } = bitmap;
    if (width > maxDimension || height > maxDimension) {
      const scale = maxDimension / Math.max(width, height);
      width = Math.round(width * scale);
      height = Math.round(height * scale);
    }
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    canvas.getContext('2d').drawImage(bitmap, 0, 0, width, height);
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/webp', quality));
    if (!blob) return file;
    const newName = file.name.replace(/\.[^.]+$/, '') + '.webp';
    return new File([blob], newName, { type: 'image/webp' });
  } catch (e) {
    console.warn('WebP conversion failed, uploading original file instead.', e);
    return file;
  }
}

class GitHubAPI {
  constructor({ token, owner, repo, branch }) {
    this.token = token;
    this.owner = owner;
    this.repo = repo;
    this.branch = branch || 'main';
  }

  get base() { return `https://api.github.com/repos/${this.owner}/${this.repo}`; }

  headers() {
    return {
      'Authorization': `Bearer ${this.token}`,
      'Accept': 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28'
    };
  }

  async verify() {
    const res = await fetch(this.base, { headers: this.headers() });
    if (!res.ok) {
      if (res.status === 401) throw new Error('Dit token wordt niet aanvaard \u2014 het is ongeldig of verlopen. Maak een nieuw token aan.');
      if (res.status === 404) throw new Error('Repository niet gevonden \u2014 controleer gebruikersnaam en repository-naam, en of dit token toegang heeft tot deze repository.');
      const err = await res.json().catch(() => ({}));
      throw accessError(res.status, err.message, 'deze repository te openen');
    }
    const repo = await res.json();

    // Seeing the repository proves almost nothing: a token with no permissions
    // at all still passes that call, and the first real failure would then land
    // much later, mid-save, as GitHub's unhelpful wording. So check here that
    // the token can actually read repository contents, and warn now if GitHub
    // says this account has no write access.
    const probe = await fetch(`${this.base}/contents/data/site.json?_=${Date.now()}`, { headers: this.headers(), cache: 'no-store' });
    if (probe.status === 403 || probe.status === 404) {
      throw new Error(`Dit token mag de inhoud van de repository niet lezen. ${TOKEN_HELP}`);
    }
    if (repo.permissions && repo.permissions.push === false) {
      throw new Error(`Dit token mag lezen maar niet schrijven, dus opslaan zou later mislukken. ${TOKEN_HELP}`);
    }
    return repo;
  }

  // Lists files directly inside a repo folder (non-recursive). Returns [] for
  // a folder that doesn't exist yet (e.g. no uploads made yet) instead of
  // throwing, since that's a normal/expected state, not an error.
  async listFolder(path) {
    const url = `${this.base}/contents/${encodeURI(path)}?ref=${this.branch}&_=${Date.now()}`;
    const res = await fetch(url, { headers: this.headers(), cache: 'no-store' });
    if (res.status === 404) return [];
    if (!res.ok) throw new Error(`Failed to list ${path} (${res.status})`);
    const data = await res.json();
    return (Array.isArray(data) ? data : []).filter(f => f.type === 'file');
  }

  // Returns { content: string, sha: string } or null if the file doesn't exist.
  // cache:'no-store' + a cache-busting param so this always reflects the true
  // current state of the file, never a browser-cached copy from earlier in
  // the session — that staleness is what causes accidental overwrites.
  async getFile(path) {
    const url = `${this.base}/contents/${encodeURI(path)}?ref=${this.branch}&_=${Date.now()}`;
    const res = await fetch(url, { headers: this.headers(), cache: 'no-store' });
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`Failed to read ${path} (${res.status})`);
    const data = await res.json();
    return { content: base64ToUtf8(data.content), sha: data.sha };
  }

  async getJSON(path) {
    const file = await this.getFile(path);
    return file ? JSON.parse(file.content) : null;
  }

  // Like getJSON, but also returns the file's current sha so callers can
  // detect "this changed since I loaded it" before overwriting.
  async getJSONWithSha(path) {
    const file = await this.getFile(path);
    return file ? { data: JSON.parse(file.content), sha: file.sha } : { data: null, sha: null };
  }

  // content: raw string (text) or { base64: '...' } for binary uploads.
  async putFile(path, content, message) {
    const existing = await this.getFile(path).catch(() => null);
    const body = {
      message: this._saveMessage(message),
      content: typeof content === 'string' ? utf8ToBase64(content) : content.base64,
      branch: this.branch
    };
    if (existing) body.sha = existing.sha;

    const res = await fetch(`${this.base}/contents/${encodeURI(path)}`, {
      method: 'PUT',
      headers: { ...this.headers(), 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.message || `Failed to save ${path} (${res.status})`);
    }
    return res.json();
  }

  async putJSON(path, obj, message) {
    return this.putFile(path, JSON.stringify(obj, null, 2), message);
  }

  async deleteFile(path, message) {
    const existing = await this.getFile(path);
    if (!existing) return; // already gone
    const res = await fetch(`${this.base}/contents/${encodeURI(path)}`, {
      method: 'DELETE',
      headers: { ...this.headers(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: this._saveMessage(message), sha: existing.sha, branch: this.branch })
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.message || `Failed to delete ${path} (${res.status})`);
    }
  }

  rawUrl(path) {
    return `https://raw.githubusercontent.com/${this.owner}/${this.repo}/${this.branch}/${path}`;
  }

  // Inverse of rawUrl() — returns the repo-relative path if this URL points at
  // a file in this repo/branch, or null for anything else.
  pathFromRawUrl(url) {
    if (!url) return null;
    const prefix = this.rawUrl('');
    return url.startsWith(prefix) ? url.slice(prefix.length) : null;
  }

  uniquePath(name, folder = 'assets/uploads') {
    const safeName = name.replace(/[^a-zA-Z0-9.\-_]/g, '-');
    return `${folder}/${uniqueUploadName(safeName)}`;
  }

  // Reads a File/Blob and gets it ready for a batch commit — does NOT touch
  // the network. Returns { path, content, url }: `url` is the raw.githubusercontent.com
  // URL the file will have once committed (safe to use immediately, e.g. in JSON
  // that's part of the same batch), and `content` is what commitBatch() expects.
  // Images are re-encoded to WebP (and downsized if huge) unless { optimize: false }
  // is passed.
  async prepareUpload(file, folder = 'assets/uploads', { optimize = true } = {}) {
    if (optimize) file = await toWebP(file);
    const base64 = await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result.split(',')[1]);
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
    const path = this.uniquePath(file.name, folder);
    return { path, content: { base64 }, url: this.rawUrl(path) };
  }

  // Single choke point for save commit messages: nothing that writes from the
  // dashboard may reach the branch without the skip marker attached.
  _saveMessage(message, target) {
    if (!DEFER_PUBLISH) return message;
    const lines = [message, '', SKIP_DEPLOY_MARKER];
    // Where in the dashboard this change was made, so the publish bar can offer
    // a way back to it. A trailer rather than something parsed out of the
    // message text: the messages are prose, and prose changes.
    if (target) lines.push(`${TARGET_PREFIX}${target}]`);
    return lines.join('\n');
  }

  // The publish step: an empty commit with NO skip marker, so Netlify picks it
  // up and ships every save made since the last publish in a single build.
  async publish(message = 'Publiceer wijzigingen') {
    return this._commitTreeEntries([], message);
  }

  // Undo, for anything. Rather than reconstructing what a change contained --
  // impossible for deleted photos, whose bytes are gone from the working set --
  // this points each path the commit touched back at the blob it had in the
  // parent commit. Git still has those blobs, so the restore is exact and no
  // file content has to be downloaded or re-uploaded. A path that did not exist
  // in the parent was added by the change, so undoing it means deleting it.
  async revertCommit(sha, message) {
    const res = await fetch(`${this.base}/commits/${sha}?_=${Date.now()}`, { headers: this.headers(), cache: 'no-store' });
    if (!res.ok) throw new Error(`Kon de wijziging niet ophalen (${res.status})`);
    const detail = await res.json();
    const parent = detail.parents && detail.parents[0];
    if (!parent) throw new Error('Deze wijziging heeft niets om naar terug te keren.');

    const entries = await Promise.all((detail.files || []).map(async (f) => {
      const before = await this.blobShaAt(f.filename, parent.sha);
      return { path: f.filename, mode: '100644', type: 'blob', sha: before };
    }));
    if (!entries.length) throw new Error('Deze wijziging raakte geen bestanden aan.');
    return this._commitTreeEntries(entries, this._saveMessage(message));
  }

  // Blob sha of a path at a given commit, or null when it did not exist there.
  async blobShaAt(path, ref) {
    const url = `${this.base}/contents/${encodeURI(path)}?ref=${ref}&_=${Date.now()}`;
    const res = await fetch(url, { headers: this.headers(), cache: 'no-store' });
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`Kon ${path} niet lezen (${res.status})`);
    return (await res.json()).sha;
  }

  // Everything saved since the last published (marker-free) commit, newest
  // first. Read from the branch history rather than kept locally, so the list
  // is right across browsers and devices. Returns null if the history can't be
  // read — callers treat that as "unknown", not as "nothing pending".
  async pendingChanges() {
    if (!DEFER_PUBLISH) return [];
    const url = `${this.base}/commits?sha=${this.branch}&per_page=100&_=${Date.now()}`;
    const res = await fetch(url, { headers: this.headers(), cache: 'no-store' });
    if (!res.ok) return null;
    const commits = await res.json();
    const pending = [];
    for (const c of commits) {
      const message = c.commit.message;
      if (!isDeferredSave(message)) break;
      const target = (message.match(/\[target: ([^\]]+)\]/) || [])[1] || null;
      pending.push({
        sha: c.sha,
        summary: message.split('\n')[0],
        target,
        date: c.commit.author && c.commit.author.date || null
      });
    }
    return pending;
  }

  // Commits any number of file changes as a single atomic commit + push, so one
  // user action (e.g. "Save product" touching several images plus a JSON file)
  // is one commit rather than one per file. Saves don't deploy at all — see
  // SKIP_DEPLOY_MARKER above and publish().
  // files: [{ path, content }] to add/update (content: string or { base64 }),
  // or [{ path, delete: true }] to remove a path.
  async commitBatch(files, message, target) {
    if (!files.length) return null;

    // Blob creation is content-addressed and independent of the branch tip, so
    // it only needs to happen once — even if committing below has to retry
    // against a moved tip, these shas are still valid.
    const treeEntries = await Promise.all(files.map(async (f) => {
      if (f.delete) return { path: f.path, mode: '100644', type: 'blob', sha: null };
      const body = typeof f.content === 'string'
        ? { content: f.content, encoding: 'utf-8' }
        : { content: f.content.base64, encoding: 'base64' };
      const res = await fetch(`${this.base}/git/blobs`, {
        method: 'POST', headers: { ...this.headers(), 'Content-Type': 'application/json' }, body: JSON.stringify(body)
      });
      if (!res.ok) { const err = await res.json().catch(() => ({})); throw accessError(res.status, err.message, `de foto ${f.path} te uploaden`); }
      const sha = (await res.json()).sha;
      return { path: f.path, mode: '100644', type: 'blob', sha };
    }));

    return this._commitTreeEntries(treeEntries, this._saveMessage(message, target));
  }

  // Builds a tree on top of the branch's CURRENT tip and updates the ref. If
  // the tip moved since we read it, the ref update is rejected as "not a
  // fast forward"; retried once against the new tip (still using the same
  // already-uploaded blobs) rather than just failing the whole save.
  async _commitTreeEntries(treeEntries, message, retriesLeft = 1) {
    const refRes = await fetch(`${this.base}/git/ref/heads/${this.branch}`, { headers: this.headers(), cache: 'no-store' });
    if (!refRes.ok) throw new Error(`Failed to read branch ref (${refRes.status})`);
    const parentSha = (await refRes.json()).object.sha;

    const parentCommitRes = await fetch(`${this.base}/git/commits/${parentSha}`, { headers: this.headers(), cache: 'no-store' });
    if (!parentCommitRes.ok) throw new Error(`Failed to read parent commit (${parentCommitRes.status})`);
    const baseTreeSha = (await parentCommitRes.json()).tree.sha;

    // No entries means an empty commit (publish()): reuse the parent's tree
    // verbatim rather than asking GitHub to build one from nothing.
    let newTreeSha = baseTreeSha;
    if (treeEntries.length) {
      const treeRes = await fetch(`${this.base}/git/trees`, {
        method: 'POST', headers: { ...this.headers(), 'Content-Type': 'application/json' },
        body: JSON.stringify({ base_tree: baseTreeSha, tree: treeEntries })
      });
      if (!treeRes.ok) { const err = await treeRes.json().catch(() => ({})); throw accessError(treeRes.status, err.message, 'de wijziging klaar te zetten'); }
      newTreeSha = (await treeRes.json()).sha;
    }

    const commitRes = await fetch(`${this.base}/git/commits`, {
      method: 'POST', headers: { ...this.headers(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ message, tree: newTreeSha, parents: [parentSha] })
    });
    if (!commitRes.ok) { const err = await commitRes.json().catch(() => ({})); throw accessError(commitRes.status, err.message, 'de wijziging vast te leggen'); }
    const newCommitSha = (await commitRes.json()).sha;

    const updateRefRes = await fetch(`${this.base}/git/refs/heads/${this.branch}`, {
      method: 'PATCH', headers: { ...this.headers(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ sha: newCommitSha })
    });
    if (!updateRefRes.ok) {
      const conflict = updateRefRes.status === 422 || updateRefRes.status === 409;
      if (conflict && retriesLeft > 0) {
        return this._commitTreeEntries(treeEntries, message, retriesLeft - 1);
      }
      const err = await updateRefRes.json().catch(() => ({}));
      throw accessError(updateRefRes.status, err.message, 'de wijziging op te slaan');
    }

    return newCommitSha;
  }
}
