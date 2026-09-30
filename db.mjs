import { randomBytes, randomUUID, scryptSync, timingSafeEqual, createHash } from "node:crypto";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";
import {
  DEFAULT_TIMEZONE,
  PALETTE,
  autoClose,
  canComplete,
  manualClose,
  moveTask,
  nextDue,
  periodBounds,
  deviceKind,
  projectBoard,
  startOfLocalDay,
  resultingPoints,
  summarize,
} from "./domain.mjs";

const SCHEMA = `
CREATE TABLE IF NOT EXISTS settings (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  timezone TEXT NOT NULL,
  code_salt TEXT,
  code_hash TEXT,
  reset_mode TEXT NOT NULL,
  cutoff TEXT,
  weights_on INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS devices (
  id TEXT PRIMARY KEY,
  token_hash TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL,
  label TEXT NOT NULL,
  kind TEXT,
  name TEXT,
  created_at TEXT NOT NULL,
  approved_at TEXT
);
CREATE TABLE IF NOT EXISTS members (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  color TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS tasks (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  points INTEGER NOT NULL,
  weight TEXT,
  assignee_id TEXT,
  due TEXT,
  position INTEGER NOT NULL,
  repeat TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS awards (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL,
  task_title TEXT NOT NULL,
  member_id TEXT NOT NULL,
  member_name TEXT NOT NULL,
  points INTEGER NOT NULL,
  at TEXT NOT NULL,
  undone_at TEXT,
  due_before TEXT
);
CREATE TABLE IF NOT EXISTS period_wins (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  start_at TEXT NOT NULL,
  end_at TEXT NOT NULL,
  member_id TEXT,
  member_name TEXT,
  points INTEGER NOT NULL,
  tied INTEGER NOT NULL,
  created_at TEXT NOT NULL
);
`;

function hashToken(token) {
  return createHash("sha256").update(token).digest("hex");
}

function hashCode(code, salt) {
  return scryptSync(code, salt, 32).toString("hex");
}

