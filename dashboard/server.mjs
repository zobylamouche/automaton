#!/usr/bin/env node
/**
 * Automaton dashboard server (read-only).
 *
 * Serves dashboard/index.html and a JSON snapshot of the agent's state at
 * /api/state, read from the agent's SQLite file (default ~/.automaton/state.db).
 * Binds to 127.0.0.1 by default (--host to change) and never writes to the database.
 *
 *   node dashboard/server.mjs [--db <path>] [--port <n>] [--host <addr>]
 */
import http from "node:http";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";

const here = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const opt = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};
const expand = (p) => (p.startsWith("~") ? path.join(os.homedir(), p.slice(1)) : p);
const DB_PATH = path.resolve(expand(opt("db", process.env.AUTOMATON_DB || "~/.automaton/state.db")));
const PORT = Number(opt("port", process.env.PORT || 4173));
// 127.0.0.1 par défaut. Dans Docker on passe 0.0.0.0 ; c'est docker-compose qui limite l'accès à la machine locale.
const HOST = opt("host", process.env.HOST || "127.0.0.1");

// Mirrors SURVIVAL_THRESHOLDS in src/types.ts (cents).
function tierOf(cents) {
  if (cents > 500) return "high";
  if (cents > 50) return "normal";
  if (cents > 10) return "low_compute";
  if (cents >= 0) return "critical";
  return "dead";
}

const json = (s, fallback) => {
  try { return JSON.parse(s); } catch { return fallback; }
};

