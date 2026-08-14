/* check-registry-retention.mjs - a project that was accepted stays accepted.
 *
 * Registration is a pull request that appends to one JSON array, so every open
 * PR conflicts with every merged one. Resolving that conflict by hand - in the
 * GitHub web editor, or by taking "our" side of the merge - is how a project
 * that was already merged silently disappears from the table. It happened once
 * (Quietline, restored in ac35a68) and the fix has to survive the next time.
 *
 * The baseline is not the pull request's base commit. That commit is main as it
 * was when the PR last fired an event, so a PR opened on Monday is still judged
 * against Monday's main on Friday, and every project merged in between is
 * invisible to the check. Instead the baseline is *every* version of
 * registry.json that has ever been on main. Anything that was in any of them
 * must still be here.
 *
 *   HISTORY_REF=origin/main node scripts/check-registry-retention.mjs
 *
 * Deliberate removals (a withdrawal, a spam entry) go in registry-removals.json
 * with a reason, which is the only way to take a repository back out.
 */

import { execFileSync } from "node:child_process";
import { readFileSync, existsSync } from "node:fs";
import { normalize, canonical } from "./repo-key.mjs";

const HISTORY_REF = process.env.HISTORY_REF || "origin/main";
const REGISTRY_PATH = new URL("../registry.json", import.meta.url);
const REMOVALS_PATH = new URL("../registry-removals.json", import.meta.url);

function git(args) {
  return execFileSync("git", args, { encoding: "utf8", maxBuffer: 32 * 1024 * 1024 });
}

function entriesAt(rev) {
  try {
    const parsed = JSON.parse(git(["show", `${rev}:registry.json`]));
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    /* A commit where registry.json was absent or mid-edit is not evidence that
       anything was removed - only the versions we can read are used. */
    return [];
  }
}

/* ---------- what has ever been on main ---------- */

let history;
try {
  history = git(["log", "--format=%H", HISTORY_REF, "--", "registry.json"]).trim().split("\n").filter(Boolean);
} catch (error) {
  console.error(`Could not read the history of registry.json on ${HISTORY_REF}: ${error.message}`);
  console.error('The workflow needs fetch-depth: 0 and an explicit "git fetch origin main".');
  process.exit(1);
}

/* Newest commit first, so the first object seen for a repository is its most
   recent accepted form - that is the one worth printing when it goes missing. */
const everAccepted = new Map();
for (const sha of history) {
  for (const entry of entriesAt(sha)) {
    const key = normalize(entry?.repo_url);
    if (key && !everAccepted.has(key)) everAccepted.set(key, { entry, sha });
  }
}

if (everAccepted.size === 0) {
  console.log(`No registry.json history found on ${HISTORY_REF} - nothing to preserve yet.`);
  process.exit(0);
}

/* ---------- deliberate removals ---------- */

const removals = new Map();
if (existsSync(REMOVALS_PATH)) {
  let parsed;
  try {
    parsed = JSON.parse(readFileSync(REMOVALS_PATH, "utf8"));
  } catch (error) {
    console.error(`registry-removals.json is not valid JSON - ${error.message}`);
    process.exit(1);
  }
  if (!Array.isArray(parsed)) {
    console.error("registry-removals.json must be a JSON array.");
    process.exit(1);
  }
  for (const [i, item] of parsed.entries()) {
    const key = normalize(item?.repo_url);
    if (!key) {
      console.error(`registry-removals.json[${i}]: "repo_url" is required.`);
      process.exit(1);
    }
    if (!item?.reason || typeof item.reason !== "string" || !item.reason.trim()) {
      console.error(`registry-removals.json[${i}] (${item.repo_url}): "reason" is required - say why it was removed.`);
      process.exit(1);
    }
    removals.set(key, item.reason.trim());
  }
}

/* ---------- what is here now ---------- */

let current;
try {
  current = JSON.parse(readFileSync(REGISTRY_PATH, "utf8"));
} catch (error) {
  console.error(`registry.json is not valid JSON - ${error.message}`);
  console.error("A leftover <<<<<<< or >>>>>>> conflict marker is the usual cause.");
  process.exit(1);
}
if (!Array.isArray(current)) {
  console.error("registry.json must be a JSON array of project objects.");
  process.exit(1);
}
const present = new Set(current.map((entry) => normalize(entry?.repo_url)).filter(Boolean));

const missing = [];
for (const [key, { entry, sha }] of everAccepted) {
  if (present.has(key) || removals.has(key)) continue;

  /* Renaming a repository is a normal thing to do mid-sprint, and on a literal
     key it looks exactly like the project leaving. Ask GitHub what the old name
     points at now before calling anything lost. */
  const now = await canonical(key);
  if (now && present.has(now)) continue;

  missing.push({ key, entry, sha, now });
}

/* ---------- report ---------- */

if (missing.length) {
  console.error(`${missing.length} project${missing.length === 1 ? " that was" : "s that were"} already accepted ${missing.length === 1 ? "is" : "are"} missing from registry.json:\n`);
  for (const { key, sha } of missing) console.error(`  ✗ ${key}  (last accepted in ${sha.slice(0, 7)})`);
  console.error("\nThis is what a hand-resolved merge conflict looks like: the branch was");
  console.error("written against an older main and took its own side of the file.");
  console.error("\nPaste these objects back into registry.json:\n");
  console.error(JSON.stringify(missing.map((m) => m.entry), null, 2));
  console.error("\nIf a removal is intentional, add the repository to registry-removals.json");
  console.error('as {"repo_url": "...", "reason": "..."} in the same pull request.');
  process.exit(1);
}

/* Not a failure - an existing entry may legitimately be edited by its own team.
   Printed so whoever merges sees a change to someone else's row rather than
   discovering it in the table later. */
const edited = [];
for (const entry of current) {
  const key = normalize(entry?.repo_url);
  const before = key && everAccepted.get(key)?.entry;
  if (before && JSON.stringify(before) !== JSON.stringify(entry)) edited.push(key);
}
if (edited.length) {
  console.log("note: this changes entries that were already accepted - confirm the change comes from that team:");
  for (const key of edited) console.log(`  ~ ${key}`);
}

const kept = everAccepted.size - removals.size;
console.log(`Registry retention check passed - all ${kept} accepted project${kept === 1 ? "" : "s"} still present (${current.length} entries).`);
