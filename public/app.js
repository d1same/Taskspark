import { colorClass, esc, icon, PALETTE } from "./icons.js";

const ui = {
  view: "board",
  admin: "household",
  sheet: null,
  taskId: null,
  awardId: null,
  pickId: null,
  cal: "week",
  day: null,
  adding: false,
  editing: null,
  boardPeriod: "week",
  lane: "today",
  filter: "all",
  rewardFilter: "all",
  rewardMember: null,
  proposing: false,
  pending: 0,
  confirm: null,
  toast: null,
  error: "",
  fields: blankFields(),
};

let state = { phase: "setup" };
let drag = null;
let sheetEpoch = 0;

function blankFields() {
  return {
    title: "",
    points: 10,
    assigneeId: "",
    bucket: "today",
    repeat: "none",
    weight: "medium",
    name: "",
    color: PALETTE[0],
    timezone: "",
    code: "",
    confirm: "",
    due: "",
    rewardTitle: "",
    rewardDetail: "",
    rewardCost: "20",
    rewardCategory: "privilege",
  };
}

function pad(n) {
  return String(n).padStart(2, "0");
}

function addDays(value, days) {
  const [year, month, day] = value.split("-").map(Number);
  const next = new Date(Date.UTC(year, month - 1, day + days));
  return `${next.getUTCFullYear()}-${pad(next.getUTCMonth() + 1)}-${pad(next.getUTCDate())}`;
}

function mondayOf(value) {
  const [year, month, day] = value.split("-").map(Number);
  const dow = (new Date(Date.UTC(year, month - 1, day)).getUTCDay() + 6) % 7;
  return addDays(value, -dow);
}

function shiftMonth(value, delta) {
  const [year, month] = value.split("-").map(Number);
  const next = new Date(Date.UTC(year, month - 1 + delta, 1));
  return `${next.getUTCFullYear()}-${pad(next.getUTCMonth() + 1)}-01`;
}

function memberById(id) {
  return (state.members || []).find((member) => member.id === id) || null;
}

function personLabel(id) {
  if (!id) return "Anyone";
  return memberById(id)?.name || "Anyone";
}

