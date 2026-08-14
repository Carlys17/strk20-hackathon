/* validate-registry.mjs - check registry.json on every pull request.
 *
 * Registration is a PR against registry.json, so this is what stands between a
 * contributor and being merged. It reports every problem in one pass rather
 * than failing on the first, because a round trip per typo is the fastest way
 * to lose someone in an 18-day sprint.
 *
 * Exit 0 means a maintainer can merge without reading the JSON.
 *
 *   node scripts/validate-registry.mjs
 *
 * GITHUB_TOKEN is optional - without it the public-repository check is skipped
 * rather than failing, since unauthenticated requests run out quickly.
 */

import { readFileSync } from "node:fs";

const TOKEN = process.env.GITHUB_TOKEN || "";
const CATEGORIES = ["Consumer", "DeFi", "Tooling", "Infra", "Payments", "Gaming", "Other"];
const STATUSES = ["building", "finished"];

const errors = [];
const notes = [];
const err = (where, msg) => errors.push(`${where}: ${msg}`);

let registry;
try {
  registry = JSON.parse(readFileSync(new URL("../registry.json", import.meta.url), "utf8"));
} catch (e) {
  console.error(`registry.json is not valid JSON - ${e.message}`);
  console.error("A trailing comma after the last entry is the usual cause.");
  process.exit(1);
}

if (!Array.isArray(registry)) {
  console.error("registry.json must be a JSON array of project objects.");
  process.exit(1);
}

