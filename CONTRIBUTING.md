# Contributing to Private Sprint

Thanks for building on the Starknet privacy pool. Everything here happens through pull requests.

A valid pull request merges itself, usually within a minute, and your project is on the hub within the half hour.

## Applying

1. Fork the repo and edit `registry.json`.
2. Append one object to the array. Two fields is a complete entry:
   ```json
   {
     "repo_url": "https://github.com/your-org/zk-mail",
     "telegram": ["your_telegram"]
   }
   ```
3. Don't modify anyone else's entry. Append yours; leave the rest alone - a pull request that changes an existing row stops and waits for a maintainer.
4. Open the pull request. It validates and merges on its own. If something is wrong, the check reports every problem at once - fix it on the branch and it merges itself.

**Ignore merge conflicts.** Everyone appends to the end of the same array, so your branch conflicts with every application merged after you opened it. Don't resolve it - a bot rewrites your branch as the current `registry.json` plus your entry, usually within a minute. Leave *Allow edits by maintainers* on and there is nothing for you to do.

If you do resolve one by hand, keep **every** entry from both sides. Taking one side of the file deletes projects that were already accepted, and a check will block the merge until they're back.

**Start building before it's merged.** Registration doesn't unlock anything - merging only decides when your project appears on the hub.

**This is the only pull request you open.** Your pushes, the lines they changed, your description, your stack, your contracts and their network, your demo and your builders are all read from your repository every 30 minutes. There is no pull request for reporting progress.

### Fields

Two are required:

- **`repo_url`** - a public GitHub repository. The hub reads your commits, README, and manifests from it.
- **`telegram`** - bare Telegram usernames, no `@` and no `t.me` links, one for each person on the team. This is how the STRK20 team reaches you during the sprint - about your entry, your submission, or a prize.

The rest are optional, and only worth setting if the derived value is wrong:

- **`name`** - defaults to the repository name.
- **`one_liner`** - defaults to the repository description.
- **`slug`** - defaults to the repository name, lowercased and hyphenated. Must be unique.
- **`category`** - defaults to `Other`. One of `Consumer`, `DeFi`, `Tooling`, `Infra`, `Payments`, `Gaming`, `Other`.
- **`team`** - builders are detected from the commit history. Add a username here only if detection misses someone: a different commit email, a co-author, or anyone who hasn't pushed yet.
- **`x_handle`** - without the `@`. Used to credit you in sprint updates.
- **`inspired_by`** - an ID from `IDEAS.md`, if one of them is what you are building.

## strk20.json, in your repository

Everything you control goes in a `strk20.json` at the root of your own repo, and it is what the panel reads when scoring. **None of it belongs in your registration PR.** Add each piece whenever you have it - the hub reads the file within 30 minutes and updates your row on its own.

```json
{
  "transactions": ["0x07c0...", "0x04b2...", "0x0919..."],
  "contracts": ["0x0abc..."],
  "demo_video": "https://youtu.be/...",
  "demo_url": "https://your-demo.example"
}
```

- **`transactions`** - at least three mainnet transaction hashes. Each is checked against the chain: it must exist, have succeeded, and have touched the STRK20 pool. Hashes rather than an address because private transactions are relayed, so the on-chain sender is never you.
- **`contracts`** - deployed addresses. Each is checked against mainnet and Sepolia and shown with the network it was found on.
- **`demo_video`** - your 3-minute demo video.
- **`demo_url`** - only if your demo isn't found automatically. See below.

Every field is optional, and none of them gates anything. Deployed a contract? Paste the address in. Recorded your video? Add the link. Made your mainnet calls? Paste the hashes.

It does matter that they end up there before the deadline: they're how we know your app is really on mainnet and how judges reach your demo. A project with none of them still appears on the hub - it just can't be scored. The hub shows what's still missing, so it isn't a surprise on the last day.

### Your demo is picked up automatically

You don't need to set `demo_url` in most cases. The hub checks each project for a deployment on every run, in this order:

1. `demo_url` in your `strk20.json`, if you set one - an explicit value always wins.
2. **GitHub Pages**, if the repository publishes a site.
3. The repository's **Website** field - the box under "About" on your repo page. One click, and the most reliable of the three.
4. Your latest successful **deployment**, if your host reports one back to GitHub.

## Adding an idea

1. Fork the repo and edit `IDEAS.md`.
2. Add your entry to the most fitting section, keeping the existing format:
   ```
   **IDEA-NN · Title**
   Two or three sentences: what it is, and what the hard part is.
   ```
3. Take the next free ID. Don't renumber existing entries.

Everything on the list is in scope for the sprint, and so is anything that isn't on it.

## Submitting

There is nothing to submit, and no second pull request. Whatever your repository shows at **August 31, 23:59 UTC** is your entry.

A project counts as submitted once three things are true, each checked automatically and shown on the hub so you can see what's still missing:

- A live demo anyone can open.
- A `demo_video` in your `strk20.json`.
- Three verified mainnet transactions in your `strk20.json`.

Your README should still cover what it does and why it needed privacy, how to run it locally, and your mainnet contract addresses - that's what judges read, and documentation carries 15% of the score.

## Guidelines

- **Public only.** Your repository, your demo, and anything you link must resolve for someone who isn't logged in. Private repos can't be judged.
- **Mainnet, actually running.** To win, at least three mainnet transactions against the live pool, listed by hash in your `strk20.json`. A prototype behind a login doesn't qualify. Nothing needs to be deployed to register.
- **Accurate.** Describe what your project actually does. Be especially precise about what is and isn't private - overclaiming costs you on integration depth. The [Day 0 guide](docs/MAINNET-DAY-0.md) has the breakdown.
- **License your repository.** It counts toward the open-source score, and other teams can't build on what they can't legally use.
- **No secrets, ever.** Use placeholder values for keys, addresses, and endpoints in anything you commit. Never commit real private keys.
- **Link-check before submitting.** Confirm every URL returns a live page.

## Reporting issues

Open an issue for a broken check, a wrong entry, anything unclear in these docs, or a question while building. The STRK20 team reads them every day of the sprint.
