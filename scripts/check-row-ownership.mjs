/* check-row-ownership.mjs - may this pull request change these rows?
 *
 * Appending a project is bookkeeping and merges unattended. Changing a row that
 * is already in the table is a claim about someone else's project, and one of
 * the fields it can change is `telegram` - the contact the team is reached on.
 * So a change to an existing row merges only when the author has a visible
 * claim to it, and otherwise waits for a maintainer.
 *
 *   MAIN=main.json UPDATED="gstohl/feltproof" AUTHOR=gstohl \
 *     node scripts/check-row-ownership.mjs
 *
 * A claim is one of:
 *   - the entry on main already lists them in `team`
 *   - they are the GitHub account the repository belongs to
 *   - the repository belongs to an organisation they are a public member of
 *
 * Every one of those is read from main or from GitHub, never from the branch -
 * otherwise adding yourself to `team` in the same pull request would be enough
 * to authorise the change it is making.
 *
 * Exit 0 means every changed row is theirs. Exit 1 means at least one is not.
 */

import { readFileSync } from "node:fs";
import { aliases } from "./repo-key.mjs";

const TOKEN = process.env.GITHUB_TOKEN || "";
const AUTHOR = (process.env.AUTHOR || "").trim();
const UPDATED = (process.env.UPDATED || "").split(/[\s,]+/).filter(Boolean);

if (!AUTHOR) {
  console.error("AUTHOR is not set - cannot tell whose rows these are.");
  process.exit(1);
}
if (UPDATED.length === 0) {
  console.log("No existing rows changed.");
  process.exit(0);
}

const main = JSON.parse(readFileSync(process.env.MAIN || "main.json", "utf8"));
const eq = (a, b) => typeof a === "string" && typeof b === "string" && a.toLowerCase() === b.toLowerCase();

/* Indexed under every name each project is known by, so a row whose repository
   was renamed is still found under the name main knows it as. */
const byKey = new Map();
for (const entry of main) {
  for (const key of await aliases(entry?.repo_url)) {
    if (!byKey.has(key)) byKey.set(key, entry);
  }
}

/* Public membership only. A private member is indistinguishable from a stranger
   here, which is the right way round to be wrong - it waits for a human rather
   than merging on a guess. */
async function isPublicOrgMember(org, user) {
  try {
    const res = await fetch(`https://api.github.com/orgs/${org}/public_members/${user}`, {
      headers: {
        Accept: "application/vnd.github+json",
        "User-Agent": "strk20-private-sprint-validator",
        ...(TOKEN ? { Authorization: `Bearer ${TOKEN}` } : {}),
      },
    });
    return res.status === 204;
  } catch {
    return false;
  }
}

const unowned = [];
for (const key of UPDATED) {
  const entry = byKey.get(key.toLowerCase());
  if (!entry) {
    /* Changed a row that is not on main. Nothing to own, and nothing this
       script can reason about - a maintainer looks. */
    unowned.push({ key, why: "not a row that is currently on main" });
    continue;
  }

  const team = Array.isArray(entry.team) ? entry.team : [];
  if (team.some((h) => eq(h, AUTHOR))) {
    console.log(`${key}: ${AUTHOR} is listed in its team on main`);
    continue;
  }

  const owner = key.split("/")[0];
  if (eq(owner, AUTHOR)) {
    console.log(`${key}: ${AUTHOR} is the account the repository belongs to`);
    continue;
  }

  if (await isPublicOrgMember(owner, AUTHOR)) {
    console.log(`${key}: ${AUTHOR} is a public member of ${owner}`);
    continue;
  }

  unowned.push({ key, why: `${AUTHOR} is not in its team on main, does not own ${owner}, and is not a public member of it` });
}

if (unowned.length) {
  console.error(`\n${AUTHOR} has no visible claim to ${unowned.length} of the rows this changes:`);
  for (const { key, why } of unowned) console.error(`  ✗ ${key} - ${why}`);
  process.exit(1);
}

console.log(`\nEvery changed row belongs to ${AUTHOR}.`);
