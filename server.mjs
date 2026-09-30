import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { PALETTE, openDatabase } from "./db.mjs";

const ROOT = join(fileURLToPath(new URL(".", import.meta.url)), "public");
const FILES = new Map([
  ["/", ["index.html", "text/html; charset=utf-8"]],
  ["/index.html", ["index.html", "text/html; charset=utf-8"]],
  ["/app.css", ["app.css", "text/css; charset=utf-8"]],
  ["/app.js", ["app.js", "text/javascript; charset=utf-8"]],
  ["/icons.js", ["icons.js", "text/javascript; charset=utf-8"]],
  ["/sw.js", ["sw.js", "text/javascript; charset=utf-8"]],
  ["/manifest.webmanifest", ["manifest.webmanifest", "application/manifest+json"]],
  ["/theme.js", ["theme.js", "text/javascript; charset=utf-8"]],
  ["/icon-192.png", ["icon-192.png", "image/png"]],
  ["/icon-512.png", ["icon-512.png", "image/png"]],
]);

const PHASE = {
  setup: { phase: "setup" },
  locked: { phase: "locked" },
  waiting: { phase: "waiting" },
};

const VERSION = readFileSync(new URL("./VERSION", import.meta.url), "utf8").trim();

function log(level, message) {
  const safe = String(message).replace(/[\u0000-\u001f]/g, " ").slice(0, 300);
  process.stdout.write(`${new Date().toISOString()} ${level} ${safe}\n`);
}

function requestPath(req) {
  const raw = String(req.url || "/");
  const path = raw.split("?")[0].split("#")[0];
  return (path.startsWith("/") ? path : "/").slice(0, 200);
}

function bad(status = 400) {
  const error = new Error("rejected");
  error.status = status;
  error.body = status === 401 ? PHASE.locked : { error: "rejected" };
  return error;
}

function isHttps(req) {
  if (req.socket?.encrypted) return true;
  const proto = String(req.headers["x-forwarded-proto"] || "").split(",")[0].trim().toLowerCase();
  return proto === "https";
}

function cookieToken(req) {
  const raw = req.headers.cookie || "";
  for (const part of raw.split(";")) {
    const [name, ...rest] = part.trim().split("=");
    if (name === "taskspark") return decodeURIComponent(rest.join("="));
  }
  return "";
}

function send(res, status, body, extra = {}) {
  const payload = Buffer.from(JSON.stringify(body).replace(/</g, "\\u003c"));
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": payload.length,
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "no-referrer",
    "Content-Security-Policy": "default-src 'self'; style-src 'self'; img-src 'self'; script-src 'self'; manifest-src 'self'; connect-src 'self'; base-uri 'none'; form-action 'self'",
    "X-Frame-Options": "SAMEORIGIN",
    ...extra,
  });
  res.end(payload);
}

function cookieHeader(token, req) {
  const secure = isHttps(req) ? "; Secure" : "";
  return `taskspark=${encodeURIComponent(token)}; HttpOnly; SameSite=Lax; Path=/; Max-Age=34560000${secure}`;
}

function clearCookie(req) {
  const secure = isHttps(req) ? "; Secure" : "";
  return `taskspark=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0${secure}`;
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > 8192) {
        reject(bad());
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", () => reject(bad()));
  });
}

async function readJson(req, allowed) {
  if (req.headers["x-taskspark"] !== "1") throw bad();
  const type = String(req.headers["content-type"] || "");
  if (!type.startsWith("application/json")) throw bad();
  const raw = await readBody(req);
  let data;
  try {
    data = raw ? JSON.parse(raw) : {};
  } catch {
    throw bad();
  }
  if (!data || typeof data !== "object" || Array.isArray(data)) throw bad();
  for (const key of Object.keys(data)) {
    if (!allowed.includes(key)) throw bad();
  }
  return data;
}

function text(value, max) {
  if (typeof value !== "string") return null;
  const cleaned = value.replace(/\s+/g, " ").trim();
  if (!cleaned || cleaned.length > max) return null;
  if (/[\u0000-\u001f]/.test(cleaned)) return null;
  return cleaned;
}

function codeText(value) {
  if (typeof value !== "string") return null;
  const cleaned = value.trim();
  if (cleaned.length < 4 || cleaned.length > 64) return null;
  if (/[\u0000-\u001f]/.test(cleaned)) return null;
  return cleaned;
}

function pointsOf(value) {
  if (value !== 5 && value !== 10 && value !== 20) return null;
  return value;
}

function optionalId(value) {
  if (value === null) return null;
  if (typeof value !== "string" || value.length < 8 || value.length > 80) return null;
  return value;
}

