/* build-projects.mjs - turn registry.json into projects.json.
 *
 * registry.json is the human-edited source: one object per project, added by
 * pull request. This resolves each entry through the GitHub API and writes the
 * flat file the hub at strk20.starknet.io/hackathon fetches at runtime.
 *
 * Each project carries two generated sentences: `summary`, describing what the
 * project is, and `latest_push`, describing what changed in the most recent
 * push. Plus `tooling` - what the repository actually depends on, read from
 * package.json and Scarb.toml rather than claimed.
 *
 * Everything is cached on the repository's head SHA. A project that hasn't
 * pushed since the last run costs exactly one API call and no tokens, which is
 * what makes a 30-minute cron affordable across an 18-day sprint.
 *
 * No dependencies - Node 20's built-in fetch only.
 *
 *   node scripts/build-projects.mjs
 *
 * GITHUB_TOKEN  optional locally (60 requests/hour unauthenticated), provided
 *               automatically in Actions.
 * OPENAI_API_KEY optional - without it the sentences are simply omitted and the
 *               hub falls back to the one-liner the team wrote themselves.
 * OPENAI_MODEL  defaults to gpt-4o-mini.
 */

import { readFileSync, writeFileSync, existsSync } from "node:fs";

const API = "https://api.github.com";
const TOKEN = process.env.GITHUB_TOKEN || "";
const OPENAI_KEY = process.env.OPENAI_API_KEY || "";
const OPENAI_MODEL = process.env.OPENAI_MODEL || "gpt-4o-mini";

const HEADERS = {
  Accept: "application/vnd.github+json",
  "X-GitHub-Api-Version": "2022-11-28",
  "User-Agent": "strk20-private-sprint-indexer",
  ...(TOKEN ? { Authorization: `Bearer ${TOKEN}` } : {}),
};

const CATEGORIES = ["Consumer", "DeFi", "Tooling", "Infra", "Payments", "Gaming", "Other"];

/* Warnings are collected rather than thrown: one team with a typo in their
 * repo URL must not take the whole hub down. The run reports them at the end
 * and still writes a good projects.json for everyone else. */
const warnings = [];
const warn = (msg) => { warnings.push(msg); console.warn(`  warn: ${msg}`); };

const REGISTRY_URL = new URL("../registry.json", import.meta.url);
const PROJECTS_URL = new URL("../projects.json", import.meta.url);

/* ---------- GitHub ---------- */

async function gh(path) {
  const res = await fetch(`${API}${path}`, { headers: HEADERS });
  if (res.status === 403 || res.status === 429) {
    const reset = res.headers.get("x-ratelimit-reset");
    throw new Error(`rate limited on ${path}` + (reset ? ` (resets ${new Date(reset * 1000).toISOString()})` : ""));
  }
  if (!res.ok) return null;
  return res.json();
}

/* Accepts the shapes people actually paste: with or without a trailing slash,
 * with or without .git, and full URLs with query strings. */
