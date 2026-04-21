/**
 * Safety-First Lane Change Critic
 * NUCLEAN HARDENED VISUALIZATION ENGINE
 */

// --- GLOBAL STATE ---
const AppState = { IDLE: 'IDLE', RUNNING: 'RUNNING', RESULT_SAFE: 'RESULT_SAFE', RESULT_UNSAFE: 'RESULT_UNSAFE', REPLAYING: 'REPLAYING' };
let currentState = AppState.IDLE;
let canvas, ctx, roadCanvas, roadCtx;
let simulationState = null, previousSimulationState = null;
let lastTickTime = Date.now();
let highlightedVehicleId = null, activeAnnotation = null, activeCommentary = null;
let currentScenarioName = 'guaranteedSafe', lastResult = null;
const tooltipTimers = {};
let replayTrace = [], replayIndex = 0, replayPlaying = false, replayInterval = null;
let activeWorker = null;

// --- SCENARIO DATA (BUNDLED TO PREVENT IMPORT ISSUES) ---
const scenarios = {
  guaranteedSafe: {
    name: 'Guaranteed Safe',
    ego: { x: 200, y: 0, vx: 25, lane: 1 },
    neighbors: [
      { id: 'f', x: 240, y: 0, vx: 25, lane: 1, mode: 'normal' },
      { id: 'r', x: 160, y: 0, vx: 25, lane: 1, mode: 'adversarial' },
      { id: 'ft', x: 245, y: 0, vx: 25, lane: 0, mode: 'normal' },
      { id: 'rt', x: 155, y: 0, vx: 25, lane: 0, mode: 'adversarial' }
    ]
  },
  guaranteedUnsafe: {
    name: 'Guaranteed Unsafe',
    ego: { x: 200, y: 0, vx: 20, lane: 1 },
    neighbors: [
      { id: 'f', x: 225, y: 0, vx: 20, lane: 1, mode: 'normal' },
      { id: 'r', x: 192, y: 0, vx: 25, lane: 1, mode: 'adversarial' },
      { id: 'ft', x: 210, y: 0, vx: 20, lane: 0, mode: 'adversarial' },
      { id: 'rt', x: 194, y: 0, vx: 25, lane: 0, mode: 'adversarial' }
    ]
  },
  borderlineGap: {
    name: 'Borderline Gap',
    ego: { x: 200, y: 0, vx: 22, lane: 1 },
    neighbors: [
      { id: 'f', x: 235, y: 0, vx: 22, lane: 1, mode: 'normal' },
      { id: 'r', x: 178, y: 0, vx: 24, lane: 1, mode: 'adversarial' },
      { id: 'ft', x: 237, y: 0, vx: 22, lane: 0, mode: 'normal' },
      { id: 'rt', x: 180, y: 0, vx: 24, lane: 0, mode: 'adversarial' }
    ],
    defaultParams: { rearGapThreshold: 20 }
  },
  borderlineSpeed: {
    name: 'Borderline Speed',
    ego: { x: 200, y: 0, vx: 22, lane: 1 },
    neighbors: [
      { id: 'f', x: 240, y: 0, vx: 22, lane: 1, mode: 'normal' },
      { id: 'r', x: 176, y: 0, vx: 26, lane: 1, mode: 'adversarial' },
      { id: 'ft', x: 242, y: 0, vx: 22, lane: 0, mode: 'normal' },
      { id: 'rt', x: 178, y: 0, vx: 26, lane: 0, mode: 'adversarial' }
    ],
    defaultParams: { ttcThreshold: 5.5 }
  }
};

// --- POLYFILLS ---
if (!CanvasRenderingContext2D.prototype.roundRect) {
  CanvasRenderingContext2D.prototype.roundRect = function(x, y, w, h, r) {
    if (w < 2 * r) r = w / 2;
    if (h < 2 * r) r = h / 2;
    this.beginPath();
    this.moveTo(x + r, y);
    this.arcTo(x + w, y, x + w, y + h, r);
    this.arcTo(x + w, y + h, x, y + h, r);
    this.arcTo(x, y + h, x, y, r);
    this.arcTo(x, y, x + w, y, r);
    this.closePath();
    return this;
  };
}

// --- INITIALIZATION ---
window.addEventListener('DOMContentLoaded', () => {
    try {
        initApp();
    } catch (e) {
        reportError('INITIALIZATION_FATAL', e);
    }
});