function localDay(iso) {
  try {
    return new Intl.DateTimeFormat("en-CA", {
      timeZone: state.timezone || "UTC",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(new Date(iso));
  } catch {
    return "";
  }
}

function weekStart() {
  return mondayOf(state.today);
}

function pointsFor(memberId, period) {
  const rows = state.leaderboard?.[period] || [];
  return rows.find((row) => row.memberId === memberId)?.points || 0;
}

function awardsFor(memberId, period) {
  const start = weekStart();
  const end = addDays(start, 7);
  const monthStart = `${state.today.slice(0, 8)}01`;
  const [year, month] = state.today.split("-").map(Number);
  const nextMonth = new Date(Date.UTC(year, month, 1));
  const monthEnd = `${nextMonth.getUTCFullYear()}-${pad(nextMonth.getUTCMonth() + 1)}-01`;
  return (state.completed || []).filter((award) => {
    if (memberId && award.memberId !== memberId) return false;
    if (period === "period") {
      if (!state.cutoff) return true;
      return new Date(award.at).getTime() >= new Date(state.cutoff).getTime();
    }
    const day = localDay(award.at);
    if (period === "today") return day === state.today;
    if (period === "week") return day >= start && day < end;
    if (period === "month") return day >= monthStart && day < monthEnd;
    return true;
  });
}

function weekTotal() {
  return (state.leaderboard?.week || []).reduce((sum, row) => sum + row.points, 0);
}

function nextMark(total) {
  const step = 20;
  return Math.max(step, Math.ceil((total + 1) / step) * step);
}

function bucketTasks(name) {
  if (name === "today") return [state.hero, ...(state.todayTasks || [])].filter(Boolean);
  if (name === "tomorrow") return state.tomorrowTasks || [];
  return state.laterTasks || [];
}

function matchesFilter(task) {
  if (ui.filter === "anyone") return !task.assigneeId;
  if (ui.filter && ui.filter !== "all") return task.assigneeId === ui.filter;
  return true;
}

function allChores() {
  return ["today", "tomorrow", "later"].flatMap((name) => bucketTasks(name));
}

function tone(color) {
  const value = String(color || "").toLowerCase();
  const index = PALETTE.indexOf(value);
  if (index >= 0) return `tone${index}`;
  if (value === "#8c7168") return "tone-muted";
  return "tone-any";
}

function letter(name, color, withDot) {
  const ch = esc(String(name || "?").trim().charAt(0).toUpperCase() || "?");
  const paint = tone(color);
  const face = `<span class="letter ${paint}">${ch}</span>`;
  if (!withDot) return face;
  return `<span class="who">${face}<span class="dot ${paint}"></span></span>`;
}

function dot(color) {
  return `<span class="dot ${tone(color)}"></span>`;
}

async function send(path, method, body) {
  const res = await fetch(path, {
    method,
    credentials: "same-origin",
    headers: method === "GET" ? {} : { "content-type": "application/json", "x-taskspark": "1" },
    body: method === "GET" ? undefined : JSON.stringify(body || {}),
  });
  const data = await res.json().catch(() => ({ error: "unavailable" }));
  if (data.phase === "setup" || data.phase === "locked" || data.phase === "waiting") {
    state = { phase: data.phase };
    ui.sheet = null;
    ui.toast = null;
    render();
    return null;
  }
  if (!res.ok) {
    ui.error = "That did not save.";
    render();
    return null;
  }
  ui.error = "";
  if (data.phase === "board") {
    state = data;
    if (!ui.day) ui.day = state.today;
    render();
  }
  return data;
}

async function load() {
  const res = await fetch("api/state", { credentials: "same-origin" });
  state = await res.json();
  if (!ui.day && state.today) ui.day = state.today;
  if (state.phase === "board") {
    const dev = await fetch("api/devices", { credentials: "same-origin" });
    const data = await dev.json().catch(() => null);
    if (data?.devices) ui.pending = data.devices.filter((device) => device.status === "pending").length;
  }
  render();
}

function gate(title, body) {
  return `<main class="phone gate"><h1>Taskspark</h1><section class="card stack">${title}${body}</section></main>`;
}

function setupScreen() {
  return gate(
    "<h2>Choose a code</h2>",
    `<label>Code<input data-field="code" type="password" autocapitalize="off" autocomplete="off" spellcheck="false"></label>
     <label>Type it again<input data-field="confirm" type="password" autocapitalize="off" autocomplete="off" spellcheck="false"></label>
     <p class="quiet">At least 4 characters. The code is not shown again.</p>
     ${ui.error ? `<p class="quiet">${esc(ui.error)}</p>` : ""}
     <button class="primary" data-action="setup">Save</button>`,
  );
}

function lockScreen() {
  return gate(
    "<h2>Open the board</h2>",
    `<label>Code<input data-field="code" type="password" autocapitalize="off" autocomplete="off" spellcheck="false"></label>
     ${ui.error ? `<p class="quiet">${esc(ui.error)}</p>` : ""}
     <button class="primary" data-action="unlock">Open</button>`,
  );
}

function waitScreen() {
  return gate("<h2>Waiting for approval.</h2>", "<p class=\"quiet\">An approved phone can allow this one under Admin.</p>");
}

function header() {
  return `<header class="topbar">
    <div class="brand">
      <button class="icon-btn" data-open="menu" aria-label="Menu">${icon("burger")}</button>
      <h1>Taskspark ${icon("bolt")}</h1>
    </div>
  </header>`;
}

function tabbar() {
  const items = [
    ["board", "list", "Chores"],
    ["leaderboard", "medal", "Leaderboard"],
    ["rewards", "gift", "Rewards"],
    ["calendar", "calendar", "Calendar"],
  ];
  return `<nav class="tabbar">${items.map(([view, glyph, label]) =>
    `<button data-view="${view}" aria-current="${ui.view === view ? "page" : "false"}">${icon(glyph)}<span>${label}</span></button>`,
  ).join("")}</nav>`;
}

function toast() {
  if (!ui.toast) return "";
  return `<div class="toast" role="status"><p>${icon("points")} ${esc(ui.toast.text)}</p><button data-undo="${esc(ui.toast.id)}">Undo</button></div>`;
}

function repeatLabel(task) {
  if (task.repeat === "daily") return "Daily";
  if (task.repeat === "weekly") return "Weekly";
  return "";
}

function badge(score, large) {
  const n = Number(score);
  const kind = n === 5 ? "p5" : n === 10 ? "p10" : n === 20 ? "p20" : "pother";
  return `<span class="badge ${kind}${large ? " lg" : ""}">${icon("points")}<span>+${n}${large ? " points" : ""}</span></span>`;
}

function pointsPick(current) {
  const value = Number(current);
  return `<div class="segment" role="group" aria-label="Points">${[5, 10, 20]
    .map((points) => `<button type="button" data-set="points" data-value="${points}" aria-pressed="${value === points}">${points}</button>`)
    .join("")}</div>`;
}

function chosenPoints() {
  const points = Number(ui.fields.points);
  return points === 5 || points === 10 || points === 20 ? points : null;
}

function taskById(id) {
  return [state.hero, ...(state.tasks || [])].find((task) => task && task.id === id) || null;
}

function taskCard(task, allowDrag) {
  const who = memberById(task.assigneeId);
  const repeat = repeatLabel(task);
  const stripe = tone(who?.color);
  const whoPill = who
    ? `<span class="pill ${tone(who.color)}">${dot(who.color)}${esc(who.name)}</span>`
    : `<span class="pill tone-any">${icon("home")} Open to anyone</span>`;
  const owned = Boolean(task.assigneeId);
  const check = task.resting
    ? `<span class="check is-done" aria-hidden="true">${icon("complete")}</span>`
    : owned
      ? `<button class="check" data-complete="${esc(task.id)}" aria-label="Complete ${esc(task.title)}"></button>`
      : `<span class="check is-open" aria-hidden="true"></span>`;
  const claim = !owned && !task.resting
    ? `<button class="primary" data-claim-chore="${esc(task.id)}">Claim</button>`
    : "";
  const edit = allowDrag ? `<button data-edit="${esc(task.id)}">Edit</button>` : "";
  const actions = claim || edit ? `<div class="row-actions">${claim}${edit}</div>` : "";
  return `<article class="task ${stripe}${task.resting ? " is-done" : ""}" data-id="${esc(task.id)}">
    <div class="task-row">
      ${allowDrag ? `<button class="grip" data-grip aria-label="Reorder">${icon("grip")}</button>` : ""}
      ${check}
      <div class="task-copy">
        <h3>${esc(task.title)}</h3>
        <p class="meta">${whoPill}${repeat ? `<span>${esc(repeat)}</span>` : ""}</p>
      </div>
      ${badge(task.score)}
    </div>
    ${actions}
    ${ui.editing === task.id ? editForm(task) : ""}
  </article>`;
}

function editForm(task) {
  const stored = Number(task.points);
  const legacy = stored !== 5 && stored !== 10 && stored !== 20
    ? `<p class="quiet">This task is worth ${stored}. Pick 5, 10, or 20.</p>`
    : "";
  const bucket = ui.fields.bucket || task.bucket || "today";
  return `<div class="fields">
    <label>Title<input data-field="title" value="${esc(ui.fields.title || task.title)}"></label>
    ${pointsPick(ui.fields.points)}
    ${legacy}
    <p class="kicker">When</p>
    <div class="segment" aria-label="When">
      <button data-set="bucket" data-value="today" aria-pressed="${bucket === "today"}">Today</button>
      <button data-set="bucket" data-value="tomorrow" aria-pressed="${bucket === "tomorrow"}">Tomorrow</button>
      <button data-set="bucket" data-value="later" aria-pressed="${bucket === "later"}">Later</button>
    </div>
    <label>Date<input data-field="due" type="date" value="${esc(ui.fields.due || task.due || "")}"></label>
    <div class="segment">
      <button data-set="repeat" data-value="none" aria-pressed="${(ui.fields.repeat || task.repeat) === "none"}">Once</button>
      <button data-set="repeat" data-value="daily" aria-pressed="${(ui.fields.repeat || task.repeat) === "daily"}">Daily</button>
      <button data-set="repeat" data-value="weekly" aria-pressed="${(ui.fields.repeat || task.repeat) === "weekly"}">Weekly</button>
    </div>
    <button class="primary" data-save-task="${esc(task.id)}">Save</button>
    <button class="danger" data-delete-task="${esc(task.id)}">Delete</button>
  </div>`;
}

function dayProgress() {
  const openTasks = bucketTasks("today").filter((task) => !task.resting);
  const earned = awardsFor(null, "today");
  const done = earned.length;
  const open = openTasks.length;
  const total = done + open;
  const pts = earned.reduce((sum, award) => sum + award.points, 0);
  const remain = openTasks.reduce((sum, task) => sum + Number(task.score || 0), 0);
  return { done, open, total, pts, goal: remain + pts };
}

function fill(part, whole) {
  if (!whole) return 0;
  return Math.max(0, Math.min(100, Math.round((part / whole) * 100)));
}

function fillMark(pct) {
  const n = Math.max(0, Math.min(100, Math.round(Number(pct) / 5) * 5));
  return `data-fill="${n}"`;
}

function dailyGoal() {
  const day = dayProgress();
  const pct = fill(day.done, day.total);
  const status = day.total ? `${pct}% complete (${day.done}/${day.total} done)` : "Nothing finished today yet.";
  const left = day.open ? `${day.open} still open today` : "Today's list is clear";
  return `<section class="card">
    <div class="goal-top">
      <div>
        <div class="meta">${icon("points")}<span class="kicker flat">Family daily goal</span></div>
        <p>${status}</p>
      </div>
      <span class="chip-hot">${icon("points")}+${day.pts} pts today</span>
    </div>
    <div class="track" aria-hidden="true"><span ${fillMark(pct)}></span></div>
    <div class="goal-foot"><span>${left}</span><strong>Goal: ${day.goal} pts</strong></div>
  </section>`;
}

function weekGoal() {
  const total = weekTotal();
  const goal = nextMark(total);
  const pct = fill(total, goal);
  const left = goal - total;
  return `<section class="card">
    <div class="goal-top">
      <div>
        <p class="kicker">Household goal</p>
        <h2>This week</h2>
      </div>
      <p class="rank-points">${total}<span>/ ${goal} pts</span></p>
    </div>
    <div class="track" aria-hidden="true"><span ${fillMark(pct)}></span></div>
    <div class="goal-foot"><span>${left} points to the next mark</span><strong>${pct}%</strong></div>
  </section>`;
}

function fridgeNote() {
  const total = weekTotal();
  const goal = nextMark(total);
  return `<aside class="note">${icon("pin")}<p><strong>Fridge note:</strong> This week is ${total} of ${goal} points.</p></aside>`;
}

function memberChips() {
  const chores = allChores();
  const allOn = ui.filter === "all";
  const chips = [`<button data-filter="all" aria-pressed="${allOn}">${allOn ? icon("complete") : ""}<span>All (${chores.length})</span></button>`];
  for (const member of state.members || []) {
    const on = ui.filter === member.id;
    chips.push(`<button data-filter="${esc(member.id)}" aria-pressed="${on}">${dot(member.color)}<span>${esc(member.name)}</span><span class="pts-mini">${pointsFor(member.id, "week")}p</span></button>`);
  }
  chips.push(`<button data-filter="anyone" aria-pressed="${ui.filter === "anyone"}">${icon("home")}<span>Anyone</span></button>`);
  return `<div class="chips">${chips.join("")}</div>`;
}

function board() {
  const name = ["today", "tomorrow", "later"].includes(ui.lane) ? ui.lane : "today";
  const titles = { today: "Today's chores", tomorrow: "Tomorrow", later: "Later" };
  const empties = { today: "Nothing on today.", tomorrow: "Tomorrow is clear.", later: "Nothing waiting." };
  const counts = {
    today: bucketTasks("today").filter(matchesFilter).length,
    tomorrow: bucketTasks("tomorrow").filter(matchesFilter).length,
    later: bucketTasks("later").filter(matchesFilter).length,
  };
  const tasks = bucketTasks(name).filter(matchesFilter);
  let marked = false;
  const cards = tasks.map((task) => {
    const next = !marked && !task.resting;
    if (next) marked = true;
    const html = taskCard(task, true);
    return next ? html.replace("class=\"task", "class=\"task is-next") : html;
  }).join("");
  const body = cards || `<p class="empty quiet">${ui.filter === "all" ? empties[name] : "Nothing for this person."}</p>`;
  const overdue = state.overdue?.length
    ? `<button data-view="calendar">${icon("calendar")} Earlier chores are on the calendar</button>`
    : "";
  const switcher = ["today", "tomorrow", "later"].map((key) => {
    const label = key[0].toUpperCase() + key.slice(1);
    return `<button data-lane="${key}" aria-pressed="${name === key}">${label} (${counts[key]})</button>`;
  }).join("");
  return `<div class="page">
    ${memberChips()}
    ${dailyGoal()}
    <div class="laneswitch" role="group" aria-label="When">${switcher}</div>
    ${toast()}
    <section class="lane" data-bucket="${name}">
      <div class="section-head"><h2>${titles[name]}</h2></div>
      ${body}
    </section>
    ${fridgeNote()}
    ${overdue}
    ${state.members?.length ? "" : `<p class="quiet">Add a person in Admin.</p>`}
    ${ui.error ? `<p class="quiet">${esc(ui.error)}</p>` : ""}
  </div>`;
}

function addForm() {
  const points = chosenPoints() || 10;
  const presets = ["Dishes", "Feed pets", "Trash and recycle", "Make the bed"]
    .map((title) => `<button type="button" data-preset="${esc(title)}">${esc(title)}</button>`)
    .join("");
  const people = [`<button data-set="assigneeId" data-value="" aria-pressed="${ui.fields.assigneeId === ""}">Anyone</button>`]
    .concat((state.members || []).map((member) => `<button data-set="assigneeId" data-value="${esc(member.id)}" aria-pressed="${ui.fields.assigneeId === member.id}">${letter(member.name, member.color)} ${esc(member.name)} <span class="quiet">${pointsFor(member.id, "allTime")} pts</span></button>`))
    .join("");
  const choices = [
    [5, "Quick"],
    [10, "Standard"],
    [20, "Big effort"],
  ].map(([value, label]) => `<button type="button" data-set="points" data-value="${value}" aria-pressed="${points === value}">${icon("points")}+${value}<span>${label}${value === 10 ? " · Recommended" : ""}</span></button>`).join("");
  return `<div class="sheet-head">
      <div class="device-main"><span class="device-mark">${icon("plus")}</span><div><h2>New chore</h2><p class="quiet">Add it to the household board.</p></div></div>
    </div>
    <label>What needs to be done?<input data-field="title" value="${esc(ui.fields.title)}" placeholder="Fold laundry"></label>
    <div class="presets">${presets}</div>
    <p class="kicker">Assign to</p>
    <div class="chips">${people}</div>
    <p class="kicker">Points</p>
    <div class="point-cards">${choices}</div>
    <p class="kicker">When</p>
    <div class="segment">
      <button data-set="bucket" data-value="today" aria-pressed="${ui.fields.bucket === "today"}">Today</button>
      <button data-set="bucket" data-value="tomorrow" aria-pressed="${ui.fields.bucket === "tomorrow"}">Tomorrow</button>
      <button data-set="bucket" data-value="later" aria-pressed="${ui.fields.bucket === "later"}">Later</button>
    </div>
    <p class="kicker">Repeat</p>
    <div class="segment">
      <button data-set="repeat" data-value="none" aria-pressed="${ui.fields.repeat === "none"}">Once</button>
      <button data-set="repeat" data-value="daily" aria-pressed="${ui.fields.repeat === "daily"}">Daily</button>
      <button data-set="repeat" data-value="weekly" aria-pressed="${ui.fields.repeat === "weekly"}">Weekly</button>
    </div>
    <button class="primary" data-action="add-task">${icon("complete")} Add chore (+${points} pts)</button>
    <button data-close="1">Cancel</button>`;
}

function podium(rows) {
  const top = ranked(rows).filter((row) => row.points > 0).slice(0, 3);
  if (!top.length) return "";
  const slots = [
    { row: top[1], place: 2 },
    { row: top[0], place: 1 },
    { row: top[2], place: 3 },
  ];
  return `<div class="podium">${slots.map(({ row, place }) => {
    const member = row ? memberById(row.memberId) : null;
    const who = row
      ? `${letter(row.name, member?.color)}<p>${esc(row.name)}</p><p class="quiet">${row.points} pts</p>`
      : `<p class="quiet">Open</p>`;
    return `<div class="podium-slot is-${place}">${who}<div class="podium-block">${place}</div></div>`;
  }).join("")}</div><p class="quiet center">Standings follow finished chores.</p>`;
}

function ranked(rows) {
  return [...(rows || [])].sort((a, b) => b.points - a.points || a.name.localeCompare(b.name));
}

function placeWord(place) {
  return ["1st", "2nd", "3rd"][place - 1] || `${place}th`;
}

function rankCard(row, place) {
  const member = memberById(row.memberId);
  const color = member?.color || "#f26a36";
  const top = ranked(state.leaderboard?.[ui.boardPeriod] || [])[0]?.points || 0;
  const pct = fill(row.points, top);
  const today = awardsFor(row.memberId, "today").reduce((sum, award) => sum + award.points, 0);
    const done = awardsFor(row.memberId, ui.boardPeriod === "allTime" ? "all" : ui.boardPeriod).length;
  const todayLine = today > 0 ? `<span class="chip-hot">+${today} today</span>` : "";
  return `<article class="card rank ${tone(color)}">
    <div>${letter(row.name, color, true)}</div>
    <div>
      <span class="place n${place}">${placeWord(place)}</span>
      <h3>${esc(row.name)}</h3>
      <p class="meta">${todayLine}<span>${done} done</span></p>
      <div class="track" aria-hidden="true"><span ${fillMark(pct)}></span></div>
    </div>
    <p class="rank-points">${row.points}<span>points</span></p>
  </article>`;
}

function winnerCard(title, winner) {
  if (!winner) {
    return `<article class="card champion"><div>${icon("medal")}</div><div><p class="kicker">${title}</p><h2>No winner</h2></div></article>`;
  }
  const member = memberById(winner.memberId);
  return `<article class="card champion">
    ${letter(winner.name, member?.color, true)}
    <div><p class="kicker">${title}</p><h2>${esc(winner.name)}</h2><p class="quiet">${winner.points} points</p></div>
  </article>`;
}

function leaderboard() {
  const board = state.leaderboard || { allTime: [], week: [], month: [], period: [], lastWeek: null, lastMonth: null };
  const periods = [["week", "Week"], ["month", "Month"], ["year", "Year"], ["allTime", "All-time"]];
  if (state.cutoff) periods.push(["period", "Period"]);
  if (!periods.some(([key]) => key === ui.boardPeriod)) ui.boardPeriod = "week";
  const control = periods.map(([key, label]) => `<button data-score="${key}" aria-pressed="${ui.boardPeriod === key}">${label}</button>`).join("");
  const rows = ranked(board[ui.boardPeriod] || []);
  const list = rows.length
    ? rows.map((row, index) => rankCard(row, index + 1)).join("")
    : `<p class="quiet">Add a person in Admin.</p>`;
  const empty = rows.some((row) => row.points > 0) ? "" : `<p class="quiet">${{
    week: "Nobody has points this week.",
    month: "Nobody has points this month.",
    year: "Nobody has points this year.",
    allTime: "Nobody has points yet.",
    period: "Nobody has points this period.",
  }[ui.boardPeriod] || "Nobody has points yet."}</p>`;
  const reset = state.resetMode === "week"
    ? "Scores reset each week. The week starts Monday."
    : state.resetMode === "month"
      ? "Scores reset each month."
      : state.resetMode === "year"
        ? "Scores reset each year."
        : "Scores stay until someone resets them.";
  return `<div class="page">
    <div>
      <h2>Scoreboard</h2>
      <p class="quiet">Household points. ${reset}</p>
    </div>
    <div class="laneswitch" role="group" aria-label="Score period">${control}</div>
    ${podium(rows)}
    ${weekGoal()}
    ${winnerCard("Last week's winner", board.lastWeek)}
    ${winnerCard("Last month's winner", board.lastMonth)}
    <div class="section-head"><h2>Family standings</h2></div>
    ${empty}
    ${list}
  </div>`;
}

function wallet(memberId) {
  const spent = (state.redemptions || []).filter((row) => row.memberId === memberId).reduce((sum, row) => sum + row.cost, 0);
  return pointsFor(memberId, "allTime") - spent;
}

function rewards() {
  const members = state.members || [];
  const selected = members.some((member) => member.id === ui.rewardMember) ? ui.rewardMember : members[0]?.id || null;
  const person = memberById(selected);
  const balance = selected ? wallet(selected) : 0;
  const filters = [
    ["all", "All rewards"],
    ["privilege", "Privileges"],
    ["outing", "Outings"],
    ["badge", "Badges"],
  ];
  const chips = members.map((member) => {
    const on = member.id === selected;
    return `<button data-reward-member="${esc(member.id)}" aria-pressed="${on}">${letter(member.name, member.color)}<span class="balance-name"><strong>${esc(member.name)}</strong><em>${wallet(member.id)} pts</em></span></button>`;
  }).join("");
  const catalog = (state.rewards || []).filter((reward) => ui.rewardFilter === "all" || reward.category === ui.rewardFilter);
  const cards = catalog.map((reward) => {
    const affordable = selected && balance >= reward.cost;
    const left = selected ? balance - reward.cost : 0;
    const short = selected ? reward.cost - balance : reward.cost;
    const tag = { privilege: "Privilege", outing: "Outing", badge: "Badge" }[reward.category] || "Reward";
    const action = !selected
      ? `<button disabled>Add a person first</button>`
      : affordable
        ? `<button class="primary" data-claim="${esc(reward.id)}">${icon("gift")} Claim</button>`
        : `<button disabled>${icon("lock")} Need ${short} pts</button>`;
    const bar = !affordable && selected
      ? `<div class="track" aria-hidden="true"><span ${fillMark(fill(balance, reward.cost))}></span></div><p class="quiet">${balance} / ${reward.cost} pts</p>`
      : "";
    return `<article class="card stack">
      <div class="spread">
        <div>
          <p class="meta"><span class="pill">${tag}</span>${affordable ? `<span class="chip-hot">${icon("complete")} Affordable</span>` : ""}</p>
          <h3>${esc(reward.title)}</h3>
          ${reward.detail ? `<p class="quiet">${esc(reward.detail)}</p>` : ""}
        </div>
        <p class="cost">${reward.cost}<span>pts</span></p>
      </div>
      ${bar}
      <div class="reward-actions">
        <p class="quiet">${selected ? (affordable ? `Leaves ${esc(person.name)} with ${left} pts` : `Earn ${short} more pts`) : "Pick a person"}</p>
        ${action}
      </div>
      <button data-delete-reward="${esc(reward.id)}">Remove reward</button>
    </article>`;
  }).join("");
  const history = (state.redemptions || []).slice(0, 8).map((row) => {
    const member = memberById(row.memberId);
    return `<div class="spread claim-row">
      <div class="device-main">${member ? letter(member.name, member.color) : ""}<div><strong>${esc(row.memberName)}: ${esc(row.rewardTitle)}</strong><p class="quiet">${row.cost} pts</p></div></div>
      <span class="chip-hot">${icon("complete")} Claimed</span>
    </div>`;
  }).join("");
  const form = ui.proposing ? `<section class="card stack">
      <label>Reward<input data-field="rewardTitle" value="${esc(ui.fields.rewardTitle)}" placeholder="Choose the Friday movie"></label>
      <label>What it is<input data-field="rewardDetail" value="${esc(ui.fields.rewardDetail)}" placeholder="They pick what the household watches"></label>
      <label>Point cost<input data-field="rewardCost" inputmode="numeric" value="${esc(ui.fields.rewardCost)}"></label>
      <div class="segment">
        <button data-set="rewardCategory" data-value="privilege" aria-pressed="${ui.fields.rewardCategory === "privilege"}">Privilege</button>
        <button data-set="rewardCategory" data-value="outing" aria-pressed="${ui.fields.rewardCategory === "outing"}">Outing</button>
        <button data-set="rewardCategory" data-value="badge" aria-pressed="${ui.fields.rewardCategory === "badge"}">Badge</button>
      </div>
      <button class="primary" data-action="add-reward">Save reward</button>
    </section>` : "";
  return `<div class="page">
    <h2>Family rewards</h2>
    <div class="spread"><p class="kicker">Family balances</p><span class="quiet">Tap a person</span></div>
    <div class="chips">${chips || `<p class="quiet">Add a person in Admin.</p>`}</div>
    ${person ? `<section class="card spread">
      <div class="device-main"><span class="device-mark">${icon("gift")}</span><div><p class="kicker">${esc(person.name)}'s points</p><h2>${balance}</h2><p class="quiet">points ready to spend</p></div></div>
    </section>` : ""}
    ${weekGoal()}
    <div class="chips">${filters.map(([key, label]) => `<button data-reward-filter="${key}" aria-pressed="${ui.rewardFilter === key}">${label}</button>`).join("")}</div>
    <div class="section-head"><h2>${person ? `Available for ${esc(person.name)}` : "Rewards"}</h2><button data-action="propose">${ui.proposing ? "Close" : "Propose reward"}</button></div>
    ${form}
    ${cards || `<p class="quiet">No rewards yet. Propose one the household can claim with points.</p>`}
    <section class="card stack">
      <h2>Recent claims</h2>
      ${history || `<p class="quiet">Nobody has claimed a reward yet.</p>`}
    </section>
  </div>`;
}

function monthTitle(ymd) {
  const [year, month, date] = ymd.split("-").map(Number);
  return new Intl.DateTimeFormat("en-US", { month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(Date.UTC(year, month - 1, date)));
}

function weekday(ymd) {
  const [year, month, date] = ymd.split("-").map(Number);
  return new Intl.DateTimeFormat("en-US", { weekday: "long", timeZone: "UTC" }).format(new Date(Date.UTC(year, month - 1, date)));
}

function isoWeek(ymd) {
  const [year, month, date] = ymd.split("-").map(Number);
  const cursor = new Date(Date.UTC(year, month - 1, date));
  const day = (cursor.getUTCDay() + 6) % 7;
  cursor.setUTCDate(cursor.getUTCDate() - day + 3);
  const first = new Date(Date.UTC(cursor.getUTCFullYear(), 0, 4));
  const firstDay = (first.getUTCDay() + 6) % 7;
  first.setUTCDate(first.getUTCDate() - firstDay + 3);
  return 1 + Math.round((cursor - first) / 604800000);
}

function dayDots(ymd) {
  const colors = [];
  for (const task of state.tasks || []) {
    if (task.due !== ymd) continue;
    const color = memberById(task.assigneeId)?.color || "#8c7168";
    if (!colors.includes(color)) colors.push(color);
  }
  return colors.slice(0, 3).map((color) => `<span class="dot ${tone(color)}"></span>`).join("");
}

function paceCard(day) {
  const open = (state.tasks || []).filter((task) => task.due === day && !task.resting);
  const earned = (state.completed || []).filter((award) => localDay(award.at) === day);
  const total = open.length + earned.length;
  const pts = earned.reduce((sum, award) => sum + award.points, 0);
  return `<section class="card spread">
    <div><h3>${weekday(day)}</h3><p class="quiet">${earned.length} of ${total || earned.length} chores finished</p></div>
    <span class="chip-hot">+${pts} pts</span>
  </section>`;
}

function choreStreak() {
  const days = new Set((state.completed || []).map((award) => localDay(award.at)));
  let cursor = days.has(state.today) ? state.today : addDays(state.today, -1);
  let count = 0;
  while (days.has(cursor) && count < 60) {
    count += 1;
    cursor = addDays(cursor, -1);
  }
  return count;
}

function calendar() {
  const day = ui.day || state.today;
  const mode = ["week", "month", "routines"].includes(ui.cal) ? ui.cal : "week";
  const legend = (state.members || []).map((member) => `<span class="meta">${dot(member.color)}${esc(member.name)}</span>`).join("")
    + `<span class="meta">${dot("#8c7168")}Anyone</span>`;
  let body = "";
  if (mode === "routines") {
    const list = (state.tasks || []).filter((task) => task.repeat === "daily" || task.repeat === "weekly");
    body = list.length ? list.map((task) => taskCard(task, false)).join("") : `<p class="quiet">No daily or weekly chores yet.</p>`;
  } else if (mode === "month") {
    const [year, month] = day.split("-").map(Number);
    const firstDow = (new Date(Date.UTC(year, month - 1, 1)).getUTCDay() + 6) % 7;
    const count = new Date(Date.UTC(year, month, 0)).getUTCDate();
    const names = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
    let grid = names.map((name) => `<span class="dow">${name}</span>`).join("");
    for (let i = 0; i < firstDow; i += 1) grid += "<span></span>";
    for (let date = 1; date <= count; date += 1) {
      const ymd = `${year}-${pad(month)}-${pad(date)}`;
      grid += `<button class="${ymd === state.today ? "is-today" : ""} ${ymd === day ? "is-picked" : ""}" data-pick-day="${ymd}">${date}<span class="dots">${dayDots(ymd)}</span></button>`;
    }
    body = `<div class="month">${grid}</div>${paceCard(day)}${dayTasks(day, state.tasks || [])}`;
  } else {
    const start = mondayOf(day);
    const names = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
    const strip = names.map((label, index) => {
      const date = addDays(start, index);
      return `<button class="week-day ${date === state.today ? "is-today" : ""} ${date === day ? "is-picked" : ""}" data-pick-day="${date}"><span>${label}</span><strong>${Number(date.slice(8))}</strong><span class="dots">${dayDots(date)}</span></button>`;
    }).join("");
    const laterEnd = addDays(start, 7);
    const later = (state.tasks || []).filter((task) => task.due && task.due > day && task.due < laterEnd);
    const streak = choreStreak();
    body = `<section class="card stack">
      <div class="spread"><h3>${monthTitle(day)}</h3><span class="pill">Week ${isoWeek(day)}</span></div>
      <div class="week-strip">${strip}</div>
    </section>
    ${paceCard(day)}
    <div class="section-head"><h2>${day === state.today ? "Today's schedule" : weekday(day)}</h2><span class="quiet">${weekday(day)}</span></div>
    ${dayTasks(day, state.tasks || [])}
    ${later.length ? `<h2>Later this week</h2>${later.map((task) => taskCard(task, false)).join("")}` : ""}
    ${streak ? `<section class="card spread"><div><h3>Household streak</h3><p class="quiet">${streak} days in a row with a finished chore.</p></div><p class="rank-points">${streak}<span>days</span></p></section>` : ""}`;
  }
  const overdue = mode !== "routines" && (state.overdue || []).length
    ? `<h2>Earlier</h2>${state.overdue.map((task) => taskCard(task, false)).join("")}`
    : "";
  return `<section class="page">
    <div><h2>Calendar</h2><p class="quiet">Household schedule</p></div>
    <div class="laneswitch">
      <button data-cal="week" aria-pressed="${mode === "week"}">This week</button>
      <button data-cal="month" aria-pressed="${mode === "month"}">Month</button>
      <button data-cal="routines" aria-pressed="${mode === "routines"}">Routines</button>
    </div>
    <div class="chips">${legend}</div>
    <div class="spread">
      <button data-cal-move="-1" aria-label="Previous">Prev</button>
      <button data-cal-today>Today</button>
      <button data-cal-move="1" aria-label="Next">Next</button>
    </div>
    ${body}
    ${overdue}
  </section>`;
}

function dayTasks(day, tasks) {
  const list = tasks.filter((task) => task.due === day);
  if (!list.length) return `<p class="quiet">Nothing on this day.</p>`;
  return list.map((task) => taskCard(task, false)).join("");
}

function completed() {
  const rows = state.completed || [];
  const list = rows.length
    ? rows.map((award) => {
        const member = memberById(award.memberId);
        return `<article class="card task ${tone(member?.color)}">
          <h3>${esc(award.taskTitle)}</h3>
          <p class="meta">${member ? letter(member.name, member.color) : ""}${icon("points")} ${award.points} ${esc(award.memberName)}</p>
          <button data-reassign="${esc(award.id)}">Change who</button>
          <button data-undo="${esc(award.id)}">Undo</button>
        </article>`;
      }).join("")
    : `<p class="quiet">No completed chores.</p>`;
  return `<section class="page"><h2>Completed</h2>${list}</section>`;
}

function colors(current) {
  return `<div class="colors">${PALETTE.map((color) => `<button class="color ${colorClass(color)}" data-set="color" data-value="${color}" aria-label="Color" aria-pressed="${current === color}"></button>`).join("")}</div>`;
}

function peopleBlock() {
  const list = (state.members || []).map((member) => `<article class="card person-line">
      <div class="device-main">${letter(member.name, member.color, true)}<div><h3>${esc(member.name)}</h3><p class="quiet">${pointsFor(member.id, "allTime")} pts earned</p></div></div>
      <button class="icon-btn" data-edit-member="${esc(member.id)}" aria-label="Edit ${esc(member.name)}">${icon("gear")}</button>
      ${ui.editing === member.id ? `<div class="fields full"><label>Name<input data-field="name" value="${esc(ui.fields.name || member.name)}"></label>${colors(ui.fields.color || member.color)}<button class="primary" data-save-member="${esc(member.id)}">Save</button><button data-remove-member="${esc(member.id)}">${ui.confirm === member.id ? "Remove now" : "Remove"}</button></div>` : ""}
    </article>`).join("");
  return `<section class="stack">
    <div class="section-head"><h2>People</h2><span class="quiet">${(state.members || []).length} members</span></div>
    ${list}
    <section class="card stack">
      <label>Name<input data-field="newName" value="${esc(ui.fields.newName || "")}"></label>
      ${colors(ui.fields.color)}
      <button class="primary" data-action="add-member">${icon("plus")} Add person</button>
    </section>
  </section>`;
}

function admin() {
  const modes = [["week", "Weekly"], ["month", "Monthly"], ["year", "Yearly"], ["never", "Never"]];
  const buttons = modes.map(([mode, label]) => `<button data-reset="${mode}" aria-pressed="${state.resetMode === mode}">${label}</button>`).join("");
  return `<section class="page">
    <div>
      <p class="kicker">On this server</p>
      <h2>Household admin</h2>
      <p class="quiet">People, phones, and the household code.</p>
    </div>
    <section class="card stack">
      <div class="device-main">${icon("lock")}<div><h2>Access</h2><p class="quiet">The household code stays on this server. It is not shown here.</p></div></div>
      <label>New code<input data-field="code" type="password" autocapitalize="off" autocomplete="off"></label>
      <label>Type it again<input data-field="confirm" type="password" autocapitalize="off" autocomplete="off"></label>
      <button data-action="code">Change code</button>
    </section>
    ${peopleBlock()}
    <section class="stack" id="devices">
      <h2>Connected devices</h2>
      <p class="quiet">Loading devices.</p>
    </section>
    <section class="card stack">
      <h2>Household</h2>
      <label>Timezone<input data-field="timezone" value="${esc(ui.fields.timezone || state.timezone || "")}" list="zones"></label>
      <datalist id="zones">
        <option value="America/New_York"></option>
        <option value="America/Chicago"></option>
        <option value="America/Denver"></option>
        <option value="America/Los_Angeles"></option>
        <option value="Europe/London"></option>
        <option value="UTC"></option>
      </datalist>
      <button data-action="timezone">Save timezone</button>
      <p class="quiet">When scores reset. The week starts Monday.</p>
      <div class="segment">${buttons}</div>
      <button class="primary" data-action="reset-now">Reset now</button>
      <button class="danger" data-action="wipe">${ui.confirm === "wipe" ? "Wipe data now" : "Wipe data"}</button>
      <button class="danger" data-action="delete-house">${ui.confirm === "delete" ? "Delete household now" : "Delete household"}</button>
      ${ui.error ? `<p class="quiet">${esc(ui.error)}</p>` : ""}
    </section>
  </section>`;
}

function peopleGrid(selectedLabel) {
  const people = state.members || [];
  if (!people.length) return `<p class="quiet">Add a person in Admin.</p>`;
  return `<div class="people-grid">${people.map((member) => {
    const on = ui.pickId === member.id;
    return `<button class="person-card${on ? " is-on" : ""}" data-choose="${esc(member.id)}" aria-pressed="${on}">
      ${letter(member.name, member.color)}
      <span><strong>${esc(member.name)}</strong><em>${pointsFor(member.id, "week")} pts</em><b class="gets">${on ? selectedLabel : "Select"}</b></span>
    </button>`;
  }).join("")}</div>`;
}

function sheet() {
  if (!ui.sheet) return "";
  let body = "";
  if (ui.sheet === "menu") {
    const theme = document.documentElement.dataset.theme === "dark" ? "dark" : "light";
    body = `<h2>Menu</h2>
      <div class="segment" role="group" aria-label="Appearance">
        <button data-theme="light" aria-pressed="${theme === "light"}">${icon("sun")} Light</button>
        <button data-theme="dark" aria-pressed="${theme === "dark"}">${icon("moon")} Dark</button>
      </div>
      <button data-view="completed">${icon("complete")} Completed</button>
      <button data-view="admin">${icon("gear")} Admin</button>`;
  } else if (ui.sheet === "add") {
    body = addForm();
  } else if (ui.sheet === "complete" || ui.sheet === "reassign") {
    const task = ui.sheet === "complete" ? taskById(ui.taskId) : null;
    const award = ui.sheet === "reassign" ? (state.completed || []).find((item) => item.id === ui.awardId) : null;
    const points = task ? task.score : award ? award.points : 0;
    const title = task?.title || award?.taskTitle || "This chore";
    const who = task ? personLabel(task.assigneeId) : award?.memberName || "";
    const picked = memberById(ui.pickId);
    const verb = ui.sheet === "complete" ? "Award" : "Give";
    const action = picked
      ? `${verb} +${points} pts to ${esc(picked.name)}`
      : "Choose who gets the points";
    body = `<div class="sheet-head">
        <div class="device-main"><span class="device-mark">${icon("points")}</span><h2>${ui.sheet === "complete" ? "Chore completed!" : "Who gets the points?"}</h2></div>
      </div>
      <div class="recap">
        <div><p>${icon("complete")} <strong>${esc(title)}</strong></p><p class="quiet">${task ? (task.assigneeId ? esc(who) : "Open to anyone") : esc(who)}</p></div>
        ${badge(points, true)}
      </div>
      <div class="spread"><p><strong>Who earned the points?</strong></p><span class="quiet">${picked ? "1 person selected" : "None selected"}</span></div>
      ${peopleGrid(`Receives +${points}`)}
      <p class="quiet">Points are saved on this household server. The chore's points stay ${points}.</p>
      <button class="primary award" data-award="1" ${picked ? "" : "disabled"}>${icon("complete")} ${action}</button>
      <button data-close="1">${ui.sheet === "complete" ? "Cancel / Keep in Today" : "Cancel"}</button>`;
  } else if (ui.sheet === "claim") {
    const task = taskById(ui.taskId);
    const picked = memberById(ui.pickId);
    const action = picked ? `Claim for ${esc(picked.name)}` : "Choose who is taking it";
    body = `<div class="sheet-head">
        <div class="device-main"><span class="device-mark">${icon("home")}</span><h2>Who is taking this?</h2></div>
      </div>
      <p><strong>${esc(task?.title || "This chore")}</strong></p>
      <p class="quiet">Anyone is not a person. Pick who it belongs to. It can be finished after that.</p>
      ${peopleGrid("Takes this chore")}
      <button class="primary award" data-claim-for="1" ${picked ? "" : "disabled"}>${icon("complete")} ${action}</button>
      <button data-close="1">Cancel</button>`;
  }
  return `<dialog class="sheet" id="sheet" closedby="any" aria-label="Taskspark"><div class="grab"></div><div class="sheet-body"><button class="icon-btn" data-close="1" aria-label="Close">${icon("close")}</button>${body}</div></dialog>`;
}

function shell() {
  const page = {
    calendar: calendar,
    completed: completed,
    admin: admin,
    leaderboard: leaderboard,
    rewards: rewards,
  }[ui.view] || board;
  const fab = ui.view === "board" ? `<button class="fab" data-open="add" aria-label="New chore">${icon("plus")} New chore</button>` : "";
  return `<main class="phone">${header()}${page()}${fab}${tabbar()}${sheet()}</main>`;
}

function render() {
  sheetEpoch += 1;
  const epoch = sheetEpoch;
  const root = document.getElementById("app");
  if (!state || state.phase === "setup") root.innerHTML = setupScreen();
  else if (state.phase === "locked") root.innerHTML = lockScreen();
  else if (state.phase === "waiting") root.innerHTML = waitScreen();
  else root.innerHTML = shell();
  const dialog = document.getElementById("sheet");
  if (dialog && !dialog.open) {
    dialog.showModal();
    dialog.addEventListener("close", () => {
      if (epoch !== sheetEpoch || !ui.sheet) return;
      ui.sheet = null;
      ui.pickId = null;
      render();
    });
    if (!("closedBy" in HTMLDialogElement.prototype)) {
      dialog.addEventListener("click", (event) => {
        if (event.target !== dialog) return;
        const rect = dialog.getBoundingClientRect();
        const inside = rect.top <= event.clientY && event.clientY <= rect.bottom && rect.left <= event.clientX && event.clientX <= rect.right;
        if (!inside) dialog.close();
      });
    }
  }
  if (ui.view === "admin" && state.phase === "board") loadDevices();
}

async function loadDevices() {
  const res = await fetch("api/devices", { credentials: "same-origin" });
  const data = await res.json().catch(() => null);
  const host = document.getElementById("devices");
  if (!host || !data?.devices) return;
  const waiting = data.devices.filter((device) => device.status === "pending");
  const rest = data.devices.filter((device) => device.status !== "pending");
  const pendingCards = waiting.map((device) => {
    const title = device.label || device.kind;
    return `<article class="card pairing stack" data-device-card="${esc(device.id)}">
      <p class="kicker">Waiting</p>
      <h3>${esc(title)}</h3>
      <p class="quiet">${esc(device.kind || "Unknown browser")}</p>
      <div class="row-actions">
        <button class="primary" data-device="approve" data-id="${esc(device.id)}">${icon("complete")} Approve</button>
        <button data-device="revoke" data-id="${esc(device.id)}">Deny</button>
      </div>
    </article>`;
  }).join("");
  const rows = rest.map((device) => {
    const title = device.name || device.label || device.kind;
    const kind = device.kind && device.kind !== title ? device.kind : "";
    const status = device.status === "approved" ? "Approved" : "Revoked";
    const action = device.status === "approved"
      ? `<button data-device="revoke" data-id="${esc(device.id)}">Revoke</button>`
      : `<button class="primary" data-device="approve" data-id="${esc(device.id)}">Approve</button>`;
    const name = device.status === "approved"
      ? `<label>Name<input data-device-name value="${esc(device.name || "")}" maxlength="40" placeholder="Kitchen iPad" autocomplete="off"></label>
         <button data-device="rename" data-id="${esc(device.id)}">Save name</button>`
      : "";
    return `<article class="card stack" data-device-card="${esc(device.id)}">
      <div class="device-row">
        <div class="device-main"><span class="device-mark">${icon("phone")}</span><div><h3>${esc(title)}</h3><p class="quiet">${esc([kind, status].filter(Boolean).join(" · "))}</p></div></div>
        ${action}
      </div>
      ${name}
    </article>`;
  }).join("");
  const approved = data.devices.filter((device) => device.status === "approved").length;
  host.innerHTML = `<div class="section-head"><h2>Connected devices</h2></div>
    <p class="quiet">${approved} approved, ${waiting.length} waiting</p>
    ${pendingCards}${rows}` || `<p class="quiet">No devices.</p>`;
}

function applyTheme(theme) {
  const next = theme === "dark" ? "dark" : "light";
  document.documentElement.dataset.theme = next;
  document.documentElement.style.colorScheme = next;
  const scheme = document.querySelector('meta[name="color-scheme"]');
  if (scheme) scheme.content = next;
  const color = document.querySelector('meta[name="theme-color"]');
  if (color) color.content = next === "dark" ? "#1c1916" : "#fff8f2";
  try {
    localStorage.setItem("taskspark-theme", next);
  } catch {
    /* the board still switches for this visit */
  }
}

function field(name) {
  const node = document.querySelector(`[data-field="${name}"]`);
  if (!node) return ui.fields[name];
  return node.value;
}

document.addEventListener("click", async (event) => {
  const target = event.target.closest("button");
  if (!target) return;
  if (target.dataset.theme) {
    applyTheme(target.dataset.theme);
    render();
    return;
  }
  if (target.dataset.open) {
    ui.sheet = target.dataset.open;
    ui.pickId = null;
    render();
    return;
  }
  if (target.dataset.close || target.dataset.view) {
    if (target.dataset.view) {
      ui.view = target.dataset.view;
      ui.day = state.today || ui.day;
    }
    ui.sheet = null;
    ui.pickId = null;
    ui.confirm = null;
    render();
    return;
  }
  if (target.dataset.lane) {
    ui.lane = target.dataset.lane;
    render();
    return;
  }
  if (target.dataset.filter) {
    ui.filter = target.dataset.filter;
    render();
    return;
  }
  if (target.dataset.preset) {
    ui.fields.title = target.dataset.preset;
    render();
    return;
  }
  if (target.dataset.rewardMember) {
    ui.rewardMember = target.dataset.rewardMember;
    render();
    return;
  }
  if (target.dataset.rewardFilter) {
    ui.rewardFilter = target.dataset.rewardFilter;
    render();
    return;
  }
  if (target.dataset.action === "propose") {
    ui.proposing = !ui.proposing;
    render();
    return;
  }
  if (target.dataset.action === "add-reward") {
    const cost = Number(field("rewardCost"));
    const data = await send("api/rewards", "POST", {
      title: field("rewardTitle"),
      detail: field("rewardDetail"),
      cost,
      category: ui.fields.rewardCategory || "privilege",
    });
    if (data) {
      ui.proposing = false;
      ui.fields.rewardTitle = "";
      ui.fields.rewardDetail = "";
      ui.fields.rewardCost = "20";
      render();
    }
    return;
  }
  if (target.dataset.claim) {
    const memberId = ui.rewardMember || state.members?.[0]?.id;
    if (!memberId) return;
    await send(`api/rewards/${target.dataset.claim}/claim`, "POST", { memberId });
    return;
  }
  if (target.dataset.deleteReward) {
    await send(`api/rewards/${target.dataset.deleteReward}`, "DELETE", {});
    return;
  }
  if (target.dataset.choose) {
    ui.pickId = target.dataset.choose;
    render();
    return;
  }
  if (target.dataset.action === "setup") {
    await send("api/setup", "POST", { code: field("code"), confirm: field("confirm") });
    return;
  }
  if (target.dataset.action === "unlock") {
    await send("api/unlock", "POST", { code: field("code") });
    return;
  }
  if (target.dataset.set) {
    ui.fields[target.dataset.set] = target.dataset.value;
    render();
    return;
  }
  if (target.dataset.score) {
    ui.boardPeriod = target.dataset.score;
    render();
    return;
  }
  if (target.dataset.action === "add-task") {
    const points = chosenPoints();
    if (!points) {
      ui.error = "Pick 5, 10, or 20.";
      render();
      return;
    }
    const data = await send("api/tasks", "POST", {
      title: field("title"),
      points,
      assigneeId: ui.fields.assigneeId || null,
      bucket: ui.fields.bucket,
      repeat: ui.fields.repeat,
    });
    if (data) {
      ui.adding = false;
      ui.sheet = null;
      ui.fields = blankFields();
      render();
    }
    return;
  }
  if (target.dataset.complete) {
    ui.sheet = "complete";
    ui.taskId = target.dataset.complete;
    ui.pickId = null;
    render();
    return;
  }
  if (target.dataset.reassign) {
    ui.sheet = "reassign";
    ui.awardId = target.dataset.reassign;
    ui.pickId = null;
    render();
    return;
  }
  if (target.dataset.award || target.dataset.pick) {
    const memberId = target.dataset.pick || ui.pickId;
    if (!memberId) return;
    const sheet = ui.sheet;
    const taskId = ui.taskId;
    const awardId = ui.awardId;
    ui.sheet = null;
    ui.pickId = null;
    if (sheet === "complete") {
      const data = await send(`api/tasks/${taskId}/complete`, "POST", { memberId });
      if (data?.awarded) ui.toast = { id: data.awarded.id, text: `${data.awarded.points} points for ${data.awarded.memberName}` };
    } else {
      await send(`api/awards/${awardId}/member`, "POST", { memberId });
    }
    render();
    return;
  }
  if (target.dataset.undo) {
    await send(`api/awards/${target.dataset.undo}/undo`, "POST", {});
    ui.toast = null;
    render();
    return;
  }
  if (target.dataset.claimChore) {
    ui.sheet = "claim";
    ui.taskId = target.dataset.claimChore;
    ui.pickId = null;
    render();
    return;
  }
  if (target.dataset.claimFor) {
    const memberId = ui.pickId;
    const taskId = ui.taskId;
    if (!memberId || !taskId) return;
    ui.sheet = null;
    ui.pickId = null;
    await send(`api/tasks/${taskId}/claim`, "POST", { memberId });
    render();
    return;
  }
  if (target.dataset.edit) {
    const task = (state.tasks || []).find((item) => item.id === target.dataset.edit) || state.hero;
    ui.editing = target.dataset.edit;
    ui.fields.title = task?.title || "";
    ui.fields.points = task?.points || 10;
    ui.fields.repeat = task?.repeat || "none";
    ui.fields.due = task?.due || "";
    ui.fields.bucket = task?.bucket || "today";
    render();
    return;
  }
  if (target.dataset.saveTask) {
    const task = (state.tasks || []).concat(state.hero || []).find((item) => item && item.id === target.dataset.saveTask);
    const points = chosenPoints();
    if (!points) {
      ui.error = "Pick 5, 10, or 20.";
      render();
      return;
    }
    const bucket = ui.fields.bucket || task?.bucket || "today";
    const typed = field("due") || "";
    let due = null;
    if (bucket === "today") due = state.today;
    else if (bucket === "tomorrow") due = state.tomorrow;
    else if (typed > (state.tomorrow || "")) due = typed;
    await send(`api/tasks/${target.dataset.saveTask}`, "POST", {
      title: field("title"),
      points,
      assigneeId: task?.assigneeId || null,
      bucket,
      repeat: ui.fields.repeat,
      due,
    });
    ui.editing = null;
    render();
    return;
  }
  if (target.dataset.deleteTask) {
    await send(`api/tasks/${target.dataset.deleteTask}`, "DELETE", {});
    ui.editing = null;
    render();
    return;
  }
  if (target.dataset.cal) {
    ui.cal = target.dataset.cal;
    render();
    return;
  }
  if (target.dataset.calMove) {
    const delta = Number(target.dataset.calMove);
    const day = ui.day || state.today;
    ui.day = ui.cal === "month" ? shiftMonth(day, delta) : addDays(day, 7);
    render();
    return;
  }
  if (target.dataset.calToday !== undefined && target.hasAttribute("data-cal-today")) {
    ui.day = state.today;
    render();
    return;
  }
  if (target.dataset.pickDay) {
    ui.day = target.dataset.pickDay;
    render();
    return;
  }
  if (target.dataset.action === "timezone") {
    await send("api/timezone", "POST", { timezone: field("timezone") });
    render();
    return;
  }
  if (target.dataset.action === "code") {
    await send("api/code", "POST", { code: field("code"), confirm: field("confirm") });
    ui.fields.code = "";
    ui.fields.confirm = "";
    render();
    return;
  }
  if (target.dataset.action === "wipe") {
    if (ui.confirm !== "wipe") {
      ui.confirm = "wipe";
      render();
      return;
    }
    await send("api/wipe", "POST", {});
    ui.confirm = null;
    ui.view = "board";
    render();
    return;
  }
  if (target.dataset.action === "delete-house") {
    if (ui.confirm !== "delete") {
      ui.confirm = "delete";
      render();
      return;
    }
    await send("api/delete-household", "POST", {});
    return;
  }
  if (target.dataset.reset) {
    await send("api/reset-mode", "POST", { resetMode: target.dataset.reset });
    render();
    return;
  }
  if (target.dataset.action === "reset-now") {
    await send("api/reset-now", "POST", {});
    render();
    return;
  }
  if (target.dataset.action === "add-member") {
    await send("api/members", "POST", { name: field("newName"), color: ui.fields.color });
    ui.fields.newName = "";
    render();
    return;
  }
  if (target.dataset.editMember) {
    const member = memberById(target.dataset.editMember);
    ui.editing = member.id;
    ui.fields.name = member.name;
    ui.fields.color = member.color;
    render();
    return;
  }
  if (target.dataset.saveMember) {
    await send(`api/members/${target.dataset.saveMember}`, "POST", { name: field("name"), color: ui.fields.color });
    ui.editing = null;
    ui.fields.name = "";
    render();
    return;
  }
  if (target.dataset.removeMember) {
    if (ui.confirm !== target.dataset.removeMember) {
      ui.confirm = target.dataset.removeMember;
      render();
      return;
    }
    await send(`api/members/${target.dataset.removeMember}`, "DELETE", {});
    ui.confirm = null;
    render();
    return;
  }
  if (target.dataset.device === "rename") {
    const card = target.closest("[data-device-card]");
    const name = card?.querySelector("[data-device-name]")?.value || "";
    await send(`api/devices/${target.dataset.id}/name`, "POST", { name });
    await loadDevices();
    return;
  }
  if (target.dataset.device) {
    await send(`api/devices/${target.dataset.id}/${target.dataset.device}`, "POST", {});
    await loadDevices();
  }
});

document.addEventListener("pointerdown", (event) => {
  const grip = event.target.closest("[data-grip]");
  if (!grip) return;
  const card = grip.closest(".task");
  drag = { id: card.dataset.id, pointer: event.pointerId, y: event.clientY, card };
  grip.setPointerCapture(event.pointerId);
  card.classList.add("dragging");
});

document.addEventListener("pointermove", (event) => {
  if (!drag || event.pointerId !== drag.pointer) return;
  drag.card.style.transform = `translateY(${event.clientY - drag.y}px)`;
});

document.addEventListener("pointerup", async (event) => {
  if (!drag || event.pointerId !== drag.pointer) return;
  const card = drag.card;
  const id = drag.id;
  card.style.visibility = "hidden";
  const hit = document.elementFromPoint(event.clientX, event.clientY);
  card.style.visibility = "";
  card.style.transform = "";
  card.classList.remove("dragging");
  drag = null;
  const zone = hit?.closest("[data-bucket]");
  if (!zone) return;
  const cards = [...zone.querySelectorAll(".task")].filter((item) => item.dataset.id !== id);
  let index = cards.length;
  for (let i = 0; i < cards.length; i += 1) {
    const box = cards[i].getBoundingClientRect();
    if (event.clientY < box.top + box.height / 2) {
      index = i;
      break;
    }
  }
  await send("api/tasks/reorder", "POST", { id, bucket: zone.dataset.bucket, index });
  render();
});

document.addEventListener("input", (event) => {
  const node = event.target.closest("[data-field]");
  if (!node) return;
  ui.fields[node.dataset.field] = node.value;
});

if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("sw.js").catch(() => {});
}

load();