function parseRepo(url) {
  if (typeof url !== "string") return null;
  const m = url.trim().match(/github\.com[/:]([^/]+)\/([^/?#]+)/i);
  if (!m) return null;
  return { owner: m[1], repo: m[2].replace(/\.git$/i, "") };
}

async function getTextFile(owner, repo, path) {
  const f = await gh(`/repos/${owner}/${repo}/contents/${path}`);
  if (!f || !f.content) return null;
  try {
    return Buffer.from(f.content, f.encoding || "base64").toString("utf8");
  } catch { return null; }
}

const userCache = new Map();
async function resolveUser(login) {
  if (userCache.has(login)) return userCache.get(login);
  const u = await gh(`/users/${encodeURIComponent(login)}`);
  /* An unresolvable handle still renders - GitHub's identicon endpoint gives a
   * stable placeholder, so a typo shows a grey avatar instead of a broken image. */
  const out = u
    ? { login: u.login, name: u.name || u.login, avatar_url: u.avatar_url }
    : { login, name: login, avatar_url: `https://github.com/${encodeURIComponent(login)}.png` };
  if (!u) warn(`unknown GitHub user "${login}"`);
  userCache.set(login, out);
  return out;
}

/* ---------- builders ---------- */

const SPRINT_START = "2026-08-14T00:00:00Z";

/* Who actually wrote the code, taken from the commit history rather than from
 * a list someone remembered to keep current. A teammate who joins in week two
 * shows up the moment they push.
 *
 * Scoped to the sprint window: /contributors would return a repository's whole
 * history, so an existing project would credit forty people who never entered.
 * Before the sprint opens there is no window yet, so it falls back to recent
 * commits and the entry can still show a face on day one.
 *
 * Avatars and names come straight off the commit payload, so this costs one
 * request per project rather than one per person. */
/* Coding agents sign their work in a Co-Authored-By trailer, or commit under
 * their own app account. Both are worth surfacing: building with an agent is
 * encouraged here, so the agent is a participant rather than something to
 * filter out. Matched against known identities only - an unrecognised
 * co-author is far more likely to be a person than a tool. */
const AGENTS = [
  [/claude|anthropic/i, "Claude"],
  [/copilot/i, "GitHub Copilot"],
  [/\bcodex\b|openai/i, "Codex"],
  [/cursor/i, "Cursor"],
  [/^claude$/i, "Claude"],
  [/devin/i, "Devin"],
  [/\bjules\b/i, "Jules"],
  [/windsurf|codeium/i, "Windsurf"],
  [/\baider\b/i, "Aider"],
];

/* The trailer carries the model that actually did the work - "Claude Opus 5",
 * "GPT-5 Codex" - so keep it rather than flattening to a family name. The
 * family is only used to pick the avatar. */
const agentFamily = (text) => {
  for (const [re, name] of AGENTS) if (re.test(text)) return name;
  return null;
};

const cleanAgentName = (raw) => raw
  .replace(/<[^>]*>/g, "")        // the email in a Co-Authored-By line
  .replace(/\([^)]*\)/g, "")      // parenthetical notes like "(1M context)"
  .replace(/\s+/g, " ")
  .trim();

async function detectBuilders(owner, repo, entry) {
  const seen = new Map();
  const counts = new Map();
  const agents = new Map();
  /* Which sprint days this repository was worked on. Collected here because
     the commit list is already in hand for the builders - the strip costs no
     extra requests. */
  const days = new Set();

  /* Keyed on family so the two ways an agent shows up merge into one entry:
     the account that commits (which carries the avatar) and the Co-Authored-By
     trailer (which carries the model). Name prefers the trailer, since
     "Claude Opus 5" says more than the account's "Claude". */
  const noteAgent = (display, family, avatar) => {
    const prev = agents.get(family) || { family, commits: 0 };
    agents.set(family, {
      family,
      name: display || prev.name || family,
      avatar_url: avatar || prev.avatar_url || "",
      commits: prev.commits + 1,
    });
  };

  const collect = (commits) => {
    for (const c of commits || []) {
      const a = c.author;
      const msg = c.commit?.message || "";

      /* Committer date, not author date: a rebase or a cherry-pick keeps the
         author date from whenever the work was first written, which would
         credit a day the repository saw nothing. UTC throughout, so a team is
         not handed an extra dot by its own timezone. */
      const when = c.commit?.committer?.date || c.commit?.author?.date;
      if (when) {
        const d = new Date(when);
        if (!isNaN(d)) days.add(d.toISOString().slice(0, 10));
      }

      /* Co-authors never appear in the author field - GitHub puts only the
         primary author there - so the trailer is the only place to read them. */
      for (const line of msg.split("\n")) {
        const m = line.match(/^\s*Co-Authored-By:\s*(.+)$/i);
        if (m) {
          const family = agentFamily(m[1]);
          if (family) noteAgent(cleanAgentName(m[1]), family, null);
        }
      }

      if (!a?.login) continue;

      /* Agents that commit as themselves show up as ordinary contributors -
         github.com/claude and github.com/cursoragent are both User accounts -
         so they are recognised by login before the human path. */
      const loginFamily = agentFamily(a.login);
      if (loginFamily) {
        noteAgent(null, loginFamily, a.avatar_url);
        continue;
      }

      if (a.type === "Bot" || /\[bot\]$/i.test(a.login)) continue;
      counts.set(a.login, (counts.get(a.login) || 0) + 1);
      if (!seen.has(a.login)) {
        seen.set(a.login, {
          login: a.login,
          name: c.commit?.author?.name || a.login,
          avatar_url: a.avatar_url,
        });
      }
    }
  };

  const started = Date.now() >= new Date(SPRINT_START).getTime();
  collect(await gh(`/repos/${owner}/${repo}/commits?per_page=100${started ? `&since=${SPRINT_START}` : ""}`));
  if (!seen.size && started) {
    /* Registered but nothing pushed inside the window yet. */
    collect(await gh(`/repos/${owner}/${repo}/commits?per_page=30`));
  }

  /* Most commits first, so the row's three visible faces are the people
     carrying the project. */
  const detected = [...seen.values()].sort((a, b) => (counts.get(b.login) || 0) - (counts.get(a.login) || 0));

  /* Anyone the team listed by hand and detection missed: a different commit
     email, a co-author, someone who hasn't pushed yet. */
  const declared = Array.isArray(entry.team) ? entry.team : [];
  for (const login of declared) {
    if (typeof login !== "string" || seen.has(login)) continue;
    detected.push(await resolveUser(login));
  }

  return {
    builders: detected,
    agents: [...agents.values()].sort((x, y) => y.commits - x.commits),
    /* Sprint days only. The fallback query above reaches outside the window to
       find faces for a repository that has not pushed yet, and those commits
       must not light dots. */
    active_days: [...days].filter((d) => d >= SPRINT_START.slice(0, 10)).sort(),
  };
}

/* ---------- stack detection ---------- */

/* Two passes. Dependencies are the strong signal - a package.json entry means
 * the code actually imports it. Text is the weak signal, needed because parts
 * of the Starknet privacy stack have no package to depend on yet (the Wallet
 * API is a wallet method, sub-accounts aren't shipped, privacy_invoke is a
 * Cairo entrypoint). The chip says "detected", not "verified", for that reason.
 *
 * `live` marks the Starknet and STRK20 stack - those are highlighted on the
 * hub. Frameworks show up muted, because "uses React" is not interesting here.
 * The list tracks the routes documented at strk20-by-example.org. */
/* Which parts of the STRK20 stack a project is actually built on.
 *
 * The third field is `stack`: true means it is a piece of STRK20 and earns a
 * pill on the row; false means it is ordinary Starknet or web tooling, real but
 * not what this page is about, so it stays in the project panel.
 *
 * Everything here comes from a manifest - a declared dependency is a fact.
 * Nothing is inferred from prose; see TEXT_SIGNALS. */
const DEP_SIGNALS = [
  /* -sdk, not the bare prefix: @starkware-libs/starknet-privacy-bridge is a
     different package and was lighting the SDK pill. */
  [/@starkware-libs\/starknet-privacy-sdk/, "Privacy SDK", true],
  [/(^|\/)starknet-start$/, "starknet-start", true],
  [/@avnu\/|avnu-sdk/, "AVNU", true],
  [/ekubo/i, "Ekubo", true],
  [/vesu/i, "Vesu", true],
  [/get-starknet/, "get-starknet", false],
  [/^starknet$|starknet\.js/, "starknet.js", false],
  [/starknetkit/i, "Starknetkit", false],
  [/^@?next$/, "Next.js", false],
  [/^react$/, "React", false],
  [/^vite$/, "Vite", false],
  [/^svelte$/, "Svelte", false],
  [/^typescript$/, "TypeScript", false],
];

/* Prose, so nothing here may claim a piece of the STRK20 stack.
 *
 * These run over the README and the manifests, and a README says what a team
 * means to do. "We plan to build an anonymizer" matched /anonymizer/i and lit
 * the same pill as a team that had shipped one; "shielded" matches essentially
 * every STRK20 README ever written. Those signals are gone rather than
 * downgraded - a pill on a public page is a claim we are making on the team's
 * behalf, and this is the whole reason the stack pills are manifest-only.
 *
 * What is left is ordinary tooling, where a false positive costs nothing. */
const TEXT_SIGNALS = [
  [/snforge|starknet-foundry/i, "Starknet Foundry", false],
];

/* Just the [dependencies] and [dev-dependencies] tables of a Scarb.toml.
 * Scoped so a package named "privacy" - or the word in a comment further down
 * the file - cannot be mistaken for depending on the pool's Cairo. */
function scarbDependencies(scarb) {
  const out = [];
  let inDeps = false;
  for (const line of scarb.split("\n")) {
    const header = line.match(/^\s*\[([^\]]+)\]/);
    if (header) { inDeps = /^(dev-)?dependencies$/.test(header[1].trim()); continue; }
    if (inDeps) out.push(line);
  }
  return out.join("\n");
}

async function detectTooling(owner, repo, readme, langs) {
  const found = new Map();
  const add = (label, stack) => { if (!found.has(label)) found.set(label, { label, live: stack, stack }); };

  const pkgRaw = await getTextFile(owner, repo, "package.json");
  if (pkgRaw) {
    try {
      const pkg = JSON.parse(pkgRaw);
      const deps = Object.keys({ ...pkg.dependencies, ...pkg.devDependencies });
      for (const dep of deps) {
        for (const [re, label, stack] of DEP_SIGNALS) if (re.test(dep)) add(label, stack);
      }
    } catch { warn(`${owner}/${repo} has an unparseable package.json`); }
  }

  const scarb = await getTextFile(owner, repo, "Scarb.toml");
  if (scarb) {
    add("Cairo", false);
    /* An anonymizer is a Cairo contract the pool calls through privacy_invoke,
     * and to compile one you need the pool's own objects - the reference
     * packages both declare `privacy = { path = "../privacy" }`, and a team
     * outside the monorepo reaches the same package over git. Either way the
     * dependency is what gives it away, and nobody adds it by accident.
     *
     * One pill whether they shipped one anonymizer or four: the interesting
     * fact is that they wrote Cairo the pool calls, not how many. Teams that
     * vendor the interface instead of depending on it are missed until the
     * source scan lands, which reads for `fn privacy_invoke` directly. */
    if (/^\s*privacy\s*=/m.test(scarbDependencies(scarb))) add("Anonymizer contract", true);
  }

  if (langs) {
    if (langs.Cairo) add("Cairo", false);
    if (langs.Rust) add("Rust", false);
  }

  /* Text pass over whatever prose and config we already fetched - no extra
   * requests. Scoped to the README and the manifests so a stray mention deep
   * in a lockfile doesn't light up a chip. */
  const corpus = [readme || "", pkgRaw || "", scarb || ""].join("\n");
  for (const [re, label, live] of TEXT_SIGNALS) if (re.test(corpus)) add(label, live);

  return found;
}

/* ---------- the team's own manifest ---------- */

/* strk20.json at the root of a team's repository. Everything a team controls
 * lives here rather than in registry.json, so they never open a second pull
 * request against us - they edit a file in their own repo and the hub picks it
 * up on the next run.
 *
 * registry.json still owns identity (slug, name, category, team), because that
 * is what review is for. This owns everything else. */
async function readManifest(owner, repo) {
  const raw = await getTextFile(owner, repo, "strk20.json");
  if (!raw) return null;
  try {
    const m = JSON.parse(raw);
    return typeof m === "object" && m !== null ? m : null;
  } catch {
    warn(`${owner}/${repo} has a strk20.json that isn't valid JSON - ignoring it`);
    return null;
  }
}

/* ---------- deployed demos ---------- */

/* Teams shouldn't have to open a second pull request the day their site goes
 * live, so the demo is discovered rather than declared. Ordered by how much
 * the signal means: an explicit value is a deliberate choice and always wins,
 * Pages and the Website field are the team saying "this is the site", and a
 * deployment URL is the host saying it. Stops at the first hit, so the extra
 * requests only happen for projects that haven't shipped one yet. */
async function resolveDemo(entry, meta, owner, repo) {
  if (entry.demo_url) return entry.demo_url;

  /* Free - the repository metadata is already in hand. */
  if (meta?.homepage && /^https?:\/\//i.test(meta.homepage)) return meta.homepage;

  if (meta?.has_pages) {
    const pages = await gh(`/repos/${owner}/${repo}/pages`);
    if (pages?.html_url) return pages.html_url;
  }

  const deployments = await gh(`/repos/${owner}/${repo}/deployments?per_page=1`);
  const id = deployments?.[0]?.id;
  if (id) {
    const statuses = await gh(`/repos/${owner}/${repo}/deployments/${id}/statuses?per_page=5`);
    const live = (statuses || []).find((st) => st.state === "success" && st.environment_url);
    if (live) return live.environment_url;
  }

  return "";
}

/* ---------- mainnet transactions ---------- */

const POOL_ADDRESS = "0x040337b1af3c663e86e333bab5a4b28da8d4652a15a69beee2b677776ffe812a";
const MIN_MAINNET_TXS = 3;

/* Addresses come back from different tools with different leading-zero
 * padding, so compare them as numbers. */
const sameAddress = (a, b) => {
  try { return BigInt(a) === BigInt(b); } catch { return false; }
};

async function rpc(url, method, params) {
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
    });
    if (!res.ok) return null;
    return (await res.json()).result || null;
  } catch { return null; }
}

