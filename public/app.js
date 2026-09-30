import { avatar, colorClass, esc, icon, PALETTE } from "./icons.js";

const ui = {
  view: "board",
  admin: "household",
  sheet: null,
  taskId: null,
  awardId: null,
  cal: "month",
  day: null,
  adding: false,
  editing: null,
  boardPeriod: "week",
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
  render();
}

function gate(title, body) {
  return `<main class="app"><h1>Taskspark</h1><section class="panel">${title}${body}</section></main>`;
}

function setupScreen() {
  return gate(
    "<h2>Choose a code</h2>",
    `<label>Code<input data-field="code" type="password" autocapitalize="off" autocomplete="off" spellcheck="false"></label>
     <label>Type it again<input data-field="confirm" type="password" autocapitalize="off" autocomplete="off" spellcheck="false"></label>
     <p class="quiet">At least 4 characters.</p>
     ${ui.error ? `<p class="quiet">${esc(ui.error)}</p>` : ""}
     <button class="primary" data-action="setup">Save</button>`,
  );
}

function lockScreen() {
  return gate(
    "",
    `<label>Code<input data-field="code" type="password" autocapitalize="off" autocomplete="off" spellcheck="false"></label>
     ${ui.error ? `<p class="quiet">${esc(ui.error)}</p>` : ""}
     <button class="primary" data-action="unlock">Open</button>`,
  );
}

function waitScreen() {
  return gate("<h2>Waiting for approval.</h2>", "");
}