function initApp() {
    canvas = document.getElementById('sim-canvas');
    if (!canvas) throw new Error('Canvas element not found');
    ctx = canvas.getContext('2d');
    canvas.height = 500;
    
    roadCanvas = document.createElement('canvas');
    roadCanvas.height = 500;
    roadCtx = roadCanvas.getContext('2d');
    
    resizeCanvas();
    window.addEventListener('resize', resizeCanvas);
    setupEventListeners();
    
    // Load Initial State
    loadScenario('guaranteedSafe');
    requestAnimationFrame(renderFrame);
    setState(AppState.IDLE);
}

function resizeCanvas() {
    canvas.width = canvas.parentElement.clientWidth;
    roadCanvas.width = canvas.width;
    drawRoadLayer();
}

// --- CORE UTILS ---
function setState(newState) {
    console.log(`[STATE] ${newState}`);
    currentState = newState;
    renderUIForState();
}

function reportError(type, err) {
    console.error(`[ERROR:${type}]`, err);
    const overlay = document.getElementById('loading-overlay');
    if (overlay) {
        overlay.hidden = false;
        overlay.innerHTML = `<div style="color:#ef4444; padding:20px; background:rgba(0,0,0,0.8); border:2px solid #ef4444; border-radius:8px;">
            <h2 style="margin:0 0 10px 0">Engine Failure</h2>
            <p style="font-family:monospace; font-size:12px;">${err.message || err}</p>
            <button onclick="location.reload()" style="margin-top:10px; padding:8px 16px; background:#ef4444; color:white; border:none; cursor:pointer;">Reload App</button>
        </div>`;
    }
}

// --- COORDINATE MAPPING ---
const HORIZON_Y = 500 * 0.15;
const WORLD_MIN_X = 150;
const WORLD_RANGE = 100;

function worldToCanvas(worldX, worldLane, lateralOffset = 0) {
    const progress = (worldX - WORLD_MIN_X) / WORLD_RANGE;
    const cy = canvas.height - (progress * (canvas.height - HORIZON_Y));
    const scaleProgress = (cy - HORIZON_Y) / (canvas.height - HORIZON_Y);
    const scale = 0.3 + (scaleProgress * 0.7);
    const roadWidthAtY = (canvas.width - 100) * scaleProgress + (canvas.width * 0.4) * (1 - scaleProgress);
    const roadStartX = (canvas.width - roadWidthAtY) / 2;
    const laneWidth = roadWidthAtY / 3;
    const cx = roadStartX + (worldLane + 0.5) * laneWidth + (lateralOffset * (laneWidth / 4));
    return { cx, cy, scale };
}

// --- RENDERING ---
function drawRoadLayer() {
    const w = roadCanvas.width, h = roadCanvas.height;
    roadCtx.clearRect(0, 0, w, h);
    roadCtx.fillStyle = '#1a1a2e';
    roadCtx.fillRect(0, HORIZON_Y, w, h - HORIZON_Y);
    const topW = w * 0.4, botW = w - 100;
    roadCtx.beginPath();
    roadCtx.moveTo((w-topW)/2, HORIZON_Y); roadCtx.lineTo((w+topW)/2, HORIZON_Y);
    roadCtx.lineTo((w+botW)/2, h-20); roadCtx.lineTo((w-botW)/2, h-20);
    roadCtx.closePath();
    roadCtx.fillStyle = '#111827';
    roadCtx.fill();
}

function renderFrame() {
    if (!ctx) return;
    const now = Date.now();
    const lerpFactor = (now - lastTickTime) / 100;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(roadCanvas, 0, 0);
    
    if (simulationState) {
        const vehicles = [{ ...simulationState.ego, id: 'ego', type: 'ego' }, ...simulationState.neighbors];
        vehicles.sort((a,b) => a.x - b.x); // Simple painter logic
        vehicles.forEach(v => {
            let color = v.type === 'ego' ? '#4fc3f7' : (v.mode === 'adversarial' ? '#ef5350' : '#78909c');
            const { cx, cy, scale } = worldToCanvas(v.x, v.lane, v.lateralOffset || 0);
            if (cy < HORIZON_Y - 20) return;
            const vw = 40 * scale, vh = 20 * scale;
            ctx.save();
            ctx.translate(cx, cy);
            if (highlightedVehicleId === v.id) {
                ctx.shadowBlur = 10; ctx.shadowColor = '#ffb300';
                ctx.fillStyle = 'rgba(255, 179, 0, 0.4)';
                ctx.roundRect(-vw/2-2, -vh/2-2, vw+4, vh+4, 4); ctx.fill();
            }
            ctx.fillStyle = color;
            ctx.roundRect(-vw/2, -vh/2, vw, vh, 4); ctx.fill();
            ctx.restore();
        });
    }
    drawOverlay();
    requestAnimationFrame(renderFrame);
}