/* A transaction hash proves three things a declared address cannot: the
 * transaction is real, it succeeded, and it actually touched the pool. Private
 * transactions are submitted by relayers, so the sender is never the team -
 * which is exactly why an address was the wrong thing to ask for.
 *
 * Verified against the receipt: execution status, and whether any event in it
 * came from the pool contract. */
async function verifyTransactions(entry) {
  const declared = Array.isArray(entry.transactions) ? entry.transactions : [];
  const out = [];
  for (const raw of declared.slice(0, 10)) {
    const hash = typeof raw === "string" ? raw.trim() : "";
    if (!/^0x[0-9a-fA-F]{1,64}$/.test(hash)) {
      warn(`${entry.slug}: "${hash}" is not a transaction hash`);
      continue;
    }
    const receipt = await rpc(RPCS[0][1], "starknet_getTransactionReceipt", [hash]);
    if (!receipt) {
      out.push({ hash, ok: false, pool: false, note: "not found on mainnet" });
      continue;
    }
    const ok = receipt.execution_status === "SUCCEEDED";
    const pool = (receipt.events || []).some((e) => sameAddress(e.from_address, POOL_ADDRESS));
    if (!ok) out.push({ hash, ok: false, pool, note: "reverted" });
    else if (!pool) out.push({ hash, ok: true, pool: false, note: "did not touch the pool" });
    else out.push({ hash, ok: true, pool: true });
  }
  return out;
}