function header() {
  return `<header class="topbar">
    <button class="icon-btn" data-open="menu" aria-label="Menu">${icon("burger")}</button>
    <h1>Taskspark</h1>
    <button class="icon-btn" data-open="score" aria-label="Scoreboard">${icon("crown")}</button>
  </header>`;
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

function pointsPill(score) {
  return `<span class="points-pill">${icon("points")}<span>${score}</span></span>`;
}

function pointsPick(current) {
  const value = Number(current);
  return `<div class="points-picks" role="group" aria-label="Points">${[5, 10, 20]
    .map((points) => `<button type="button" data-set="points" data-value="${points}" aria-pressed="${value === points}">${points}</button>`)
    .join("")}</div>`;
}

function chosenPoints() {
  const points = Number(ui.fields.points);
  return points === 5 || points === 10 || points === 20 ? points : null;
}

function taskCard(task, allowDrag) {
  const who = memberById(task.assigneeId);
  const repeat = repeatLabel(task);
  return `<article class="task" data-id="${esc(task.id)}">
    <div class="task-row">
      ${allowDrag ? `<button class="grip" data-grip aria-label="Reorder">${icon("grip")}</button>` : ""}
      ${task.resting ? `<span class="resting">Done</span>` : `<button class="check" data-complete="${esc(task.id)}" aria-label="Complete ${esc(task.title)}">${icon("complete")}</button>`}
      <div class="task-copy">
        <h3>${esc(task.title)}</h3>
        <p class="meta">${who ? avatar(who.name, who.color) : ""}<span>${esc(personLabel(task.assigneeId))}${repeat ? ` · ${esc(repeat)}` : ""}</span></p>
      </div>
      ${pointsPill(task.score)}
    </div>
    ${allowDrag ? `<div class="segment" aria-label="When">
      <button data-move="today" aria-pressed="${task.bucket === "today"}">Today</button>
      <button data-move="tomorrow" aria-pressed="${task.bucket === "tomorrow"}">Tomorrow</button>
      <button data-move="later" aria-pressed="${task.bucket === "later"}">Later</button>
    </div>
    <button data-edit="${esc(task.id)}">Edit</button>` : ""}
    ${ui.editing === task.id ? editForm(task) : ""}
  </article>`;
}

function editForm(task) {
  const stored = Number(task.points);
  const legacy = stored !== 5 && stored !== 10 && stored !== 20
    ? `<p class="quiet">This task is worth ${stored}. Pick 5, 10, or 20.</p>`
    : "";
  return `<div class="panel">
    <label>Title<input data-field="title" value="${esc(ui.fields.title || task.title)}"></label>
    ${pointsPick(ui.fields.points)}
    ${legacy}
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

function lane(name, title, tasks, empty) {
  const count = tasks.length;
  const body = count
    ? tasks.map((task) => taskCard(task, true)).join("")
    : `<p class="empty-row">${empty}</p>`;
  return `<section class="lane ${name}" data-bucket="${name}">
    <div class="lane-head"><h2>${title}</h2><span class="count">${count}</span></div>
    ${body}
  </section>`;
}

function spotlight() {
  if (!state.hero) {
    const overdue = state.overdue?.length
      ? `<button data-view="calendar">${icon("calendar")} Earlier tasks are on the calendar</button>`
      : "";
    return `<section class="spotlight is-empty">
      <div class="empty-mark" aria-hidden="true">${icon("points")}</div>
      <p class="kicker">Now</p>
      <h2>Nothing to do right now</h2>
      <p class="quiet">The next task shows up here.</p>
      ${overdue}
    </section>`;
  }
  const hero = state.hero;
  const who = memberById(hero.assigneeId);
  const repeat = repeatLabel(hero);
  return `<section class="spotlight" data-id="${esc(hero.id)}">
    <div class="spotlight-top">
      <p class="kicker">Now</p>
      ${pointsPill(hero.score)}
    </div>
    <h2>${esc(hero.title)}</h2>
    <p class="meta">${who ? avatar(who.name, who.color) : ""}<span>${esc(personLabel(hero.assigneeId))}${repeat ? ` · ${esc(repeat)}` : ""}</span></p>
    <button class="complete" data-complete="${esc(hero.id)}">${icon("complete")} Complete</button>
    <div class="move-row">
      <span class="quiet">Move</span>
      <button data-move="tomorrow">Tomorrow</button>
      <button data-move="later">Later</button>
    </div>
  </section>`;
}

function board() {
  return `${spotlight()}
    ${toast()}
    <div class="lanes">
      ${lane("today", "Today", state.todayTasks || [], "Nothing else today.")}
      ${lane("tomorrow", "Tomorrow", state.tomorrowTasks || [], "Tomorrow is clear.")}
      ${lane("later", "Later", state.laterTasks || [], "Nothing waiting.")}
    </div>
    <section class="composer">
      <button data-action="add-toggle">${ui.adding ? "Close" : "Add a task"}</button>
      ${ui.adding ? addForm() : ""}
      ${state.members?.length ? "" : `<p class="quiet">Add a person in Admin.</p>`}
    </section>
    ${ui.error ? `<p class="quiet">${esc(ui.error)}</p>` : ""}`;
}

function addForm() {
  const people = [`<button data-set="assigneeId" data-value="" aria-pressed="${ui.fields.assigneeId === ""}">Anyone</button>`]
    .concat((state.members || []).map((member) => `<button data-set="assigneeId" data-value="${esc(member.id)}" aria-pressed="${ui.fields.assigneeId === member.id}">${esc(member.name)}</button>`))
    .join("");
  return `<label>Title<input data-field="title" value="${esc(ui.fields.title)}"></label>
    ${pointsPick(ui.fields.points)}
    <div class="segment wrap">${people}</div>
    <div class="segment">
      <button data-set="bucket" data-value="today" aria-pressed="${ui.fields.bucket === "today"}">Today</button>
      <button data-set="bucket" data-value="tomorrow" aria-pressed="${ui.fields.bucket === "tomorrow"}">Tomorrow</button>
      <button data-set="bucket" data-value="later" aria-pressed="${ui.fields.bucket === "later"}">Later</button>
    </div>
    <div class="segment">
      <button data-set="repeat" data-value="none" aria-pressed="${ui.fields.repeat === "none"}">Once</button>
      <button data-set="repeat" data-value="daily" aria-pressed="${ui.fields.repeat === "daily"}">Daily</button>
      <button data-set="repeat" data-value="weekly" aria-pressed="${ui.fields.repeat === "weekly"}">Weekly</button>
    </div>
    <button class="primary" data-action="add-task">Add</button>`;
}

function calendar() {
  const day = ui.day || state.today;
  const tasks = state.tasks || [];
  let body = "";
  if (ui.cal === "day") {
    body = dayTasks(day, tasks);
  } else if (ui.cal === "week") {
    const start = mondayOf(day);
    body = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((label, index) => {
      const date = addDays(start, index);
      return `<button class="day-row ${date === state.today ? "is-today" : ""}" data-pick-day="${date}">${label} ${date.slice(8)} ${date === state.today ? "Today" : ""}</button>${date === day ? dayTasks(date, tasks) : ""}`;
    }).join("");
  } else {
    const [year, month] = day.split("-").map(Number);
    const firstDow = (new Date(Date.UTC(year, month - 1, 1)).getUTCDay() + 6) % 7;
    const count = new Date(Date.UTC(year, month, 0)).getUTCDate();
    const names = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
    const cells = names.map((name) => `<span class="dow">${name}</span>`).join("");
    let grid = "";
    for (let i = 0; i < firstDow; i += 1) grid += "<span></span>";
    for (let date = 1; date <= count; date += 1) {
      const ymd = `${year}-${pad(month)}-${pad(date)}`;
      const marked = tasks.some((task) => task.due === ymd) ? " ·" : "";
      grid += `<button class="${ymd === state.today ? "is-today" : ""}" data-pick-day="${ymd}" aria-current="${ymd === state.today ? "date" : "false"}">${date}${marked}</button>`;
    }
    body = `<div class="month">${cells}${grid}</div>${dayTasks(day, tasks)}`;
  }
  const overdue = (state.overdue || []).map((task) => taskCard(task, false)).join("");
  return `<section class="stack">
    <button data-view="board">Board</button>
    <div class="switcher">
      <button data-cal="day" aria-pressed="${ui.cal === "day"}">Daily</button>
      <button data-cal="week" aria-pressed="${ui.cal === "week"}">Weekly</button>
      <button data-cal="month" aria-pressed="${ui.cal === "month"}">Monthly</button>
    </div>
    <div class="spread">
      <button data-cal-move="-1" aria-label="Previous">Prev</button>
      <h2>${esc(day)}</h2>
      <button data-cal-move="1" aria-label="Next">Next</button>
    </div>
    <button data-cal-today>Today</button>
    ${body}
    ${overdue ? `<section class="stack"><h2>Overdue</h2>${overdue}</section>` : ""}
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
        return `<article class="task"><div class="task-body">
          <h3>${esc(award.taskTitle)}</h3>
          <p class="meta">${member ? avatar(member.name, member.color) : ""}${icon("points")} ${award.points} ${esc(award.memberName)}</p>
          <button data-reassign="${esc(award.id)}">Change who</button>
          <button data-undo="${esc(award.id)}">Undo</button>
        </div></article>`;
      }).join("")
    : `<p class="quiet">No completed tasks.</p>`;
  return `<section class="stack"><button data-view="board">Board</button><h2>Completed</h2>${list}</section>`;
}

