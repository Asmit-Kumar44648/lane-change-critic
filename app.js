/**
 * Safety-First Lane Change Critic
 * Visualization Engine
 */

let canvas, ctx;
let roadCanvas, roadCtx;
let simulationState = null;
let previousSimulationState = null;
let lastTickTime = Date.now();
let highlightedVehicleId = null;
let currentScenario = null;
let currentScenarioName = 'guaranteedSafe';
let lastResult = null;
let activeAnnotation = null;
let activeCommentary = null;

let currentState = AppState.IDLE;
const tooltipTimers = {};
let replayTrace = [];
let replayIndex = 0;
let replayPlaying = false;
let replayInterval = null;

// --- UTILITIES ---
function setState(newState) {
  currentState = newState;
  renderUIForState();
}

import { scenarios } from './scenarios.js';

// No longer need testState here, as we load from scenarios.js

// --- INITIALIZATION ---

export function initCanvas(canvasElement) {
    canvas = canvasElement;
    ctx = canvas.getContext('2d');
    
    canvas.height = 500;
    resizeCanvas();
    window.addEventListener('resize', resizeCanvas);

    roadCanvas = document.createElement('canvas');
    roadCanvas.width = canvas.width;
    roadCanvas.height = canvas.height;
    roadCtx = roadCanvas.getContext('2d');
    
    drawRoadLayer();
    
    // UI Event Listeners
    setupEventListeners();
    
    // Animation loop
    requestAnimationFrame(renderFrame);

    // Initial Load
    const urlParams = new URLSearchParams(window.location.search);
    const sceneParam = urlParams.get('scenario');
    if (sceneParam && scenarios[sceneParam]) {
        document.getElementById('scenario-select').value = sceneParam;
        loadScenario(sceneParam);
    } else {
        loadScenario('guaranteedSafe');
    }
}

function resizeCanvas() {
    const parent = canvas.parentElement;
    canvas.width = parent.clientWidth;
    if (roadCanvas) {
        roadCanvas.width = canvas.width;
        drawRoadLayer();
    }
}

// --- COORDINATE MAPPING ---

const HORIZON_Y = 500 * 0.15;
const WORLD_MIN_X = 150;
const WORLD_RANGE = 100;

function worldToCanvas(worldX, worldLane, lateralOffset = 0) {
    // cy calculation
    const progress = (worldX - WORLD_MIN_X) / WORLD_RANGE; // 0 at min, 1 at max
    const cy = canvas.height - (progress * (canvas.height - HORIZON_Y));
    
    // scale calculation
    const scaleProgress = (cy - HORIZON_Y) / (canvas.height - HORIZON_Y);
    const scale = 0.3 + (scaleProgress * 0.7);
    
    // Trapezoid mapping
    const roadWidthAtY = (canvas.width - 100) * scaleProgress + (canvas.width * 0.4) * (1 - scaleProgress);
    const roadStartX = (canvas.width - roadWidthAtY) / 2;
    const laneWidth = roadWidthAtY / 3;
    
    const cx = roadStartX + (worldLane + 0.5) * laneWidth + (lateralOffset * (laneWidth / 4));
    
    return { cx, cy, scale };
}

// --- ROAD LAYER ---

