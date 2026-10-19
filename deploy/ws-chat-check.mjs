// One real turn over ZeroClaw's /ws/chat, the same protocol Nutq uses: connect with ?agent=&token=, send
// {"type":"message","content":...}, read frames until done, aborted or error. Prints a JSON summary; the token is read
// from a file and never printed. Exit code 0 only if a done frame with a non-empty reply arrived.
//
//   node deploy/ws-chat-check.mjs --token-file deploy/.local/gateway-token [--url ws://127.0.0.1:42617/ws/chat]
//     [--agent default] [--message "..."] [--timeout-ms 60000]
//
// Needs Node 22 or later (the built-in WebSocket).

import { readFileSync } from "node:fs";
import { parseArgs } from "node:util";

const { values: args } = parseArgs({
  options: {
    url: { type: "string", default: "ws://127.0.0.1:42617/ws/chat" },
    agent: { type: "string", default: "default" },
    "token-file": { type: "string" },
    message: { type: "string", default: "This is a connectivity check. Reply with one short sentence that says the check worked." },
    "timeout-ms": { type: "string", default: "60000" },
  },
});

if (!args["token-file"]) {
  console.error("ws-chat-check: --token-file is required");
  process.exit(2);
}
const token = readFileSync(args["token-file"], "utf8").trim();
const url = new URL(args.url);
url.searchParams.set("agent", args.agent);
url.searchParams.set("token", token);

const t0 = Date.now();
const since = () => Date.now() - t0;
const summary = {
  url: args.url,
  agent: args.agent,
  message: args.message,
  opened_ms: null,
  frames: {},
  first_chunk_ms: null,
  end_frame: null,
  end_ms: null,
  chunks_text: "",
  full_response: null,
  error: null,
  close: null,
};

const ws = new WebSocket(url);
const timer = setTimeout(() => finish(`timed out after ${args["timeout-ms"]} ms`), Number(args["timeout-ms"]));

function finish(error) {
  clearTimeout(timer);
  if (error && !summary.error) summary.error = error;
  try {
    ws.close();
  } catch {}
  const reply = (summary.full_response ?? summary.chunks_text).trim();
  const ok = summary.end_frame === "done" && reply.length > 0 && !summary.error;
  console.log(JSON.stringify({ ok, ...summary }, null, 2));
  process.exit(ok ? 0 : 1);
}

ws.onopen = () => {
  summary.opened_ms = since();
  ws.send(JSON.stringify({ type: "message", content: args.message }));
};

ws.onmessage = (ev) => {
  let frame;
  try {
    frame = JSON.parse(String(ev.data));
  } catch {
    summary.frames["(non-json)"] = (summary.frames["(non-json)"] ?? 0) + 1;
    return;
  }
  const type = frame.type ?? "(no type)";
  summary.frames[type] = (summary.frames[type] ?? 0) + 1;
  if (type === "chunk") {
    if (summary.first_chunk_ms === null) summary.first_chunk_ms = since();
    summary.chunks_text += frame.content ?? "";
  } else if (type === "done") {
    summary.end_frame = "done";
    summary.end_ms = since();
    summary.full_response = frame.full_response ?? null;
    finish();
  } else if (type === "aborted") {
    summary.end_frame = "aborted";
    summary.end_ms = since();
    finish("turn aborted");
  } else if (type === "error") {
    summary.end_frame = "error";
    summary.end_ms = since();
    finish(`error frame: ${frame.code ?? ""} ${frame.message ?? JSON.stringify(frame)}`.trim());
  } else if (type === "approval_request") {
    // Nutq always denies; do the same so a tool request cannot stall the check.
    ws.send(JSON.stringify({ type: "approval_response", request_id: frame.request_id, decision: "deny" }));
  }
};

ws.onerror = () => {
  // A failed upgrade (a wrong token is an HTTP 401) reaches a WebSocket client only as an error plus close 1006.
  if (!summary.error) summary.error = "websocket error (a wrong or missing token shows up this way)";
};

ws.onclose = (ev) => {
  summary.close = { code: ev.code, reason: ev.reason || null };
  if (summary.end_frame === null) finish(summary.error ?? `closed before the turn ended (code ${ev.code})`);
};
