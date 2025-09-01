(() => {
  // ===== Config & Defaults =====
  const DEFAULT_MJPEG = "http://192.168.0.131:8000/stream";
  const CONFIG = {
    mode: "mjpeg",
    mjpegUrl:
      getParam("mjpeg", "") ||
      localStorage.getItem("mjpegUrl") ||
      DEFAULT_MJPEG,
    controlWs: "",
    apiBase: "",
    authToken: "",
  };

  //DOM
  const dot = document.getElementById("dot");
  const statusEl = document.getElementById("status");
  const stateLabel = document.getElementById("stateLabel");
  const modeLabel = document.getElementById("modeLabel");
  const resLabel = document.getElementById("resLabel");
  const errorLabel = document.getElementById("errorLabel");
  const pausedOverlay = document.getElementById("pausedOverlay");
  const mjpegEl = document.getElementById("mjpegEl");
  const connectBtn = document.getElementById("connectBtn");
  const playPauseBtn = document.getElementById("playPauseBtn");
  const fsBtn = document.getElementById("fsBtn");
  const endpointInput = document.getElementById("endpointInput");
  const padBtns = document.querySelectorAll(".pad-btn");
  const snapBtn = document.getElementById("snapBtn");
  const galleryEl = document.getElementById("gallery");
  const galleryCountEl = document.getElementById("galleryCount");
  const clearGalleryBtn = document.getElementById("clearGalleryBtn");

  //狀態
  let ctrl = null;
  let playing = false;
  let connected = false;
  const gallery = []; // { id, url, blob, ts }
  let nextId = 1;

  //初始 UI
  endpointInput.value = cleanUrl(CONFIG.mjpegUrl || "");
  endpointInput.addEventListener("change", () => {
    endpointInput.value = cleanUrl(endpointInput.value);
    localStorage.setItem("mjpegUrl", endpointInput.value);
  });
  modeLabel.textContent = "MJPEG";
  setState("idle");
  setStatus("尚未連線", "warn");
  resLabel.textContent = "—";
  updateButtons();

  //事件
  connectBtn.addEventListener("click", async () => {
    try {
      await connect();
      await playMJPEG();
    } catch (err) {
      setError(err);
    }
  });

  playPauseBtn.addEventListener("click", async () => {
    try {
      if (!connected) await connect();
      if (playing) stopMJPEG();
      else await playMJPEG();
    } catch (err) {
      setError(err);
    }
  });

  fsBtn.addEventListener("click", () => {
    const card = document.querySelector(".video-card");
    if (!document.fullscreenElement) card.requestFullscreen?.();
    else document.exitFullscreen?.();
  });

  //當前幀載入/失敗
  mjpegEl.addEventListener("load", () => {
    const w = mjpegEl.naturalWidth || 16;
    const h = mjpegEl.naturalHeight || 9;
    document.querySelector(".video-stage").style.aspectRatio = `${w} / ${h}`;
    resLabel.textContent = `${w}x${h}`;
    setStatus("串流正常", "ok");
  });
  mjpegEl.addEventListener("error", () => {
    setError(new Error("MJPEG載入失敗,請檢查端點或 token"));
  });

  //遙控按鈕
  padBtns.forEach((btn) =>
    btn.addEventListener("click", () => {
      const type = btn.dataset.cmd;
      const v = parseFloat(btn.dataset.v || "0");
      const w = parseFloat(btn.dataset.w || "0");
      sendControl(type, { v, w });
    })
  );

  //鍵盤控制
  document.addEventListener("keydown", (e) => {
    if (!ctrl || ctrl.readyState !== 1 || e.repeat) return;
    const SPEED = 0.6,
      TURN = 1.0;
    switch (e.key) {
      case "ArrowUp":
        return sendControl("drive", { v: +SPEED, w: 0 });
      case "ArrowDown":
        return sendControl("drive", { v: -SPEED, w: 0 });
      case "ArrowLeft":
        return sendControl("drive", { v: 0, w: +TURN });
      case "ArrowRight":
        return sendControl("drive", { v: 0, w: -TURN });
      case " ":
        return sendControl("resume");
      case "e":
      case "E":
        return sendControl("estop");
    }
  });

  //截圖加入圖庫
  snapBtn.addEventListener("click", async () => {
    try {
      const blob = await takeSnapshotBlob(); // 可能是 API 或 Canvas
      await addToGallery(blob);
      setStatus("已加入圖庫", "ok");
    } catch (e) {
      setError(e);
    }
  });

  clearGalleryBtn?.addEventListener("click", () => {
    while (gallery.length) {
      const it = gallery.pop();
      try {
        URL.revokeObjectURL(it.url);
      } catch {}
    }
    galleryEl.innerHTML = "";
    galleryCountEl.textContent = "(0)";
  });

  //離開清理
  window.addEventListener("beforeunload", teardown);

  async function connect() {
    setState("connecting");
    setStatus("連線中…", "warn");
    connected = true;
    setState("ready");
    updateButtons();
  }

  async function playMJPEG() {
    let base = cleanUrl(
      endpointInput.value || CONFIG.mjpegUrl || DEFAULT_MJPEG
    );
    if (!base) throw new Error("未提供 MJPEG 端點");

    //HTTPS 頁面載 HTTP：會被擋（GitHub Pages 情境）
    if (location.protocol === "https:" && base.startsWith("http://")) {
      throw new Error(
        "Mixed Content：本頁是 HTTPS，但串流是 HTTP。請改用同網域 HTTPS（反向代理/Tunnel），或用 HTTP 開此頁。"
      );
    }

    //cache-busting 避免連老連線
    const src = base + (base.includes("?") ? "&" : "?") + "ts=" + Date.now();

    //顯示 IMG
    mjpegEl.removeAttribute("crossorigin"); // 不碰 CORS，避免直接載入失敗
    mjpegEl.style.display = "block";

    mjpegEl.onload = () => {
      resLabel.textContent = `${mjpegEl.naturalWidth || "—"}x${
        mjpegEl.naturalHeight || "—"
      }`;
      setStatus("串流正常", "ok");
      playing = true;
      showPaused(false);
      updateButtons();
      localStorage.setItem("mjpegUrl", base); //記住可用端點
    };
    mjpegEl.onload = () => {
      resLabel.textContent = `${mjpegEl.naturalWidth || "—"}x${
        mjpegEl.naturalHeight || "—"
      }`;
      setStatus("串流正常", "ok");
      playing = true;
      showPaused(false);
      updateButtons();
      localStorage.setItem("mjpegUrl", base); //記住可用端點
    };
    mjpegEl.onerror = () => {
      setError(new Error("MJPEG載入失敗,請檢查端點或 token"));
      playing = false;
      showPaused(true);
      updateButtons();
    };

    //觸發載入
    mjpegEl.src = src;
    connected = true;
    setState("ready");
    setStatus("串流連線中…", "warn");
    updateButtons();
  }

  function stopMJPEG() {
    mjpegEl.src = "";
    playing = false;
    showPaused(true);
    setStatus("已暫停", "warn");
    updateButtons();
  }

  function teardown() {
    playing = false;
    connected = false;
    if (mjpegEl) mjpegEl.src = "";
    try {
      ctrl?.close?.();
    } catch {}
    ctrl = null;
    showPaused(false);
    updateButtons();
  }
  //Snapshot (API 優先；否則 Canvas，需要同源或 CORS)
  async function takeSnapshotBlob() {
    if (CONFIG.apiBase) {
      const url = CONFIG.apiBase.replace(/\/?$/, "") + "/snapshot";
      const res = await fetch(url, { method: "POST" });
      if (!res.ok) throw new Error(`截圖失敗（${res.status}）`);
      return await res.blob();
    }

    if (!mjpegEl.naturalWidth)
      throw new Error("目前沒有影像幀可截圖（請先連線播放）");

    // 不主動設定 crossOrigin，避免影像顯示被毀；若來源允許 CORS 同樣可以成功
    const canvas = document.createElement("canvas");
    canvas.width = mjpegEl.naturalWidth;
    canvas.height = mjpegEl.naturalHeight;
    const ctx = canvas.getContext("2d");

    try {
      ctx.drawImage(mjpegEl, 0, 0);
    } catch {
      throw new Error(
        "無法擷取畫面：來源未允許 CORS，請改用 API 截圖或同源反向代理。"
      );
    }

    return await new Promise((resolve, reject) =>
      canvas.toBlob(
        (b) => (b ? resolve(b) : reject(new Error("轉檔失敗"))),
        "image/png"
      )
    );
  }

  async function addToGallery(blob) {
    const url = URL.createObjectURL(blob);
    const item = { id: nextId++, url, blob, ts: Date.now() };
    gallery.unshift(item);
    renderGalleryItem(item);
    galleryCountEl.textContent = `(${gallery.length})`;
  }

  function renderGalleryItem(item) {
    const card = document.createElement("div");
    card.className = "gallery-item";
    card.dataset.id = item.id;

    const thumb = document.createElement("img");
    thumb.src = item.url;
    thumb.alt = `snapshot_${item.id}`;
    thumb.title = new Date(item.ts).toLocaleString();
    thumb.style.cursor = "zoom-in";
    thumb.addEventListener("click", () => window.open(item.url, "_blank"));

    const meta = document.createElement("div");
    meta.className = "gallery-meta";
    const time = document.createElement("div");
    time.textContent = new Date(item.ts).toLocaleTimeString();

    const actions = document.createElement("div");
    actions.className = "gallery-actions";

    const dl = document.createElement("a");
    dl.className = "btn";
    dl.textContent = "下載";
    dl.download = `snapshot_${item.ts}.png`;
    dl.href = item.url;

    const rm = document.createElement("button");
    rm.className = "btn";
    rm.textContent = "刪除";
    rm.addEventListener("click", () => removeFromGallery(item.id));

    actions.append(dl, rm);
    meta.append(time, actions);
    card.append(thumb, meta);

    if (galleryEl.firstChild)
      galleryEl.insertBefore(card, galleryEl.firstChild);
    else galleryEl.appendChild(card);

    const MAX = 50;
    if (gallery.length > MAX) {
      const old = gallery.pop();
      removeFromGallery(old.id);
    }
  }
  function removeFromGallery(id) {
    const idx = gallery.findIndex((it) => it.id === id);
    if (idx === -1) return;
    const [it] = gallery.splice(idx, 1);
    const node = galleryEl.querySelector(`.gallery-item[data-id="${id}"]`);
    if (node) node.remove();
    try {
      URL.revokeObjectURL(it.url);
    } catch {}
    galleryCountEl.textContent = `(${gallery.length})`;
  }

  //Control WS
  function sendControl(type, payload = {}) {
    if (!ctrl || ctrl.readyState !== 1) {
      setStatus("控制通道未連線", "warn");
      return;
    }
    safeSend(ctrl, { type, ...payload });
  }

  //UI Utils
  function setState(s) {
    stateLabel.textContent = s;
  }
  function setStatus(text, type = "ok") {
    statusEl.textContent = text;
    dot.style.background =
      type === "ok"
        ? "var(--ok)"
        : type === "warn"
        ? "var(--warn)"
        : "var(--err)";
  }
  function showPaused(show) {
    pausedOverlay.style.display = show ? "grid" : "none";
  }
  function updateButtons() {
    const enabled = connected || true;
    playPauseBtn.disabled = !enabled;
    fsBtn.disabled = !enabled;
    connectBtn.textContent = connected
      ? playing
        ? "重新連線"
        : "▶ 重新連線並播放"
      : "▶ 連線並播放";
  }
  function setError(err) {
    console.error(err);
    errorLabel.textContent = err?.message || String(err);
    setStatus("發生錯誤", "err");
  }
  function safeSend(ws, obj) {
    try {
      if (ws && ws.readyState === 1) ws.send(JSON.stringify(obj));
    } catch {}
  }
  function withToken(url, token) {
    if (!token) return url;
    const u = new URL(url, location.href);
    if (!u.searchParams.get("token")) u.searchParams.set("token", token);
    return u.toString();
  }
  function getParam(key, fallback = "") {
    const v = new URLSearchParams(location.search).get(key);
    return v ?? fallback;
  }
  function cleanUrl(s) {
    if (!s) return "";
    s = ("" + s).trim();
    s = s
      .replace(/^[`'"\u2018\u2019\u201C\u201D]+/, "")
      .replace(/[`'"\u2018\u2019\u201C\u201D]+$/, "");
    s = s.replace(/[;,]+$/, "");
    return s;
  }
})();
