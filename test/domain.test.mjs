import assert from "node:assert/strict";
import test from "node:test";
import {
  addDays,
  autoClose,
  bucketFor,
  canComplete,
  localDate,
  manualClose,
  moveTask,
  nextDue,
  periodBounds,
  projectBoard,
  resultingPoints,
  summarize,
} from "../domain.mjs";

const TZ = "America/New_York";
const fern = { id: "fern", name: "Fern" };
const reed = { id: "reed", name: "Reed" };
const people = [fern, reed];

function award(id, memberId, points, at, extra = {}) {
  return { id, taskId: extra.taskId || "task", memberId, points, at, undoneAt: extra.undoneAt || null };
}

test("monday 00:00 in New York starts the week and the previous millisecond stays in last week", () => {
  const now = new Date("2026-09-30T15:00:00.000Z");
  const awards = [
    award("sun", "fern", 5, "2026-09-28T03:59:59.999Z"),
    award("mon", "reed", 3, "2026-09-28T04:00:00.000Z"),
  ];
  const summary = summarize(awards, people, now, TZ, null);
  assert.equal(summary.bounds.weekStart, "2026-09-28");
  assert.equal(summary.bounds.today, "2026-09-30");
  assert.deepEqual(summary.week, [
    { memberId: "fern", name: "Fern", points: 0 },
    { memberId: "reed", name: "Reed", points: 3 },
  ]);
  assert.deepEqual(summary.lastWeek, { memberId: "fern", name: "Fern", points: 5 });
  assert.deepEqual(summary.allTime, [
    { memberId: "fern", name: "Fern", points: 5 },
    { memberId: "reed", name: "Reed", points: 3 },
  ]);
});

test("month edges in New York keep February and March apart, including the March daylight shift", () => {
  const march = summarize(
    [
      award("feb", "fern", 4, "2026-03-01T04:59:59.999Z"),
      award("mar", "reed", 2, "2026-03-01T05:00:00.000Z"),
    ],
    people,
    new Date("2026-03-15T16:00:00.000Z"),
    TZ,
    null,
  );
  assert.equal(march.bounds.monthStart, "2026-03-01");
  assert.equal(march.month[0].points, 0);
  assert.equal(march.month[1].points, 2);
  assert.deepEqual(march.lastMonth, { memberId: "fern", name: "Fern", points: 4 });

  const springWeek = summarize(
    [
      award("before", "fern", 7, "2026-03-09T03:59:59.999Z"),
      award("after", "reed", 1, "2026-03-09T04:00:00.000Z"),
    ],
    people,
    new Date("2026-03-11T15:00:00.000Z"),
    TZ,
    null,
  );
  assert.equal(springWeek.bounds.weekStart, "2026-03-09");
  assert.equal(localDate(new Date("2026-03-09T03:59:59.999Z"), TZ), "2026-03-08");
  assert.equal(localDate(new Date("2026-03-09T04:00:00.000Z"), TZ), "2026-03-09");
  assert.deepEqual(springWeek.lastWeek, { memberId: "fern", name: "Fern", points: 7 });
  assert.equal(springWeek.week[1].points, 1);
  assert.equal(springWeek.week[0].points, 0);

  const fallWeek = summarize(
    [
      award("sun", "fern", 6, "2026-11-02T04:59:59.999Z"),
      award("mon", "reed", 8, "2026-11-02T05:00:00.000Z"),
    ],
    people,
    new Date("2026-11-04T16:00:00.000Z"),
    TZ,
    null,
  );
  assert.equal(fallWeek.bounds.weekStart, "2026-11-02");
  assert.equal(localDate(new Date("2026-11-02T04:59:59.999Z"), TZ), "2026-11-01");
  assert.equal(localDate(new Date("2026-11-02T05:00:00.000Z"), TZ), "2026-11-02");
  assert.deepEqual(fallWeek.lastWeek, { memberId: "fern", name: "Fern", points: 6 });
  assert.equal(fallWeek.week[1].points, 8);

  const november = summarize(
    [
      award("oct", "fern", 9, "2026-11-01T03:59:59.999Z"),
      award("nov", "reed", 1, "2026-11-01T04:00:00.000Z"),
    ],
    people,
    new Date("2026-11-04T16:00:00.000Z"),
    TZ,
    null,
  );
  assert.equal(november.bounds.monthStart, "2026-11-01");
  assert.deepEqual(november.lastMonth, { memberId: "fern", name: "Fern", points: 9 });
  assert.equal(november.month[1].points, 1);
  assert.equal(november.month[0].points, 0);
});