function admin() {
  const tabs = ["household", "people", "devices", "leaderboard"].map((tab) => {
    const label = { household: "Household", people: "People", devices: "Devices", leaderboard: "Leaderboard" }[tab];
    return `<button data-admin="${tab}" aria-pressed="${ui.admin === tab}">${label}</button>`;
  }).join("");
  return `<section class="stack"><button data-view="board">Board</button><div class="tabs">${tabs}</div>${adminPane()}</section>`;
}

function adminPane() {
  if (ui.admin === "people") return peoplePane();
  if (ui.admin === "devices") return `<div id="devices"><p class="quiet">Loading devices.</p></div>`;
  if (ui.admin === "leaderboard") return leaderPane();
  return `<section class="panel">
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
    <label>New code<input data-field="code" type="password" autocapitalize="off" autocomplete="off"></label>
    <label>Type it again<input data-field="confirm" type="password" autocapitalize="off" autocomplete="off"></label>
    <button data-action="code">Change code</button>
    <button class="danger" data-action="wipe">${ui.confirm === "wipe" ? "Wipe data now" : "Wipe data"}</button>
    <button class="danger" data-action="delete-house">${ui.confirm === "delete" ? "Delete household now" : "Delete household"}</button>
    ${ui.error ? `<p class="quiet">${esc(ui.error)}</p>` : ""}
  </section>`;
}

function peoplePane() {
  const list = (state.members || []).map((member) => `<article class="task"><div class="task-body">
      <p class="person">${avatar(member.name, member.color)} ${esc(member.name)}</p>
      <button data-edit-member="${esc(member.id)}">Edit</button>
      <button data-remove-member="${esc(member.id)}">${ui.confirm === member.id ? "Remove now" : "Remove"}</button>
      ${ui.editing === member.id ? `<label>Name<input data-field="name" value="${esc(ui.fields.name || member.name)}"></label>${colors(ui.fields.color || member.color)}<button data-save-member="${esc(member.id)}">Save</button>` : ""}
    </div></article>`).join("");
  return `<section class="stack">${list}
    <section class="panel">
      <label>Name<input data-field="newName" value="${esc(ui.fields.newName || "")}"></label>
      ${colors(ui.fields.color)}
      <button class="primary" data-action="add-member">Add person</button>
    </section>
  </section>`;
}

function colors(current) {
  return `<div class="colors">${PALETTE.map((color) => `<button class="color ${colorClass(color)}" data-set="color" data-value="${color}" aria-label="Color" aria-pressed="${current === color}"></button>`).join("")}</div>`;
}

