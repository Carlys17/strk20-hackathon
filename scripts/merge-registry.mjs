/* merge-registry.mjs - rebuild one registration branch's registry.json so it
 * cannot conflict with main.
 *
 * Every registration appends to the same JSON array, so every open pull request
 * conflicts with every merged one. The conflict is always the same shape - two
 * branches added a different last element - and resolving it by hand is how a
 * project that was already accepted gets dropped. Nothing about that resolution
 * needs a human: the answer is always "everything on main, plus what this
 * branch added".
 *
 *   MAIN=main.json BASE=base.json HEAD=head.json node scripts/merge-registry.mjs
 *
 * MAIN  registry.json as it is on main right now
 * BASE  registry.json at this branch's merge base - what the contributor
 *       started from, used to tell an intentional edit from a stale copy
 * HEAD  registry.json as it is on this branch
 *
 * The merged array goes to stdout. Order follows main, so the diff a maintainer
 * reads is only ever the new entries at the end.
 *
 * Exit 2 means the branch is not mergeable by machine - unresolved conflict
 * markers, or something that is not an array - and a human should look.
 */

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { normalize, aliases } from "./repo-key.mjs";

function load(label, path, fallback) {
  if (!path || !existsSync(path)) {
    if (fallback !== undefined) return fallback;
    console.error(`${label} is required and ${path ? `${path} does not exist` : "was not set"}.`);
    process.exit(2);
  }
  const raw = readFileSync(path, "utf8");
  if (/^(<{7}|={7}|>{7})/m.test(raw)) {
    console.error(`${label} still contains merge conflict markers - resolve it by hand.`);
    process.exit(2);
  }
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    console.error(`${label} is not valid JSON - ${error.message}`);
    process.exit(2);
  }
  if (!Array.isArray(parsed)) {
    console.error(`${label} must be a JSON array.`);
    process.exit(2);
  }
  return parsed;
}

const main = load("MAIN", process.env.MAIN);
const head = load("HEAD", process.env.HEAD);
/* A branch cut before registry.json existed has no base version. Everything on
   it then reads as new, which is correct. */
const base = load("BASE", process.env.BASE, []);

const merged = main.slice();

/* Indexed under every name each project is known by, so a branch that points an
   entry at a renamed repository updates the row it already has instead of
   adding a second one for the same project. */
const indexByKey = new Map();
for (const [i, entry] of main.entries()) {
  for (const key of await aliases(entry?.repo_url)) {
    if (!indexByKey.has(key)) indexByKey.set(key, i);
  }
}
const baseByKey = new Map();
for (const entry of base) {
  for (const key of await aliases(entry?.repo_url)) {
    if (!baseByKey.has(key)) baseByKey.set(key, entry);
  }
}

const added = [];
const updated = [];
for (const entry of head) {
  const key = normalize(entry?.repo_url);

  /* Not a repository URL. Keep it so the branch is not silently emptied -
     validate-registry.mjs is what tells the contributor it is wrong. */
  if (!key) {
    if (!merged.some((e) => JSON.stringify(e) === JSON.stringify(entry))) merged.push(entry);
    continue;
  }

  if (!indexByKey.has(key)) {
    indexByKey.set(key, merged.length);
    merged.push(entry);
    added.push(key);
    continue;
  }

  /* Already on main. Taking this branch's version would undo whatever main has
     learned since - so it only wins where the branch deliberately changed the
     entry it started from. A branch that simply carries a stale copy loses. */
  const before = baseByKey.get(key);
  if (before && JSON.stringify(before) !== JSON.stringify(entry)) {
    merged[indexByKey.get(key)] = entry;
    updated.push(key);
  }
}

console.error(`merged: ${main.length} on main, ${added.length} added${added.length ? ` (${added.join(", ")})` : ""}, ${updated.length} updated${updated.length ? ` (${updated.join(", ")})` : ""}`);

/* Whoever is deciding whether this can merge unattended needs to know the
 * difference between a branch that appended its own project and one that
 * rewrote somebody else's row. Both are valid JSON and both pass every other
 * check. */
if (process.env.SUMMARY) writeFileSync(process.env.SUMMARY, JSON.stringify({ added, updated }) + "\n");

process.stdout.write(JSON.stringify(merged, null, 2) + "\n");
