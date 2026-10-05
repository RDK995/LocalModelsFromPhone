// M19g-T5 diagnostic: one write request shaped exactly like research.ts builds it
// (system + user content via the same SCHEMAS/SYSTEM_INSTRUCTIONS; context() layout; Task last).
// Usage: bun run M19g-T5-diag.ts "<task text>" <think true|false>
import { SCHEMAS, SYSTEM_INSTRUCTIONS } from "../../server/src/generations/research.ts";

const task = process.argv[2]!;
const think = process.argv[3] === "true";
// Synthetic notes modelled on the q1 run's report content (the real notes were not recorded).
const notes: Array<[number, string, string]> = [
  [1, "Raft relies on a leader elected via randomized timeouts to serialize writes.", "Raft elects a leader using randomized election timeouts"],
  [1, "All Raft operations pass through the single leader of a term.", "all client requests go through the leader"],
  [1, "Both protocols use majority quorums to stay safe during partitions.", "a majority of nodes must agree"],
  [2, "Basic Paxos uses proposers and acceptors without a dedicated leader.", "any node can act as a proposer"],
  [2, "Multi-Paxos introduces a stable leader to optimize performance.", "Multi-Paxos elects a distinguished proposer"],
  [2, "Raft requires log consistency before a node can become leader; basic Paxos does not.", "only a candidate with an up-to-date log can win"],
  [3, "Raft is considered simpler and more intuitive than Paxos.", "Raft was designed for understandability"],
  [3, "The original Paxos specification was ambiguous and led to years of debate.", "the original paper was notoriously hard to follow"],
  [3, "Raft's explicit state machine model leads to fewer implementation bugs.", "clearly specified states reduce bugs"],
  [4, "Raft is preferable where developer productivity and maintainability matter.", "teams pick Raft for maintainability"],
  [4, "Multi-Paxos variants are compared against Raft for high-throughput systems.", "Multi-Paxos is used in high-throughput systems"],
  [4, "Paxos implementation complexity is high in practice.", "implementing Paxos correctly is hard"],
  [4, "The choice depends on whether a team values clarity or theoretical flexibility.", "the choice depends on team priorities"],
];
const userContent = [
  "Research brief: Compare the Raft and Paxos consensus algorithms: architecture, complexity, and when to choose each.",
  "Plan (sub-questions):\n1. What are the core architectural differences between Raft and Paxos?\n2. How do they compare in complexity and maintainability?\n3. In which use cases is each preferable?",
  `Notes so far:\n${notes.map(([n, c, q]) => `- [${n}] ${c} (quote: "${q}")`).join("\n")}`,
  "Write the report now.",
].join("\n\n");
const body = {
  model: "qwen3.5:35b-a3b",
  messages: [
    { role: "system", content: SYSTEM_INSTRUCTIONS },
    { role: "user", content: `${userContent}\n\nTask: ${task}` },
  ],
  format: SCHEMAS.write,
  options: { num_ctx: 32768 },
  think,
  keep_alive: -1,
  stream: false,
};
const t0 = Date.now();
const res = await fetch("http://127.0.0.1:11434/api/chat", {
  method: "POST",
  body: JSON.stringify(body),
  signal: AbortSignal.timeout(90_000),
});
const j: any = await res.json();
console.log(
  JSON.stringify(
    {
      wall_ms: Date.now() - t0,
      think,
      task,
      prompt_eval_count: j.prompt_eval_count,
      eval_count: j.eval_count,
      thinking_chars: j.message?.thinking?.length ?? 0,
      content: j.message?.content,
    },
    null,
    1
  )
);
