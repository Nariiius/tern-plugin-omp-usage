import { expect, test } from "bun:test";
import * as fs from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

const cliRoot = dirname(fs.realpathSync(Bun.which("omp")));
const { buildProviderCards } = await import(Bun.resolveSync("@oh-my-pi/pi-tui/overlays/usage-dashboard", cliRoot));
const { default: usageRemaining, combineReports, lineFor, modelIndex, savedResets } = await import("../omp/extensions/usage-remaining.js");
const now = Date.now();
const hour = 3_600_000;
const model = { provider: "openai-codex", id: "gpt-main", name: "Main" };
const spark = { ...model, id: "gpt-spark", name: "Spark" };
const index = modelIndex([model, spark]);
const limit = (id, windowId, usedFraction, scope = {}) => ({
  id, label: "Usage", scope: { provider: model.provider, windowId, ...scope },
  window: { id: windowId, resetsAt: now + hour }, amount: { usedFraction, unit: "percent" }, status: "ok",
});
const report = (limits, resetCredits) => ({ provider: model.provider, limits, resetCredits, fetchedAt: now });
const percentages = (line) => [...line.matchAll(/(\d+)% left/g)].map((m) => Number(m[1]));


test("account means match native overview, preserve missing windows, and use fullest account reset", () => {
  const fullest = { ...limit("a5", "5h", 1), window: { id: "5h", resetsAt: now + 2 * hour } };
  const reports = [report([fullest, limit("a7", "7d", 0.2)]), report([limit("b5", "5h", 0), limit("bm", "monthly", 0.005)])];
  const combined = combineReports(reports);
  const native = buildProviderCards(reports, now)[0];
  expect(combined[0].limits.map((l) => l.amount.usedFraction)).toEqual(native.windows.map((w) => w.fraction));
  expect(combined[0].limits[0].window.resetsAt).toBe(now + native.windows[0].resetMs);
  expect(percentages(lineFor(combined, model.provider, model.id, index))).toEqual([50, 80, 100]);
});

test("fraction precedence, unknown amounts, exhausted overage, and provider isolation", () => {
  const a = limit("a", "5h", undefined);
  a.amount = { used: 1, limit: 4, remainingFraction: 0.99 };
  const b = limit("b", "5h", undefined);
  b.amount = { remainingFraction: 0.25 };
  const reports = [report([a]), report([b]), report([limit("unknown", "5h", undefined)])];
  expect(percentages(lineFor(combineReports(reports), model.provider, model.id, index))).toEqual([50]);
  expect(percentages(lineFor(combineReports([report([limit("over", "5h", 1.5)])]), model.provider, model.id, index))).toEqual([0]);
  expect(lineFor(combineReports(reports), "anthropic", "claude", index)).toBe("");
});

test("shared counters collapse before averaging; model and tier buckets survive same-duration windows", () => {
  const base = limit("base", "5h", 0.2, { sharedGroup: "shared" });
  const copy = limit("copy", "5h", 0.2, { sharedGroup: "shared", modelId: "gpt-other" });
  const reports = [report([base, copy, limit("spark", "5h", 0.9, { tier: "spark" }),
    limit("model", "5h", 0.7, { modelId: "gpt-main" })]), report([limit("second", "5h", 0.6)])];
  const combined = combineReports(reports);
  expect(combined[0].limits).toHaveLength(3);
  expect(percentages(lineFor(combined, model.provider, model.id, index))).toEqual([60, 30]);
  expect(percentages(lineFor(combined, model.provider, spark.id, index))).toEqual([60, 10]);
  const providerLine = lineFor(combined, model.provider, "", index);
  expect(percentages(providerLine)).toEqual([60, 10, 30]);
  expect(providerLine).toContain("Usage (spark)");
  expect(providerLine).toContain("Usage (gpt-main)");
  const onlyScoped = combineReports([report([limit("spark", "7d", 0.9, { tier: "spark" })])]);
  expect(lineFor(onlyScoped, model.provider, model.id, index)).toBe("");
  expect(lineFor(onlyScoped, model.provider, "", index)).toContain("10% left");
});

