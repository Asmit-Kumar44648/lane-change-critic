/**
 * COMPREHENSIVE TEST ENGINE
 * Verifies all 4 scenarios against the minimax engine.
 */

const TIMESTEP = 0.75;
const MAX_SPEED = 40;
const MIN_SPEED = 0;
const LANE_WIDTH = 4;
const MAX_ACCEL = 4;
const MAX_DECEL = 8;
const MILD_ACCEL = 1.5;
const LC_TICKS = 3;
const SMS_THRESHOLD = 0.6;
const SMS_WEIGHTS = { frontGap: 0.30, rearGap: 0.25, ttc: 0.30, lateral: 0.15 };
const VEHICLE_LENGTH = 5;

// --- Engine Logic ---
function createNextState(state) {
  return {
    ego: { ...state.ego },
    neighbors: state.neighbors.map(n => ({ ...n })),
    timestep: state.timestep,
    laneChangeTick: state.laneChangeTick
  };
}

function getActions(state, isEgo) {
  if (isEgo) {
    const actions = ['MAINTAIN', 'ACCELERATE', 'DECELERATE'];
    if (state.laneChangeTick === 0) actions.push('INITIATE_LC');
    return actions;
  } else {
    const neighborActionSets = state.neighbors.map(n => {
      if (n.mode === 'normal') return ['MAINTAIN', 'ACCEL_MILD'];
      return ['HARD_BRAKE', 'ACCELERATE_CUTOFF', 'SWERVE_TOWARD'];
    });
    return neighborActionSets.reduce((acc, set) => {
      const nextAcc = [];
      for (const prev of acc) {
        for (const action of set) nextAcc.push([...prev, action]);
      }
      return nextAcc;
    }, [[]]);
  }
}

function applyAction(state, egoAction, neighborActions) {
  const next = createNextState(state);
  next.timestep++;
  if (egoAction) {
    if (egoAction === 'ACCELERATE') next.ego.vx = Math.min(MAX_SPEED, next.ego.vx + MAX_ACCEL * TIMESTEP);
    else if (egoAction === 'DECELERATE') next.ego.vx = Math.max(MIN_SPEED, next.ego.vx - MAX_ACCEL * TIMESTEP);
    else if (egoAction === 'INITIATE_LC') next.laneChangeTick = 1;
    if (next.laneChangeTick > 0) {
      next.ego.lateralOffset += LANE_WIDTH / LC_TICKS;
      next.laneChangeTick++;
      if (next.laneChangeTick > LC_TICKS) {
        next.ego.lane -= 1;
        next.ego.lateralOffset = 0;
        next.laneChangeTick = 0;
      }
    }
    next.ego.x += next.ego.vx * TIMESTEP;
  }
  if (neighborActions && neighborActions.length > 0) {
    next.neighbors.forEach((n, i) => {
      const action = neighborActions[i];
      if (action === 'ACCEL_MILD') n.vx = Math.min(MAX_SPEED, n.vx + MILD_ACCEL * TIMESTEP);
      else if (action === 'HARD_BRAKE') n.vx = Math.max(MIN_SPEED, n.vx - MAX_DECEL * TIMESTEP);
      else if (action === 'ACCELERATE_CUTOFF') n.vx = Math.min(MAX_SPEED, n.vx + MAX_ACCEL * TIMESTEP);
      else if (action === 'SWERVE_TOWARD') n.lateralOffset += 0.5;
      n.x += n.vx * TIMESTEP;
    });
  }
  return next;
}

function evaluateSafety(state, params) {
  const ego = state.ego;
  let gap_f = Infinity;
  let gap_r = Infinity;
  let ttc_r = Infinity;
  const egoEffY = (ego.lane * LANE_WIDTH) - ego.lateralOffset;
  state.neighbors.forEach(n => {
    const nEffY = (n.lane * LANE_WIDTH) + n.lateralOffset;
    const inSameCorridor = Math.abs(egoEffY - nEffY) < (LANE_WIDTH * 0.9);
    if (inSameCorridor) {
      const dist = n.x - ego.x;
      if (dist > 0) {
        const gap = dist - VEHICLE_LENGTH;
        if (gap < gap_f) gap_f = gap;
      } else {
        const gap = Math.abs(dist) - VEHICLE_LENGTH;
        if (gap < gap_r) {
          gap_r = gap;
          if (n.vx > ego.vx) ttc_r = gap / (n.vx - ego.vx);
        }
      }
    }
  });
  const s_f = Math.max(0, Math.min(1, gap_f / params.frontGapThreshold));
  const s_r = Math.max(0, Math.min(1, gap_r / params.rearGapThreshold));
  const s_ttc = Math.max(0, Math.min(1, Math.min(ttc_r, 10) / 10));
  const lateral = Math.min(ego.lateralOffset, LANE_WIDTH - ego.lateralOffset);
  const s_lat = Math.max(0, Math.min(1, lateral / LANE_WIDTH));
  const sms = (s_f * 0.30) + (s_r * 0.25) + (s_ttc * 0.30) + (s_lat * 0.15);
  return { sms };
}

function isTerminal(state, params) {
  if (state.timestep >= params.depth) return true;
  for (let n of state.neighbors) {
    const longDist = Math.abs(state.ego.x - n.x);
    const egoEffY = (state.ego.lane * LANE_WIDTH) - state.ego.lateralOffset;
    const nEffY = (n.lane * LANE_WIDTH) + n.lateralOffset;
    const latDist = Math.abs(egoEffY - nEffY);
    if (longDist < VEHICLE_LENGTH && latDist < (LANE_WIDTH * 0.7)) return true;
  }
  return false;
}