/* ---------- deployed contracts ---------- */

/* Which network a declared contract actually lives on, asked of the chains
 * rather than taken on trust. Mainnet is checked first because that is what
 * the sprint requires; a contract only on Sepolia is still worth showing, and
 * an address that exists nowhere is reported as such instead of silently
 * rendering a dead explorer link. */
const RPCS = [
  ["mainnet", process.env.MAINNET_RPC_URL || "https://rpc.starknet.lava.build"],
  ["sepolia", process.env.SEPOLIA_RPC_URL || "https://api.cartridge.gg/x/starknet/sepolia"],
];

async function classHashAt(url, address) {
  return rpc(url, "starknet_getClassHashAt", ["latest", address]);
}

async function resolveContracts(entry) {
  const declared = Array.isArray(entry.contracts) ? entry.contracts : [];
  const out = [];
  for (const raw of declared) {
    const address = typeof raw === "string" ? raw : raw.address;
    if (!address || !/^0x[0-9a-fA-F]+$/.test(address)) {
      warn(`${entry.slug} declared an address that isn't a felt: ${address}`);
      continue;
    }
    let network = "unknown";
    for (const [name, rpc] of RPCS) {
      if (await classHashAt(rpc, address)) { network = name; break; }
    }
    if (network === "unknown") warn(`${entry.slug}: ${address.slice(0, 12)}… not found on mainnet or sepolia`);
    out.push({ address, network });
  }
  return out;
}