test("credits combine per account, retain target IDs, and do not duplicate across weekly scopes", () => {
  const credit = (id, count, hours, clears) => ({ id, status: "available", usable: true, remainingCount: count,
    expiresAt: new Date(now + hours * hour).toISOString(), clears });
  const reports = [report([limit("a7", "7d", 0.2), limit("as", "7d", 0.8, { tier: "spark" })],
    { availableCount: 2, credits: [credit("a", 2, 10, ["a7", "as"])] }),
  report([limit("b7", "7d", 0.6)], { availableCount: 3, credits: [credit("b", 3, 20, ["b7"])] })];
  const combined = combineReports(reports);
  expect(lineFor(combined, model.provider, model.id, index)).toContain("(!5 -");
  expect(savedResets(combined[0], () => true)).toEqual([
    { expiresAt: now + 10 * hour, count: 2 }, { expiresAt: now + 20 * hour, count: 3 },
  ]);
});

// Each invocation owns its dependencies: no process-wide mocks or real timers.
function session({ native = true, cache = null, current = model, list = () => [model, spark] } = {}) {
  const handlers = new Map();
  const listeners = new Set();
  const pending = [];
  const writes = [];
  const calls = { fetch: 0, read: 0, list: 0 };
  const context = (active = current) => {
    const timers = new Map();
    const statuses = [];
    const ctx = {
      model: active,
      models: { current: () => ctx.model, list: () => { calls.list++; return list(); } },
      ui: { setStatus: (key, line) => statuses.push({ key, line }) },
      setInterval: (callback, ms) => { timers.set(ms, callback); return ms; },
      clearTimer: (timer) => timers.delete(timer),
    };
    return { ctx, timers, statuses };
  };
  const { ctx, timers, statuses } = context();
  usageRemaining({ on: (event, handler) => handlers.set(event, handler) }, {
    isNativeRendering: () => native,
    onNativeRenderingChange: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    fetchUsageJson: () => {
      calls.fetch++;
      return new Promise((resolve) => pending.push(resolve));
    },
    readLines: () => { calls.read++; return cache; },
    writeLines: (state) => writes.push({ data: state.data, dataAt: state.dataAt, models: state.models }),
  });
  return {
    ctx, timers, statuses, writes, calls, listeners, context,
    emit: (event, target = ctx) => handlers.get(event)?.({}, target),
    poll: () => timers.get(Math.max(...timers.keys()))(),
    checkModel: () => timers.get(Math.min(...timers.keys()))(),
    complete: (data) => pending.shift()(data),
    native: (on) => { native = on; for (const listener of listeners) listener(on); },
  };
}

const settle = () => Bun.sleep(0);
const freshCache = (line = "Codex 5h ████░░░░ 50% left") => ({
  generatedAt: Date.now(),
  models: { Main: { line, resets: [] } },
  providers: { "openai-codex": { label: "Codex", line, resets: [] } },
});

function expectAvailability(line) {
  expect(typeof line).toBe("string");
  expect(line.length).toBeGreaterThan(0);
  expect(percentages(line)).toEqual([]);
}

test("ordinary terminal sessions never read, fetch, list, schedule, write, or publish quota status", async () => {
  const s = session({ native: false, cache: freshCache() });
  expect(s.emit("session_start")).toBeUndefined();
  s.emit("turn_end");
  s.emit("retry_fallback_applied");
  await settle();
  expect(s.calls).toEqual({ fetch: 0, read: 0, list: 0 });
  expect(s.timers.size).toBe(0);
  expect(s.statuses).toEqual([]);
  expect(s.writes).toEqual([]);
  s.emit("session_shutdown");
  expect(s.listeners.size).toBe(0);
});

