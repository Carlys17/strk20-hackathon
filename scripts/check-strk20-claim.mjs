/* check-strk20-claim.mjs - a registration has to be about STRK20.
 *
 * Registrations land unattended, and the checks around them are about the shape
 * of the file: valid JSON, a repository that exists, a row nobody else owns.
 * None of them notice a project that has nothing to do with this sprint. One
 * team registered on-chain credit scoring "on Starknet" against a repository
 * whose README is a Solana yield optimizer, unchanged from what they forked,
 * and it went in like any other.
 *
 * The bar is deliberately low and it is not "Starknet only". A Solana app that
 * bridges into the STRK20 pool is exactly the kind of thing this sprint wants -
 * what it cannot be is a project that never touches STRK20 at all. So this asks
 * one question: does anything the team has written say they are building on
 * STRK20 or on Starknet? Their application, their one-liner, their README.
 *
 * Failing is not a rejection. It stops the entry landing unattended and says so
 * on the pull request; a maintainer applies it, or the team adds a sentence and
 * it goes in on the next run. Getting builders into the table matters more than
 * catching every case here, so anything that mentions the sprint at all passes.
 *
 *   MERGED=merged.json ADDED="owner/repo" PR_BODY="..." node scripts/check-strk20-claim.mjs
 */

import { readFileSync } from "node:fs";
import { normalize } from "./repo-key.mjs";

const MERGED = process.env.MERGED || "";
const ADDED = (process.env.ADDED || "").trim().split(/\s+/).filter(Boolean);
const PR_BODY = process.env.PR_BODY || "";
const TOKEN = process.env.GITHUB_TOKEN || "";

if (!ADDED.length) {
  console.log("No new entries in this pull request - nothing to check.");
  process.exit(0);
}

/* Any one of these is enough. They are the words a team writes when they are
   building on this pool, and a project bridging in from somewhere else writes
   them too - that is the case this is careful not to catch. */
const SIGNALS = [
  /strk-?20/i,
  /starknet/i,
  /\bcairo\b/i,
  /privacy pool/i,
  /shielded?\b/i,
  /unshield/i,
  /viewing key/i,
  /anonymizer|privacy_invoke/i,
  /private (?:transfer|note|payment)s?/i,
  /\bRFP-\d|\bIDEA-\d/i,
];

async function readme(key) {
  if (!key) return "";
  try {
    const res = await fetch(`https://api.github.com/repos/${key}/readme`, {
      headers: {
        Accept: "application/vnd.github.raw",
        "User-Agent": "strk20-private-sprint-registrations",
        ...(TOKEN ? { Authorization: `Bearer ${TOKEN}` } : {}),
      },
    });
    /* No README, a fresh repository, a rate limit: all the same answer here.
       The application and the one-liner are the parts that always exist. */
    return res.ok ? await res.text() : "";
  } catch {
    return "";
  }
}

let entries;
try {
  entries = JSON.parse(readFileSync(MERGED, "utf8"));
} catch (error) {
  console.error(`Could not read the merged registry (${error.message}).`);
  process.exit(1);
}

const byKey = new Map();
for (const entry of entries) {
  const key = normalize(entry?.repo_url);
  if (key && !byKey.has(key)) byKey.set(key, entry);
}

const unclear = [];
for (const key of ADDED) {
  const entry = byKey.get(key) || {};
  const written = [
    entry.name,
    entry.one_liner,
    entry.category,
    entry.inspired_by,
    key,
    PR_BODY,
    await readme(key),
  ].filter(Boolean).join("\n");

  const hit = SIGNALS.find((re) => re.test(written));
  if (hit) {
    console.log(`  ${key}: says what it is building on (${hit.source.replace(/\\/g, "")})`);
    continue;
  }
  unclear.push(key);
}

if (!unclear.length) {
  console.log(`STRK20 claim check passed for ${ADDED.length} new entr${ADDED.length === 1 ? "y" : "ies"}.`);
  process.exit(0);
}

console.error(`Nothing in ${unclear.length === 1 ? "this registration" : "these registrations"} says they are built on STRK20 or Starknet:\n`);
for (const key of unclear) console.error(`  ? ${key}`);
console.error("\nChecked: the entry's name, one-liner, category and inspired_by, the");
console.error("application on the pull request, and the repository's README.");
console.error("\nNot applied unattended. A maintainer can apply it, or the team can say");
console.error("which part of what they are building touches the pool.");
process.exit(1);
