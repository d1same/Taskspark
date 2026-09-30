import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import { createApp } from "../server.mjs";

const headers = {
  "content-type": "application/json",
  "x-taskspark": "1",
};

function tokenFrom(res) {
  const raw = res.headers.getSetCookie()[0] || "";
  const match = /taskspark=([^;]+)/.exec(raw);
  assert.ok(match, raw);
  return decodeURIComponent(match[1]);
}

async function api(url, path, { method = "GET", token, body, proto, ua } = {}) {
  const res = await fetch(url + path, {
    method,
    headers: {
      ...(body !== undefined || method !== "GET" ? headers : {}),
      ...(token ? { cookie: `taskspark=${token}` } : {}),
      ...(proto ? { "x-forwarded-proto": proto } : {}),
      ...(ua ? { "user-agent": ua } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    json = null;
  }
  return { res, text, json };
}

test("an unapproved device cannot read or write, and the code is not stored in plain text", async () => {
  const dir = mkdtempSync(join(tmpdir(), "taskspark-"));
  const app = createApp({
    dataFile: join(dir, "taskspark.sqlite"),
    attemptLimit: 3,
    attemptWindowMs: 60_000,
  });
  const { url } = await app.listen();
  try {
    const fresh = await api(url, "/api/state");
    assert.equal(fresh.res.status, 200);
    assert.deepEqual(fresh.json, { phase: "setup" });

    const extra = await api(url, "/api/setup", { method: "POST", body: { code: "river-stone", confirm: "river-stone", role: "admin" } });
    assert.equal(extra.res.status, 400);
    assert.deepEqual(await (await api(url, "/api/state")).json, { phase: "setup" });

    const setup = await api(url, "/api/setup", {
      method: "POST",
      proto: "https",
      body: { code: "river-stone", confirm: "river-stone" },
    });
    assert.equal(setup.res.status, 200);
    assert.equal(setup.json.phase, "board");
    const cookie = setup.res.headers.getSetCookie()[0];
    assert.match(cookie, /HttpOnly/);
    assert.match(cookie, /Secure/);
    assert.match(cookie, /SameSite=Lax/);
    const owner = tokenFrom(setup.res);
    assert.equal(setup.json.members.length, 0);
    assert.equal(setup.text.includes("river-stone"), false);

    const fern = await api(url, "/api/members", {
      method: "POST",
      token: owner,
      body: { name: "Fern", color: "#6f8f78" },
    });
    const reed = await api(url, "/api/members", {
      method: "POST",
      token: owner,
      body: { name: "Reed", color: "#4e7c8a" },
    });
    const fernId = fern.json.members.find((member) => member.name === "Fern").id;
    const reedId = reed.json.members.find((member) => member.name === "Reed").id;
    const created = await api(url, "/api/tasks", {
      method: "POST",
      token: owner,
      body: { title: "Fold towels", points: 5, assigneeId: fernId, bucket: "today", repeat: "none" },
    });
    const taskId = created.json.tasks[0].id;

    const page = await api(url, "/");
    assert.equal(page.text.includes("Fern"), false);
    assert.equal(page.text.includes("Fold towels"), false);
    assert.equal(page.text.includes("river-stone"), false);

    const stranger = await api(url, "/api/state");
    assert.equal(stranger.res.status, 401);
    assert.deepEqual(stranger.json, { phase: "locked" });
    assert.equal(stranger.text.includes("Fern"), false);
    assert.equal(stranger.text.includes("Fold towels"), false);

    const wrong = await api(url, "/api/unlock", { method: "POST", body: { code: "nope-nope" } });
    assert.equal(wrong.res.status, 401);
    assert.deepEqual(wrong.json, { phase: "locked" });
    assert.equal(wrong.text.includes("Fern"), false);

    const pendingRes = await api(url, "/api/unlock", { method: "POST", body: { code: "river-stone" } });
    assert.equal(pendingRes.res.status, 200);
    assert.deepEqual(pendingRes.json, { phase: "waiting" });
    assert.equal(pendingRes.text.includes("Fern"), false);
    assert.equal(pendingRes.text.includes("Fold towels"), false);
    const guest = tokenFrom(pendingRes.res);

    const guestRead = await api(url, "/api/state", { token: guest });
    assert.equal(guestRead.res.status, 401);
    assert.deepEqual(guestRead.json, { phase: "waiting" });
    assert.equal(guestRead.text.includes("Fern"), false);

    const guestWrite = await api(url, "/api/tasks", {
      method: "POST",
      token: guest,
      body: { title: "Sneak", points: 5, assigneeId: null, bucket: "today", repeat: "none" },
    });
    assert.equal(guestWrite.res.status, 401);
    assert.deepEqual(guestWrite.json, { phase: "waiting" });

    const devices = await api(url, "/api/devices", { token: owner });
    const guestDevice = devices.json.devices.find((device) => device.status === "pending");
    const selfApprove = await api(url, `/api/devices/${guestDevice.id}/approve`, {
      method: "POST",
      token: guest,
      body: {},
    });
    assert.equal(selfApprove.res.status, 401);
    assert.deepEqual(selfApprove.json, { phase: "waiting" });
    const stillPending = await api(url, "/api/devices", { token: owner });
    assert.equal(stillPending.json.devices.find((device) => device.id === guestDevice.id).status, "pending");

    await api(url, `/api/devices/${guestDevice.id}/approve`, { method: "POST", token: owner, body: {} });
    const opened = await api(url, "/api/state", { token: guest });
    assert.equal(opened.res.status, 200);
    assert.equal(opened.json.tasks[0].title, "Fold towels");

    const done = await api(url, `/api/tasks/${taskId}/complete`, {
      method: "POST",
      token: guest,
      body: { memberId: reedId },
    });
    assert.equal(done.json.leaderboard.allTime.find((row) => row.name === "Fern").points, 0);
    assert.equal(done.json.leaderboard.allTime.find((row) => row.name === "Reed").points, 5);
    assert.equal(done.json.leaderboard.week.find((row) => row.name === "Reed").points, 5);
    const awardId = done.json.completed[0].id;

    const undone = await api(url, `/api/awards/${awardId}/undo`, { method: "POST", token: guest, body: {} });
    assert.equal(undone.json.leaderboard.allTime.find((row) => row.name === "Reed").points, 0);
    const again = await api(url, `/api/tasks/${taskId}/complete`, {
      method: "POST",
      token: guest,
      body: { memberId: reedId },
    });
    const second = again.json.completed[0].id;
    const moved = await api(url, `/api/awards/${second}/member`, {
      method: "POST",
      token: guest,
      body: { memberId: fernId },
    });
    assert.equal(moved.json.leaderboard.allTime.find((row) => row.name === "Fern").points, 5);
    assert.equal(moved.json.leaderboard.allTime.find((row) => row.name === "Reed").points, 0);

    await api(url, `/api/devices/${guestDevice.id}/revoke`, { method: "POST", token: owner, body: {} });
    const revoked = await api(url, "/api/state", { token: guest });
    assert.equal(revoked.res.status, 401);
    assert.deepEqual(revoked.json, { phase: "waiting" });
    assert.equal(revoked.text.includes("Fern"), false);
    const revokedWrite = await api(url, "/api/members", {
      method: "POST",
      token: guest,
      body: { name: "Ghost", color: "#c56a4a" },
    });
    assert.equal(revokedWrite.res.status, 401);
    const after = await api(url, "/api/state", { token: owner });
    assert.equal(after.json.members.some((member) => member.name === "Ghost"), false);

    await api(url, "/api/unlock", { method: "POST", body: { code: "wrong-one" } });
    await api(url, "/api/unlock", { method: "POST", body: { code: "wrong-two" } });
    await api(url, "/api/unlock", { method: "POST", body: { code: "wrong-three" } });
    const blocked = await api(url, "/api/unlock", { method: "POST", body: { code: "river-stone" } });
    assert.equal(blocked.res.status, 401);
    assert.deepEqual(blocked.json, { phase: "locked" });
    assert.equal(blocked.text.includes("Fern"), false);

    const injected = await api(url, "/api/tasks", {
      method: "POST",
      token: owner,
      body: { title: "Fold'); DROP TABLE tasks;--", points: 5, assigneeId: null, bucket: "later", repeat: "none" },
    });
    assert.equal(injected.res.status, 200);
    assert.equal(injected.json.tasks.some((task) => task.title.includes("DROP TABLE")), true);

    const huge = await api(url, "/api/members", {
      method: "POST",
      token: owner,
      body: { name: "F".repeat(41), color: "#c56a4a" },
    });
    assert.equal(huge.res.status, 400);
    assert.deepEqual(huge.json, { error: "rejected" });
  } finally {
    app.close();
  }

  const saved = new DatabaseSync(join(dir, "taskspark.sqlite"));
  const row = saved.prepare("SELECT code_hash, code_salt FROM settings WHERE id = 1").get();
  assert.ok(row.code_hash);
  assert.notEqual(row.code_hash, "river-stone");
  assert.notEqual(row.code_salt, "river-stone");
  assert.equal(saved.prepare("SELECT count(*) AS n FROM tasks").get().n > 0, true);
  saved.close();
});

test("a task worth 20 awards 20, and a reset keeps the closed winner without deleting completions", async () => {
  const dir = mkdtempSync(join(tmpdir(), "taskspark-"));
  const app = createApp({ dataFile: join(dir, "board.sqlite") });
  const { url } = await app.listen();
  try {
    const setup = await api(url, "/api/setup", {
      method: "POST",
      body: { code: "quiet-lake", confirm: "quiet-lake" },
    });
    const owner = tokenFrom(setup.res);
    const member = await api(url, "/api/members", {
      method: "POST",
      token: owner,
      body: { name: "Fern", color: "#d4a054" },
    });
    const fernId = member.json.members[0].id;
    const rejected = await api(url, "/api/tasks", {
      method: "POST",
      token: owner,
      body: { title: "Typed", points: 50, assigneeId: fernId, bucket: "today", repeat: "none" },
    });
    assert.equal(rejected.res.status, 400);
    const multiplied = await api(url, "/api/tasks", {
      method: "POST",
      token: owner,
      body: { title: "Sweep", points: 20, assigneeId: fernId, bucket: "today", repeat: "none", weight: "big" },
    });
    assert.equal(multiplied.res.status, 400);
    const created = await api(url, "/api/tasks", {
      method: "POST",
      token: owner,
      body: { title: "Sweep", points: 20, assigneeId: fernId, bucket: "today", repeat: "none" },
    });
    assert.equal(created.json.tasks[0].score, 20);
    const taskId = created.json.tasks[0].id;
    const done = await api(url, `/api/tasks/${taskId}/complete`, {
      method: "POST",
      token: owner,
      body: { memberId: fernId },
    });
    assert.equal(done.json.leaderboard.allTime[0].points, 20);
    assert.equal(done.json.completed[0].points, 20);
    const reset = await api(url, "/api/reset-now", { method: "POST", token: owner, body: {} });
    assert.equal(reset.json.periods[0].memberName, "Fern");
    assert.equal(reset.json.periods[0].points, 20);
    assert.equal(reset.json.completed.length, 1);
    assert.equal(reset.json.leaderboard.allTime[0].points, 20);
    assert.equal(reset.json.leaderboard.period[0].points, 0);
    const twice = await api(url, `/api/tasks/${taskId}/complete`, {
      method: "POST",
      token: owner,
      body: { memberId: fernId },
    });
    assert.equal(twice.res.status, 400);
    assert.equal(twice.json.error, "rejected");
  } finally {
    app.close();
  }
});

test("logs skip the household code and record unlock failures", async () => {
  const lines = [];
  const write = process.stdout.write.bind(process.stdout);
  process.stdout.write = (chunk, encoding, callback) => {
    lines.push(String(chunk));
    return write(chunk, encoding, callback);
  };
  const dir = mkdtempSync(join(tmpdir(), "taskspark-"));
  const secret = "pond-light";
  const app = createApp({
    dataFile: join(dir, "taskspark.sqlite"),
    attemptLimit: 1,
    attemptWindowMs: 60_000,
  });
  const { url } = await app.listen();
  try {
    const setup = await api(url, "/api/setup", {
      method: "POST",
      body: { code: secret, confirm: secret },
    });
    const owner = tokenFrom(setup.res);
    const pending = await api(url, "/api/unlock", { method: "POST", body: { code: secret } });
    const guest = tokenFrom(pending.res);
    const devices = await api(url, "/api/devices", { token: owner });
    const guestId = devices.json.devices.find((device) => device.status !== "approved").id;
    const approved = await api(url, `/api/devices/${guestId}/approve`, { method: "POST", token: owner, body: {} });
    assert.equal(approved.res.status, 200);
    const revoked = await api(url, `/api/devices/${guestId}/revoke`, { method: "POST", token: owner, body: {} });
    assert.equal(revoked.res.status, 200);
    const wrong = await api(url, `/api/unlock?code=${secret}`, { method: "POST", body: { code: "nope-nope" } });
    assert.equal(wrong.res.status, 401);
    const limited = await api(url, "/api/unlock", { method: "POST", body: { code: secret } });
    assert.equal(limited.res.status, 401);
    const text = lines.join("");
    assert.equal(text.includes(secret), false);
    assert.equal(text.includes("nope-nope"), false);
    assert.equal(text.includes("?code="), false);
    assert.match(text, /error unlock failed/);
    assert.match(text, /error unlock rate-limited/);
    assert.match(text, /info POST \/api\/unlock 401/);
    assert.match(text, /info device approve/);
    assert.match(text, /info device revoke/);
    assert.equal(text.includes(guest), false);
    assert.equal(text.includes(owner), false);
  } finally {
    process.stdout.write = write;
    app.close();
  }
});

test("a joined phone shows its browser, and an approved phone can name it", async () => {
  const lines = [];
  const write = process.stdout.write.bind(process.stdout);
  process.stdout.write = (chunk, encoding, callback) => {
    lines.push(String(chunk));
    return write(chunk, encoding, callback);
  };
  const dir = mkdtempSync(join(tmpdir(), "taskspark-"));
  const app = createApp({ dataFile: join(dir, "board.sqlite") });
  const { url } = await app.listen();
  const iphone = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1";
  try {
    const setup = await api(url, "/api/setup", {
      method: "POST",
      ua: "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_5) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15",
      body: { code: "meadow-path", confirm: "meadow-path" },
    });
    const owner = tokenFrom(setup.res);
    const pending = await api(url, "/api/unlock", {
      method: "POST",
      ua: iphone,
      body: { code: "meadow-path" },
    });
    const guest = tokenFrom(pending.res);
    const devices = await api(url, "/api/devices", { token: owner });
    const phone = devices.json.devices.find((device) => device.status === "pending");
    assert.equal(phone.kind, "iPhone · Safari");
    assert.equal(phone.label, "iPhone · Safari");
    assert.equal(phone.name, null);
    assert.equal(JSON.stringify(devices.json).includes("Mozilla"), false);
    assert.equal(JSON.stringify(devices.json).includes(guest), false);
    const named = await api(url, `/api/devices/${phone.id}/name`, {
      method: "POST",
      token: owner,
      body: { name: "Moe's phone" },
    });
    const saved = named.json.devices.find((device) => device.id === phone.id);
    assert.equal(named.res.status, 200);
    assert.equal(saved.name, "Moe's phone");
    assert.equal(saved.label, "Moe's phone");
    assert.equal(saved.kind, "iPhone · Safari");
    const mac = named.json.devices.find((device) => device.status === "approved");
    assert.equal(mac.kind, "Mac · Safari");
    const text = lines.join("");
    assert.equal(text.includes("meadow-path"), false);
    assert.equal(text.includes(owner), false);
    assert.equal(text.includes(guest), false);
    assert.equal(text.includes(iphone), false);
    assert.match(text, /info device rename/);
  } finally {
    process.stdout.write = write;
    app.close();
  }
});

test("a reward spends the points that person has earned", async () => {
  const lines = [];
  const write = process.stdout.write.bind(process.stdout);
  process.stdout.write = (chunk, encoding, callback) => {
    lines.push(String(chunk));
    return write(chunk, encoding, callback);
  };
  const dir = mkdtempSync(join(tmpdir(), "taskspark-"));
  const app = createApp({ dataFile: join(dir, "board.sqlite") });
  const { url } = await app.listen();
  try {
    const setup = await api(url, "/api/setup", {
      method: "POST",
      body: { code: "harbor-light", confirm: "harbor-light" },
    });
    const owner = tokenFrom(setup.res);
    const member = await api(url, "/api/members", {
      method: "POST",
      token: owner,
      body: { name: "Ada", color: "#c56a4a" },
    });
    const person = member.json.members[0];
    const task = await api(url, "/api/tasks", {
      method: "POST",
      token: owner,
      body: { title: "Dishes", points: 20, assigneeId: null, bucket: "today", repeat: "none" },
    });
    const id = task.json.tasks.find((row) => row.title === "Dishes").id;
    await api(url, `/api/tasks/${id}/complete`, {
      method: "POST",
      token: owner,
      body: { memberId: person.id },
    });
    const added = await api(url, "/api/rewards", {
      method: "POST",
      token: owner,
      body: { title: "Movie pick", detail: "They choose the film", cost: 20, category: "privilege" },
    });
    assert.equal(added.res.status, 200);
    const reward = added.json.rewards[0];
    const broke = await api(url, `/api/rewards/${reward.id}/claim`, {
      method: "POST",
      token: owner,
      body: { memberId: person.id, cost: 5 },
    });
    assert.equal(broke.res.status, 400);
    const claimed = await api(url, `/api/rewards/${reward.id}/claim`, {
      method: "POST",
      token: owner,
      body: { memberId: person.id },
    });
    assert.equal(claimed.res.status, 200);
    assert.equal(claimed.json.redemptions[0].cost, 20);
    assert.equal(claimed.json.redemptions[0].memberName, "Ada");
    const again = await api(url, `/api/rewards/${reward.id}/claim`, {
      method: "POST",
      token: owner,
      body: { memberId: person.id },
    });
    assert.equal(again.res.status, 400);
    const text = lines.join("");
    assert.equal(text.includes("harbor-light"), false);
    assert.equal(text.includes("Movie pick"), false);
    assert.match(text, /info reward claim/);
  } finally {
    process.stdout.write = write;
    app.close();
  }
});