test("default runtime shares the CLI's native capability and paints cache before provider I/O", async () => {
  const home = fs.mkdtempSync(join(tmpdir(), "omp-native-usage-"));
  try {
    const cacheDir = join(home, ".omp", "cache");
    fs.mkdirSync(cacheDir, { recursive: true });
    const cache = freshCache("Codex 5h ██████░░ 80% left");
    fs.writeFileSync(join(cacheDir, "usage-remaining.json"), JSON.stringify(cache));
    const child = Bun.spawn([process.execPath, "--eval", `
      import assert from "node:assert/strict";
      import { isNativeRendering, setNativeRendering } from ${JSON.stringify(Bun.resolveSync("@oh-my-pi/pi-tui/native/state", cliRoot))};
      import usageRemaining from ${JSON.stringify(Bun.resolveSync("../omp/extensions/usage-remaining.js", import.meta.dir))};
      const handlers = new Map(), timers = new Set(), statuses = [];
      usageRemaining({ on: (event, handler) => handlers.set(event, handler) });
      const terminal = new Proxy({}, { get(_target, key) {
        throw new Error("Terminal quota work: " + String(key));
      } });
      setNativeRendering(false);
      for (const event of ["session_start", "turn_end", "retry_fallback_applied", "session_shutdown"])
        handlers.get(event)({}, terminal);
      setNativeRendering(true);
      assert.equal(isNativeRendering(), true);
      const ctx = {
        model: ${JSON.stringify(model)},
        models: { list: () => new Promise(() => {}) },
        ui: { setStatus: (_key, line) => statuses.push(line) },
        setInterval: (callback) => { timers.add(callback); return callback; },
        clearTimer: (timer) => timers.delete(timer),
      };
      assert.equal(handlers.get("session_start")({}, ctx), undefined);
      assert.equal(statuses.at(-1), ${JSON.stringify(cache.models.Main.line)});
      assert.ok(timers.size > 0);
      setNativeRendering(false);
      assert.equal(statuses.at(-1), undefined);
      assert.equal(timers.size, 0);
      handlers.get("session_shutdown")({}, ctx);
    `], { env: { ...process.env, HOME: home, TERM_PROGRAM: "Tern" }, stdout: "ignore", stderr: "pipe" });
    const stderr = await new Response(child.stderr).text();
    expect({ exitCode: await child.exited, stderr }).toEqual({ exitCode: 0, stderr: "" });
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test("native startup publishes fresh cached model quotas synchronously before a slow fetch", async () => {
  const cache = freshCache();
  const s = session({ cache });
  expect(s.emit("session_start")).toBeUndefined();
  expect(s.statuses.at(-1)).toEqual({ key: "usage-remaining", line: cache.models.Main.line });
  expect(s.timers.size).toBeGreaterThan(0);
  await settle();
  expect(s.calls.fetch).toBe(1);
  expect(s.emit("turn_end")).toBeUndefined();
  expect(s.statuses.at(-1).line).toBe(cache.models.Main.line);
  s.emit("session_shutdown");
});

test("poll, turn, and model triggers share one fetch and reuse the model inventory", async () => {
  const s = session();
  s.emit("session_start");
  await settle();
  s.emit("turn_end");
  s.poll();
  s.ctx.model = spark;
  s.checkModel();
  expect(s.calls).toEqual({ fetch: 1, read: 1, list: 1 });
  s.complete({ reports: [report([limit("base", "5h", 0.25)])] });
  await settle();
  expect(s.statuses.at(-1).line).toContain("75% left");
  expect(s.writes).toHaveLength(1);
  s.emit("turn_end");
  await settle();
  expect(s.calls.fetch).toBe(2);
  expect(s.calls.list).toBe(1);
  s.complete(null);
  await settle();
  expect(s.writes).toHaveLength(1);
  expect(s.statuses.at(-1).line).toContain("75% left");
  s.emit("session_shutdown");
});

test("late native negotiation activates quota work and losing the surface stops it", async () => {
  const s = session({ native: false, cache: freshCache() });
  s.emit("session_start");
  s.native(true);
  expect(s.statuses.at(-1).line).toContain("50% left");
  await settle();
  expect(s.calls.fetch).toBe(1);
  s.native(false);
  expect(s.timers.size).toBe(0);
  expect(s.statuses.at(-1).line).toBeUndefined();
  s.complete({ reports: [report([limit("base", "5h", 0.25)])] });
  await settle();
  s.emit("turn_end");
  expect(s.calls.fetch).toBe(1);
  expect(s.writes).toEqual([]);
  s.emit("session_shutdown");
  expect(s.listeners.size).toBe(0);
});

test("a provider without quotas exposes only truthful availability, not another provider's percentages", async () => {
  const s = session({ current: { provider: "other", id: "other", name: "Other" }, cache: freshCache() });
  s.emit("session_start");
  expectAvailability(s.statuses.at(-1).line);
  await settle();
  s.complete({ reports: [report([limit("base", "5h", 0.25)])] });
  await settle();
  expectAvailability(s.statuses.at(-1).line);
  expect(lineFor(s.writes[0].data.reports, "other", "other", index)).toBe("");
  s.emit("session_shutdown");
});

test("expired cached lines are not shown or renewed by failed refreshes", async () => {
  const cache = freshCache();
  const s = session({ cache });
  s.emit("session_start");
  expect(s.statuses.at(-1).line).toContain("50% left");
  cache.generatedAt = Date.now() - 10 * 60_000 - 1;
  s.checkModel();
  expect(s.statuses.at(-1).line).toBeUndefined();
  await settle();
  s.complete(null);
  await settle();
  expect(s.statuses.at(-1).line).toBeUndefined();
  expect(s.writes).toEqual([]);
  s.emit("session_shutdown");
});

test("missing model inventory still publishes provider quotas; old native reports stay expired", async () => {
  const s = session({ list: () => { throw new Error("model inventory unavailable"); } });
  s.emit("session_start");
  await settle();
  s.complete({ reports: [report([limit("base", "5h", 0.25)])] });
  await settle();
  expect(s.writes).toHaveLength(1);
  expect(s.writes[0].models).toBeNull();
  expect(s.statuses.at(-1).line).toContain("75% left");
  s.emit("turn_end");
  await settle();
  s.complete({ reports: [{ ...report([limit("old", "5h", 0)]), fetchedAt: Date.now() - 10 * 60_000 - 1 }] });
  await settle();
  expect(s.statuses.at(-1).line).toBeUndefined();
  s.emit("session_shutdown");
});

test("an explicitly empty cached model scope never inherits its provider's unfiltered quotas", () => {
  const cache = freshCache();
  cache.models.Main.line = "";
  const s = session({ cache });
  s.emit("session_start");
  expectAvailability(s.statuses.at(-1).line);
  s.emit("session_shutdown");
});

test("repeated session_start retires old timers and in-flight results before painting the new context", async () => {
  const cache = freshCache();
  cache.models.Spark = { line: "Codex 5h ██████░░ 75% left", resets: [] };
  const s = session({ cache });
  s.emit("session_start");
  await settle();
  const oldStatuses = s.statuses.length;
  const oldTimers = [...s.timers.values()];
  const next = s.context(spark);
  expect(s.emit("session_start", next.ctx)).toBeUndefined();
  expect(s.timers.size).toBe(0);
  expect(s.listeners.size).toBe(1);
  expect(next.timers.size).toBeGreaterThan(0);
  expect(next.statuses.at(-1).line).toBe(cache.models.Spark.line);
  await settle();
  const newStatuses = next.statuses.length;
  s.complete({ reports: [report([limit("old", "5h", 0.9)])] });
  await settle();
  for (const callback of oldTimers) callback();
  expect(s.writes).toEqual([]);
  expect(s.statuses).toHaveLength(oldStatuses);
  expect(next.statuses).toHaveLength(newStatuses);
  s.complete({ reports: [report([limit("new", "5h", 0.1)])] });
  await settle();
  expect(s.writes).toHaveLength(1);
  expect(percentages(next.statuses.at(-1).line)).toEqual([90]);
  s.emit("session_shutdown", next.ctx);
  expect(next.timers.size).toBe(0);
  expect(s.listeners.size).toBe(0);
});

test("shutdown clears session timers and ignores a provider fetch completing afterward", async () => {
  const s = session({ cache: freshCache() });
  s.emit("session_start");
  await settle();
  const statuses = s.statuses.length;
  const timers = [...s.timers.values()];
  s.emit("session_shutdown");
  expect(s.timers.size).toBe(0);
  expect(s.listeners.size).toBe(0);
  s.complete({ reports: [report([limit("late", "5h", 0.1)])] });
  await settle();
  for (const callback of timers) callback();
  s.emit("turn_end");
  s.emit("retry_fallback_applied");
  expect(s.calls.fetch).toBe(1);
  expect(s.writes).toEqual([]);
  expect(s.statuses).toHaveLength(statuses);
});