function drawRoadLayer() {
    const w = roadCanvas.width;
    const h = roadCanvas.height;
    
    roadCtx.clearRect(0, 0, w, h);
    
    // Sky
    const skyGrad = roadCtx.createLinearGradient(0, 0, 0, HORIZON_Y);
    skyGrad.addColorStop(0, '#020617');
    skyGrad.addColorStop(1, '#1e293b');
    roadCtx.fillStyle = skyGrad;
    roadCtx.fillRect(0, 0, w, HORIZON_Y);
    
    // Asphalt base
    roadCtx.fillStyle = '#1a1a2e';
    roadCtx.fillRect(0, HORIZON_Y, w, h - HORIZON_Y);
    
    // Trapezoid Road
    const topW = w * 0.4;
    const botW = w - 100;
    
    roadCtx.beginPath();
    roadCtx.moveTo((w - topW) / 2, HORIZON_Y);
    roadCtx.lineTo((w + topW) / 2, HORIZON_Y);
    roadCtx.lineTo((w + botW) / 2, h - 20);
    roadCtx.lineTo((w - botW) / 2, h - 20);
    roadCtx.closePath();
    roadCtx.fillStyle = '#111827';
    roadCtx.fill();
    
    // Lane Markings
    roadCtx.setLineDash([10, 20]);
    roadCtx.strokeStyle = 'rgba(255, 255, 255, 0.3)';
    roadCtx.lineWidth = 2;
    
    for (let i = 1; i < 3; i++) {
        const xTop = (w - topW) / 2 + (i * topW / 3);
        const xBot = (w - botW) / 2 + (i * botW / 3);
        roadCtx.beginPath();
        roadCtx.moveTo(xTop, HORIZON_Y);
        roadCtx.lineTo(xBot, h - 20);
        roadCtx.stroke();
    }
    
    // Shoulders
    roadCtx.setLineDash([]);
    roadCtx.strokeStyle = 'white';
    roadCtx.lineWidth = 3;
    roadCtx.beginPath();
    roadCtx.moveTo((w - topW) / 2, HORIZON_Y);
    roadCtx.lineTo((w - botW) / 2, h - 20);
    roadCtx.stroke();
    roadCtx.beginPath();
    roadCtx.moveTo((w + topW) / 2, HORIZON_Y);
    roadCtx.lineTo((w + botW) / 2, h - 20);
    roadCtx.stroke();
}

// --- VEHICLE RENDERING ---

function drawVehicle(v, color) {
    const { cx, cy, scale } = worldToCanvas(v.xInterpolated, v.lane, v.lateralOffset || 0);
    
    if (cy < HORIZON_Y - 20) return; // Cull if too far
    
    const w = 40 * scale;
    const h = 20 * scale;
    
    ctx.save();
    ctx.translate(cx, cy);
    
    // Pulsing highlight
    if (highlightedVehicleId === v.id) {
        const pulse = 0.7 + 0.3 * Math.sin(Date.now() / 160); // approx 2Hz
        ctx.shadowBlur = 15 * scale;
        ctx.shadowColor = '#ffb300';
        ctx.fillStyle = `rgba(255, 179, 0, ${pulse})`;
        ctx.beginPath();
        ctx.roundRect(-w/2 - 2, -h/2 - 2, w + 4, h + 4, 6 * scale);
        ctx.fill();
        ctx.shadowBlur = 0;
    }

    // Body
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.roundRect(-w/2, -h/2, w, h, 4 * scale);
    ctx.fill();
    
    // Windshield (Front is +X in world, which is Up on canvas? No, user says worldX maps to canvasY)
    // Front of car should be upper side of rectangle if moving towards horizon
    ctx.fillStyle = 'rgba(255, 255, 255, 0.3)';
    ctx.fillRect(-w/2 + 4 * scale, -h/2 + 2 * scale, w - 8 * scale, 4 * scale);
    
    // Velocity Arrow
    const arrowLen = Math.min(30, (v.vx / 40) * 30) * scale;
    ctx.strokeStyle = color;
    ctx.globalAlpha = 0.6;
    ctx.lineWidth = 2 * scale;
    ctx.beginPath();
    ctx.moveTo(0, -h/2);
    ctx.lineTo(0, -h/2 - arrowLen);
    ctx.stroke();
    
    ctx.restore();
}

// --- CORE LOOPS ---

function simTick() {
    previousSimulationState = JSON.parse(JSON.stringify(simulationState));
    
    // Update simulation positions (simple linear for test state)
    simulationState.ego.x += simulationState.ego.vx * 0.1;
    simulationState.neighbors.forEach(n => {
        n.x += n.vx * 0.1;
    });
    
    // Reset test loop
    if (simulationState.ego.x > WORLD_MIN_X + WORLD_RANGE) {
        simulationState.ego.x = WORLD_MIN_X;
        simulationState.neighbors.forEach(n => n.x -= WORLD_RANGE);
    }
    
    lastTickTime = Date.now();
}

