export const DEFAULT_TIMEZONE = "America/New_York";

export const PALETTE = [
  "#c56a4a",
  "#d4a054",
  "#6f8f78",
  "#4e7c8a",
  "#a15d78",
  "#c4844a",
  "#7a6a8a",
  "#3f6f62",
];

const WEEKDAY = { Mon: 0, Tue: 1, Wed: 2, Thu: 3, Fri: 4, Sat: 5, Sun: 6 };

export function pad(n) {
  return String(n).padStart(2, "0");
}

export function ymd(year, month, day) {
  return `${year}-${pad(month)}-${pad(day)}`;
}

export function parseYmd(value) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value || "");
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const check = new Date(Date.UTC(year, month - 1, day));
  if (
    check.getUTCFullYear() !== year ||
    check.getUTCMonth() !== month - 1 ||
    check.getUTCDate() !== day
  ) {
    return null;
  }
  return { year, month, day };
}

export function addDays(value, days) {
  const part = parseYmd(value);
  if (!part) return null;
  const next = new Date(Date.UTC(part.year, part.month - 1, part.day + days));
  return ymd(next.getUTCFullYear(), next.getUTCMonth() + 1, next.getUTCDate());
}

export function zonedParts(date, timeZone) {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
    weekday: "short",
  });
  const parts = Object.fromEntries(
    fmt
      .formatToParts(date)
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, part.value]),
  );
  let hour = Number(parts.hour);
  if (hour === 24) {
    return zonedParts(new Date(date.getTime() + 1000), timeZone);
  }
  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    hour,
    minute: Number(parts.minute),
    second: Number(parts.second),
    weekday: parts.weekday,
  };
}

export function localDate(date, timeZone) {
  const part = zonedParts(date, timeZone);
  return ymd(part.year, part.month, part.day);
}

export function zonedTimeToUtc(year, month, day, hour, minute, second, ms, timeZone) {
  let utc = Date.UTC(year, month - 1, day, hour, minute, second, ms);
  for (let i = 0; i < 6; i += 1) {
    const part = zonedParts(new Date(utc), timeZone);
    const got = Date.UTC(part.year, part.month - 1, part.day, part.hour, part.minute, part.second, ms);
    const want = Date.UTC(year, month - 1, day, hour, minute, second, ms);
    if (got === want) return new Date(utc);
    utc += want - got;
  }
  return new Date(utc);
}

export function startOfLocalDay(value, timeZone) {
  const part = parseYmd(value);
  if (!part) return null;
  return zonedTimeToUtc(part.year, part.month, part.day, 0, 0, 0, 0, timeZone);
}

export function periodBounds(now, timeZone) {
  const today = localDate(now, timeZone);
  const part = zonedParts(now, timeZone);
  const weekStart = addDays(today, -WEEKDAY[part.weekday]);
  const monthStart = ymd(part.year, part.month, 1);
  const yearStart = ymd(part.year, 1, 1);
  const monthEnd = part.month === 12 ? ymd(part.year + 1, 1, 1) : ymd(part.year, part.month + 1, 1);
  const prevMonthStart = part.month === 1 ? ymd(part.year - 1, 12, 1) : ymd(part.year, part.month - 1, 1);
  return {
    today,
    tomorrow: addDays(today, 1),
    weekStart,
    weekEnd: addDays(weekStart, 7),
    monthStart,
    monthEnd,
    yearStart,
    yearEnd: ymd(part.year + 1, 1, 1),
    prevWeekStart: addDays(weekStart, -7),
    prevWeekEnd: weekStart,
    prevMonthStart,
    prevMonthEnd: monthStart,
    prevYearStart: ymd(part.year - 1, 1, 1),
    prevYearEnd: yearStart,
  };
}

export function resultingPoints(points) {
  return points;
}

export function bucketFor(due, today, tomorrow) {
  if (!due) return "later";
  if (due === today) return "today";
  if (due === tomorrow) return "tomorrow";
  if (due < today) return "overdue";
  return "later";
}

export function liveAwards(awards) {
  return awards.filter((award) => !award.undoneAt);
}

export function canComplete(task, awards, now, timeZone) {
  const live = liveAwards(awards).filter((award) => award.taskId === task.id);
  if (task.repeat === "none") return live.length === 0;
  const bounds = periodBounds(now, timeZone);
  if (task.repeat === "daily") {
    return !live.some((award) => localDate(new Date(award.at), timeZone) === bounds.today);
  }
  if (task.repeat === "weekly") {
    return !live.some((award) => {
      const day = localDate(new Date(award.at), timeZone);
      return day >= bounds.weekStart && day < bounds.weekEnd;
    });
  }
  return false;
}

export function nextDue(due, repeat, completedOn) {
  if (repeat === "daily") return addDays(completedOn, 1);
  if (repeat === "weekly") {
    let cursor = due || completedOn;
    do {
      cursor = addDays(cursor, 7);
    } while (cursor <= completedOn);
    return cursor;
  }
  return due;
}

function rowsFor(members, awards, pred) {
  return members.map((member) => ({
    memberId: member.id,
    name: member.name,
    points: liveAwards(awards)
      .filter((award) => award.memberId === member.id && pred(award))
      .reduce((sum, award) => sum + award.points, 0),
  }));
}

export function standing(rows) {
  let best = null;
  let tied = false;
  for (const row of rows) {
    if (row.points <= 0) continue;
    if (!best || row.points > best.points) {
      best = row;
      tied = false;
    } else if (row.points === best.points) {
      tied = true;
    }
  }
  if (!best) return { memberId: null, name: null, points: 0, tied: false };
  if (tied) return { memberId: null, name: null, points: best.points, tied: true };
  return { memberId: best.memberId, name: best.name, points: best.points, tied: false };
}