/* ---------- generated sentences ---------- */

async function openai(system, user, maxTokens = 300) {
  if (!OPENAI_KEY) return null;
  try {
    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${OPENAI_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: OPENAI_MODEL,
        messages: [{ role: "system", content: system }, { role: "user", content: user }],
        response_format: { type: "json_object" },
        max_completion_tokens: maxTokens,
      }),
    });
    if (!res.ok) { warn(`OpenAI ${res.status} - sentences skipped for this project`); return null; }
    const json = await res.json();
    const text = json.choices?.[0]?.message?.content;
    return text ? JSON.parse(text) : null;
  } catch (e) {
    warn(`OpenAI call failed (${e.message}) - sentences skipped`);
    return null;
  }
}

const DESC_SYSTEM = `You describe developer projects for a public hackathon board that other builders read.
Return JSON: {"summary": string, "description_long": string}.
summary: ONE sentence, under 110 characters, saying what the project does. Start with a verb or a noun phrase, never with the project's name or "This project".
description_long: two or three sentences with the interesting technical substance - the approach, and the hard part they are solving.
Plain English. No marketing adjectives, no "revolutionary", no "seamless", no exclamation marks.
Never use an em dash. Use a comma, a colon, or two sentences instead. If the README is empty or says nothing, return empty strings.`;