function drawOverlay() {
    if (currentState === AppState.RUNNING) {
        ctx.fillStyle = 'rgba(255,255,255,0.05)';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
    }
}

// --- WORKER BRIDGE ---
function runVerifier() {
    console.log('[VERIFIER] Initiating...');
    if (activeWorker) activeWorker.terminate();
    
    activeWorker = new Worker('dls_worker.js');
    activeWorker.onerror = (e) => reportError('WORKER_CRASH', e);
    activeWorker.onmessage = (e) => handleWorkerResult(e.data);
    
    const params = getParams();
    if (isNaN(params.depth)) return reportError('INVALID_PARAMS', 'Depth is NaN');
    
    setState(AppState.RUNNING);
    activeWorker.postMessage({ type: 'RUN', scenario: scenarios[currentScenarioName], params });
}

function handleWorkerResult(data) {
    activeWorker.terminate();
    activeWorker = null;
    lastResult = data;
    console.log('[VERIFIER] Success:', data.verdict);
    
    document.getElementById('verdict-badge').textContent = data.verdict;
    document.getElementById('verdict-badge').setAttribute('data-verdict', data.verdict);
    document.getElementById('sms-score-value').textContent = data.score + '/100';
    document.getElementById('sms-bar-fill').style.width = data.score + '%';
    
    const b = data.breakdown;
    const items = [['frontgap', b.s_f], ['reargap', b.s_r], ['ttc', b.s_ttc], ['lateral', b.s_lat]];
    items.forEach(([k, v]) => {
        document.getElementById('c-'+k).textContent = Math.round(v*100)+'%';
        const st = document.getElementById('cs-'+k);
        st.textContent = v >= 0.5 ? '● PASS' : '● FAIL';
        st.className = v >= 0.5 ? 'status-pass' : 'status-fail';
    });

    if (data.verdict === 'SAFE') setState(AppState.RESULT_SAFE);
    else {
        setState(AppState.RESULT_UNSAFE);
        if (data.trace && data.trace.length > 0) initReplay(data.trace);
    }
}

// --- REPLAY & SCENARIO ---
function loadScenario(name) {
    currentScenarioName = name;
    const s = scenarios[name];
    simulationState = { ego: { ...s.ego, lateralOffset: 0 }, neighbors: s.neighbors.map(n => ({ ...n, lateralOffset: 0 })) };
    previousSimulationState = JSON.parse(JSON.stringify(simulationState));
}

function initReplay(trace) {
    replayTrace = trace; replayIndex = 0;
    renderReplayFrame(0);
}

function renderReplayFrame(idx) {
    simulationState = JSON.parse(JSON.stringify(replayTrace[idx]));
}

function stepReplay(dir) {
    replayIndex = Math.max(0, Math.min(replayTrace.length - 1, replayIndex + dir));
    renderReplayFrame(replayIndex);
}

// --- EVENTS ---
function setupEventListeners() {
    document.getElementById('btn-run').onclick = runVerifier;
    document.getElementById('scenario-select').onchange = (e) => { loadScenario(e.target.value); setState(AppState.IDLE); };
    document.getElementById('btn-step-forward').onclick = () => stepReplay(1);
    document.getElementById('btn-step-back').onclick = () => stepReplay(-1);
    document.getElementById('btn-reset').onclick = () => { if (activeWorker) activeWorker.terminate(); loadScenario(currentScenarioName); setState(AppState.IDLE); };

    ['frontGap', 'rearGap', 'ttc', 'depth', 'aggression'].forEach(id => {
        document.getElementById(id).oninput = (e) => {
            document.getElementById(id+'-val').textContent = e.target.value + (id.includes('Gap') ? 'm' : (id==='ttc'?'s':''));
        };
    });
}

function getParams() {
    return {
        frontGapThreshold: parseFloat(document.getElementById('frontGap').value),
        rearGapThreshold: parseFloat(document.getElementById('rearGap').value),
        ttcThreshold: parseFloat(document.getElementById('ttc').value),
        depth: parseInt(document.getElementById('depth').value),
        aggression: parseFloat(document.getElementById('aggression').value)
    };
}

function renderUIForState() {
    const s = currentState;
    document.getElementById('loading-overlay').hidden = s !== AppState.RUNNING;
    document.getElementById('verdict-card').hidden = (s !== AppState.RESULT_SAFE && s !== AppState.RESULT_UNSAFE && s !== AppState.REPLAYING);
    document.getElementById('replay-controls').hidden = (s !== AppState.RESULT_UNSAFE && s !== AppState.REPLAYING);
    document.getElementById('btn-run').disabled = s === AppState.RUNNING;
}