export function winnerOf(rows) {
  const result = standing(rows);
  if (!result.memberId) return null;
  return { memberId: result.memberId, name: result.name, points: result.points };
}

function onLocalDay(award, timeZone, start, end) {
  const day = localDate(new Date(award.at), timeZone);
  return day >= start && day < end;
}

export function summarize(awards, members, now, timeZone, cutoff) {
  const bounds = periodBounds(now, timeZone);
  const since = (award) => !cutoff || new Date(award.at).getTime() >= new Date(cutoff).getTime();
  return {
    bounds,
    allTime: rowsFor(members, awards, () => true),
    week: rowsFor(members, awards, (award) => onLocalDay(award, timeZone, bounds.weekStart, bounds.weekEnd)),
    month: rowsFor(members, awards, (award) => onLocalDay(award, timeZone, bounds.monthStart, bounds.monthEnd)),
    year: rowsFor(members, awards, (award) => onLocalDay(award, timeZone, bounds.yearStart, bounds.yearEnd)),
    period: rowsFor(members, awards, since),
    lastWeek: winnerOf(
      rowsFor(members, awards, (award) => onLocalDay(award, timeZone, bounds.prevWeekStart, bounds.prevWeekEnd)),
    ),
    lastMonth: winnerOf(
      rowsFor(members, awards, (award) => onLocalDay(award, timeZone, bounds.prevMonthStart, bounds.prevMonthEnd)),
    ),
  };
}

export function winnerBetween(awards, members, startIso, endIso) {
  const start = startIso ? new Date(startIso).getTime() : Number.NEGATIVE_INFINITY;
  const end = new Date(endIso).getTime();
  return standing(
    rowsFor(members, awards, (award) => {
      const at = new Date(award.at).getTime();
      return at >= start && at < end;
    }),
  );
}

export function autoClose({ mode, cutoff, now, timeZone, awards, members }) {
  if (mode !== "week" && mode !== "month" && mode !== "year") return null;
  if (!cutoff) return null;
  const bounds = periodBounds(now, timeZone);
  const startKey = mode === "week" ? bounds.weekStart : mode === "month" ? bounds.monthStart : bounds.yearStart;
  const cutoffDay = localDate(new Date(cutoff), timeZone);
  if (cutoffDay >= startKey) return null;
  const end = startOfLocalDay(startKey, timeZone);
  const win = winnerBetween(awards, members, cutoff, end.toISOString());
  return {
    cutoff: end.toISOString(),
    record: {
      kind: mode,
      startAt: cutoff,
      endAt: end.toISOString(),
      memberId: win.memberId,
      memberName: win.name,
      points: win.points,
      tied: win.tied ? 1 : 0,
    },
  };
}

export function manualClose({ cutoff, now, awards, members }) {
  const endAt = now.toISOString();
  const win = winnerBetween(awards, members, cutoff, endAt);
  return {
    cutoff: endAt,
    record: {
      kind: "manual",
      startAt: cutoff || "",
      endAt,
      memberId: win.memberId,
      memberName: win.name,
      points: win.points,
      tied: win.tied ? 1 : 0,
    },
  };
}

export function projectBoard(tasks, awards, now, timeZone) {
  const bounds = periodBounds(now, timeZone);
  const visible = [];
  for (const task of tasks) {
    const doneOnce = task.repeat === "none" && liveAwards(awards).some((award) => award.taskId === task.id);
    if (doneOnce) continue;
    visible.push({
      ...task,
      resting: !canComplete(task, awards, now, timeZone),
      bucket: bucketFor(task.due, bounds.today, bounds.tomorrow),
    });
  }
  const byPos = (a, b) => a.position - b.position || String(a.id).localeCompare(String(b.id));
  const todayTasks = visible.filter((task) => task.bucket === "today").sort(byPos);
  const hero = todayTasks.find((task) => !task.resting) || null;
  return {
    todayDate: bounds.today,
    tomorrowDate: bounds.tomorrow,
    hero,
    today: hero ? todayTasks.filter((task) => task.id !== hero.id) : todayTasks,
    tomorrow: visible.filter((task) => task.bucket === "tomorrow").sort(byPos),
    later: visible.filter((task) => task.bucket === "later").sort(byPos),
    overdue: visible.filter((task) => task.bucket === "overdue").sort(byPos),
    tasks: visible.sort(byPos),
  };
}

export function moveTask(tasks, id, toBucket, index, today, tomorrow) {
  const current = tasks.find((task) => task.id === id);
  if (!current) return tasks;
  let due = current.due;
  if (toBucket === "today") due = today;
  else if (toBucket === "tomorrow") due = tomorrow;
  else if (toBucket === "later" && bucketFor(current.due, today, tomorrow) !== "later") due = null;
  const next = tasks.map((task) => (task.id === id ? { ...task, due } : task));
  const groups = { today: [], tomorrow: [], later: [], overdue: [] };
  for (const task of next) {
    groups[bucketFor(task.due, today, tomorrow)].push(task);
  }
  for (const key of Object.keys(groups)) {
    groups[key].sort((a, b) => a.position - b.position || String(a.id).localeCompare(String(b.id)));
  }
  const dest = groups[toBucket].filter((task) => task.id !== id);
  const at = Math.max(0, Math.min(index, dest.length));
  dest.splice(at, 0, next.find((task) => task.id === id));
  groups[toBucket] = dest;
  const positioned = [];
  for (const key of ["today", "tomorrow", "later", "overdue"]) {
    groups[key].forEach((task, position) => positioned.push({ ...task, position }));
  }
  return positioned;
}