test("new year midnight in New York is January, and the previous millisecond is still December", () => {
  const summary = summarize(
    [
      award("old", "fern", 11, "2026-01-01T04:59:59.999Z"),
      award("new", "reed", 13, "2026-01-01T05:00:00.000Z"),
    ],
    people,
    new Date("2026-01-15T15:00:00.000Z"),
    TZ,
    null,
  );
  assert.equal(summary.bounds.yearStart, "2026-01-01");
  assert.equal(summary.bounds.monthStart, "2026-01-01");
  assert.equal(localDate(new Date("2026-01-01T04:59:59.999Z"), TZ), "2025-12-31");
  assert.equal(localDate(new Date("2026-01-01T05:00:00.000Z"), TZ), "2026-01-01");
  assert.equal(summary.year[0].points, 0);
  assert.equal(summary.year[1].points, 13);
  assert.equal(summary.month[1].points, 13);
  assert.deepEqual(summary.lastMonth, { memberId: "fern", name: "Fern", points: 11 });
});

test("a tie or a zero week has no winner, and undo drops the points", () => {
  const now = new Date("2026-09-30T15:00:00.000Z");
  const tied = summarize(
    [
      award("a", "fern", 4, "2026-09-22T16:00:00.000Z"),
      award("b", "reed", 4, "2026-09-23T16:00:00.000Z"),
    ],
    people,
    now,
    TZ,
    null,
  );
  assert.equal(tied.lastWeek, null);

  const undone = summarize(
    [award("a", "fern", 5, "2026-09-28T04:00:00.000Z", { undoneAt: "2026-09-30T15:00:00.000Z" })],
    people,
    now,
    TZ,
    null,
  );
  assert.equal(undone.week[0].points, 0);
  assert.equal(undone.allTime[0].points, 0);
  assert.equal(undone.lastWeek, null);
});

test("weight scales points only when the setting is on", () => {
  assert.equal(resultingPoints(5, "small", true), 5);
  assert.equal(resultingPoints(5, "medium", true), 10);
  assert.equal(resultingPoints(5, "big", true), 15);
  assert.equal(resultingPoints(5, "big", false), 5);
});

test("repeat moves the due date and a second completion the same day does not count", () => {
  const now = new Date("2026-09-30T15:00:00.000Z");
  assert.equal(nextDue("2026-09-30", "daily", "2026-09-30"), "2026-10-01");
  assert.equal(nextDue("2026-09-28", "weekly", "2026-09-30"), "2026-10-05");
  assert.equal(nextDue("2026-09-01", "weekly", "2026-09-30"), "2026-10-06");
  const task = { id: "dishes", repeat: "daily", due: "2026-09-30" };
  assert.equal(canComplete(task, [], now, TZ), true);
  assert.equal(
    canComplete(task, [award("once", "fern", 5, "2026-09-30T15:00:00.000Z", { taskId: "dishes" })], now, TZ),
    false,
  );
  assert.equal(
    canComplete(
      { id: "bins", repeat: "none", due: "2026-09-30" },
      [award("once", "fern", 1, "2026-09-30T15:00:00.000Z", { taskId: "bins" })],
      now,
      TZ,
    ),
    false,
  );
});