export function renderFrame() {
    if (!ctx) return;
    
    const now = Date.now();
    const lerpFactor = (now - lastTickTime) / 100;
    
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    
    // Layer 1: Static Road
    ctx.drawImage(roadCanvas, 0, 0);
    
    // Layer 2: Vehicles
    const vehicles = [
        { ...simulationState.ego, id: 'ego', type: 'ego' },
        ...simulationState.neighbors
    ].map(v => {
        const prev = v.id === 'ego' ? previousSimulationState.ego : previousSimulationState.neighbors.find(n => n.id === v.id);
        return {
            ...v,
            xInterpolated: prev ? prev.x + (v.x - prev.x) * Math.min(1, lerpFactor) : v.x
        };
    });
    
    // Sort by x Interpolated for painter's algorithm (descending worldX = back to front in view)
    vehicles.sort((a, b) => a.xInterpolated - b.xInterpolated);
    
    vehicles.forEach(v => {
        let color = '#78909c'; // Normal
        if (v.type === 'ego') color = '#4fc3f7';
        else if (v.mode === 'adversarial') color = '#ef5350';
        
        drawVehicle(v, color);
    });
    
    // Layer 3: Overlay
    drawOverlay();
    
    requestAnimationFrame(renderFrame);
}

function drawOverlay() {
    // Canvas Loading Shimmer (Diagonal Stripes)
    if (currentState === AppState.RUNNING) {
        const w = canvas.width;
        const h = canvas.height;
        ctx.save();
        ctx.globalAlpha = 0.05;
        ctx.fillStyle = 'white';
        const time = Date.now() * 0.1;
        const stripeWidth = 50;
        const gap = 50;
        for (let x = -h; x < w + h; x += stripeWidth + gap) {
            ctx.beginPath();
            const xOffset = x + (time % (stripeWidth + gap));
            ctx.moveTo(xOffset, 0);
            ctx.lineTo(xOffset + stripeWidth, 0);
            ctx.lineTo(xOffset + stripeWidth - h, h);
            ctx.lineTo(xOffset - h, h);
            ctx.fill();
        }
        ctx.restore();
    }

    if (activeCommentary) {
        ctx.fillStyle = 'rgba(0, 0, 0, 0.7)';
        ctx.fillRect(0, 20, canvas.width, 40);
        ctx.fillStyle = 'white';
        ctx.font = 'bold 16px var(--font-sans)';
        ctx.textAlign = 'center';
        ctx.fillText(activeCommentary, canvas.width / 2, 45);
    }

    if (activeAnnotation) {
        const frame = replayTrace[replayIndex];
        if (frame) {
            // Find the vehicle to annotate (highlighted or ego)
            const targetVehicle = frame.neighbors.find(n => n.id === highlightedVehicleId) || frame.ego;
            const { cx, cy } = worldToCanvas(targetVehicle.x, targetVehicle.lane, targetVehicle.lateralOffset || 0);
            
            ctx.save();
            // Callout Label
            const labelX = cx + 40;
            const labelY = cy - 60;
            const padding = { h: 10, v: 6 };
            
            ctx.font = '11px var(--font-mono)';
            const textWidth = ctx.measureText(activeAnnotation.text).width;
            const labelW = textWidth + padding.h * 2;
            const labelH = 11 + padding.v * 2;

            // Line to vehicle
            ctx.strokeStyle = 'var(--color-amber)';
            ctx.lineWidth = 1.5;
            ctx.beginPath();
            ctx.moveTo(cx, cy);
            ctx.lineTo(labelX, labelY + labelH / 2);
            ctx.stroke();

            // Label background
            ctx.fillStyle = 'rgba(255, 179, 0, 0.9)';
            ctx.beginPath();
            ctx.roundRect(labelX, labelY, labelW, labelH, 4);
            ctx.fill();
            
            // Label text
            ctx.fillStyle = '#000';
            ctx.textAlign = 'left';
            ctx.fillText(activeAnnotation.text, labelX + padding.h, labelY + labelH - padding.v - 1);
            ctx.restore();
        }
    }

    // Default Bottom Bar
    if (currentState === AppState.IDLE || currentState === AppState.RUNNING) {
        ctx.fillStyle = 'rgba(15, 23, 42, 0.9)';
        ctx.fillRect(0, canvas.height - 60, canvas.width, 60);
        ctx.fillStyle = '#94a3b8';
        ctx.font = '14px var(--font-sans)';
        ctx.textAlign = 'center';
        ctx.fillText(currentState === AppState.RUNNING ? 'Searching for counterexamples...' : 'Run verifier to see safety score', canvas.width / 2, canvas.height - 25);
    }
}

