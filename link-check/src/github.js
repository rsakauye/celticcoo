export function pullRequestPlan(pulls, { branch }) {
  const match = (pulls || []).find((pull) => pull?.head?.ref === branch && pull.number);
  if (match) return { action: 'update', number: match.number };
  return { action: 'create' };
}

async function github(fetchImpl, token, path, { method = 'GET', body } = {}) {
  const response = await fetchImpl(`https://api.github.com${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'link-check',
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await response.text();
  let payload = null;
  if (text) {
    try { payload = JSON.parse(text); } catch { payload = text; }
  }
  if (!response.ok) {
    const detail = typeof payload === 'string' ? payload.slice(0, 180) : (payload?.message || `HTTP ${response.status}`);
    throw new Error(`GitHub ${method} ${path} failed: ${detail}`);
  }
  return payload;
}

// One open pull request for the bot branch. A later run updates that request instead of opening another.
export async function openOrUpdatePullRequest({
  token, repository, branch, base, title, body, fetchImpl = fetch,
}) {
  if (!token) throw new Error('GITHUB_TOKEN is required');
  const [owner, repo] = String(repository || '').split('/');
  if (!owner || !repo || repository.split('/').length !== 2) throw new Error('GITHUB_REPOSITORY must be owner/repo');
  const listed = await github(
    fetchImpl,
    token,
    `/repos/${owner}/${repo}/pulls?state=open&head=${encodeURIComponent(`${owner}:${branch}`)}&per_page=20`,
  );
  const plan = pullRequestPlan(Array.isArray(listed) ? listed : [], { branch, title });
  if (plan.action === 'update') {
    const updated = await github(fetchImpl, token, `/repos/${owner}/${repo}/pulls/${plan.number}`, {
      method: 'PATCH',
      body: { title, body },
    });
    return { action: 'update', number: updated.number, url: updated.html_url };
  }
  const created = await github(fetchImpl, token, `/repos/${owner}/${repo}/pulls`, {
    method: 'POST',
    body: { title, head: branch, base, body },
  });
  return { action: 'create', number: created.number, url: created.html_url };
}