function leaderPane() {
  const modes = [["week", "Weekly"], ["month", "Monthly"], ["year", "Yearly"], ["never", "Never"]];
  const buttons = modes.map(([mode, label]) => `<button data-reset="${mode}" aria-pressed="${state.resetMode === mode}">${label}</button>`).join("");
  const archive = (state.periods || []).slice(0, 8).map((row) => `<p class="score-line"><span>${esc(row.kind)}</span><span>${row.memberName ? esc(row.memberName) : "No winner"} ${row.points}</span></p>`).join("");
  return `<section class="panel"><div class="segment">${buttons}</div><button class="primary" data-action="reset-now">Reset now</button>${archive}</section>`;
}

function ranked(rows) {
  return [...(rows || [])].sort((a, b) => b.points - a.points || a.name.localeCompare(b.name));
}

function placeSlot(row, place) {
  if (!row) {
    return `<div class="place place-${place} is-open"><div class="place-block" aria-hidden="true">${place}</div></div>`;
  }
  const member = memberById(row.memberId);
  return `<div class="place place-${place}">
    <div class="place-person">${place === 1 ? icon("crown") : ""}${member ? avatar(member.name, member.color) : ""}</div>
    <p class="place-name">${esc(row.name)}</p>
    <p class="place-points">${icon("points")} ${row.points}</p>
    <div class="place-block" aria-hidden="true">${place}</div>
  </div>`;
}

function podium(rows) {
  const top = ranked(rows).filter((row) => row.points > 0).slice(0, 3);
  const slots = [
    { row: top[1], place: 2 },
    { row: top[0], place: 1 },
    { row: top[2], place: 3 },
  ];
  return `<div class="podium">${slots.map((slot) => placeSlot(slot.row, slot.place)).join("")}</div>`;
}

function emptyPodium() {
  return `<div class="podium is-empty" aria-hidden="true">${[2, 1, 3].map((place) => `<div class="place place-${place}"><div class="place-block">${place}</div></div>`).join("")}</div>`;
}

function rankRow(row, place) {
  const member = memberById(row.memberId);
  return `<li class="rank-row">
    <span class="rank-num">${place}</span>
    ${member ? avatar(member.name, member.color) : ""}
    <span class="rank-name">${esc(row.name)}</span>
    <span class="rank-points">${row.points}</span>
  </li>`;
}

function standings(rows, period) {
  const ordered = ranked(rows);
  if (!ordered.some((row) => row.points > 0)) {
    const sentence = {
      week: "Nobody has points this week.",
      month: "Nobody has points this month.",
      year: "Nobody has points this year.",
      allTime: "Nobody has points yet.",
      period: "Nobody has points this period.",
    }[period];
    return `${emptyPodium()}<p class="score-empty">${sentence}</p>`;
  }
  return `${podium(ordered)}<ol class="rank-list">${ordered.map((row, index) => rankRow(row, index + 1)).join("")}</ol>`;
}

function winnerLine(title, winner, mark) {
  const name = winner ? esc(winner.name) : "No winner";
  const points = winner ? winner.points : "";
  return `<p class="winner-row">${mark}<span class="winner-label">${title}</span><span class="winner-name">${name}</span><span class="winner-points">${points}</span></p>`;
}

function sheet() {
  if (!ui.sheet) return "";
  let body = "";
  if (ui.sheet === "menu") {
    const theme = document.documentElement.dataset.theme === "dark" ? "dark" : "light";
    body = `<div class="segment" role="group" aria-label="Appearance">
        <button data-theme="light" aria-pressed="${theme === "light"}">${icon("sun")} Light</button>
        <button data-theme="dark" aria-pressed="${theme === "dark"}">${icon("moon")} Dark</button>
      </div>
      <button data-view="calendar">${icon("calendar")} Calendar</button>
      <button data-view="completed">${icon("complete")} Completed</button>
      <button data-view="admin">${icon("gear")} Admin</button>`;
  } else if (ui.sheet === "score") {
    const board = state.leaderboard || { allTime: [], week: [], month: [], year: [], period: [], lastWeek: null, lastMonth: null };
    const periods = [["week", "Week"], ["month", "Month"], ["year", "Year"], ["allTime", "All-time"]];
    if (state.cutoff) periods.push(["period", "Period"]);
    if (!periods.some(([key]) => key === ui.boardPeriod)) ui.boardPeriod = "week";
    const control = periods.map(([key, label]) => `<button data-score="${key}" aria-pressed="${ui.boardPeriod === key}">${label}</button>`).join("");
    body = `<h2>Scoreboard</h2>
      <div class="segment" role="group" aria-label="Score period">${control}</div>
      ${standings(board[ui.boardPeriod] || [], ui.boardPeriod)}
      <div class="winner-stack">
        ${winnerLine("Last week", board.lastWeek, icon("crown"))}
        ${winnerLine("Last month", board.lastMonth, icon("month"))}
      </div>`;
  } else if (ui.sheet === "complete" || ui.sheet === "reassign") {
    const people = state.members || [];
    body = people.length
      ? people.map((member) => `<button class="member-pick" data-pick="${esc(member.id)}">${avatar(member.name, member.color)} ${esc(member.name)}</button>`).join("")
      : `<p>Add a person in Admin.</p>`;
    body = `<h2>${ui.sheet === "complete" ? "Who did this?" : "Who gets the points?"}</h2>${body}`;
  }
  return `<dialog class="sheet" id="sheet" closedby="any" aria-label="Taskspark"><div class="sheet-body"><button class="icon-btn" data-close="1" aria-label="Close">${icon("close")}</button>${body}</div></dialog>`;
}