function clientIp(req) {
  return req.socket?.remoteAddress || "local";
}

export function createApp({ dataFile, attemptLimit = 20, attemptWindowMs = 15 * 60 * 1000, now = () => new Date() } = {}) {
  let db;
  try {
    db = openDatabase(dataFile);
  } catch {
    log("error", "sqlite open failed");
    throw new Error("sqlite open failed");
  }
  log("info", `sqlite open data=${dirname(dataFile)}`);
  const attempts = new Map();

  function limited(ip) {
    const slot = attempts.get(ip);
    if (!slot || slot.resetAt <= Date.now()) return false;
    return slot.count >= attemptLimit;
  }

  function fail(ip) {
    const current = attempts.get(ip);
    if (!current || current.resetAt <= Date.now()) {
      attempts.set(ip, { count: 1, resetAt: Date.now() + attemptWindowMs });
      return;
    }
    current.count += 1;
  }

  function gate(req) {
    const device = db.deviceByToken(cookieToken(req));
    if (!device) {
      return { device: null, phase: db.hasCode() ? "locked" : "setup" };
    }
    if (device.status !== "approved") return { device, phase: "waiting" };
    return { device, phase: "board" };
  }

  function requireBoard(req) {
    const got = gate(req);
    if (got.phase !== "board") {
      const error = bad(401);
      error.body = PHASE[got.phase] || PHASE.locked;
      throw error;
    }
    return got.device;
  }

  async function handle(req, res) {
    const url = new URL(req.url || "/", "http://localhost");
    const path = url.pathname;
    if (req.method === "GET" && FILES.has(path)) {
      const [name, type] = FILES.get(path);
      const file = readFileSync(join(ROOT, name));
      res.writeHead(200, {
        "Content-Type": type,
        "Content-Length": file.length,
        "X-Content-Type-Options": "nosniff",
        "Referrer-Policy": "no-referrer",
        "Content-Security-Policy":
          "default-src 'self'; style-src 'self'; img-src 'self'; script-src 'self'; manifest-src 'self'; connect-src 'self'; base-uri 'none'; form-action 'self'",
        "X-Frame-Options": "SAMEORIGIN",
        "Cache-Control": name === "sw.js" || name === "index.html" ? "no-cache" : "public, max-age=300",
      });
      res.end(file);
      return;
    }

    const clock = now();
    const ip = clientIp(req);

    if (req.method === "GET" && path === "/api/state") {
      const got = gate(req);
      if (got.phase !== "board") {
        send(res, got.phase === "setup" ? 200 : 401, PHASE[got.phase]);
        return;
      }
      send(res, 200, db.readState(clock), { "Set-Cookie": cookieHeader(cookieToken(req), req) });
      return;
    }

    if (req.method === "POST" && path === "/api/setup") {
      const body = await readJson(req, ["code", "confirm"]);
      const code = codeText(body.code);
      const confirm = codeText(body.confirm);
      if (!code || code !== confirm) {
        log("error", "setup failed");
        throw bad();
      }
      if (db.hasCode()) {
        fail(ip);
        log("error", "setup failed");
        send(res, 401, PHASE.locked);
        return;
      }
      const device = db.setup(code, clock);
      if (!device) {
        log("error", "setup failed");
        send(res, 401, PHASE.locked);
        return;
      }
      send(res, 200, db.readState(clock), { "Set-Cookie": cookieHeader(device.token, req) });
      return;
    }

    if (req.method === "POST" && path === "/api/unlock") {
      const body = await readJson(req, ["code"]);
      if (limited(ip)) {
        log("error", "unlock rate-limited");
        send(res, 401, PHASE.locked);
        return;
      }
      const code = codeText(body.code);
      if (!code || !db.hasCode() || !db.checkCode(code)) {
        fail(ip);
        log("error", "unlock failed");
        send(res, 401, PHASE.locked);
        return;
      }
      const existing = db.deviceByToken(cookieToken(req));
      if (existing?.status === "approved") {
        send(res, 200, db.readState(clock), { "Set-Cookie": cookieHeader(cookieToken(req), req) });
        return;
      }
      if (existing && existing.status !== "approved") {
        send(res, 200, PHASE.waiting, { "Set-Cookie": cookieHeader(cookieToken(req), req) });
        return;
      }
      const device = db.unlock(code, clock);
      if (!device) {
        fail(ip);
        log("error", "unlock failed");
        send(res, 401, PHASE.locked);
        return;
      }
      send(res, 200, PHASE.waiting, { "Set-Cookie": cookieHeader(device.token, req) });
      return;
    }

    if (req.method === "GET" && path === "/api/devices") {
      requireBoard(req);
      send(res, 200, { devices: db.listDevices() });
      return;
    }

    const deviceRoute = path.match(/^\/api\/devices\/([0-9a-f-]{36})\/(approve|revoke)$/);
    if (req.method === "POST" && deviceRoute) {
      await readJson(req, []);
      const actor = requireBoard(req);
      const target = deviceRoute[1];
      const action = deviceRoute[2];
      if (action === "revoke" && target === actor.id) {
        log("error", "device revoke failed");
        throw bad();
      }
      const ok = db.setDeviceStatus(target, action === "approve" ? "approved" : "revoked", clock);
      if (!ok) {
        log("error", `device ${action} failed`);
        throw bad();
      }
      log("info", `device ${action}`);
      send(res, 200, { devices: db.listDevices() });
      return;
    }

    if (req.method === "POST" && path === "/api/members") {
      requireBoard(req);
      const body = await readJson(req, ["name", "color"]);
      const name = text(body.name, 40);
      const color = typeof body.color === "string" ? body.color.toLowerCase() : "";
      if (!name || !PALETTE.includes(color)) throw bad();
      db.addMember(name, color, clock);
      send(res, 200, db.readState(clock));
      return;
    }

    const memberRoute = path.match(/^\/api\/members\/([0-9a-f-]{36})$/);
    if (memberRoute && (req.method === "POST" || req.method === "DELETE")) {
      requireBoard(req);
      if (req.method === "DELETE") {
        await readJson(req, []);
        db.deleteMember(memberRoute[1]);
      } else {
        const body = await readJson(req, ["name", "color"]);
        const name = text(body.name, 40);
        const color = typeof body.color === "string" ? body.color.toLowerCase() : "";
        if (!name || !PALETTE.includes(color)) throw bad();
        if (!db.updateMember(memberRoute[1], name, color)) throw bad();
      }
      send(res, 200, db.readState(clock));
      return;
    }

    if (req.method === "POST" && path === "/api/tasks") {
      requireBoard(req);
      const body = await readJson(req, ["title", "points", "assigneeId", "bucket", "repeat"]);
      const title = text(body.title, 80);
      const points = pointsOf(body.points);
      const assigneeId = optionalId(body.assigneeId);
      const bucket = body.bucket;
      const repeat = body.repeat;
      if (!title || !points) throw bad();
      if (body.assigneeId !== null && !assigneeId) throw bad();
      if (!["today", "tomorrow", "later"].includes(bucket)) throw bad();
      if (!["none", "daily", "weekly"].includes(repeat)) throw bad();
      if (!db.addTask({ title, points, assigneeId, bucket, repeat }, clock)) throw bad();
      send(res, 200, db.readState(clock));
      return;
    }

    if (req.method === "POST" && path === "/api/tasks/reorder") {
      requireBoard(req);
      const body = await readJson(req, ["id", "bucket", "index"]);
      const id = optionalId(body.id);
      if (!id || !["today", "tomorrow", "later"].includes(body.bucket)) throw bad();
      if (typeof body.index !== "number" || !Number.isInteger(body.index) || body.index < 0 || body.index > 500) {
        throw bad();
      }
      db.reorder(id, body.bucket, body.index, clock);
      send(res, 200, db.readState(clock));
      return;
    }

    const taskRoute = path.match(/^\/api\/tasks\/([0-9a-f-]{36})(?:\/(complete))?$/);
    if (taskRoute && req.method === "POST") {
      requireBoard(req);
      if (taskRoute[2] === "complete") {
        const body = await readJson(req, ["memberId"]);
        const memberId = optionalId(body.memberId);
        if (!memberId) throw bad();
        const result = db.complete(taskRoute[1], memberId, clock);
        if (!result.ok) throw bad();
        send(res, 200, { ...db.readState(clock), awarded: result });
        return;
      }
      const body = await readJson(req, ["title", "points", "assigneeId", "bucket", "repeat", "due"]);
      const title = text(body.title, 80);
      const points = pointsOf(body.points);
      const assigneeId = optionalId(body.assigneeId);
      const repeat = body.repeat;
      if (!title || !points || !["none", "daily", "weekly"].includes(repeat)) throw bad();
      if (body.assigneeId !== null && !assigneeId) throw bad();
      if (body.bucket !== undefined && !["today", "tomorrow", "later"].includes(body.bucket)) throw bad();
      let due;
      if (body.due === null) due = null;
      else if (body.due === undefined) due = undefined;
      else if (typeof body.due === "string" && /^\d{4}-\d{2}-\d{2}$/.test(body.due)) due = body.due;
      else throw bad();
      if (!db.updateTask(taskRoute[1], { title, points, assigneeId, bucket: body.bucket, repeat, due }, clock)) {
        throw bad();
      }
      send(res, 200, db.readState(clock));
      return;
    }

    if (taskRoute && req.method === "DELETE") {
      requireBoard(req);
      await readJson(req, []);
      db.deleteTask(taskRoute[1]);
      send(res, 200, db.readState(clock));
      return;
    }

    const awardRoute = path.match(/^\/api\/awards\/([0-9a-f-]{36})\/(undo|member)$/);
    if (awardRoute && req.method === "POST") {
      requireBoard(req);
      if (awardRoute[2] === "undo") {
        await readJson(req, []);
        db.undo(awardRoute[1], clock);
        send(res, 200, db.readState(clock));
        return;
      }
      const body = await readJson(req, ["memberId"]);
      const memberId = optionalId(body.memberId);
      if (!memberId || !db.reassign(awardRoute[1], memberId).ok) throw bad();
      send(res, 200, db.readState(clock));
      return;
    }

    if (req.method === "POST" && path === "/api/timezone") {
      requireBoard(req);
      const body = await readJson(req, ["timezone"]);
      const timezone = text(body.timezone, 80);
      if (!timezone) throw bad();
      try {
        Intl.DateTimeFormat("en-US", { timeZone: timezone });
      } catch {
        throw bad();
      }
      db.setTimezone(timezone);
      send(res, 200, db.readState(clock));
      return;
    }

    if (req.method === "POST" && path === "/api/reset-mode") {
      requireBoard(req);
      const body = await readJson(req, ["resetMode"]);
      if (!["week", "month", "year", "never"].includes(body.resetMode)) throw bad();
      db.setResetMode(body.resetMode, clock);
      send(res, 200, db.readState(clock));
      return;
    }

    if (req.method === "POST" && path === "/api/reset-now") {
      requireBoard(req);
      await readJson(req, []);
      db.resetNow(clock);
      send(res, 200, db.readState(clock));
      return;
    }

    if (req.method === "POST" && path === "/api/weights") {
      requireBoard(req);
      const body = await readJson(req, ["on"]);
      if (typeof body.on !== "boolean") throw bad();
      db.setWeights(body.on);
      send(res, 200, db.readState(clock));
      return;
    }

    if (req.method === "POST" && path === "/api/code") {
      requireBoard(req);
      const body = await readJson(req, ["code", "confirm"]);
      const code = codeText(body.code);
      const confirm = codeText(body.confirm);
      if (!code || code !== confirm) throw bad();
      db.changeCode(code);
      send(res, 200, db.readState(clock));
      return;
    }

    if (req.method === "POST" && path === "/api/wipe") {
      requireBoard(req);
      await readJson(req, []);
      db.wipe();
      send(res, 200, db.readState(clock));
      return;
    }

    if (req.method === "POST" && path === "/api/delete-household") {
      requireBoard(req);
      await readJson(req, []);
      db.deleteHousehold();
      send(res, 200, PHASE.setup, { "Set-Cookie": clearCookie(req) });
      return;
    }

    send(res, 404, { error: "unavailable" });
  }

  const server = createServer((req, res) => {
    const path = requestPath(req);
    res.on("finish", () => {
      log("info", `${req.method || "GET"} ${path} ${res.statusCode}`);
    });
    handle(req, res).catch((error) => {
      if (res.headersSent) return;
      const status = Number(error.status) || 500;
      log("error", status >= 500 ? "request failed" : "request rejected");
      send(res, status, error.body || { error: "unavailable" });
    });
  });

  return {
    server,
    db,
    close() {
      server.close();
      db.close();
    },
    listen(port = 0, host = "127.0.0.1") {
      return new Promise((resolve) => {
        server.listen(port, host, () => {
          const address = server.address();
          resolve({ url: `http://127.0.0.1:${address.port}`, port: address.port });
        });
      });
    },
  };
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isMain) {
  const dataDir = process.env.DATA_DIR || "/data";
  const dataFile = join(dataDir, "taskspark.sqlite");
  const port = Number(process.env.PORT || 7370);
  let app;
  try {
    app = createApp({ dataFile });
  } catch {
    process.exit(1);
  }
  app.listen(port, "0.0.0.0").then(() => {
    log("info", `listening port=${port} version=${VERSION}`);
  });
}
