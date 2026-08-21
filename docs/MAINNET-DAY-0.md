# Day 0 - your first mainnet transaction

The sprint is mainnet-only. Prizes require **three real transactions** against the pool, listed by hash in your `strk20.json`, so the first thing to do - before you write any code - is prove you can reach the pool on mainnet. Budget an hour. If you're still stuck after that, open an issue; getting you unblocked is what the team is there for.

> **This is real money on a real network.** Start with an amount you would not mind losing. Nothing about the sprint requires large sums - three transactions of a few STRK each satisfy the eligibility rule.

---

## What you need

| | |
|---|---|
| A Starknet wallet | Ready (formerly Argent) or Braavos, switched to **Mainnet** |
| STRK for gas and for shielding | From a centralized exchange that supports Starknet withdrawals, or bridged from Ethereum |
| Three mainnet transaction hashes | Go in `strk20.json` in your own repository. Each is checked on-chain: it must exist, have succeeded, and carry a STRK20 pool event. |

## Verified mainnet values

These are checked against the live network. Use them, not the Sepolia values in the starter kit's `.env.example`.

```bash
CHAIN_ID=SN_MAIN                  # 0x534e5f4d41494e
RPC_URL=https://rpc.starknet.lava.build
POOL_ADDRESS=0x040337b1af3c663e86e333bab5a4b28da8d4652a15a69beee2b677776ffe812a
```

Pool on Voyager: [voyager.online/contract/0x040337b1af3c663e86e333bab5a4b28da8d4652a15a69beee2b677776ffe812a](https://voyager.online/contract/0x040337b1af3c663e86e333bab5a4b28da8d4652a15a69beee2b677776ffe812a)

> **Do you actually need a proving service URL?** Every private transaction is proved. What decides this is *who* reaches the proving service - the user's wallet, or you.
>
> - **Private dapp through the Wallet API** - the user's privacy-enabled wallet holds the keys and reaches a proving service itself. You need a Starknet RPC URL and nothing else. This is the route most teams here are on, and the only one that needs no proving service URL of your own.
> - **Privacy SDK holding your own keys** - you reach the proving service, so you need its URL. `MockProofProvider` is for tests only; real proofs go through `ProvingServiceProofProvider(proverUrl, chainId)`.
> - **Cairo anonymizer contracts** - these do **not** avoid the prover. An anonymizer is called *by the pool contract*, through `privacy_invoke`, from inside a private transaction that was proved like any other. Writing one is orthogonal to which of the two routes above you are on.
>
> **What needs no proof at all:** registering a viewing key, and shielding. Both are ordinary public transactions. A headless service can move value *into* the pool today with nothing but an RPC URL - it is spending notes privately that needs a proof.
>
> **Discovery.** `IndexerDiscoveryProvider(apiUrl, poolAddress)` wants a hosted indexer. `ContractDiscoveryProvider` reads the same notes from the pool contract over ordinary Starknet RPC, and would be the way to work without one - but as of SDK `0.14.3-rc.5` it is not re-exported from the package entry, and the `exports` map has no `./internal/*` subpath, so it cannot be deep-imported either. Tracked in [#121](https://github.com/starkience/strk20-hackathon/issues/121). Until that lands, discovery on the SDK route means a hosted indexer.
>
> The mainnet **proving service URL** is not published here yet. If your design needs the SDK route on mainnet, open an issue and say so - that is the one blocker a team cannot work around on its own. Don't guess at endpoints: a wrong proving service fails in ways that look like your bug.

---

## Step 1 - Register your viewing key

Every pool user registers exactly once, on-chain. This publishes the public viewing key that relayers encrypt your notes to; without it, nothing can be sent to you privately.

The private half is derived from a signature, never transmitted. The canonical derivation signs the message `${chainId}:${poolAddress}`, folds the signature with Poseidon, and reduces it into the curve order:

```ts
const messageHash = hash.starknetKeccak(`${chainId}:${poolAddress}`);
const { r, s } = await account.signMessage(/* ... */);
const folded = BigInt(hash.computePoseidonHashOnElements([r, s]));
const reduced = folded % ec.starkCurve.CURVE.n;
```

Your wallet needs no STRK20 support for this - `signMessage` is standard Starknet.

Registration emits a `ViewingKeySet` event with your address as the first key. That event is your proof of enrolment, and it's how the pool counts users.

**If you'd rather not write this yourself on day 0:** use the app at [strk20.starknet.io/app](https://strk20.starknet.io/app), which does registration and shielding through the UI. Doing it once by hand is worth the hour, but it is not a prerequisite for shielding.

## Step 2 - Shield

Shielding deposits an ERC-20 into the pool and credits you an encrypted note. It emits `Deposit(user_addr, token, amount)`.

Two things about this that surprise people:

- **Deposits are screened.** A compliance provider screens the depositing address and signs every deposit; the pool verifies that signature on-chain. It is mandatory, and running your own prover does not bypass it. If your deposit reverts at this step, that's what happened.
- **Amounts and depositor addresses are public at this step.** Shielding is not private - *what you do afterwards* is. Don't build a product whose privacy claim depends on the deposit being hidden.

## Step 3 - Do something private

A note-to-note transfer emits only an encrypted note and a nullifier: no amount, no parties. This is where the privacy actually is.

Reading your own private state uses the discovery provider rather than event scanning:

```ts
const indexer = new IndexerDiscoveryProvider(discoveryUrl, poolAddress);
const { notes } = await indexer.discoverNotes(
  BigInt(address),
  viewingKey,
  { tokens, blockIdentifier: "pre_confirmed" }
);
// notes is a map of token address -> Note[], already filtered to unspent
const privateBalance = notes.get(token).reduce((sum, n) => sum + n.amount, 0n);
```

Don't persist the registry between sessions - rebuild with `discoverNotes` each time. It's fast, and it avoids reorg and cursor-drift bugs.

## Step 4 - Check that your transactions counted

Open your address on [Voyager](https://voyager.online) and look for the pool interactions.

**One thing that will confuse you:** private transactions are submitted by **rotating shared relayers**, not by your wallet. The sender address on the transaction will be a relayer with a nonce in the hundreds of thousands, and your address appears nowhere in the calldata or signature. That's the system working - sender-level identity privacy holds.

This is why eligibility is verified against the `user_addr` recorded in the pool's own `Deposit` event rather than against the transaction sender. List the hashes of calls you actually made.

---

## What is and isn't private

Be precise about this in your README - overclaiming is the fastest way to lose points on integration depth.

| Public | Private |
|---|---|
| Deposits: your address, the token, the amount | Note-to-note transfers: amounts and parties |
| Withdrawal destination and amount | Which deposit a withdrawal came from |
| Swap and lending amounts, and their timing | Who performed the swap or the loan |

Private DeFi routes through shared anonymizer contracts into public venues, so a swap's **amounts and timing are visible** - the anonymity comes from the shared address and the mixing set, not from hiding the amount. A distinctive amount executed shortly after a distinctive deposit is correlatable. Claim identity privacy; never claim amount privacy for swaps.

## Where to go next

- [Privacy SDK](https://github.com/starkware-libs/starknet-privacy) - the monorepo
- [STRK20 by example](https://strk20-by-example.org/what-is-strk20) - the pool, the wallet API, anonymizer contracts
- [Integration routes](https://strk20.starknet.io/build) - private dapp vs privacy wallet vs your own prover

Stuck? Open an issue. Every day of the sprint.
