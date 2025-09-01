(() => {
const CONFIG = {
mode: getParam('mode', 'webrtc'),
signalingUrl: getParam('signal', 'wss://your-server.example.com/ws'),//WebRTC信令伺服器
hlsUrl: getParam('hls', 'https://your-server.example.com/live/agv.m3u8'),//HLS串流網址
mjpegUrl: getParam('mjpeg', 'https://your-server.example.com/stream.mjpg'),//MJPEG串流網址
controlWs: getParam('control', 'wss://your-server.example.com/agv/control'), //遙控WebSocket
apiBase: getParam('api', 'https://your-server.example.com/api'), // 截圖API
authToken: getParam('token', ''),//驗證token
};

// DOM 參照
const dot = document.getElementById('dot');
const statusEl = document.getElementById('status');
const stateLabel = document.getElementById('stateLabel');
const modeLabel = document.getElementById('modeLabel');
const audioLabel = document.getElementById('audioLabel');
const resLabel = document.getElementById('resLabel');
const errorLabel = document.getElementById('errorLabel');
const pausedOverlay = document.getElementById('pausedOverlay');
const videoEl = document.getElementById('videoEl');
const mjpegEl = document.getElementById('mjpegEl');
const connectBtn = document.getElementById('connectBtn');
const playPauseBtn = document.getElementById('playPauseBtn');
const muteBtn = document.getElementById('muteBtn');
const fsBtn = document.getElementById('fsBtn');
const endpointInput = document.getElementById('endpointInput');
const modeSelect = document.getElementById('modeSelect');
const padBtns = document.querySelectorAll('.pad-btn');
const pauseBtn = document.getElementById('pauseBtn');
const resumeBtn = document.getElementById('resumeBtn');
const estopBtn = document.getElementById('estopBtn');
const snapBtn = document.getElementById('snapBtn');

// 狀態
let currentMode = CONFIG.mode;//當前播放模式 (webrtc/hls/mjpeg)
let wsSignal = null; // WebRTC signaling
let pc = null; // RTCPeerConnection
let hls = null; // Hls.js instance(用於播放HLS)
let ctrl = null; // Control WS
let playing = false;
let connected = false;

// 初始 UI
endpointInput.value = (currentMode === 'webrtc') ? CONFIG.signalingUrl : (currentMode === 'hls') ? CONFIG.hlsUrl : CONFIG.mjpegUrl;
modeSelect.value = currentMode;
modeLabel.textContent = labelOf(currentMode);
setState('idle');
setStatus('尚未連線', 'warn');
updateButtons();

// 事件(模式選擇)
modeSelect.addEventListener('change', () => {
currentMode = modeSelect.value;
modeLabel.textContent = labelOf(currentMode);
endpointInput.value = (currentMode === 'webrtc') ? CONFIG.signalingUrl : (currentMode === 'hls') ? CONFIG.hlsUrl : CONFIG.mjpegUrl;
teardown(); setState('idle'); setStatus('模式已切換為 ' + labelOf(currentMode), 'warn'); updateButtons();
});

//連線按鈕
connectBtn.addEventListener('click', async () => {
try { await connect(); await playVideoIfNeeded(); } catch (err) { setError(err); }
});

//播放/暫停 按鈕
playPauseBtn.addEventListener('click', async () => {
try {
if (!connected) { await connect(); }// 沒連線就先連線
if (currentMode === 'mjpeg') {
if (playing) { mjpegEl.src = ''; playing = false; showPaused(true); }
else { mjpegEl.src = endpointInput.value || CONFIG.mjpegUrl; playing = true; showPaused(false); }
updateButtons(); return;
}
if (videoEl.paused) { await videoEl.play(); playing = true; showPaused(false); }
else { videoEl.pause(); playing = false; showPaused(true); }
updateButtons();
} catch (err) { setError(err); }
});

//靜音切換按鈕
muteBtn.addEventListener('click', () => {
videoEl.muted = !videoEl.muted;
audioLabel.textContent = videoEl.muted ? '靜音' : '有聲';
muteBtn.textContent = videoEl.muted ? '靜音' : '取消靜音';
});

//全螢幕按鈕
fsBtn.addEventListener('click', () => {
const card = document.querySelector('.video-card');
if (!document.fullscreenElement) card.requestFullscreen?.(); else document.exitFullscreen?.();
});

//影片載入完畢後顯示解析度
videoEl.addEventListener('loadedmetadata', () => {
resLabel.textContent = `${videoEl.videoWidth || '—'}x${videoEl.videoHeight || '—'}`;
});

//遙控按鈕
padBtns.forEach(btn => btn.addEventListener('click', () => {
const type = btn.dataset.cmd; const v = parseFloat(btn.dataset.v||'0'); const w = parseFloat(btn.dataset.w||'0');
sendControl(type, { v, w });
}));

//鍵盤控制
document.addEventListener('keydown', (e) => {
if (!ctrl || ctrl.readyState !== 1 || e.repeat) return;
const SPEED = 0.6, TURN = 1.0;
switch (e.key) {
case 'ArrowUp': return sendControl('drive', { v: +SPEED, w: 0 });
case 'ArrowDown': return sendControl('drive', { v: -SPEED, w: 0 });
case 'ArrowLeft': return sendControl('drive', { v: 0, w: +TURN });
case 'ArrowRight': return sendControl('drive', { v: 0, w: -TURN });
case ' ': return sendControl('resume');
case 'e': case 'E':return sendControl('estop');
}
});

//截圖
snapBtn.addEventListener('click', async () => {
if (!CONFIG.apiBase) return alert('未設定 API Base');
try {
const url = withToken(CONFIG.apiBase.replace(/\/?$/,'') + '/snapshot', CONFIG.authToken);
const res = await fetch(url, { method: 'POST' });
if (!res.ok) throw new Error('截圖失敗');
const blob = await res.blob();
const a = document.createElement('a');
a.href = URL.createObjectURL(blob);
//下載成圖片檔
a.download = `snapshot_${Date.now()}.jpg`;
a.click();
setStatus('已取得截圖', 'ok');
} catch (e) { setError(e); }
});

//頁面離開前清理資源
window.addEventListener('beforeunload', teardown);

//WebRTC初始化
iceServers: [ { urls: 'stun:stun.l.google.com:19302' } ]
});
const inbound = new MediaStream(); videoEl.srcObject = inbound;
pc.ontrack = (ev) => { ev.streams[0].getTracks().forEach(t => inbound.addTrack(t)); };