// --- UI LOGIC ---

function setupEventListeners() {
    document.getElementById('btn-run').addEventListener('click', runVerifier);
    document.getElementById('btn-reset').addEventListener('click', resetApp);
    document.getElementById('scenario-select').addEventListener('change', (e) => {
        loadScenario(e.target.value);
        setState(AppState.IDLE);
    });

    // Sliders
    ['frontGap', 'rearGap', 'ttc', 'depth', 'aggression'].forEach(id => {
        const el = document.getElementById(id);
        el.addEventListener('input', () => {
            updateSliderDisplay(id);
            showTooltip(id);
            if (currentState === AppState.RESULT_SAFE || currentState === AppState.RESULT_UNSAFE) {
                debouncedRun();
            }
        });
        el.addEventListener('change', () => hideTooltip(id));
    });

    // Replay Controls
    document.getElementById('btn-step-forward').addEventListener('click', () => stepReplay(1));
    document.getElementById('btn-step-back').addEventListener('click', stepReplay(-1));
    document.getElementById('btn-play-pause').addEventListener('click', togglePlayPause);
    
    // Extra actions
    document.getElementById('btn-demo').addEventListener('click', runDemo);
    document.getElementById('btn-copy-json').addEventListener('click', copyResults);

    // Keyboard Shortcuts
    window.addEventListener('keydown', (e) => {
        if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT') return;
        
        switch(e.key.toLowerCase()) {
            case 'r': runVerifier(); break;
            case 'escape': resetApp(); break;
            case ' ': e.preventDefault(); togglePlayPause(); break;
            case 'arrowright': stepReplay(1); break;
            case 'arrowleft': stepReplay(-1); break;
        }
    });
}

function updateSliderDisplay(id) {
    const el = document.getElementById(id);
    const span = document.getElementById(id + '-val');
    const tooltip = document.getElementById(id + '-tooltip');
    let val = el.value;
    if (id.includes('Gap')) val += 'm';
    else if (id === 'ttc') val += 's';
    span.textContent = val;
    if (tooltip) tooltip.textContent = val;
}

function showTooltip(id) {
    const el = document.getElementById(id);
    const tooltip = document.getElementById(id + '-tooltip');
    if (!tooltip) return;
    
    tooltip.classList.add('show');
    
    // Position tooltip above thumb
    const ratio = (el.value - el.min) / (el.max - el.min);
    const thumbWidth = 16;
    const offset = (ratio * (el.offsetWidth - thumbWidth)) + (thumbWidth / 2);
    tooltip.style.left = offset + 'px';
    
    clearTimeout(tooltipTimers[id]);
    tooltipTimers[id] = setTimeout(() => hideTooltip(id), 1000);
}

function hideTooltip(id) {
    const tooltip = document.getElementById(id + '-tooltip');
    if (tooltip) tooltip.classList.remove('show');
}

let debounceTimer = null;
function debouncedRun() {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(runVerifier, 300);
}

function loadScenario(name) {
    currentScenarioName = name;
    currentScenario = scenarios[name];
    
    // Overwrite thresholds if scenario has defaults
    if (currentScenario.defaultParams) {
        Object.entries(currentScenario.defaultParams).forEach(([key, val]) => {
            const input = document.getElementById(key.replace('Threshold', ''));
            if (input) {
                input.value = val;
                updateSliderDisplay(input.id);
            }
        });
    }

    simulationState = {
        ego: { ...currentScenario.ego, lateralOffset: 0 },
        neighbors: currentScenario.neighbors.map(n => ({ ...n, lateralOffset: 0 })),
        timestep: 0
    };
    previousSimulationState = JSON.parse(JSON.stringify(simulationState));
}

function resetApp() {
    clearInterval(replayInterval);
    replayPlaying = false;
    replayTrace = [];
    lastResult = null;
    activeAnnotation = null;
    setHighlight(null);
    loadScenario(currentScenarioName);
    setState(AppState.IDLE);
}

// --- WORKER BRIDGE ---
const worker = new Worker('dls_worker.js');