function parseRepo(url) {
  if (typeof url !== "string") return null;
  const m = url.trim().match(/github\.com[/:]([^/]+)\/([^/?#]+)/i);
  return m ? { owner: m[1], repo: m[2].replace(/\.git$/i, "") } : null;
}

const seen = new Map();
const repoChecks = [];
const toAdd = [];

registry.forEach((entry, i) => {
  /* Always carry the index: two entries with the same slug is itself an error,
     and without it both sets of messages look like they describe one entry. */
  const where = entry?.slug ? `entry #${i + 1} "${entry.slug}"` : (entry?.repo_url ? `entry #${i + 1} (${entry.repo_url})` : `entry #${i + 1}`);

  if (typeof entry !== "object" || entry === null) {
    err(where, "is not an object");
    return;
  }

  /* Only two things cannot be read from the repository. Everything else is
     derived, and the entry may override it. */
  if (!entry.repo_url || typeof entry.repo_url !== "string" || !entry.repo_url.trim()) {
    err(where, '"repo_url" is required');
  }

  const parsed = parseRepo(entry.repo_url);
  const slug = entry.slug || (parsed ? parsed.repo.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") : "");
  if (entry.slug && !/^[a-z0-9]+(-[a-z0-9]+)*$/.test(entry.slug)) {
    err(where, `slug "${entry.slug}" must be lowercase and hyphenated, e.g. "zk-mail"`);
  }
  if (slug) {
    if (seen.has(slug)) {
      err(where, `slug "${slug}" is already used by entry #${seen.get(slug) + 1}`);
    } else {
      seen.set(slug, i);
    }
  }

  if (entry.category && !CATEGORIES.includes(entry.category)) {
    err(where, `category "${entry.category}" must be one of: ${CATEGORIES.join(", ")}`);
  }

  /* Optional: at registration the only valid value is "building", so requiring
     it would just be boilerplate. Absent means building. */
  if (entry.status && !STATUSES.includes(entry.status)) {
    err(where, `status "${entry.status}" must be "building" or "finished"`);
  }

  /* Registrations merge unattended, so this is the only contact detail anyone
     collects. Without a reachable handle there is no way to reach a team about
     their entry, their submission, or a prize. */
  if (!Array.isArray(entry.telegram) || entry.telegram.length === 0) {
    err(where, '"telegram" must be a non-empty array of Telegram usernames, one per person on the team');
  } else {
    for (const h of entry.telegram) {
      if (typeof h !== "string" || /^@|t\.me|https?:|\s/.test(h)) {
        err(where, `telegram entry "${h}" should be a bare username without "@" or a t.me link`);
      }
    }
    toAdd.push({ slug: entry.slug || `entry #${i + 1}`, handles: entry.telegram });
    if (Array.isArray(entry.team) && entry.telegram.length !== entry.team.length) {
      notes.push(`${where}: ${entry.team.length} GitHub handles but ${entry.telegram.length} Telegram usernames - one per person on the team.`);
    }
  }

  /* Optional: builders are detected from the commit history. The field is a
     top-up for anyone detection misses, so an empty one is fine. */
  if (entry.team !== undefined && !Array.isArray(entry.team)) {
    err(where, '"team" must be an array of GitHub usernames, or left out entirely');
  } else if (Array.isArray(entry.team)) {
    for (const h of entry.team) {
      if (typeof h !== "string" || /^https?:|@|\s|\//.test(h)) {
        err(where, `team entry "${h}" should be a bare GitHub handle, not a URL or @mention`);
      }
    }
  }

  if (entry.x_handle && /^@|x\.com|twitter\.com/i.test(entry.x_handle)) {
    err(where, `x_handle should be the bare handle without "@" or a URL - got "${entry.x_handle}"`);
  }

  if (entry.demo_url && !/^https?:\/\//i.test(entry.demo_url)) {
    err(where, `demo_url must start with http:// or https:// - got "${entry.demo_url}"`);
  }

  const repo = parseRepo(entry.repo_url);
  if (entry.repo_url && !repo) {
    err(where, `repo_url "${entry.repo_url}" is not a GitHub repository URL`);
  } else if (repo) {
    repoChecks.push({ where, ...repo });
  }

  /* Nothing here enforces submission any more. Mainnet address, contracts and
     demo video live in the team's own strk20.json, and the hub derives whether
     a project is submitted from what it can actually verify - so there is no
     second pull request to police. */
  for (const moved of ["starknet_address", "transactions", "contracts", "demo_url", "demo_video", "status"]) {
    if (entry[moved] !== undefined) {
      notes.push(`${where}: "${moved}" moved to strk20.json in your own repository - it is ignored here. See CONTRIBUTING.md.`);
    }
  }
});

/* One request per repository, and only if a token is available. The point is
 * catching a private or misspelled repo at PR time rather than discovering it
 * when the hub renders a project nobody can open. */
if (repoChecks.length && TOKEN) {
  for (const { where, owner, repo } of repoChecks) {
    try {
      const res = await fetch(`https://api.github.com/repos/${owner}/${repo}`, {
        headers: {
          Accept: "application/vnd.github+json",
          "User-Agent": "strk20-private-sprint-validator",
          Authorization: `Bearer ${TOKEN}`,
        },
      });
      if (res.status === 404) {
        err(where, `${owner}/${repo} is not reachable - it must be public (or the URL has a typo)`);
      } else if (res.ok) {
        const meta = await res.json();
        if (meta.private) err(where, `${owner}/${repo} is private - public repositories are required`);
        if (!meta.license) notes.push(`${where}: ${owner}/${repo} has no license. Add one before submitting - it counts toward the open-source score.`);
      }
    } catch (e) {
      notes.push(`${where}: could not check ${owner}/${repo} (${e.message})`);
    }
  }
} else if (repoChecks.length) {
  notes.push("No GITHUB_TOKEN - skipped the public-repository check.");
}

for (const n of notes) console.log(`note: ${n}`);

/* Registrations merge unattended, so nobody necessarily opens the diff. Listing
   the handles here is what makes a run readable after the fact: who registered,
   and who to contact about it. */
if (toAdd.length) {
  console.log("\nTelegram usernames in this registry:");
  for (const { slug, handles } of toAdd) console.log(`  ${slug}: ${handles.join(", ")}`);
}

if (errors.length) {
  console.error(`\n${errors.length} problem${errors.length === 1 ? "" : "s"} with registry.json:\n`);
  for (const e of errors) console.error(`  ✗ ${e}`);
  console.error("\nSee the schema in README.md. Push a fix to this branch and the check runs again.");
  process.exit(1);
}

console.log(`registry.json is valid - ${registry.length} project${registry.length === 1 ? "" : "s"}.`);