//建立WebSocket
const url = withToken(signalingUrl, CONFIG.authToken);
wsSignal = new WebSocket(url);

//WebRTC信令事件
wsSignal.onopen = async () => {
try {
safeSend(wsSignal, { type: 'viewer' });
const offer = await pc.createOffer({ offerToReceiveVideo: true, offerToReceiveAudio: true });
await pc.setLocalDescription(offer);
safeSend(wsSignal, { type: 'offer', sdp: offer.sdp });
} catch (err) { setError(err); }
};

wsSignal.onmessage = async (e) => {
try {
const msg = JSON.parse(e.data);
if (msg.type === 'answer' && msg.sdp) {
await pc.setRemoteDescription(new RTCSessionDescription({ type: 'answer', sdp: msg.sdp }));
} else if (msg.type === 'ice' && msg.candidate) {
await pc.addIceCandidate(new RTCIceCandidate(msg.candidate));
} else if (msg.type === 'offer') {
await pc.setRemoteDescription(new RTCSessionDescription({ type: 'offer', sdp: msg.sdp }));
const answer = await pc.createAnswer(); await pc.setLocalDescription(answer);
safeSend(wsSignal, { type: 'answer', sdp: answer.sdp });
} else if (msg.type === 'error') {
setError(new Error(`${msg.code||''} ${msg.message||''}`));
}
} catch (err) { setError(err); }
};

wsSignal.onclose = () => { setStatus('信令已關閉', 'warn'); };
wsSignal.onerror = (e) => { setError(e); };
//ICE候選者事件-傳送給信令伺服器
pc.onicecandidate = (ev) => { if (ev.candidate) safeSend(wsSignal, { type: 'ice', candidate: ev.candidate }); };

//HLS連線
async function connectHLS(src) {
setState('connecting'); setStatus('HLS 連線中…', 'warn');
videoEl.srcObject = null; videoEl.removeAttribute('src');
mjpegEl.style.display = 'none'; videoEl.style.display = 'block';

const real = withToken(src, CONFIG.authToken);
if (videoEl.canPlayType('application/vnd.apple.mpegurl')) {
videoEl.src = real;
} else if (window.Hls && window.Hls.isSupported()) {
hls = new Hls({ liveDurationInfinity: true }); hls.loadSource(real); hls.attachMedia(videoEl);
} else { throw new Error('此瀏覽器不支援 HLS,且無法載入 Hls.js'); }
}

//MJPEG連線
async function connectMJPEG(src) {
setState('connecting'); setStatus('MJPEG 連線中…', 'warn');
videoEl.pause(); videoEl.style.display = 'none'; mjpegEl.style.display = 'block';
mjpegEl.src = withToken(src, CONFIG.authToken);
playing = true; showPaused(false);
}

// 清理資源
function teardown() {
playing = false; connected = false;
if (mjpegEl) mjpegEl.src = '';
if (hls) { try { hls.destroy(); } catch {} hls = null; }
if (pc) { try { pc.getTransceivers?.().forEach(t=>t.stop?.()); } catch {}
try { pc.getSenders?.().forEach(s=>s.track&&s.track.stop()); } catch {}
try { pc.getReceivers?.().forEach(r=>r.track&&r.track.stop()); } catch {}
try { pc.close(); } catch {} }
pc = null;
try { wsSignal?.close?.(); } catch {}
wsSignal = null;
try { ctrl?.close?.(); } catch {}
ctrl = null;
showPaused(false); updateButtons();
}

// 工具
async function playVideoIfNeeded() {
if (currentMode !== 'mjpeg') {
try { await videoEl.play(); playing = true; showPaused(false); } catch {}
updateButtons();
}
}
function setState(s) { stateLabel.textContent = s; }
function setStatus(text, type='ok') {
statusEl.textContent = text;
dot.style.background = type==='ok' ? 'var(--ok)' : type==='warn' ? 'var(--warn)' : 'var(--err)';
}
function showPaused(show) { pausedOverlay.style.display = show ? 'grid' : 'none'; }
function updateButtons() {
const enabled = connected || true; // 初次也允許按播放
playPauseBtn.disabled = !enabled;
muteBtn.disabled = currentMode === 'mjpeg' || !enabled;
fsBtn.disabled = !enabled;
connectBtn.textContent = connected ? (playing ? '重新連線' : '▶ 重新連線並播放') : '▶ 連線並播放';
}
function setError(err) { console.error(err); errorLabel.textContent = err?.message || String(err); setStatus('發生錯誤', 'err'); }
function labelOf(mode) { return mode==='webrtc'?'WebRTC':mode==='hls'?'HLS':'MJPEG'; }
function safeSend(ws, obj) { try { if (ws && ws.readyState === 1) ws.send(JSON.stringify(obj)); } catch {} }
function withToken(url, token) { if (!token) return url; const u = new URL(url, location.href); if (!u.searchParams.get('token')) u.searchParams.set('token', token); return u.toString(); }
function getParam(key, fallback='') { const v = new URLSearchParams(location.search).get(key); return v ?? fallback; }