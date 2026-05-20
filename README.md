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

The runner timeout for solver is 120 seconds per round.

If `SOLVER_COMMAND` is empty, the runner watches but does not commit.

### Example 1 — Minimal regex (no AI)

Current phrase bank exposes the answer in the question text. Easiest solver:

```js
// my-solver.mjs
let buf = "";
process.stdin.on("data", (chunk) => (buf += chunk));
process.stdin.on("end", () => {
  const round = JSON.parse(buf);
  const match = round.question.match(/"([^"]+)"/);
  process.stdout.write(match ? match[1] : "");
});
```

```env
SOLVER_COMMAND=node ./my-solver.mjs
```

### Example 2 — OpenAI (GPT-4o-mini)

`npm install openai` first.

```js
// solver-openai.mjs
import OpenAI from "openai";

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
let buf = "";
process.stdin.on("data", (chunk) => (buf += chunk));
process.stdin.on("end", async () => {
  const round = JSON.parse(buf);
  const completion = await client.chat.completions.create({
    model: "gpt-4o-mini",
    messages: [
      { role: "system", content: "You extract the target phrase the player must produce. Output ONLY the phrase, no quotes, no explanation." },
      { role: "user", content: round.question },
    ],
    temperature: 0,
    max_tokens: 30,
  });
  process.stdout.write(completion.choices[0].message.content.trim());
});
```

```env
SOLVER_COMMAND=node ./solver-openai.mjs
OPENAI_API_KEY=sk-...
```

### Example 3 — Anthropic (Claude Haiku)

`npm install @anthropic-ai/sdk` first.

```js
// solver-claude.mjs
import Anthropic from "@anthropic-ai/sdk";

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
let buf = "";
process.stdin.on("data", (chunk) => (buf += chunk));
process.stdin.on("end", async () => {
  const round = JSON.parse(buf);
  const message = await client.messages.create({
    model: "claude-haiku-4-5-20251001",
    max_tokens: 30,
    system: "Extract the target phrase the player must produce. Output ONLY the phrase, no quotes, no commentary.",
    messages: [{ role: "user", content: round.question }],
  });
  const text = message.content[0].type === "text" ? message.content[0].text : "";
  process.stdout.write(text.trim());
});
```

```env
SOLVER_COMMAND=node ./solver-claude.mjs
ANTHROPIC_API_KEY=sk-ant-...
```

### Example 4 — Local LLM via Ollama

Install [Ollama](https://ollama.com) + pull a model: `ollama pull llama3.2`.

```js
// solver-ollama.mjs
let buf = "";
process.stdin.on("data", (chunk) => (buf += chunk));
process.stdin.on("end", async () => {
  const round = JSON.parse(buf);
  const response = await fetch("http://localhost:11434/api/generate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "llama3.2",
      prompt: `Extract the target phrase from this challenge. Output ONLY the phrase.\n\n${round.question}`,
      stream: false,
      options: { temperature: 0, num_predict: 30 },
    }),
  });
  const { response: text } = await response.json();
  process.stdout.write(text.trim());
});
```

```env
SOLVER_COMMAND=node ./solver-ollama.mjs
```

Free, runs locally, no API costs.

### Picking a solver

- **Regex** — fastest, free, works as long as challenge format stays the same
- **OpenAI / Anthropic** — costs per round (~$0.0001), robust if challenge format changes
- **Ollama** — free, slower (depends on GPU), full local privacy

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

## $CODEX token (companion airdrop)

Codex Secret has a companion token `$CODEX` launching on [clanker.world](https://clanker.world/) on Base.

- **Name:** Codex Secret
- **Ticker:** `$CODEX`
- **Network:** Base
- **Total supply:** 100,000,000,000
- **Start market cap:** ~10 WETH

### Allocation

| Bucket | Share | Notes |
| --- | --- | --- |
| NFT holders airdrop | 40% | Snapshot pre-launch, weighted by rarity (see below) |
| Vault | 5% | Locked 30 days — future marketing + NFT swap |
| Liquidity | 55% | LP at clanker launch |

### Holder allocation by rarity

| Rarity | NFTs | % of total | Per NFT (approx.) |
| --- | --- | --- | --- |
| Mythos | 11 | 11% | 1,000,000,000 |
| Legendary | 67 | 6% | ~89,552,238 |
| Epic | 111 | 9% | ~81,081,081 |
| Rare | 278 | 8% | ~28,776,978 |
| Common | 644 | 6% | ~9,316,770 |

Hold your Codex Secret NFT through the snapshot block to qualify.

## Transparency — public wallets

Everything is published on-chain.

- **NFT Contract:** [`0xB85675381f1814899B6146103B17AFf90313e780`](https://basescan.org/address/0xB85675381f1814899B6146103B17AFf90313e780)
- **Owner / Deployer / VRF admin:** [`0xdeA4Bec7Ab35Df40B6F85b3c6782b52695458d50`](https://basescan.org/address/0xdeA4Bec7Ab35Df40B6F85b3c6782b52695458d50)
- **Treasury (royalty + slashed bonds):** [`0x2F72C20353507D3213F00ee69328eDF98bd2D2ca`](https://basescan.org/address/0x2F72C20353507D3213F00ee69328eDF98bd2D2ca)
- **VRF Subscription:** `102284659155864015141478380727831947693925110980080191151272147931900779399885` (Chainlink VRF v2.5 on Base)

## Reference

- Site: https://codexsecret.codes
- X: [@codexsecretcode](https://x.com/codexsecretcode)
- Launchpad: https://clanker.world/
