(() => {
  "use strict";

  const CONFIG = window.MENDAN_CONFIG || {};
  const API_URL = String(CONFIG.GAS_WEB_APP_URL || "").trim();
  const IS_CONFIGURED = /^https:\/\/script\.google\.com\/macros\/s\/.+\/exec(?:\?.*)?$/.test(API_URL);
  const REFRESH_MS = Number(CONFIG.REFRESH_INTERVAL_MS) || 20000;
  const START_MINUTES = 9 * 60;
  const END_MINUTES = 16 * 60 + 30;
  const DEFAULT_DURATION = 25;
  const DATES = [
    ["2026-08-17", "8/17", "月"],
    ["2026-08-18", "8/18", "火"],
    ["2026-08-19", "8/19", "水"],
    ["2026-08-20", "8/20", "木"],
    ["2026-08-21", "8/21", "金"],
    ["2026-08-24", "8/24", "月"],
    ["2026-08-25", "8/25", "火"],
    ["2026-08-26", "8/26", "水"],
    ["2026-08-27", "8/27", "木"],
    ["2026-08-28", "8/28", "金"]
  ].map(([iso, short, weekday]) => ({ iso, short, weekday }));

  const DEMO_EVENTS = [
    { id: "demo-1", type: "interview", date: "2026-08-17", start: "09:30", end: "09:55", title: "佐藤 花子" },
    { id: "demo-2", type: "teacher", date: "2026-08-17", start: "11:00", end: "11:45", title: "職員会議" },
    { id: "demo-3", type: "interview", date: "2026-08-18", start: "10:00", end: "10:25", title: "鈴木 太郎" },
    { id: "demo-4", type: "teacher", date: "2026-08-18", start: "13:00", end: "13:45", title: "教材準備" },
    { id: "demo-5", type: "interview", date: "2026-08-19", start: "09:30", end: "09:55", title: "田中 悠真" },
    { id: "demo-6", type: "teacher", date: "2026-08-20", start: "10:30", end: "11:15", title: "進路指導部" },
    { id: "demo-7", type: "interview", date: "2026-08-21", start: "13:30", end: "13:55", title: "高橋 美咲" },
    { id: "demo-8", type: "interview", date: "2026-08-24", start: "14:00", end: "14:25", title: "伊藤 大輝" }
  ];

  const els = {
    stage: document.getElementById("calendarStage"),
    scroll: document.getElementById("calendarScroll"),
    updated: document.getElementById("updatedText"),
    setup: document.getElementById("setupAlert"),
    refresh: document.getElementById("refreshButton"),
    add: document.getElementById("addButton"),
    dialog: document.getElementById("eventDialog"),
    form: document.getElementById("eventForm"),
    dialogTitle: document.getElementById("dialogTitle"),
    closeDialog: document.getElementById("closeDialog"),
    cancel: document.getElementById("cancelButton"),
    delete: document.getElementById("deleteButton"),
    save: document.getElementById("saveButton"),
    id: document.getElementById("eventId"),
    date: document.getElementById("eventDate"),
    start: document.getElementById("startTime"),
    end: document.getElementById("endTime"),
    studentName: document.getElementById("studentName"),
    teacherTitle: document.getElementById("teacherTitle"),
    studentField: document.getElementById("studentNameField"),
    teacherField: document.getElementById("teacherTitleField"),
    formError: document.getElementById("formError"),
    passwordDialog: document.getElementById("passwordDialog"),
    passwordForm: document.getElementById("passwordForm"),
    password: document.getElementById("teacherPassword"),
    passwordError: document.getElementById("passwordError"),
    passwordCancel: document.getElementById("passwordCancel"),
    toast: document.getElementById("toast")
  };

  let events = [];
  let didInitialScroll = false;
  let passwordResolver = null;
  let toastTimer = 0;

  function localIsoDate(date = new Date()) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
  }

  function timeToMinutes(time) {
    const [hours, minutes] = String(time).split(":").map(Number);
    return hours * 60 + minutes;
  }

  function minutesToTime(minutes) {
    return `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
  }

  function escapeText(value) {
    return String(value ?? "");
  }

  function isPastDate(iso) {
    return iso < localIsoDate();
  }

  function getInitialDayIndex() {
    const today = localIsoDate();
    if (today < "2026-08-17") return 0;
    if (today >= "2026-08-24") return 5;
    const exact = DATES.findIndex((date) => date.iso === today);
    return exact >= 0 ? exact : 5;
  }

  function populateSelects() {
    els.date.replaceChildren();
    DATES.forEach((date) => {
      const option = document.createElement("option");
      option.value = date.iso;
      option.textContent = `2026年${date.short.replace("/", "月")}日（${date.weekday}）`;
      els.date.append(option);
    });

    els.start.replaceChildren();
    els.end.replaceChildren();
    for (let minute = START_MINUTES; minute <= END_MINUTES; minute += 5) {
      const time = minutesToTime(minute);
      [els.start, els.end].forEach((select) => {
        const option = document.createElement("option");
        option.value = time;
        option.textContent = time;
        select.append(option);
      });
    }
  }

  function buildCalendar() {
    const today = localIsoDate();
    els.stage.replaceChildren();

    const header = document.createElement("div");
    header.className = "date-header";
    const spacer = document.createElement("div");
    spacer.className = "date-header-spacer";
    header.append(spacer);

    DATES.forEach((date) => {
      const cell = document.createElement("div");
      cell.className = "date-cell";
      if (date.iso < today) cell.classList.add("past");
      if (date.iso === today) cell.classList.add("today");
      const day = document.createElement("span");
      day.className = "month-day";
      day.textContent = date.short;
      const weekday = document.createElement("span");
      weekday.className = "weekday";
      weekday.textContent = date.weekday;
      cell.append(day, weekday);
      header.append(cell);
    });

    const timeAxis = document.createElement("div");
    timeAxis.className = "time-axis";
    for (let minute = START_MINUTES; minute <= END_MINUTES; minute += 60) {
      const label = document.createElement("span");
      label.className = "time-label";
      if (minute === START_MINUTES) label.classList.add("first");
      label.style.top = `${minute - START_MINUTES}px`;
      label.textContent = minutesToTime(minute);
      timeAxis.append(label);
    }
    const daysLayer = document.createElement("div");
    daysLayer.className = "days-layer";

    DATES.forEach((date) => {
      const column = document.createElement("div");
      column.className = "day-column";
      column.dataset.date = date.iso;
      column.setAttribute("aria-label", `${date.short}（${date.weekday}）`);
      if (date.iso < today) column.classList.add("past");
      column.addEventListener("click", onEmptySlotClick);
      daysLayer.append(column);
    });

    els.stage.append(header, timeAxis, daysLayer);
    renderEventCards(daysLayer);

    if (!didInitialScroll) {
      didInitialScroll = true;
      requestAnimationFrame(() => {
        const index = getInitialDayIndex();
        const dateCells = header.querySelectorAll(".date-cell");
        const dayWidth = dateCells[0]?.getBoundingClientRect().width || 64;
        els.scroll.scrollLeft = Math.max(0, index * dayWidth);
        els.scroll.scrollTop = 0;
      });
    }
  }

  function renderEventCards(daysLayer) {
    const columns = new Map(
      [...daysLayer.querySelectorAll(".day-column")].map((column) => [column.dataset.date, column])
    );

    events
      .slice()
      .sort((a, b) => `${a.date} ${a.start}`.localeCompare(`${b.date} ${b.start}`))
      .forEach((event) => {
        const column = columns.get(event.date);
        if (!column) return;
        const start = timeToMinutes(event.start);
        const end = timeToMinutes(event.end);
        if (start < START_MINUTES || end > END_MINUTES || end <= start) return;

        const card = document.createElement("button");
        card.type = "button";
        card.className = `event-card ${event.type === "teacher" ? "teacher" : "interview"}`;
        card.style.top = `${start - START_MINUTES}px`;
        card.style.height = `${Math.max(end - start, 18)}px`;
        card.dataset.eventId = event.id;
        card.title = `${event.start}〜${event.end} ${event.title}`;

        const time = document.createElement("span");
        time.className = "event-time";
        time.textContent = event.start;
        const title = document.createElement("span");
        title.className = "event-title";
        title.textContent = escapeText(event.title);
        card.append(time, title);
        card.addEventListener("click", (clickEvent) => {
          clickEvent.stopPropagation();
          openEditDialog(event.id);
        });
        column.append(card);
      });
  }

  function onEmptySlotClick(event) {
    if (event.target.closest(".event-card")) return;
    const column = event.currentTarget;
    const rect = column.getBoundingClientRect();
    const rawMinute = START_MINUTES + Math.max(0, event.clientY - rect.top);
    const rounded = Math.round(rawMinute / 5) * 5;
    const start = Math.min(Math.max(rounded, START_MINUTES), END_MINUTES - DEFAULT_DURATION);
    openAddDialog(column.dataset.date, minutesToTime(start));
  }

  function openAddDialog(date = DATES[getInitialDayIndex()].iso, start = "09:00") {
    const startMinutes = timeToMinutes(start);
    els.dialogTitle.textContent = "予定を追加";
    els.id.value = "";
    els.date.value = date;
    els.start.value = start;
    els.end.value = minutesToTime(Math.min(startMinutes + DEFAULT_DURATION, END_MINUTES));
    els.studentName.value = "";
    els.teacherTitle.value = "";
    els.delete.hidden = true;
    els.formError.textContent = "";
    document.querySelector('input[name="eventType"][value="interview"]').checked = true;
    updateTypeFields();
    els.dialog.showModal();
  }

  function openEditDialog(id) {
    const event = events.find((item) => item.id === id);
    if (!event) return;
    els.dialogTitle.textContent = "予定を編集";
    els.id.value = event.id;
    els.date.value = event.date;
    els.start.value = event.start;
    els.end.value = event.end;
    els.studentName.value = event.type === "interview" ? event.title : "";
    els.teacherTitle.value = event.type === "teacher" ? event.title : "";
    els.delete.hidden = false;
    els.formError.textContent = "";
    const radio = document.querySelector(`input[name="eventType"][value="${event.type}"]`);
    if (radio) radio.checked = true;
    updateTypeFields();
    els.dialog.showModal();
  }

  function updateTypeFields() {
    const type = document.querySelector('input[name="eventType"]:checked')?.value || "interview";
    const isInterview = type === "interview";
    els.studentField.hidden = !isInterview;
    els.teacherField.hidden = isInterview;
  }

  function validateEvent() {
    const type = document.querySelector('input[name="eventType"]:checked')?.value || "interview";
    const title = (type === "interview" ? els.studentName.value : els.teacherTitle.value).trim();
    const start = timeToMinutes(els.start.value);
    const end = timeToMinutes(els.end.value);

    if (!DATES.some((date) => date.iso === els.date.value)) return "対象期間内の日付を選んでください。";
    if (!title) return type === "interview" ? "生徒名を入力してください。" : "予定名を入力してください。";
    if (start < START_MINUTES || end > END_MINUTES || end <= start) return "終了時刻は開始時刻より後にしてください。";
    if (start % 5 !== 0 || end % 5 !== 0) return "時刻は5分単位で選んでください。";

    const overlap = events.find((item) =>
      item.id !== els.id.value &&
      item.date === els.date.value &&
      timeToMinutes(item.start) < end &&
      timeToMinutes(item.end) > start
    );
    if (overlap) return `${overlap.start}〜${overlap.end}の予定と重なっています。`;
    return "";
  }

  async function saveEvent(event) {
    event.preventDefault();
    const error = validateEvent();
    els.formError.textContent = error;
    if (error) return;

    const password = await ensurePassword();
    if (password === null) return;

    const type = document.querySelector('input[name="eventType"]:checked')?.value || "interview";
    const payload = {
      action: "saveEvent",
      password,
      event: {
        id: els.id.value || "",
        type,
        date: els.date.value,
        start: els.start.value,
        end: els.end.value,
        title: (type === "interview" ? els.studentName.value : els.teacherTitle.value).trim()
      }
    };

    els.save.disabled = true;
    els.save.textContent = "保存中…";
    try {
      if (IS_CONFIGURED) {
        await postToApi(payload);
        await loadEvents(false);
      } else {
        const item = {
          ...payload.event,
          id: payload.event.id || `local-${Date.now()}`
        };
        const index = events.findIndex((entry) => entry.id === item.id);
        if (index >= 0) events[index] = item;
        else events.push(item);
        buildCalendar();
      }
      els.dialog.close();
      showToast("予定を保存しました。");
    } catch (saveError) {
      const message = saveError.message || "予定を保存できませんでした。";
      els.formError.textContent = message;
      if (/パスワード/.test(message)) sessionStorage.removeItem("mendanTeacherPassword");
    } finally {
      els.save.disabled = false;
      els.save.textContent = "保存する";
    }
  }

  async function deleteEvent() {
    const id = els.id.value;
    if (!id || !confirm("この予定を削除しますか？")) return;
    const password = await ensurePassword();
    if (password === null) return;

    els.delete.disabled = true;
    try {
      if (IS_CONFIGURED) {
        await postToApi({ action: "deleteEvent", password, eventId: id });
        await loadEvents(false);
      } else {
        events = events.filter((item) => item.id !== id);
        buildCalendar();
      }
      els.dialog.close();
      showToast("予定を削除しました。");
    } catch (deleteError) {
      const message = deleteError.message || "予定を削除できませんでした。";
      els.formError.textContent = message;
      if (/パスワード/.test(message)) sessionStorage.removeItem("mendanTeacherPassword");
    } finally {
      els.delete.disabled = false;
    }
  }

  function ensurePassword() {
    const stored = sessionStorage.getItem("mendanTeacherPassword");
    if (stored) return Promise.resolve(stored);

    els.password.value = "";
    els.passwordError.textContent = "";
    els.passwordDialog.showModal();
    setTimeout(() => els.password.focus(), 80);

    return new Promise((resolve) => {
      passwordResolver = resolve;
    });
  }

  function settlePassword(value) {
    if (!passwordResolver) return;
    const resolve = passwordResolver;
    passwordResolver = null;
    resolve(value);
  }

  function onPasswordSubmit(event) {
    event.preventDefault();
    const value = els.password.value.trim();
    if (!value) {
      els.passwordError.textContent = "管理パスワードを入力してください。";
      return;
    }
    sessionStorage.setItem("mendanTeacherPassword", value);
    els.passwordDialog.close();
    settlePassword(value);
  }

  function jsonpEvents() {
    return new Promise((resolve, reject) => {
      const callback = `mendanCallback_${Date.now()}_${Math.random().toString(36).slice(2)}`;
      const script = document.createElement("script");
      const timer = setTimeout(() => cleanup(new Error("予定の読み込みがタイムアウトしました。")), 12000);

      function cleanup(error, data) {
        clearTimeout(timer);
        script.remove();
        delete window[callback];
        if (error) reject(error);
        else resolve(data);
      }

      window[callback] = (data) => {
        if (!data || data.ok !== true) {
          cleanup(new Error(data?.message || "予定を読み込めませんでした。"));
          return;
        }
        cleanup(null, data);
      };

      const url = new URL(API_URL);
      url.searchParams.set("action", "events");
      url.searchParams.set("callback", callback);
      url.searchParams.set("_", String(Date.now()));
      script.src = url.toString();
      script.onerror = () => cleanup(new Error("予定を読み込めませんでした。通信状況を確認してください。"));
      document.head.append(script);
    });
  }

  async function postToApi(payload) {
    const requestId = `req-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 20000);
    const body = new URLSearchParams({
      payload: JSON.stringify({ ...payload, requestId })
    });

    try {
      await fetch(API_URL, {
        method: "POST",
        mode: "no-cors",
        redirect: "follow",
        body,
        signal: controller.signal
      });
    } catch (error) {
      if (error.name === "AbortError") {
        throw new Error("送信がタイムアウトしました。もう一度お試しください。");
      }
      throw new Error("送信できませんでした。通信状況を確認してください。");
    } finally {
      clearTimeout(timeout);
    }

    for (let attempt = 0; attempt < 12; attempt += 1) {
      const status = await getSubmissionStatus(requestId);
      if (status.done) {
        if (status.ok) return status;
        throw new Error(status.message || "処理できませんでした。");
      }
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    throw new Error("送信結果を確認できませんでした。もう一度お試しください。");
  }

  function getSubmissionStatus(requestId) {
    return new Promise((resolve, reject) => {
      const callback = `mendanStatus_${Date.now()}_${Math.random().toString(36).slice(2)}`;
      const script = document.createElement("script");
      const timer = setTimeout(
        () => cleanup(new Error("送信結果を確認できませんでした。")),
        8000
      );

      function cleanup(error, status) {
        clearTimeout(timer);
        script.remove();
        delete window[callback];
        if (error) reject(error);
        else resolve(status);
      }

      window[callback] = (data) => {
        if (!data || data.ok !== true) {
          cleanup(new Error(data?.message || "送信結果を確認できませんでした。"));
          return;
        }
        cleanup(null, data.status || { done: false });
      };

      const url = new URL(API_URL);
      url.searchParams.set("action", "status");
      url.searchParams.set("requestId", requestId);
      url.searchParams.set("callback", callback);
      url.searchParams.set("_", String(Date.now()));
      script.src = url.toString();
      script.onerror = () => cleanup(new Error("送信結果を確認できませんでした。"));
      document.head.append(script);
    });
  }

  async function loadEvents(showFeedback = true) {
    els.refresh.classList.add("is-loading");
    els.refresh.disabled = true;
    if (!IS_CONFIGURED) {
      events = events.length ? events : DEMO_EVENTS.map((event) => ({ ...event }));
      els.setup.hidden = false;
      els.updated.textContent = "見本データを表示中";
      buildCalendar();
      els.refresh.classList.remove("is-loading");
      els.refresh.disabled = false;
      return;
    }

    try {
      const data = await jsonpEvents();
      events = Array.isArray(data.events) ? data.events : [];
      els.updated.textContent = `最終更新 ${new Intl.DateTimeFormat("ja-JP", { hour: "2-digit", minute: "2-digit" }).format(new Date())}`;
      buildCalendar();
      if (showFeedback) showToast("最新の予定に更新しました。");
    } catch (error) {
      els.updated.textContent = "予定を読み込めませんでした";
      if (showFeedback) showToast(error.message || "通信状況を確認してください。");
    } finally {
      els.refresh.classList.remove("is-loading");
      els.refresh.disabled = false;
    }
  }

  function showToast(message) {
    clearTimeout(toastTimer);
    els.toast.textContent = message;
    els.toast.classList.add("show");
    toastTimer = setTimeout(() => els.toast.classList.remove("show"), 3000);
  }

  document.querySelectorAll('input[name="eventType"]').forEach((radio) => radio.addEventListener("change", updateTypeFields));
  els.add.addEventListener("click", () => openAddDialog());
  els.refresh.addEventListener("click", () => loadEvents(true));
  els.closeDialog.addEventListener("click", () => els.dialog.close());
  els.cancel.addEventListener("click", () => els.dialog.close());
  els.form.addEventListener("submit", saveEvent);
  els.delete.addEventListener("click", deleteEvent);
  els.passwordForm.addEventListener("submit", onPasswordSubmit);
  els.passwordCancel.addEventListener("click", () => {
    els.passwordDialog.close();
    settlePassword(null);
  });
  els.passwordDialog.addEventListener("cancel", (event) => {
    event.preventDefault();
    els.passwordDialog.close();
    settlePassword(null);
  });
  els.start.addEventListener("change", () => {
    const start = timeToMinutes(els.start.value);
    if (timeToMinutes(els.end.value) <= start) {
      els.end.value = minutesToTime(Math.min(start + DEFAULT_DURATION, END_MINUTES));
    }
  });

  populateSelects();
  loadEvents(false);
  setInterval(() => {
    if (!document.hidden && !els.dialog.open && !els.passwordDialog.open) loadEvents(false);
  }, REFRESH_MS);
})();