const PUSH_SYSTEM = `You summarise what a developer just pushed, for a live hackathon board.
Return JSON: {"latest_push": string}.
ONE sentence, under 90 characters, past tense, concrete, describing the substance of the change.
Say what changed, not how many commits. Name the actual thing: a feature, a file, a fix, a contract.
BANNED words and phrases - never use any of them: "various", "updates", "improvements", "enhanced", "enhancements", "new features", "and more", "several changes", "refactored code", "better".
If the commits are genuinely trivial (formatting, lockfiles, merges), say so plainly: "Formatting and dependency bumps only."
Never use an em dash.
Good: "Added the useShieldedBalance hook and its tests." Bad: "Enhanced privacy with new features and tests."`;

/* ---------- assembly ---------- */

function validate(entry, index, seenSlugs) {
  const where = `registry.json[${index}]`;
  /* Only the two things that cannot be read from the repository itself. The
     name, the one-liner, the category and the slug are all derived below and
     the entry can override any of them. */
  const required = ["repo_url"];
  for (const key of required) {
    if (!entry[key] || (Array.isArray(entry[key]) && !entry[key].length)) {
      warn(`${where} is missing "${key}" - skipped`);
      return false;
    }
  }
  const repo = parseRepo(entry.repo_url);
  if (!repo) {
    warn(`${where} repo_url is not a GitHub URL: ${entry.repo_url} - skipped`);
    return false;
  }
  /* Derived from the repository when the entry does not say otherwise. */
  entry.slug = entry.slug || repo.repo.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  if (seenSlugs.has(entry.slug)) { warn(`${where} duplicate slug "${entry.slug}" - skipped`); return false; }
  if (entry.category && !CATEGORIES.includes(entry.category)) {
    warn(`${where} category "${entry.category}" is not one of ${CATEGORIES.join(", ")} - kept as Other`);
    entry.category = "Other";
  }
  seenSlugs.add(entry.slug);
  return true;
}