function runVerifier() {
    setState(AppState.RUNNING);
    activeAnnotation = null;
    const params = getParams();
    worker.postMessage({ type: 'RUN', scenario: currentScenario, params });
    
    // Update URL
    const url = new URL(window.location);
    url.searchParams.set('scenario', currentScenarioName);
    history.replaceState(null, '', url);
}

function getParams() {
    return {
        frontGapThreshold: parseFloat(document.getElementById('frontGap').value),
        rearGapThreshold: parseFloat(document.getElementById('rearGap').value),
        ttcThreshold: parseFloat(document.getElementById('ttc').value),
        depth: parseInt(document.getElementById('depth').value),
        adversarialAggression: parseFloat(document.getElementById('aggression').value)
    };
}

worker.onmessage = function(e) {
    lastResult = e.data;
    
    // Update UI Elements
    document.getElementById('verdict-badge').textContent = e.data.verdict;
    document.getElementById('verdict-badge').setAttribute('data-verdict', e.data.verdict);
    document.getElementById('sms-score-value').textContent = e.data.score + '/100';
    
    const fill = document.getElementById('sms-bar-fill');
    fill.style.width = e.data.score + '%';
    fill.className = 'sms-bar-fill ' + (e.data.score < 40 ? 'score-low' : (e.data.score < 70 ? 'score-mid' : 'score-high'));

    const b = e.data.breakdown;
    const items = [
        { key: 'frontgap', val: b.s_f },
        { key: 'reargap', val: b.s_r },
        { key: 'ttc', val: b.s_ttc },
        { key: 'lateral', val: b.s_lat }
    ];
    items.forEach(item => {
        document.getElementById('c-' + item.key).textContent = Math.round(item.val * 100) + '%';
        const st = document.getElementById('cs-' + item.key);
        st.textContent = item.val >= 0.5 ? '● PASS' : '● FAIL';
        st.className = item.val >= 0.5 ? 'status-pass' : 'status-fail';
    });

    document.getElementById('stat-nodes').textContent = e.data.stats.nodesExplored;
    document.getElementById('stat-pruned').textContent = e.data.stats.branchesPruned;
    document.getElementById('stat-depth').textContent = e.data.stats.depthReached;

    if (e.data.verdict === 'SAFE') {
        setState(AppState.RESULT_SAFE);
    } else {
        setState(AppState.RESULT_UNSAFE);
        if (e.data.trace && e.data.trace.length > 0) {
            initReplay(e.data.trace);
        }
    }
};

function updateSimState(frame) {
    previousSimulationState = JSON.parse(JSON.stringify(simulationState));
    simulationState = JSON.parse(JSON.stringify(frame));
    lastTickTime = Date.now();
}

function setHighlight(id) {
    highlightedVehicleId = id;
}

// --- REPLAY CONTROLLER ---
let replayTrace = [];
let replayIndex = 0;
let replayPlaying = false;
let replayInterval = null;

function initReplay(trace) {
    replayTrace = trace;
    replayIndex = 0;
    replayPlaying = false;
    renderReplayFrame(0);
}

function renderReplayFrame(index) {
    const frame = replayTrace[index];
    if (!frame) return;
    
    updateSimState(frame);
    
    // Identify violator (find vehicle that is too close)
    let violator = frame.neighbors.find(n => {
        const dist = Math.abs(n.x - frame.ego.x);
        return dist < 10; // Simple heuristic for replay
    });
    
    const violatorID = violator ? violator.id : 'rear';
    setHighlight(violatorID);
    
    const vConstraint = frame.eval.violated[0] || 'Safety Buffer';
    const vValue = frame.eval.sms < 0.2 ? 'Critical' : 'Low';
    
    activeAnnotation = {
        x: violator ? violator.x : frame.ego.x - 10,
        lane: violator ? violator.lane : frame.ego.lane,
        lateralOffset: violator ? violator.lateralOffset : 0,
        text: `T=${(frame.timestep * 0.75).toFixed(2)}s | Violation: ${vConstraint} (${vValue})`
    };
}

function stepReplay(dir) {
    replayIndex = Math.max(0, Math.min(replayTrace.length - 1, replayIndex + dir));
    renderReplayFrame(replayIndex);
}