function snapshot() {
  if (!fs.existsSync(DB_PATH)) return { status: 503, body: { error: "no_db", dbPath: DB_PATH } };
  const db = new Database(DB_PATH, { readonly: true, fileMustExist: true });
  try {
    const kv = (k) => db.prepare("SELECT value FROM kv WHERE key = ?").get(k)?.value;
    const ident = (k) => db.prepare("SELECT value FROM identity WHERE key = ?").get(k)?.value;
    const sum = (sql, ...p) => db.prepare(sql).get(...p)?.v ?? 0;

    const bal = json(kv("last_known_balance"), null);
    const creditsCents = bal?.creditsCents ?? null;
    const state = kv("agent_state") || "setup";
    const dayAgo = new Date(Date.now() - 24 * 3600 * 1000).toISOString();

    const earned = sum("SELECT COALESCE(SUM(amount_cents),0) v FROM transactions WHERE type = 'transfer_in'");
    const infer = sum("SELECT COALESCE(SUM(cost_cents),0) v FROM turns");
    const outflow = sum("SELECT COALESCE(SUM(ABS(amount_cents)),0) v FROM transactions WHERE type IN ('transfer_out','x402_payment')");
    const earned24 = sum("SELECT COALESCE(SUM(amount_cents),0) v FROM transactions WHERE type = 'transfer_in' AND created_at >= ?", dayAgo.slice(0, 19).replace("T", " "));
    const spent24 =
      sum("SELECT COALESCE(SUM(cost_cents),0) v FROM turns WHERE timestamp >= ?", dayAgo) +
      sum("SELECT COALESCE(SUM(ABS(amount_cents)),0) v FROM transactions WHERE type IN ('transfer_out','x402_payment') AND created_at >= ?", dayAgo.slice(0, 19).replace("T", " "));

    const events = [];
    for (const r of db.prepare("SELECT created_at t, type, amount_cents a, description d FROM transactions ORDER BY created_at DESC LIMIT 8").all()) {
      const incoming = r.type === "transfer_in" || r.type === "topup";
      events.push({ at: r.t.replace(" ", "T") + "Z", cls: incoming ? "gain" : "loss",
        text: `${incoming ? "Reçu" : "Payé"} ${(Math.abs(r.a ?? 0) / 100).toFixed(2)} $ (${r.type})${r.d ? " · " + r.d.slice(0, 60) : ""}` });
    }
    for (const r of db.prepare("SELECT timestamp t, state, tool_calls tc, thinking th FROM turns ORDER BY timestamp DESC LIMIT 8").all()) {
      const names = json(r.tc, []).map((c) => c.name).filter(Boolean);
      events.push({ at: r.t, cls: "", text: names.length ? `Agit : ${names.slice(0, 3).join(", ")}` : `Pense : ${(r.th || "").slice(0, 70)}` });
    }
    for (const r of db.prepare("SELECT timestamp t, type, description d FROM modifications ORDER BY timestamp DESC LIMIT 4").all()) {
      events.push({ at: r.t, cls: "born", text: `Auto-modification (${r.type}) : ${r.d.slice(0, 60)}` });
    }
    events.sort((a, b) => (a.at < b.at ? 1 : -1));

    // Mémoire de l'agent. Chaque requête est isolée : une vieille base peut ne pas avoir ces tables.
    const safe = (fn, fallback) => { try { return fn(); } catch { return fallback; } };
    const learned = {
      lessons: safe(() => db.prepare(
        "SELECT key, value, confidence FROM semantic_memory WHERE category = 'environment' AND value LIKE '%fails with%' ORDER BY confidence DESC, updated_at DESC LIMIT 6"
      ).all().map((r) => ({ key: r.key, text: String(r.value).slice(0, 160), confidence: r.confidence })), []),
      procedures: safe(() => db.prepare(
        "SELECT name, description, success_count s, failure_count f FROM procedural_memory ORDER BY (success_count - failure_count) DESC, updated_at DESC LIMIT 5"
      ).all().map((r) => ({ name: r.name, description: String(r.description).slice(0, 120), success: r.s, failure: r.f })), []),
      failures: safe(() => db.prepare(
        "SELECT summary, created_at t FROM episodic_memory WHERE outcome = 'failure' ORDER BY created_at DESC LIMIT 5"
      ).all().map((r) => ({ at: r.t.replace(" ", "T") + "Z", text: String(r.summary).slice(0, 140) })), []),
      counts: {
        facts: safe(() => sum("SELECT COUNT(*) v FROM semantic_memory"), 0),
        procedures: safe(() => sum("SELECT COUNT(*) v FROM procedural_memory"), 0),
        successes: safe(() => sum("SELECT COUNT(*) v FROM episodic_memory WHERE outcome = 'success'"), 0),
        failures: safe(() => sum("SELECT COUNT(*) v FROM episodic_memory WHERE outcome = 'failure'"), 0),
      },
    };

    const children = db.prepare("SELECT name, status, funded_amount_cents f FROM children ORDER BY created_at").all();
    const lastTurn = db.prepare("SELECT timestamp, tool_calls tc FROM turns ORDER BY timestamp DESC LIMIT 1").get();

    return { status: 200, body: {
      now: new Date().toISOString(),
      name: ident("name") || "Automaton",
      address: ident("address") || null,
      state,
      creditsCents,
      tier: state === "dead" ? "dead" : creditsCents == null ? null : tierOf(creditsCents),
      usdc: bal?.usdcBalance ?? null,
      turns: sum("SELECT COUNT(*) v FROM turns"),
      lastTurnAt: lastTurn?.timestamp ?? null,
      lastTurnActed: lastTurn ? json(lastTurn.tc, []).length > 0 : false,
      earnedCents: earned,
      spentCents: infer + outflow,
      earned24Cents: earned24,
      spent24Cents: spent24,
      children: children.map((c) => ({ name: c.name, status: c.status, fundedCents: c.f })),
      events: events.slice(0, 8),
      learned,
    } };
  } finally {
    db.close();
  }
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, "http://localhost");
  if (req.method !== "GET") { res.writeHead(405).end(); return; }
  if (url.pathname === "/api/state") {
    let out;
    try { out = snapshot(); } catch (e) { out = { status: 500, body: { error: "read_failed", message: String(e.message || e) } }; }
    res.writeHead(out.status, { "content-type": "application/json", "cache-control": "no-store" });
    res.end(JSON.stringify(out.body));
    return;
  }
  if (url.pathname === "/" || url.pathname === "/index.html") {
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    res.end(fs.readFileSync(path.join(here, "index.html")));
    return;
  }
  res.writeHead(404).end("Not found");
});

server.listen(PORT, HOST, () => {
  console.log(`Automaton dashboard : http://${HOST}:${PORT}`);
  console.log(`Base lue (lecture seule) : ${DB_PATH}`);
});
