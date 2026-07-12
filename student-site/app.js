(() => {
  "use strict";

  const CONFIG = window.MENDAN_CONFIG || {};
  const API_URL = String(CONFIG.GAS_WEB_APP_URL || "").trim();
  const IS_CONFIGURED = /^https:\/\/script\.google\.com\/macros\/s\/.+\/exec(?:\?.*)?$/.test(API_URL);
  const REFRESH_MS = Number(CONFIG.REFRESH_INTERVAL_MS) || 30000;
  const START_MINUTES = 9 * 60;
  const END_MINUTES = 16 * 60 + 30;
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

  let events = [];
  let didInitialScroll = false;
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

  function getInitialDayIndex() {
    const today = localIsoDate();
    if (today < "2026-08-17") return 0;
    if (today >= "2026-08-24") return 5;
    const exact = DATES.findIndex((date) => date.iso === today);
    return exact >= 0 ? exact : 5;
  }

  function showToast(message) {
    const toast = document.getElementById("toast");
    if (!toast) return;
    clearTimeout(toastTimer);
    toast.textContent = message;
    toast.classList.add("show");
    toastTimer = setTimeout(() => toast.classList.remove("show"), 3000);
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

  function buildCalendar() {
    const stage = document.getElementById("calendarStage");
    const scroll = document.getElementById("calendarScroll");
    if (!stage || !scroll) return;
    const today = localIsoDate();
    stage.replaceChildren();

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
      if (date.iso < today) column.classList.add("past");
      daysLayer.append(column);
    });

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

        const card = document.createElement("div");
        card.className = `event-card ${event.type === "teacher" ? "teacher" : "interview"}`;
        card.style.top = `${start - START_MINUTES}px`;
        card.style.height = `${Math.max(end - start, 18)}px`;
        card.title = `${event.start}〜${event.end} ${event.title}`;
        const time = document.createElement("span");
        time.className = "event-time";
        time.textContent = event.start;
        const title = document.createElement("span");
        title.className = "event-title";
        title.textContent = String(event.title || "");
        card.append(time, title);
        column.append(card);
      });

    stage.append(header, timeAxis, daysLayer);

    if (!didInitialScroll) {
      didInitialScroll = true;
      requestAnimationFrame(() => {
        const dateCells = header.querySelectorAll(".date-cell");
        const dayWidth = dateCells[0]?.getBoundingClientRect().width || 64;
        scroll.scrollLeft = Math.max(0, getInitialDayIndex() * dayWidth);
        scroll.scrollTop = 0;
      });
    }
  }

  async function loadEvents(showFeedback = true) {
    const refresh = document.getElementById("refreshButton");
    const updated = document.getElementById("updatedText");
    const setup = document.getElementById("setupAlert");
    refresh?.classList.add("is-loading");
    if (refresh) refresh.disabled = true;

    if (!IS_CONFIGURED) {
      events = DEMO_EVENTS.map((event) => ({ ...event }));
      if (setup) setup.hidden = false;
      if (updated) updated.textContent = "見本データを表示中";
      buildCalendar();
      refresh?.classList.remove("is-loading");
      if (refresh) refresh.disabled = false;
      return;
    }

    try {
      const data = await jsonpEvents();
      events = Array.isArray(data.events) ? data.events : [];
      if (updated) {
        updated.textContent = `最終更新 ${new Intl.DateTimeFormat("ja-JP", { hour: "2-digit", minute: "2-digit" }).format(new Date())}`;
      }
      buildCalendar();
      if (showFeedback) showToast("最新の予定に更新しました。");
    } catch (error) {
      if (updated) updated.textContent = "予定を読み込めませんでした";
      if (showFeedback) showToast(error.message || "通信状況を確認してください。");
    } finally {
      refresh?.classList.remove("is-loading");
      if (refresh) refresh.disabled = false;
    }
  }

  function initStudentCalendar() {
    document.getElementById("refreshButton")?.addEventListener("click", () => loadEvents(true));
    loadEvents(false);
    setInterval(() => {
      if (!document.hidden) loadEvents(false);
    }, REFRESH_MS);
  }

  function initRequestForm() {
    const form = document.getElementById("requestForm");
    const name = document.getElementById("requestName");
    const dates = document.getElementById("requestDates");
    const errorText = document.getElementById("requestError");
    const submit = document.getElementById("submitRequest");
    const formCard = document.getElementById("requestFormCard");
    const successCard = document.getElementById("successCard");

    form?.addEventListener("submit", async (event) => {
      event.preventDefault();
      const studentName = name.value.trim();
      const preferredDates = dates.value.trim();
      errorText.textContent = "";

      if (!studentName) {
        errorText.textContent = "氏名を入力してください。";
        name.focus();
        return;
      }
      if (!preferredDates) {
        errorText.textContent = "希望日時を入力してください。";
        dates.focus();
        return;
      }
      if (!IS_CONFIGURED) {
        errorText.textContent = "現在は送信設定が完了していません。先生にお知らせください。";
        return;
      }

      submit.disabled = true;
      submit.textContent = "送信中…";
      try {
        await postToApi({
          action: "submitRequest",
          name: studentName,
          preferredDates
        });
        formCard.hidden = true;
        successCard.hidden = false;
        successCard.focus?.();
        window.scrollTo({ top: 0, behavior: "smooth" });
      } catch (submitError) {
        errorText.textContent = submitError.message || "送信できませんでした。時間をおいてもう一度お試しください。";
      } finally {
        submit.disabled = false;
        submit.textContent = "送信する";
      }
    });
  }

  if (document.body.dataset.page === "student") initStudentCalendar();
  if (document.body.dataset.page === "request") initRequestForm();
})();