function togglePlayPause() {
    replayPlaying = !replayPlaying;
    const btn = document.getElementById('btn-play-pause');
    btn.textContent = replayPlaying ? '⏸ Pause' : '▶ Play';
    
    if (replayPlaying) {
        replayInterval = setInterval(() => {
            if (replayIndex < replayTrace.length - 1) {
                stepReplay(1);
            } else {
                togglePlayPause(); // Stop at end
            }
        }, 800);
    } else {
        clearInterval(replayInterval);
    }
}

// --- STATE MACHINE UI ---
function renderUIForState() {
    const loading = document.getElementById('loading-overlay');
    const verdict = document.getElementById('verdict-card');
    const replay = document.getElementById('replay-controls');
    const stats = document.getElementById('search-stats');
    const btnRun = document.getElementById('btn-run');
    const note = document.getElementById('counterexample-note');

    loading.hidden = (currentState !== AppState.RUNNING);
    
    if (currentState === AppState.RESULT_SAFE || currentState === AppState.RESULT_UNSAFE) {
        verdict.hidden = false;
        verdict.classList.add('show');
    } else {
        verdict.hidden = true;
        verdict.classList.remove('show');
    }

    replay.hidden = (currentState !== AppState.RESULT_UNSAFE && currentState !== AppState.REPLAYING);
    stats.hidden = (currentState === AppState.IDLE);
    btnRun.disabled = (currentState === AppState.RUNNING);
    note.hidden = (currentState !== AppState.RESULT_UNSAFE);
}

// --- DEMO & EXTRAS ---
async function runDemo() {
    const scenarioOrder = ['guaranteedSafe', 'guaranteedUnsafe', 'borderlineGap', 'borderlineSpeed'];
    const commentary = [
        'SAFE: Wide gaps, matching speeds.',
        'UNSAFE: Close rear neighbor, collision detected.',
        'BORDERLINE: Rear gap at 1.1x threshold.',
        'BORDERLINE: TTC at threshold + 0.5s.'
    ];

    for (let i = 0; i < scenarioOrder.length; i++) {
        activeCommentary = commentary[i];
        const select = document.getElementById('scenario-select');
        select.value = scenarioOrder[i];
        loadScenario(scenarioOrder[i]);
        await new Promise(r => setTimeout(r, 1000));
        runVerifier();
        await new Promise(resolve => {
            const originalHandler = worker.onmessage;
            worker.onmessage = (e) => {
                originalHandler(e);
                resolve();
                worker.onmessage = originalHandler;
            };
        });
        await new Promise(r => setTimeout(r, 2000));
    }
    activeCommentary = null;
}

function showCommentary(text) { activeCommentary = text; }
function hideCommentary() { activeCommentary = null; }

function copyResults() {
    if (!lastResult) return;
    const data = {
        scenario: currentScenarioName,
        verdict: lastResult.verdict,
        score: lastResult.score,
        params: getParams(),
        timestamp: new Date().toISOString()
    };
    navigator.clipboard.writeText(JSON.stringify(data, null, 2));
    const btn = document.getElementById('btn-copy-json');
    const oldText = btn.textContent;
    btn.textContent = '✓ Copied!';
    setTimeout(() => btn.textContent = oldText, 2000);
}

// --- INITIALIZATION ---
window.addEventListener('DOMContentLoaded', () => {
    initCanvas(document.getElementById('sim-canvas'));
    
    // URL Params Recovery
    const urlParams = new URLSearchParams(window.location.search);
    if (urlParams.get('scenario')) {
        const s = urlParams.get('scenario');
        document.getElementById('scenario-select').value = s;
        loadScenario(s);
        
        // Restore param sliders
        if (urlParams.get('fg')) document.getElementById('frontGap').value = urlParams.get('fg');
        if (urlParams.get('rg')) document.getElementById('rearGap').value = urlParams.get('rg');
        if (urlParams.get('ttc')) document.getElementById('ttc').value = urlParams.get('ttc');
        if (urlParams.get('d')) document.getElementById('depth').value = urlParams.get('d');
        if (urlParams.get('ag')) document.getElementById('aggression').value = urlParams.get('ag');
        
        // Update all displays
        ['frontGap', 'rearGap', 'ttc', 'depth', 'aggression'].forEach(id => updateSliderDisplay(id));
    } else {
        loadScenario('guaranteedSafe');
    }
    
    setState(AppState.IDLE);
});
