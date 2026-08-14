# Private Sprint

> An 18-day sprint to ship a real privacy application on Starknet mainnet.

**August 14 - August 31, 2026.** $5,000 USD paid in STRK:

- 🥇 **$2,500** for first
- 🥈 **$1,500** for second
- 🥉 **$1,000** for third

You build in your own public repository. Your progress appears on the hub at [strk20.starknet.io/hackathon](https://strk20.starknet.io/hackathon) throughout the sprint.

## Contents

- [How to apply](#how-to-apply)
- [Your registry entry](#your-registry-entry)
- [strk20.json](#strk20json)
- [Rules](#rules)
- [Submitting](#submitting)
- [Judging](#judging)
- [Timeline](#timeline)
- [Ideas](#ideas)
- [Resources](#resources)
- [After the sprint](#after-the-sprint)

## How to apply

1. Fork this repository and add one object to [`registry.json`](registry.json).
2. Open a pull request saying what you're building.
3. It merges on its own once the check passes, and your project appears on the hub within the half hour.

Registration stays open for the whole sprint. Merging puts your project on the hub.

This is the only pull request you open. Everything else - your pushes, your stack, your contracts, your demo - is read from your repository and refreshed every 30 minutes.

## Your registry entry

Two fields. Everything else is read from the repository itself.

`registry.json` is an array. Your object goes inside the brackets, with a comma after the entry above it:

```json
[
  ...,
  {
    "repo_url": "https://github.com/your-org/zk-mail",
    "telegram": ["your_telegram", "teammate_telegram"]
  }
]
```

| Field | Required | Notes |
|---|---|---|
| `repo_url` | yes | your public GitHub repository |
| `telegram` | yes | Telegram usernames, no `@`, one per person on the team - how the STRK20 team reaches you during the sprint |

Optional, only if the derived value is wrong:

| Field | Derived from | |
|---|---|---|
| `name` | the repository name | |
| `one_liner` | the repository description | |
| `slug` | the repository name, lowercased | must be unique |
| `category` | defaults to `Other` | `Consumer`, `DeFi`, `Tooling`, `Infra`, `Payments`, `Gaming`, `Other` |
| `team` | commit history | GitHub usernames, for anyone detection misses |
| `x_handle` | - | without the `@` |
| `inspired_by` | - | an ID from [IDEAS.md](IDEAS.md) |

Nothing needs to be deployed to apply. Builders appear on the hub automatically, taken from who commits to the repository.

## strk20.json

A file at the root of your own repository. Add each field when you have it. This is what the panel reads when scoring, so it needs to be there before the deadline.

```json
{
  "transactions": ["0x07c0...", "0x04b2...", "0x0919..."],
  "contracts": ["0x0abc...", "0x0def..."],
  "demo_video": "https://youtu.be/...",
  "demo_url": "https://your-demo.example"
}
```

| Field | Required | Notes |
|---|---|---|
| `transactions` | to be scored | At least three mainnet transaction hashes. Each is checked against the chain: it must exist, have succeeded, and have touched the STRK20 pool |
| `contracts` | no | Deployed addresses, shown with their network |
| `demo_video` | to be scored | Your 3-minute demo video |
| `demo_url` | no | Only if your demo isn't found automatically |

> [!NOTE]
> Your demo is usually found without you doing anything: GitHub Pages first, then your repository's **Website** field, then your latest deployment. Filling in the Website field is the one-click way to be certain.

## Rules

- Open to individuals and teams, new projects or existing ones.
- Your repository must be **public and open-source**, with a license.
- To win, your app must run on **Starknet mainnet** against the live STRK20 pool, with at least **three mainnet transactions** that touched the pool, listed by hash in your `strk20.json`.
- A **public demo URL** anyone can open.
- One payout address per winning team.

Ideas are not exclusive. Several teams working from the same idea is fine.

## Submitting

There is nothing to submit. Whatever your repository shows at **August 31, 23:59 UTC** is your entry.

To be scored, it needs:

- A live demo
- A 3-minute demo video
- Three mainnet transaction hashes in `strk20.json`, each proving a real call against the STRK20 pool

The hub shows which of these you're still missing.

## Judging

A named panel scores every project after submissions close.

| Weight | Criterion |
|---|---|
| 30% | **STRK20 integration depth** - shielded balances, private transfers, anonymizer contracts, the SDK, using stealth accounts |
| 30% | **Working mainnet product** - it runs, on mainnet, for a real user |
| 25% | **Innovation** - something the ecosystem doesn't have yet, or a better take on something it does |
| 15% | **Documentation & open-source quality** - a README someone can follow, code someone can build on, a license |

If another team depends on something you published, that counts in your favour.

Winners announced **September 4**.

## Timeline

| Date | |
|---|---|
| August 14 | Applications and hacking open |
| August 31, 23:59 UTC | Submissions close |
| September 4 | Winners announced |

## Ideas

[IDEAS.md](IDEAS.md) holds the 12 published Request for Startups plus 28 shorter prompts across trading, payments, asset management, capital formation, infrastructure and governance. All of it is in scope: build one, build a variation, or build something else entirely.

## Resources

- [Day 0: your first mainnet transaction](docs/MAINNET-DAY-0.md) - Zero to a shielded mainnet balance. Start here.
- [Awesome STRK20](https://github.com/Akashneelesh/awesome-strk20) - SDKs, helper contracts, proof-of-concept apps and guides.
- [STRK20 starter kit](https://github.com/Akashneelesh/strk20-starter-kit) - Next.js starter: wallet picker, shield, unshield, private transfer, and a deployable `privacy_invoke` helper.
- [Privacy SDK](https://github.com/starkware-libs/starknet-privacy) - Pool contracts, the TypeScript SDK, and the proving service.
- [STRK20 by example](https://strk20-by-example.org/what-is-strk20) - Documentation for the pool, the Privacy Wallet API, and anonymizer contracts.
- [Build on STRK20](https://strk20.starknet.io/build) - Integration routes: private dapp, privacy wallet, or your own prover.

Stuck on something? Open an issue on this repository - the STRK20 team reads them every day of the sprint.

## After the sprint

Strong projects get continued support: technical feedback from the StarkWare privacy team, ecosystem introductions, and a path into the Starknet Foundation Grants Program.

---

Full contribution guidance in [CONTRIBUTING.md](./CONTRIBUTING.md).