export function openDatabase(file) {
  mkdirSync(dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec("PRAGMA journal_mode = WAL");
  db.exec("PRAGMA busy_timeout = 5000");
  db.exec(SCHEMA);
  const deviceColumns = db.prepare("PRAGMA table_info(devices)").all();
  if (!deviceColumns.some((column) => column.name === "kind")) {
    db.exec("ALTER TABLE devices ADD COLUMN kind TEXT");
  }
  if (!deviceColumns.some((column) => column.name === "name")) {
    db.exec("ALTER TABLE devices ADD COLUMN name TEXT");
  }
  const existing = db.prepare("SELECT id FROM settings WHERE id = 1").get();
  if (!existing) {
    db.prepare(
      "INSERT INTO settings (id, timezone, reset_mode, weights_on) VALUES (1, ?, 'never', 0)",
    ).run(DEFAULT_TIMEZONE);
  }

  function tx(fn) {
    db.exec("BEGIN IMMEDIATE");
    try {
      const result = fn();
      db.exec("COMMIT");
      return result;
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
  }

  function settings() {
    return db.prepare("SELECT * FROM settings WHERE id = 1").get();
  }

  function members() {
    return db.prepare("SELECT id, name, color, created_at AS createdAt FROM members ORDER BY created_at, name").all();
  }

  function tasks() {
    return db
      .prepare(
        `SELECT id, title, points, weight, assignee_id AS assigneeId, due, position, repeat, created_at AS createdAt
         FROM tasks ORDER BY position, id`,
      )
      .all();
  }

  function awards() {
    return db
      .prepare(
        `SELECT id, task_id AS taskId, task_title AS taskTitle, member_id AS memberId, member_name AS memberName,
                points, at, undone_at AS undoneAt, due_before AS dueBefore
         FROM awards ORDER BY at DESC, id`,
      )
      .all();
  }

  function wins() {
    return db
      .prepare(
        `SELECT id, kind, start_at AS startAt, end_at AS endAt, member_id AS memberId, member_name AS memberName,
                points, tied, created_at AS createdAt
         FROM period_wins ORDER BY created_at DESC, id`,
      )
      .all();
  }

  function insertWin(record, nowIso) {
    db.prepare(
      `INSERT INTO period_wins (id, kind, start_at, end_at, member_id, member_name, points, tied, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      randomUUID(),
      record.kind,
      record.startAt,
      record.endAt,
      record.memberId,
      record.memberName,
      record.points,
      record.tied,
      nowIso,
    );
  }

  function closeElapsed(now) {
    const row = settings();
    const closed = autoClose({
      mode: row.reset_mode,
      cutoff: row.cutoff,
      now,
      timeZone: row.timezone,
      awards: awards(),
      members: members(),
    });
    if (!closed) return;
    insertWin(closed.record, now.toISOString());
    db.prepare("UPDATE settings SET cutoff = ? WHERE id = 1").run(closed.cutoff);
  }

  function presentDevice(row) {
    const stored = row.kind || "";
    const kind = stored || (/^Device \d+$/.test(row.label || "") ? "Earlier phone" : row.label || "Unknown browser");
    const name = row.name || null;
    return {
      id: row.id,
      status: row.status,
      name,
      kind,
      label: name || kind,
      createdAt: row.createdAt,
      approvedAt: row.approvedAt,
    };
  }

  function createDevice(status, nowIso, userAgent) {
    const kind = deviceKind(userAgent);
    const id = randomUUID();
    const token = randomBytes(32).toString("base64url");
    db.prepare(
      `INSERT INTO devices (id, token_hash, status, label, kind, name, created_at, approved_at)
       VALUES (?, ?, ?, ?, ?, NULL, ?, ?)`,
    ).run(id, hashToken(token), status, kind, kind, nowIso, status === "approved" ? nowIso : null);
    return { id, token, status, label: kind, kind, name: null };
  }

  return {
    close() {
      db.close();
    },
    file,
    hasCode() {
      return Boolean(settings().code_hash);
    },
    checkCode(code) {
      const row = settings();
      if (!row.code_hash || !row.code_salt) return false;
      const got = Buffer.from(hashCode(code, Buffer.from(row.code_salt, "hex")), "hex");
      const want = Buffer.from(row.code_hash, "hex");
      if (got.length !== want.length) return false;
      return timingSafeEqual(got, want);
    },
    setup(code, now, userAgent) {
      return tx(() => {
        const row = settings();
        if (row.code_hash) return null;
        const salt = randomBytes(16);
        db.prepare("UPDATE settings SET code_salt = ?, code_hash = ? WHERE id = 1").run(
          salt.toString("hex"),
          hashCode(code, salt),
        );
        return createDevice("approved", now.toISOString(), userAgent);
      });
    },
    unlock(code, now, userAgent) {
      if (!this.checkCode(code)) return null;
      return tx(() => createDevice("pending", now.toISOString(), userAgent));
    },
    deviceByToken(token) {
      if (!token) return null;
      return (
        db
          .prepare(
            `SELECT id, status, label, created_at AS createdAt, approved_at AS approvedAt
             FROM devices WHERE token_hash = ?`,
          )
          .get(hashToken(token)) || null
      );
    },
    listDevices() {
      return db
        .prepare(
          `SELECT id, status, label, kind, name, created_at AS createdAt, approved_at AS approvedAt
           FROM devices ORDER BY created_at, id`,
        )
        .all()
        .map(presentDevice);
    },
    renameDevice(id, name) {
      return tx(() => {
        const row = db.prepare("SELECT id FROM devices WHERE id = ?").get(id);
        if (!row) return false;
        db.prepare("UPDATE devices SET name = ? WHERE id = ?").run(name, id);
        return true;
      });
    },
    setDeviceStatus(id, status, now) {
      return tx(() => {
        const row = db.prepare("SELECT id FROM devices WHERE id = ?").get(id);
        if (!row) return false;
        db.prepare("UPDATE devices SET status = ?, approved_at = ? WHERE id = ?").run(
          status,
          status === "approved" ? now.toISOString() : null,
          id,
        );
        return true;
      });
    },
    readState(now) {
      tx(() => closeElapsed(now));
      const row = settings();
      const memberRows = members();
      const awardRows = awards();
      const taskRows = tasks();
      const board = projectBoard(taskRows, awardRows, now, row.timezone);
      const summary = summarize(awardRows, memberRows, now, row.timezone, row.cutoff);
      const withScore = (task) => ({
        ...task,
        score: resultingPoints(task.points, task.weight, row.weights_on === 1),
      });
      return {
        phase: "board",
        timezone: row.timezone,
        today: board.todayDate,
        tomorrow: board.tomorrowDate,
        weightsOn: row.weights_on === 1,
        resetMode: row.reset_mode,
        cutoff: row.cutoff,
        members: memberRows,
        hero: board.hero ? withScore(board.hero) : null,
        todayTasks: board.today.map(withScore),
        tomorrowTasks: board.tomorrow.map(withScore),
        laterTasks: board.later.map(withScore),
        overdue: board.overdue.map(withScore),
        tasks: board.tasks.map(withScore),
        completed: awardRows.filter((award) => !award.undoneAt),
        leaderboard: {
          allTime: summary.allTime,
          week: summary.week,
          month: summary.month,
          year: summary.year,
          period: summary.period,
          lastWeek: summary.lastWeek,
          lastMonth: summary.lastMonth,
        },
        periods: wins(),
      };
    },
    addMember(name, color, now) {
      return tx(() => {
        const id = randomUUID();
        db.prepare("INSERT INTO members (id, name, color, created_at) VALUES (?, ?, ?, ?)").run(
          id,
          name,
          color,
          now.toISOString(),
        );
        return id;
      });
    },
    updateMember(id, name, color) {
      return tx(() => {
        const row = db.prepare("SELECT id FROM members WHERE id = ?").get(id);
        if (!row) return false;
        db.prepare("UPDATE members SET name = ?, color = ? WHERE id = ?").run(name, color, id);
        db.prepare("UPDATE awards SET member_name = ? WHERE member_id = ?").run(name, id);
        db.prepare("UPDATE period_wins SET member_name = ? WHERE member_id = ?").run(name, id);
        return true;
      });
    },
    deleteMember(id) {
      return tx(() => {
        db.prepare("UPDATE tasks SET assignee_id = NULL WHERE assignee_id = ?").run(id);
        db.prepare("DELETE FROM members WHERE id = ?").run(id);
        return true;
      });
    },
    addTask(input, now) {
      return tx(() => {
        if (input.assigneeId && !db.prepare("SELECT id FROM members WHERE id = ?").get(input.assigneeId)) return null;
        const row = settings();
        const bounds = periodBounds(now, row.timezone);
        let due = null;
        if (input.bucket === "today") due = bounds.today;
        else if (input.bucket === "tomorrow") due = bounds.tomorrow;
        const bucket = input.bucket === "tomorrow" ? "tomorrow" : input.bucket === "later" ? "later" : "today";
        const siblings = tasks().filter((task) => {
          const taskBucket = !task.due ? "later" : task.due === bounds.today ? "today" : task.due === bounds.tomorrow ? "tomorrow" : task.due < bounds.today ? "overdue" : "later";
          return taskBucket === bucket;
        });
        const position = siblings.reduce((max, task) => Math.max(max, task.position), -1) + 1;
        const id = randomUUID();
        db.prepare(
          `INSERT INTO tasks (id, title, points, weight, assignee_id, due, position, repeat, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        ).run(id, input.title, input.points, null, input.assigneeId, due, position, input.repeat, now.toISOString());
        return id;
      });
    },
    updateTask(id, input, now) {
      return tx(() => {
        if (input.assigneeId && !db.prepare("SELECT id FROM members WHERE id = ?").get(input.assigneeId)) return false;
        const current = db.prepare("SELECT id, due FROM tasks WHERE id = ?").get(id);
        if (!current) return false;
        const row = settings();
        const bounds = periodBounds(now, row.timezone);
        let due = input.due === undefined ? current.due : input.due;
        if (input.bucket === "today") due = bounds.today;
        else if (input.bucket === "tomorrow") due = bounds.tomorrow;
        else if (input.bucket === "later") {
          const isLater = !current.due || (current.due !== bounds.today && current.due !== bounds.tomorrow && current.due > bounds.today);
          if (!isLater) due = null;
        }
        db.prepare(
          `UPDATE tasks SET title = ?, points = ?, weight = ?, assignee_id = ?, due = ?, repeat = ? WHERE id = ?`,
        ).run(input.title, input.points, null, input.assigneeId, due, input.repeat, id);
        return true;
      });
    },
    deleteTask(id) {
      return tx(() => {
        db.prepare("DELETE FROM tasks WHERE id = ?").run(id);
        return true;
      });
    },
    reorder(id, bucket, index, now) {
      return tx(() => {
        const row = settings();
        const bounds = periodBounds(now, row.timezone);
        const next = moveTask(tasks(), id, bucket, index, bounds.today, bounds.tomorrow);
        const update = db.prepare("UPDATE tasks SET due = ?, position = ? WHERE id = ?");
        for (const task of next) update.run(task.due, task.position, task.id);
        return true;
      });
    },
    complete(taskId, memberId, now) {
      return tx(() => {
        const task = db.prepare("SELECT * FROM tasks WHERE id = ?").get(taskId);
        const member = db.prepare("SELECT id, name FROM members WHERE id = ?").get(memberId);
        if (!task || !member) return { ok: false };
        const row = settings();
        const mapped = {
          id: task.id,
          repeat: task.repeat,
          due: task.due,
          points: task.points,
          weight: task.weight,
        };
        if (!canComplete(mapped, awards(), now, row.timezone)) return { ok: false };
        const points = resultingPoints(task.points, task.weight, row.weights_on === 1);
        const id = randomUUID();
        db.prepare(
          `INSERT INTO awards (id, task_id, task_title, member_id, member_name, points, at, undone_at, due_before)
           VALUES (?, ?, ?, ?, ?, ?, ?, NULL, ?)`,
        ).run(id, task.id, task.title, member.id, member.name, points, now.toISOString(), task.due);
        if (task.repeat === "daily" || task.repeat === "weekly") {
          const due = nextDue(task.due, task.repeat, periodBounds(now, row.timezone).today);
          db.prepare("UPDATE tasks SET due = ? WHERE id = ?").run(due, task.id);
        }
        return { ok: true, id, points, memberName: member.name };
      });
    },
    undo(awardId, now) {
      return tx(() => {
        const award = db.prepare("SELECT * FROM awards WHERE id = ?").get(awardId);
        if (!award || award.undone_at) return { ok: false };
        db.prepare("UPDATE awards SET undone_at = ? WHERE id = ?").run(now.toISOString(), awardId);
        const task = db.prepare("SELECT id FROM tasks WHERE id = ?").get(award.task_id);
        if (task) db.prepare("UPDATE tasks SET due = ? WHERE id = ?").run(award.due_before, task.id);
        return { ok: true };
      });
    },
    reassign(awardId, memberId) {
      return tx(() => {
        const award = db.prepare("SELECT id, points, undone_at FROM awards WHERE id = ?").get(awardId);
        const member = db.prepare("SELECT id, name FROM members WHERE id = ?").get(memberId);
        if (!award || award.undone_at || !member) return { ok: false };
        db.prepare("UPDATE awards SET member_id = ?, member_name = ? WHERE id = ?").run(member.id, member.name, awardId);
        return { ok: true, points: award.points };
      });
    },
    setTimezone(timezone) {
      db.prepare("UPDATE settings SET timezone = ? WHERE id = 1").run(timezone);
    },
    setResetMode(mode, now) {
      return tx(() => {
        if (mode === "never") {
          db.prepare("UPDATE settings SET reset_mode = 'never' WHERE id = 1").run();
          return;
        }
        const row = settings();
        const bounds = periodBounds(now, row.timezone);
        const key = mode === "week" ? bounds.weekStart : mode === "month" ? bounds.monthStart : bounds.yearStart;
        db.prepare("UPDATE settings SET reset_mode = ?, cutoff = ? WHERE id = 1").run(
          mode,
          startOfLocalDay(key, row.timezone).toISOString(),
        );
      });
    },
    resetNow(now) {
      return tx(() => {
        const row = settings();
        const closed = manualClose({
          cutoff: row.cutoff,
          now,
          awards: awards(),
          members: members(),
        });
        insertWin(closed.record, now.toISOString());
        db.prepare("UPDATE settings SET cutoff = ? WHERE id = 1").run(closed.cutoff);
        return closed.record;
      });
    },
    setWeights(on) {
      db.prepare("UPDATE settings SET weights_on = ? WHERE id = 1").run(on ? 1 : 0);
    },
    changeCode(code) {
      const salt = randomBytes(16);
      db.prepare("UPDATE settings SET code_salt = ?, code_hash = ? WHERE id = 1").run(salt.toString("hex"), hashCode(code, salt));
    },
    wipe() {
      tx(() => {
        db.exec("DELETE FROM tasks");
        db.exec("DELETE FROM awards");
        db.exec("DELETE FROM members");
        db.exec("DELETE FROM period_wins");
        db.prepare("UPDATE settings SET cutoff = NULL, reset_mode = 'never', weights_on = 0 WHERE id = 1").run();
      });
    },
    deleteHousehold() {
      tx(() => {
        db.exec("DELETE FROM tasks");
        db.exec("DELETE FROM awards");
        db.exec("DELETE FROM members");
        db.exec("DELETE FROM period_wins");
        db.exec("DELETE FROM devices");
        db.prepare(
          `UPDATE settings SET timezone = ?, code_salt = NULL, code_hash = NULL, reset_mode = 'never', cutoff = NULL, weights_on = 0 WHERE id = 1`,
        ).run(DEFAULT_TIMEZONE);
      });
    },
  };
}

export { PALETTE };