async function buildProject(entry, prev) {
  const { owner, repo } = parseRepo(entry.repo_url);
  const meta = await gh(`/repos/${owner}/${repo}`);
  if (!meta) warn(`${owner}/${repo} is unreachable - is it public?`);
  if (meta?.private) warn(`${owner}/${repo} is private - public repositories are required`);

  /* The team's own file wins for the fields they control. They can change any
     of these without touching our repository, which is the whole point. */
  const manifest = await readManifest(owner, repo);
  if (manifest) {
    entry = {
      ...entry,
      transactions: Array.isArray(manifest.transactions) && manifest.transactions.length
        ? manifest.transactions
        : entry.transactions,
      demo_url: manifest.demo_url || entry.demo_url,
      demo_video: manifest.demo_video || entry.demo_video,
      x_handle: manifest.x_handle || entry.x_handle,
      contracts: Array.isArray(manifest.contracts) && manifest.contracts.length
        ? manifest.contracts
        : entry.contracts,
    };
  }

  const { builders, agents, active_days } = await detectBuilders(owner, repo, entry);

  const demoUrl = await resolveDemo(entry, meta, owner, repo);
  const contracts = await resolveContracts(entry);
  const transactions = await verifyTransactions(entry);
  const verifiedTxs = transactions.filter((t) => t.ok && t.pool).length;

  /* Submission is a state the repository is in, not a form someone remembers to
   * fill in at 23:00 on the deadline. Each requirement is checked
   * independently so the hub can tell a team exactly what is still missing,
   * rather than a single pass/fail they have to reverse-engineer. */
  const requirements = {
    demo: !!demoUrl,
    video: !!entry.demo_video,
    mainnet: verifiedTxs >= MIN_MAINNET_TXS,
  };
  const ready = Object.values(requirements).every(Boolean);

  const base = {
    slug: entry.slug,
    /* The repository already carries a name and a description; asking for them
       again is a form to fill in for no gain. */
    name: entry.name || meta?.name || entry.slug,
    one_liner: entry.one_liner || meta?.description || "",
    category: entry.category || "Other",
    repo_url: meta?.html_url || entry.repo_url,
    demo_url: demoUrl,
    demo_video: entry.demo_video || "",
    x_handle: entry.x_handle || "",
    /* Telegram usernames stay in registry.json and never reach projects.json.
       They exist so the team can reach a project's builders, not to be
       published on a page anyone can scrape. */
    inspired_by: entry.inspired_by || "",
    contracts,
    transactions,
    verified_txs: verifiedTxs,
    requirements,
    /* Derived, never declared. A team that meets every requirement is
     * submitted; one that stops meeting them is not. */
    status: ready ? "finished" : "building",
    /* The hub orders on this. Null (unreachable repo) sorts last and renders
     * as an em dash rather than a fake timestamp. */
    pushed_at: meta?.pushed_at || null,
    stars: meta?.stargazers_count ?? 0,
    builders,
    agents,
    active_days,
  };

  const head = await gh(`/repos/${owner}/${repo}/commits?per_page=1`);
  const headSha = head?.[0]?.sha || null;

  /* Nothing new since the last run: reuse everything generated. This is the
   * common case on a 30-minute cron and costs no tokens.
   *
   * An empty summary counts as a miss even when the SHA matches. Otherwise a
   * run that failed to generate one - no key, a rate limit, a bad response -
   * poisons the cache permanently: the SHA never changes again for a finished
   * project, so it would never retry. */
  const summaryUsable = !OPENAI_KEY || !!prev?.summary;
  if (prev && headSha && prev.head_sha === headSha && summaryUsable) {
    console.log(`  ${entry.slug}: unchanged`);
    return {
      ...base,
      head_sha: headSha,
      readme_hash: prev.readme_hash || "",
      summary: prev.summary || "",
      description_long: prev.description_long || "",
      latest_push: prev.latest_push || "",
      tooling: prev.tooling || [],
      agents: prev.agents || [],
      has_readme: !!prev.has_readme,
      additions: prev.additions || 0,
      deletions: prev.deletions || 0,
      churn_pct: prev.churn_pct || 0,
    };
  }

  console.log(`  ${entry.slug}: reindexing`);
  const readme = await getTextFile(owner, repo, "README.md");
  const langs = await gh(`/repos/${owner}/${repo}/languages`);
  const tooling = await detectTooling(owner, repo, readme, langs);

  /* Description is regenerated only when the README actually changed - a push
   * that touches only source shouldn't rewrite the project's description. */
  let summary = prev?.summary || "";
  let descriptionLong = prev?.description_long || "";
  const readmeHash = readme ? readme.length + ":" + readme.slice(0, 200) : "";
  /* Regenerate when the README changed, and also whenever we simply don't have
     a summary yet - same reasoning as the SHA cache. A README that never
     changes again would otherwise keep an empty description forever. */
  if (readme && (readmeHash !== (prev?.readme_hash || "") || !summary)) {
    const out = await openai(DESC_SYSTEM, `Project name: ${entry.name}\nTeam's own one-liner: ${entry.one_liner}\n\nREADME:\n${readme.slice(0, 6000)}`);
    if (out) {
      summary = out.summary || summary;
      descriptionLong = out.description_long || descriptionLong;
    }
  }

  /* What just landed. With a previous SHA the compare endpoint gives the
   * commits and the changed files in a single call; without one (a project's
   * first index) fall back to recent commits. */
  let latestPush = "";
  let changeText = "";
  /* Lines moved in this push, GitHub-style. On a project's first index there is
   * no previous SHA to diff against, so the head commit's own stats stand in. */
  let additions = 0;
  let deletions = 0;
  if (prev?.head_sha && headSha && prev.head_sha !== headSha) {
    const cmp = await gh(`/repos/${owner}/${repo}/compare/${prev.head_sha}...${headSha}`);
    if (cmp) {
      const msgs = (cmp.commits || []).map((c) => `- ${c.commit.message.split("\n")[0]}`).join("\n");
      const files = (cmp.files || []).slice(0, 30).map((f) => `${f.filename} (+${f.additions}/-${f.deletions})`).join("\n");
      changeText = `Commits:\n${msgs}\n\nFiles changed:\n${files}`;
      for (const f of cmp.files || []) { additions += f.additions || 0; deletions += f.deletions || 0; }
    }
  }
  if (!changeText) {
    const commits = await gh(`/repos/${owner}/${repo}/commits?per_page=10`);
    if (commits?.length) {
      changeText = "Commits:\n" + commits.map((c) => `- ${c.commit.message.split("\n")[0]}`).join("\n");
    }
    if (headSha) {
      const headCommit = await gh(`/repos/${owner}/${repo}/commits/${headSha}`);
      additions = headCommit?.stats?.additions || 0;
      deletions = headCommit?.stats?.deletions || 0;
    }
  }
  if (changeText) {
    const out = await openai(PUSH_SYSTEM, `Project: ${entry.name}\n\n${changeText.slice(0, 5000)}`, 200);
    latestPush = out?.latest_push || prev?.latest_push || "";
  }

  /* How much of the codebase this push moved. Lines changed over an estimate
   * of the whole tree, from the byte totals GitHub already gave us for language
   * detection - roughly 40 bytes a line across the languages in play here.
   *
   * An estimate is the right call: the alternative is /stats/code_frequency,
   * which answers 202 while GitHub computes it and would make the first run on
   * every new project unreliable. The number is a momentum signal, not an
   * audit, and it only has to be right to the nearest percent. */
  const totalBytes = Object.values(langs || {}).reduce((a, b) => a + b, 0);
  const estimatedLines = totalBytes ? totalBytes / 40 : 0;
  const churnPct = estimatedLines
    ? Math.min(100, Math.round(((additions + deletions) / estimatedLines) * 1000) / 10)
    : 0;

  return {
    ...base,
    head_sha: headSha,
    readme_hash: readmeHash,
    churn_pct: churnPct,
    summary,
    description_long: descriptionLong,
    latest_push: latestPush,
    tooling: [...tooling.values()],
    has_readme: !!readme,
    additions,
    deletions,
  };
}

