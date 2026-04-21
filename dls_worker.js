/**
 * Safety-First Lane Change Critic
 * CORE MINIMAX ENGINE (Web Worker)
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

let nodesExplored = 0;
let branchesPruned = 0;
let depthReached = 0;
let currentWorstTrace = [];

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

  // Ego physics
  if (egoAction) {
    if (egoAction === 'ACCELERATE') {
      next.ego.vx = Math.min(MAX_SPEED, next.ego.vx + MAX_ACCEL * TIMESTEP);
    } else if (egoAction === 'DECELERATE') {
      next.ego.vx = Math.max(MIN_SPEED, next.ego.vx - MAX_ACCEL * TIMESTEP);
    } else if (egoAction === 'INITIATE_LC') {
      next.laneChangeTick = 1;
    }

    if (next.laneChangeTick > 0) {
      next.ego.lateralOffset += LANE_WIDTH / LC_TICKS;
      next.laneChangeTick++;
      if (next.laneChangeTick > LC_TICKS) {
        next.ego.lane -= 1; // LC to lane 0 from 1
        next.ego.lateralOffset = 0;
        next.laneChangeTick = 0;
      }
    }
    next.ego.x += next.ego.vx * TIMESTEP;
  }

  // Neighbor physics
  if (neighborActions && neighborActions.length > 0) {
    next.neighbors.forEach((n, i) => {
      const action = neighborActions[i];
      if (action === 'ACCEL_MILD') {
        n.vx = Math.min(MAX_SPEED, n.vx + MILD_ACCEL * TIMESTEP);
      } else if (action === 'HARD_BRAKE') {
        n.vx = Math.max(MIN_SPEED, n.vx - MAX_DECEL * TIMESTEP);
      } else if (action === 'ACCELERATE_CUTOFF') {
        n.vx = Math.min(MAX_SPEED, n.vx + MAX_ACCEL * TIMESTEP);
      } else if (action === 'SWERVE_TOWARD') {
        n.lateralOffset += 0.5; // Swerve towards ego
      }
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
  let violated = [];

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
          if (n.vx > ego.vx) {
            ttc_r = gap / (n.vx - ego.vx);
          }
        }
      }
    }
  });

  const s_f = Math.max(0, Math.min(1, gap_f / params.frontGapThreshold));
  const s_r = Math.max(0, Math.min(1, gap_r / params.rearGapThreshold));
  const s_ttc = Math.max(0, Math.min(1, Math.min(ttc_r, 10) / 10));
  
  const lateral = Math.min(ego.lateralOffset, LANE_WIDTH - ego.lateralOffset);
  const s_lat = Math.max(0, Math.min(1, lateral / LANE_WIDTH));

  const sms = (s_f * SMS_WEIGHTS.frontGap) + 
              (s_r * SMS_WEIGHTS.rearGap) + 
              (s_ttc * SMS_WEIGHTS.ttc) + 
              (s_lat * SMS_WEIGHTS.lateral);

  if (s_f < 0.5) violated.push('frontGap');
  if (s_r < 0.5) violated.push('rearGap');
  if (s_ttc < 0.5) violated.push('ttc');
  if (s_lat < 0.5) violated.push('lateral');

  return { sms, breakdown: { s_f, s_r, s_ttc, s_lat }, violated };
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

function minimax(state, depth, alpha, beta, isEgoTurn, params, trace) {
  nodesExplored++;
  depthReached = Math.max(depthReached, state.timestep);

  const terminal = isTerminal(state, params);
  if (terminal || depth === 0) {
    const evalResult = evaluateSafety(state, params);
    return terminal && state.timestep < params.depth ? 0 : evalResult.sms;
  }

  if (isEgoTurn) {
    let best = -Infinity;
    const actions = getActions(state, true);
    for (let action of actions) {
      const nextState = applyAction(state, action, []);
      const score = minimax(nextState, depth - 1, alpha, beta, false, params, [...trace, { state, action: 'EGO:' + action }]);
      if (score > best) best = score;
      alpha = Math.max(alpha, best);
      if (beta <= alpha) { branchesPruned++; break; }
    }
    return best;
  } else {
    let worst = Infinity;
    const neighborActions = getActions(state, false);
    for (let jointAction of neighborActions) {
      const nextState = applyAction(state, null, jointAction);
      const newTrace = [...trace, { state, action: 'ENV:' + jointAction.join(',') }];
      const score = minimax(nextState, depth - 1, alpha, beta, true, params, newTrace);
      if (score < worst) {
        worst = score;
        if (depth === params.depth || depth === params.depth - 1) {
          currentWorstTrace = newTrace.map(t => ({ ...t.state, eval: evaluateSafety(t.state, params) }));
        }
      }
      beta = Math.min(beta, worst);
      if (beta <= alpha) { branchesPruned++; break; }
    }
    return worst;
  }
}

self.onmessage = function(e) {
  if (e.data.type === 'RUN') {
    const { scenario, params } = e.data;
    nodesExplored = 0;
    branchesPruned = 0;
    depthReached = 0;
    currentWorstTrace = [];

    const initialState = {
      ego: { x: scenario.ego.x, y: scenario.ego.y, vx: scenario.ego.vx, lane: scenario.ego.lane, lateralOffset: 0 },
      neighbors: scenario.neighbors.map(n => ({ id: n.id, x: n.x, y: n.y, vx: n.vx, lane: n.lane, mode: n.mode, lateralOffset: 0 })),
      timestep: 0,
      laneChangeTick: 0
    };

    const finalScore = minimax(initialState, params.depth * 2, -Infinity, Infinity, true, params, []);
    const finalEval = evaluateSafety(initialState, params);

    self.postMessage({
      verdict: finalScore >= SMS_THRESHOLD ? 'SAFE' : 'UNSAFE',
      score: Math.round(finalScore * 100),
      trace: currentWorstTrace,
      stats: { nodesExplored, branchesPruned, depthReached },
      breakdown: finalEval.breakdown
    });
  }
};
