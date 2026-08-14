/* repo-key.mjs - identify a project by its repository, across renames.
 *
 * Every check here keys a project on owner/repo taken from repo_url. That works
 * until a team renames its repository mid-sprint, which is a normal thing to do
 * and happened in the first week: gstohl/feltproof became gstohl/quietline.
 * On a literal key that reads as one project leaving and a different one
 * arriving - the table shows both, and the retention check refuses to let the
 * old name go because it was accepted once.
 *
 * GitHub keeps redirecting the old name, so it can say what a repository is
 * called now. That answer is what these keys are compared on.
 */

const TOKEN = process.env.GITHUB_TOKEN || "";
const cache = new Map();

/* owner/repo, lowercased, without .git or a trailing slash. Anything that is
   not a GitHub repository URL is not a project and returns null - an
   organisation page or a typo was never something anyone could open. */
export function normalize(repoUrl) {
  if (typeof repoUrl !== "string") return null;
  const m = repoUrl.trim().match(/^(?:https?:\/\/)?(?:www\.)?github\.com[/:]([^/\s]+)\/([^/?#\s]+)/i);
  return m ? `${m[1]}/${m[2].replace(/\.git$/i, "")}`.toLowerCase() : null;
}

/* The name the repository has now, or null if GitHub cannot say. Null is not
 * "gone" - an outage, a rate limit and a deleted repository are the same answer
 * here, so callers fall back to the literal key and let a human decide rather
 * than acting on a guess. */
export async function canonical(key) {
  if (!key) return null;
  if (cache.has(key)) return cache.get(key);

  let result = null;
  try {
    const res = await fetch(`https://api.github.com/repos/${key}`, {
      headers: {
        Accept: "application/vnd.github+json",
        "User-Agent": "strk20-private-sprint-validator",
        ...(TOKEN ? { Authorization: `Bearer ${TOKEN}` } : {}),
      },
      /* Redirects are the whole point - fetch follows them by default, and the
         body that comes back carries the current full_name. */
    });
    if (res.ok) {
      const meta = await res.json();
      if (typeof meta?.full_name === "string") result = meta.full_name.toLowerCase();
    }
  } catch {
    result = null;
  }

  cache.set(key, result);
  return result;
}

/* Every name a project is known by: what its entry says, and what GitHub calls
   it now. Indexing on both is what makes a rename a continuation rather than a
   departure and an arrival. */
export async function aliases(repoUrl) {
  const key = normalize(repoUrl);
  if (!key) return [];
  const now = await canonical(key);
  return now && now !== key ? [key, now] : [key];
}