function minimax(state, depth, alpha, beta, isEgoTurn, params) {
  const terminal = isTerminal(state, params);
  if (terminal || depth === 0) {
    if (terminal && state.timestep < params.depth) return 0;
    return evaluateSafety(state, params).sms;
  }
  if (isEgoTurn) {
    let best = -Infinity;
    for (const action of getActions(state, true)) {
      const nextState = applyAction(state, action, []);
      best = Math.max(best, minimax(nextState, depth - 1, alpha, beta, false, params));
      alpha = Math.max(alpha, best);
      if (beta <= alpha) break;
    }
    return best;
  } else {
    let worst = Infinity;
    for (const jointAction of getActions(state, false)) {
      const nextState = applyAction(state, null, jointAction);
      worst = Math.min(worst, minimax(nextState, depth - 1, alpha, beta, true, params));
      beta = Math.min(beta, worst);
      if (beta <= alpha) break;
    }
    return worst;
  }
}

// --- Scenario Data ---
const DEFAULT_PARAMS = { frontGapThreshold: 20, rearGapThreshold: 20, ttcThreshold: 5, depth: 4 };

const scenarios = [
  {
    name: 'Guaranteed Safe',
    ego: { x: 200, y: 0, vx: 25, lane: 1 },
    neighbors: [
      { id: 'front', x: 240, y: 0, vx: 25, lane: 1, mode: 'normal' },
      { id: 'rear', x: 160, y: 0, vx: 25, lane: 1, mode: 'adversarial' },
      { id: 'frontTarget', x: 245, y: 0, vx: 25, lane: 0, mode: 'normal' },
      { id: 'rearTarget', x: 155, y: 0, vx: 25, lane: 0, mode: 'adversarial' }
    ],
    expectedVerdict: 'SAFE',
    expectedRange: [75, 100],
    params: { ...DEFAULT_PARAMS }
  },
  {
    name: 'Guaranteed Unsafe',
    ego: { x: 200, y: 0, vx: 20, lane: 1 },
    neighbors: [
      { id: 'front', x: 225, y: 0, vx: 20, lane: 1, mode: 'normal' },
      { id: 'rear', x: 192, y: 0, vx: 25, lane: 1, mode: 'adversarial' },
      { id: 'frontTarget', x: 210, y: 0, vx: 20, lane: 0, mode: 'adversarial' },
      { id: 'rearTarget', x: 194, y: 0, vx: 25, lane: 0, mode: 'adversarial' }
    ],
    expectedVerdict: 'UNSAFE',
    expectedRange: [0, 25],
    params: { ...DEFAULT_PARAMS }
  },
  {
    name: 'Borderline Gap',
    ego: { x: 200, y: 0, vx: 22, lane: 1 },
    neighbors: [
      { id: 'front', x: 235, y: 0, vx: 22, lane: 1, mode: 'normal' },
      { id: 'rear', x: 178, y: 0, vx: 24, lane: 1, mode: 'adversarial' },
      { id: 'frontTarget', x: 237, y: 0, vx: 22, lane: 0, mode: 'normal' },
      { id: 'rearTarget', x: 180, y: 0, vx: 24, lane: 0, mode: 'adversarial' }
    ],
    expectedVerdict: 'SAFE',
    expectedRange: [55, 70],
    params: { ...DEFAULT_PARAMS, rearGapThreshold: 20 }
  },
  {
    name: 'Borderline Speed',
    ego: { x: 200, y: 0, vx: 22, lane: 1 },
    neighbors: [
      { id: 'front', x: 240, y: 0, vx: 22, lane: 1, mode: 'normal' },
      { id: 'rear', x: 176, y: 0, vx: 26, lane: 1, mode: 'adversarial' },
      { id: 'frontTarget', x: 242, y: 0, vx: 22, lane: 0, mode: 'normal' },
      { id: 'rearTarget', x: 178, y: 0, vx: 26, lane: 0, mode: 'adversarial' }
    ],
    expectedVerdict: 'SAFE',
    expectedRange: [55, 70],
    params: { ...DEFAULT_PARAMS, ttcThreshold: 5.5 }
  }
];

// --- Execution ---
console.log('--- SCENARIO VERIFICATION SUITE ---');
scenarios.forEach(sc => {
  const initialState = {
    ego: { x: sc.ego.x, y: sc.ego.y, vx: sc.ego.vx, lane: sc.ego.lane, lateralOffset: 0 },
    neighbors: sc.neighbors.map(n => ({ id: n.id, x: n.x, y: n.y, vx: n.vx, lane: n.lane, mode: n.mode, lateralOffset: 0 })),
    timestep: 0,
    laneChangeTick: 0
  };

  const score = minimax(initialState, sc.params.depth * 2, -Infinity, Infinity, true, sc.params);
  const sms = Math.round(score * 100);
  const status = (sms >= sc.expectedRange[0] && sms <= sc.expectedRange[1]) ? 'PASS' : 'FAIL';
  
  console.log(`[${status}] ${sc.name.padEnd(20)} | SMS: ${sms.toString().padStart(3)} | Range: [${sc.expectedRange[0]}-${sc.expectedRange[1]}]`);
});
console.log('--- TEST COMPLETE ---');
