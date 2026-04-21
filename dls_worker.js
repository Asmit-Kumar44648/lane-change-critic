/**
 * Safety-First Lane Change Critic
 * NUCLEAN HARDENED MINIMAX ENGINE
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

let searchStartTime = 0;
const SEARCH_TIMEOUT = 3000; // 3 seconds hard limit

function createNextState(state) {
  return {
    ego: { ...state.ego },
    neighbors: state.neighbors.map(n => ({ ...n })),
    timestep: state.timestep,
    laneChangeTick: state.laneChangeTick
  };
}

function getActions(state, isEgo, params) {
  if (isEgo) {
    const actions = ['MAINTAIN', 'ACCELERATE', 'DECELERATE'];
    if (state.laneChangeTick === 0) actions.push('INITIATE_LC');
    return actions;
  } else {
    // HARD PRUNING: Only allow 1 adversarial neighbor if depth is high or many neighbors exist
    const dists = state.neighbors.map(n => ({ id: n.id, d: Math.abs(n.x - state.ego.x) }));
    dists.sort((a,b) => a.d - b.d);
    
    // Limits: Max 1 active adversary for N=6 depth, Max 2 for N=4 depth.
    const maxAdversaries = params.depth > 4 ? 1 : 2;
    const activeIds = dists.slice(0, maxAdversaries).map(d => d.id);

    const sets = state.neighbors.map(n => {
      if (!activeIds.includes(n.id) || n.mode === 'normal') return ['MAINTAIN'];
      return ['HARD_BRAKE', 'ACCELERATE_CUTOFF', 'SWERVE_TOWARD'];
    });

    return sets.reduce((acc, set) => {
      const next = [];
      for (const p of acc) {
        for (const a of set) {
          p.push(a);
          next.push([...p]);
          p.pop();
        }
      }
      return next;
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
      if (action === 'HARD_BRAKE') n.vx = Math.max(MIN_SPEED, n.vx - MAX_DECEL * TIMESTEP);
      else if (action === 'ACCELERATE_CUTOFF') n.vx = Math.min(MAX_SPEED, n.vx + MAX_ACCEL * TIMESTEP);
      else if (action === 'SWERVE_TOWARD') n.lateralOffset += 0.5;
      n.x += n.vx * TIMESTEP;
    });
  }
  return next;
}

function evaluateSafety(state, params) {
  const ego = state.ego;
  let gap_f = Infinity, gap_r = Infinity, ttc_r = Infinity;
  const egoEffY = (ego.lane * LANE_WIDTH) - ego.lateralOffset;

  state.neighbors.forEach(n => {
    const nEffY = (n.lane * LANE_WIDTH) + n.lateralOffset;
    if (Math.abs(egoEffY - nEffY) < LANE_WIDTH * 0.9) {
      const dist = n.x - ego.x;
      if (dist > 0) gap_f = Math.min(gap_f, dist - VEHICLE_LENGTH);
      else {
        gap_r = Math.min(gap_r, Math.abs(dist) - VEHICLE_LENGTH);
        if (n.vx > ego.vx) ttc_r = (Math.abs(dist) - VEHICLE_LENGTH) / (n.vx - ego.vx);
      }
    }
  });

  const s_f = Math.max(0, Math.min(1, gap_f / params.frontGapThreshold));
  const s_r = Math.max(0, Math.min(1, gap_r / params.rearGapThreshold));
  const s_ttc = Math.max(0, Math.min(1, Math.min(ttc_r, 10) / 10));
  const s_lat = Math.max(0, Math.min(1, Math.min(ego.lateralOffset, LANE_WIDTH - ego.lateralOffset) / (LANE_WIDTH/2)));
  
  const sms = (s_f * SMS_WEIGHTS.frontGap) + (s_r * SMS_WEIGHTS.rearGap) + (s_ttc * SMS_WEIGHTS.ttc) + (s_lat * SMS_WEIGHTS.lateral);
  return { sms, breakdown: { s_f, s_r, s_ttc, s_lat } };
}

function isTerminal(state, params) {
  if (state.timestep >= params.depth * 2) return true;
  for (let n of state.neighbors) {
    const egoEffY = (state.ego.lane * LANE_WIDTH) - state.ego.lateralOffset;
    const nEffY = (n.lane * LANE_WIDTH) + n.lateralOffset;
    if (Math.abs(state.ego.x - n.x) < VEHICLE_LENGTH && Math.abs(egoEffY - nEffY) < (LANE_WIDTH * 0.7)) return true;
  }
  return false;
}

function minimax(state, depth, alpha, beta, isEgoTurn, params) {
  if (Date.now() - searchStartTime > SEARCH_TIMEOUT) return 0.5; // Emergency abort
  
  const term = isTerminal(state, params);
  if (term || depth === 0) {
    const ev = evaluateSafety(state, params);
    return (term && state.timestep < params.depth * 2) ? 0 : ev.sms;
  }

  if (isEgoTurn) {
    let best = -Infinity;
    for (const a of getActions(state, true, params)) {
      const s = minimax(applyAction(state, a, []), depth - 1, alpha, beta, false, params);
      best = Math.max(best, s);
      alpha = Math.max(alpha, best);
      if (beta <= alpha) break;
    }
    return best;
  } else {
    let worst = Infinity;
    for (const j of getActions(state, false, params)) {
      const s = minimax(applyAction(state, null, j), depth - 1, alpha, beta, true, params);
      worst = Math.min(worst, s);
      beta = Math.min(beta, worst);
      if (beta <= alpha) break;
    }
    return worst;
  }
}

function reconstruct(state, depth, isEgoTurn, params) {
    const trace = []; let curr = state; let d = depth; let turn = isEgoTurn;
    while (d > 0 && !isTerminal(curr, params)) {
        trace.push({ ...curr, eval: evaluateSafety(curr, params) });
        if (turn) {
            let b = -Infinity; let bm = 'MAINTAIN';
            for (const a of getActions(curr, true, params)) {
                const s = minimax(applyAction(curr, a, []), d-1, -Infinity, Infinity, false, params);
                if (s > b) { b = s; bm = a; }
            }
            curr = applyAction(curr, bm, []);
        } else {
            let w = Infinity; let wm = [];
            for (const j of getActions(curr, false, params)) {
                const s = minimax(applyAction(curr, null, j), d-1, -Infinity, Infinity, true, params);
                if (s < w) { w = s; wm = j; }
            }
            curr = applyAction(curr, null, wm);
        }
        turn = !turn; d--;
    }
    trace.push({ ...curr, eval: evaluateSafety(curr, params) });
    return trace;
}

self.onmessage = function(e) {
  try {
    const { scenario, params } = e.data;
    if (!scenario || !params) return;
    
    searchStartTime = Date.now();
    const initialState = {
      ego: { ...scenario.ego, lateralOffset: 0 },
      neighbors: scenario.neighbors.map(n => ({ ...n, lateralOffset: 0 })),
      timestep: 0, laneChangeTick: 0
    };

    const score = minimax(initialState, params.depth * 2, -Infinity, Infinity, true, params);
    let trace = [];
    if (score < SMS_THRESHOLD) trace = reconstruct(initialState, params.depth * 2, true, params);

    self.postMessage({
      verdict: score >= SMS_THRESHOLD ? 'SAFE' : 'UNSAFE',
      score: Math.round(score * 100),
      trace: trace,
      breakdown: evaluateSafety(initialState, params).breakdown
    });
  } catch (err) {
    console.error('[WORKER ERROR]', err);
  }
};