test("due date picks the bucket, and overdue is not today", () => {
  assert.equal(bucketFor("2026-09-30", "2026-09-30", "2026-10-01"), "today");
  assert.equal(bucketFor("2026-10-01", "2026-09-30", "2026-10-01"), "tomorrow");
  assert.equal(bucketFor("2026-10-06", "2026-09-30", "2026-10-01"), "later");
  assert.equal(bucketFor(null, "2026-09-30", "2026-10-01"), "later");
  assert.equal(bucketFor("2026-09-29", "2026-09-30", "2026-10-01"), "overdue");
  const board = projectBoard(
    [
      { id: "a", title: "Dishes", points: 1, due: "2026-09-30", position: 1, repeat: "none", weight: null, assigneeId: null },
      { id: "b", title: "Bins", points: 1, due: "2026-09-30", position: 0, repeat: "none", weight: null, assigneeId: null },
      { id: "c", title: "Laundry", points: 1, due: "2026-09-29", position: 0, repeat: "none", weight: null, assigneeId: null },
    ],
    [],
    new Date("2026-09-30T15:00:00.000Z"),
    TZ,
  );
  assert.equal(board.hero.id, "b");
  assert.deepEqual(board.today.map((task) => task.id), ["a"]);
  assert.deepEqual(board.overdue.map((task) => task.id), ["c"]);
});

test("reorder keeps a later due date, and moving to today sets today", () => {
  const tasks = [
    { id: "a", due: "2026-10-10", position: 0 },
    { id: "b", due: null, position: 1 },
  ];
  const reordered = moveTask(tasks, "b", "later", 0, "2026-09-30", "2026-10-01");
  const laterA = reordered.find((task) => task.id === "a");
  const laterB = reordered.find((task) => task.id === "b");
  assert.equal(laterA.due, "2026-10-10");
  assert.equal(laterB.due, null);
  assert.equal(laterB.position, 0);
  assert.equal(laterA.position, 1);
  const moved = moveTask(tasks, "a", "today", 0, "2026-09-30", "2026-10-01");
  assert.equal(moved.find((task) => task.id === "a").due, "2026-09-30");
});

test("a weekly reset archives the closed period and leaves the new week for later", () => {
  const cutoff = "2026-09-21T04:00:00.000Z";
  const now = new Date("2026-09-30T15:00:00.000Z");
  const awards = [
    award("old", "fern", 8, "2026-09-22T16:00:00.000Z"),
    award("new", "reed", 9, "2026-09-29T16:00:00.000Z"),
  ];
  const closed = autoClose({ mode: "week", cutoff, now, timeZone: TZ, awards, members: people });
  assert.equal(closed.record.memberId, "fern");
  assert.equal(closed.record.points, 8);
  assert.equal(closed.record.tied, 0);
  assert.equal(closed.cutoff, "2026-09-28T04:00:00.000Z");
  assert.equal(addDays("2026-09-28", 0), "2026-09-28");
  const again = autoClose({
    mode: "week",
    cutoff: closed.cutoff,
    now,
    timeZone: TZ,
    awards,
    members: people,
  });
  assert.equal(again, null);
});

test("manual reset records who led since the last cutoff and starts at now", () => {
  const now = new Date("2026-09-30T15:00:00.000Z");
  const closed = manualClose({
    cutoff: "2026-09-01T04:00:00.000Z",
    now,
    awards: [award("a", "reed", 12, "2026-09-10T16:00:00.000Z")],
    members: people,
  });
  assert.equal(closed.record.kind, "manual");
  assert.equal(closed.record.memberId, "reed");
  assert.equal(closed.record.points, 12);
  assert.equal(closed.cutoff, "2026-09-30T15:00:00.000Z");
  const summary = summarize(
    [award("a", "reed", 12, "2026-09-10T16:00:00.000Z"), award("b", "fern", 2, "2026-09-30T16:00:00.000Z")],
    people,
    now,
    TZ,
    closed.cutoff,
  );
  assert.equal(summary.period[0].points, 2);
  assert.equal(summary.period[1].points, 0);
  assert.equal(summary.allTime[1].points, 12);
  assert.equal(periodBounds(now, TZ).weekStart, "2026-09-28");
});