function shell() {
  const page = ui.view === "calendar" ? calendar() : ui.view === "completed" ? completed() : ui.view === "admin" ? admin() : board();
  return `<main class="app">${header()}${page}${sheet()}</main>`;
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
  if (ui.view === "admin" && ui.admin === "devices" && state.phase === "board") loadDevices();
}

async function loadDevices() {
  const data = await send("api/devices", "GET");
  const host = document.getElementById("devices");
  if (!host || !data?.devices) return;
  host.innerHTML = data.devices.map((device) => {
    const action = device.status === "approved"
      ? `<button data-device="revoke" data-id="${esc(device.id)}">Revoke</button>`
      : `<button class="primary" data-device="approve" data-id="${esc(device.id)}">Approve</button>`;
    return `<article class="task"><div class="task-body"><h3>${esc(device.label)}</h3><p class="quiet">${esc(device.status)}</p>${action}</div></article>`;
  }).join("") || `<p class="quiet">No devices.</p>`;
}

function applyTheme(theme) {
  const next = theme === "dark" ? "dark" : "light";
  document.documentElement.dataset.theme = next;
  document.documentElement.style.colorScheme = next;
  const scheme = document.querySelector('meta[name="color-scheme"]');
  if (scheme) scheme.content = next;
  const color = document.querySelector('meta[name="theme-color"]');
  if (color) color.content = next === "dark" ? "#141311" : "#f6f3ec";
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
    render();
    return;
  }
  if (target.dataset.close || target.dataset.view) {
    if (target.dataset.view) {
      ui.view = target.dataset.view;
      ui.day = state.today || ui.day;
    }
    ui.sheet = null;
    ui.confirm = null;
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
  if (target.dataset.action === "add-toggle") {
    ui.adding = !ui.adding;
    render();
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
      ui.fields = blankFields();
      render();
    }
    return;
  }
  if (target.dataset.complete) {
    ui.sheet = "complete";
    ui.taskId = target.dataset.complete;
    render();
    return;
  }
  if (target.dataset.reassign) {
    ui.sheet = "reassign";
    ui.awardId = target.dataset.reassign;
    render();
    return;
  }
  if (target.dataset.pick) {
    const sheet = ui.sheet;
    const taskId = ui.taskId;
    const awardId = ui.awardId;
    ui.sheet = null;
    if (sheet === "complete") {
      const data = await send(`api/tasks/${taskId}/complete`, "POST", { memberId: target.dataset.pick });
      if (data?.awarded) ui.toast = { id: data.awarded.id, text: `${data.awarded.points} points for ${data.awarded.memberName}` };
    } else {
      await send(`api/awards/${awardId}/member`, "POST", { memberId: target.dataset.pick });
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
  if (target.dataset.move) {
    const card = target.closest("[data-id]");
    await send("api/tasks/reorder", "POST", { id: card.dataset.id, bucket: target.dataset.move, index: 500 });
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
    await send(`api/tasks/${target.dataset.saveTask}`, "POST", {
      title: field("title"),
      points,
      assigneeId: task?.assigneeId || null,
      repeat: ui.fields.repeat,
      due: field("due") || null,
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
    ui.day = ui.cal === "month" ? shiftMonth(day, delta) : addDays(day, ui.cal === "week" ? delta * 7 : delta);
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
    if (ui.cal === "month") ui.cal = "month";
    render();
    return;
  }
  if (target.dataset.admin) {
    ui.admin = target.dataset.admin;
    ui.fields.name = "";
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
