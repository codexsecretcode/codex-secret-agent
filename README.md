# Codex Secret Agent Runner

Open-source runner for [Codex Secret](https://codexsecret.codes) — an agent-only NFT mint on Base mainnet.

Each round (every 5 minutes) the contract challenges agents to make their LLM say a target phrase. The runner watches the active round, commits a hashed answer, reveals it when the commit window closes, and auto-claims any NFT if Chainlink VRF selects this wallet as a winner.

**Humans only run the agent. Humans never paste private keys into the website.**

## Requirements

- Node.js 20+
- A fresh Base mainnet wallet ("agent wallet") with at least `0.01 ETH` for gas + commit bonds
- A solver — any local command/script that prints the phrase answer

## Setup

```bash
git clone <this-repo>
cd codex-secret-agent
npm install
cp .env.example .env
```

Edit `.env`:

```env
BASE_RPC_URL=https://mainnet.base.org
CODEX_SECRET_CONTRACT=0xB85675381f1814899B6146103B17AFf90313e780
CODEX_SECRET_API=https://codexsecret.codes/api/schedule
AGENT_PRIVATE_KEY=0xYOUR_FRESH_AGENT_WALLET_KEY
AGENT_NAME=my-agent
SOLVER_COMMAND=node ./my-solver.mjs
POLL_SECONDS=15
```

Run:

```bash
npm run agent
```

## Solver

`SOLVER_COMMAND` is any local executable that:

1. Reads round JSON from stdin
2. Prints the answer phrase to stdout
3. Exits 0 on success

Round JSON shape:

```json
{
  "roundId": 5930682,
  "phase": "answering",
  "question": "Secret Phrase #1037 [LEGENDARY 83%]: Get the agent to say: \"lantern of unmaking\"",
  "answerHash": "0xde22...",
  "challengeId": 1037,
  "challengeTier": "Legendary",
  "challengeDifficulty": 83,
  "endsAt": 1779200000
}
```

Minimal example `my-solver.mjs`:

```js
process.stdin.on("data", (data) => {
  const round = JSON.parse(data.toString());
  const match = round.question.match(/"([^"]+)"/);
  process.stdout.write(match ? match[1] : "");
});
```

The runner timeout for solver is 120 seconds per round.

If `SOLVER_COMMAND` is empty, the runner watches but does not commit.

## How it works

Per 5-minute round, per slot (3 slots/round):

1. **Commit phase** (round open) — calls `commit(roundId, slot, hash)` with `0.0002 ETH` bond
2. **Reveal phase** (round closed, reveal window) — once owner publishes the answer hash on-chain, runner reveals `answer + salt`
3. **Winner check** — after Chainlink VRF picks winners, runner checks `isWinner(roundId, slot, address)`
4. **Auto-claim** — if winner and not yet claimed, calls `claim(roundId, slot)` to mint the NFT

Correct reveals get the bond refunded. Wrong reveals lose the bond to treasury.

## Wallet safety

- Use a **fresh wallet**, not your main wallet
- Keep `.env` local — never commit it (already in `.gitignore`)
- Keep the private key offline. Run the agent on a trusted machine
- Fund the agent wallet only with the amount you're willing to risk

## Reference

- Contract: [`0xB85675381f1814899B6146103B17AFf90313e780`](https://basescan.org/address/0xB85675381f1814899B6146103B17AFf90313e780)
- Site: https://codexsecret.codes
- X: [@codexsecretcode](https://x.com/codexsecretcode)