/* ---------- run ---------- */

const registry = JSON.parse(readFileSync(REGISTRY_URL, "utf8"));
if (!Array.isArray(registry)) {
  console.error("registry.json must be an array");
  process.exit(1);
}

/* Previous output doubles as the cache - no separate cache file to keep in
 * sync, and the committed diff shows exactly what changed each run. */
let previous = [];
if (existsSync(PROJECTS_URL)) {
  try { previous = JSON.parse(readFileSync(PROJECTS_URL, "utf8")); } catch { previous = []; }
}
const prevBySlug = new Map(previous.map((p) => [p.slug, p]));

console.log(`resolving ${registry.length} registry entries…`);
if (!OPENAI_KEY) console.log("  (no OPENAI_API_KEY - generated sentences will be omitted)");

const seenSlugs = new Set();
const projects = [];
for (const [i, entry] of registry.entries()) {
  if (!validate(entry, i, seenSlugs)) continue;
  projects.push(await buildProject(entry, prevBySlug.get(entry.slug)));
}

/* Most recently pushed first. The hub re-sorts client-side too, so this is
 * belt-and-braces - it also makes the committed file readable in a diff. */
projects.sort((a, b) => new Date(b.pushed_at || 0) - new Date(a.pushed_at || 0));

writeFileSync(PROJECTS_URL, JSON.stringify(projects, null, 2) + "\n");
console.log(`wrote projects.json - ${projects.length} projects, ${warnings.length} warnings`);
