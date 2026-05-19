import "dotenv/config";
import { spawn } from "node:child_process";
import { ethers } from "ethers";

const rpcUrl = process.env.BASE_RPC_URL;
const contractAddress = process.env.CODEX_SECRET_CONTRACT;
const apiUrl = process.env.CODEX_SECRET_API ?? "https://codexsecret.codes/api/schedule";
const privateKey = process.env.AGENT_PRIVATE_KEY;
const agentName = process.env.AGENT_NAME ?? "codex-agent";
const solverCommand = process.env.SOLVER_COMMAND ?? "";
const pollSeconds = Number(process.env.POLL_SECONDS ?? 15);

const abi = [
  "function COMMIT_BOND() view returns (uint256)",
  "function answerHashes(uint256,uint8) view returns (bytes32)",
  "function commit(uint256,uint8,bytes32) payable",
  "function reveal(uint256,uint8,string,bytes32,string)",
  "function isWinner(uint256,uint8,address) view returns (bool)",
  "function winnerClaimed(uint256,uint8,address) view returns (bool)",
  "function claim(uint256,uint8)",
];

if (!rpcUrl) throw new Error("Set BASE_RPC_URL.");
if (!contractAddress) throw new Error("Set CODEX_SECRET_CONTRACT.");
if (!privateKey) throw new Error("Set AGENT_PRIVATE_KEY.");

const provider = new ethers.JsonRpcProvider(rpcUrl);
const wallet = new ethers.Wallet(privateKey, provider);
const contract = new ethers.Contract(contractAddress, abi, wallet);
const memory = new Map();

function normalizeAnswer(answer) {
  return String(answer)
    .normalize("NFKC")
    .trim()
    .toLowerCase()
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'")
    .replace(/\s+/g, " ");
}

function key(roundId, slot) {
  return `${roundId}:${slot}`;
}

async function solve(round) {
  if (!solverCommand.trim()) return "";
  return new Promise((resolve, reject) => {
    const [cmd, ...args] = solverCommand.split(/\s+/);
    const child = spawn(cmd, args, { stdio: ["pipe", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error("solver_timeout"));
    }, 120_000);

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("error", reject);
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code !== 0) {
        reject(new Error(stderr || `solver_failed_${code}`));
        return;
      }
      resolve(normalizeAnswer(stdout));
    });

    child.stdin.end(JSON.stringify(round));
  });
}

async function tick() {
  const round = await fetch(apiUrl, { cache: "no-store" }).then((res) => res.json());
  const now = Math.floor(Date.now() / 1000);
  const commitOpen = now >= round.startedAt && now < round.endsAt;
  const revealOpen = now >= round.endsAt && now < round.endsAt + 300;
  const bond = await contract.COMMIT_BOND();

  for (const item of round.commitSlots ?? []) {
    const slot = Number(item.slot) - 1;
    const id = key(round.roundId, slot);

    if (commitOpen && !memory.has(id)) {
      const answer = await solve(round);
      if (!answer) continue;
      const salt = ethers.hexlify(ethers.randomBytes(32));
      const commitment = ethers.solidityPackedKeccak256(
        ["string", "bytes32", "address", "string"],
        [answer, salt, wallet.address, agentName],
      );
      const tx = await contract.commit(round.roundId, slot, commitment, { value: bond });
      console.log(`commit ${id}: ${tx.hash}`);
      await tx.wait();
      memory.set(id, { answer, salt });
    }

    if (revealOpen && memory.has(id)) {
      const entry = memory.get(id);
      const published = await contract.answerHashes(round.roundId, slot);
      if (published !== ethers.ZeroHash && !entry.revealed) {
        const tx = await contract.reveal(round.roundId, slot, entry.answer, entry.salt, agentName);
        console.log(`reveal ${id}: ${tx.hash}`);
        await tx.wait();
        entry.revealed = true;
      }
    }

    const selected = await contract.isWinner(round.roundId, slot, wallet.address).catch(() => false);
    if (selected) {
      const claimed = await contract.winnerClaimed(round.roundId, slot, wallet.address);
      if (!claimed) {
        const tx = await contract.claim(round.roundId, slot);
        console.log(`claim ${id}: ${tx.hash}`);
        await tx.wait();
      }
    }
  }
}

console.log(`Codex Secret agent running as ${wallet.address}`);
await tick();
setInterval(() => tick().catch((error) => console.error(error)), pollSeconds * 1000);
