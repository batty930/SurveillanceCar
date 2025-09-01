(() => {
  const CONFIG = {
    mode: "mjpeg",
    mjpegUrl: getParam("mjpeg", "'http://192.168.0.131:8000/stream'"), //MJPEG串流網址
    controlWs: "", // 如果有遙控 WebSocket URL 可以填在這裡
    apiBase: "", // 如果有提供截圖 API，可以填 base URL
    authToken: "", // 如果需要 token 驗證可以放這裡
  };

  // DOM 參照
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

  // 狀態
  let ctrl = null; // Control WebSocket
  let playing = false; // 是否正在播放 MJPEG
  let connected = false;

  // 初始 UI
  endpointInput.value = CONFIG.mjpegUrl;
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
      if (!connected) {
        await connect();
      }
      if (playing) {
        stopMJPEG();
      } else {
        await playMJPEG();
      }
    } catch (err) {
      setError(err);
    }
  });

  fsBtn.addEventListener("click", () => {
    const card = document.querySelector(".video-card");
    if (!document.fullscreenElement) card.requestFullscreen?.();
    else document.exitFullscreen?.();
  });

  //連線按鈕
  connectBtn.addEventListener("click", async () => {
    try {
      await connect();
      await playVideoIfNeeded();
    } catch (err) {
      setError(err);
    }
  });

  //播放/暫停 按鈕
  playPauseBtn.addEventListener("click", async () => {
    try {
      if (!connected) {
        await connect();
      } // 沒連線就先連線
      if (currentMode === "mjpeg") {
        if (playing) {
          mjpegEl.src = "";
          playing = false;
          showPaused(true);
        } else {
          mjpegEl.src = endpointInput.value = CONFIG.mjpegUrl;
          playing = true;
          showPaused(false);
        }
        updateButtons();
        return;
      }
      if (videoEl.paused) {
        await videoEl.play();
        playing = true;
        showPaused(false);
      } else {
        videoEl.pause();
        playing = false;
        showPaused(true);
      }
      updateButtons();
    } catch (err) {
      setError(err);
    }
  });

  //全螢幕按鈕
  fsBtn.addEventListener("click", () => {
    const card = document.querySelector(".video-card");
    if (!document.fullscreenElement) card.requestFullscreen?.();
    else document.exitFullscreen?.();
  });

  // 反映當前幀
  mjpegEl.addEventListener("load", () => {
    resLabel.textContent = `${mjpegEl.naturalWidth || "—"}x${
      mjpegEl.naturalHeight || "—"
    }`;
    setStatus("正常", "ok");
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

  //截圖
  snapBtn.addEventListener("click", async () => {
    if (!CONFIG.apiBase) return alert("未設定 API Base");
    try {
      const url = withToken(
        CONFIG.apiBase.replace(/\/?$/, "") + "/snapshot",
        CONFIG.authToken
      );
      const res = await fetch(url, { method: "POST" });
      if (!res.ok) throw new Error("截圖失敗");
      const blob = await res.blob();
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      //下載成圖片檔
      a.download = `snapshot_${Date.now()}.jpg`;
      a.click();
      setStatus("已取得截圖", "ok");
    } catch (e) {
      setError(e);
    }
  });

  //頁面離開前清理資源
  window.addEventListener("beforeunload", teardown);

  //主要流程
  async function connect() {
    setState("connecting");
    setStatus("連線中…", "warn");

    // 建立 Control WebSocket（有設置才連）
    if (CONFIG.controlWs) {
      try {
        if (ctrl && ctrl.readyState === 1) {
          /* 已連線 */
        } else {
          if (ctrl) {
            try {
              ctrl.close();
            } catch {}
          }
          const wsUrl = withToken(CONFIG.controlWs, CONFIG.authToken);
          ctrl = new WebSocket(wsUrl);
          ctrl.addEventListener("open", () => {
            setStatus("控制通道已連線", "ok");
          });
          ctrl.addEventListener("close", () => {
            setStatus("控制通道已關閉", "warn");
          });
          ctrl.addEventListener("error", () => {
            setStatus("控制通道錯誤", "err");
          });
          ctrl.addEventListener("message", (ev) => {
            // 可視需要處理伺服器回覆
            // console.debug('Control <-', ev.data);
          });
        }
      } catch (e) {
        // 控制通道失敗不影響影像播放
        console.warn("控制通道連線失敗：", e);
      }
    }

    connected = true;
    setState("ready");
    updateButtons();
  }
  async function playMJPEG() {
    const src =
      (endpointInput.value && endpointInput.value.trim()) || CONFIG.mjpegUrl;
    if (!src) throw new Error("未提供 MJPEG 端點");
    mjpegEl.style.display = "block";
    mjpegEl.src = src; // 直接用 src
    playing = true;
    showPaused(false);
    updateButtons();
  }

  function stopMJPEG() {
    mjpegEl.src = ""; // 清空即可停止拉流
    playing = false;
    showPaused(true);
    setStatus("已暫停", "warn");
    updateButtons();
  }

  // 清理資源
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

  //控制通訊
  function sendControl(type, payload = {}) {
    if (!ctrl || ctrl.readyState !== 1) {
      setStatus("控制通道未連線", "warn");
      return;
    }
    safeSend(ctrl, { type, ...payload });
  }

  // UI工具
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
    const enabled = connected || true; // 允許先按播放以觸發連線
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
})();
