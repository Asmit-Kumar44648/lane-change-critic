/**
 * Safety-First Lane Change Critic
 * Scenario Presets & Default Parameters
 */

const guaranteedSafe = {
  name: 'Guaranteed Safe',
  description: 'Wide gaps, matching speeds. Even max adversarial braking cannot close the gap within 3s.',
  ego: { x: 200, y: 0, vx: 25, vy: 0, lane: 1 },
  neighbors: [
    { id: 'front', x: 240, y: 0, vx: 25, lane: 1, mode: 'normal' },
    { id: 'rear', x: 160, y: 0, vx: 25, lane: 1, mode: 'adversarial' },
    { id: 'frontTarget', x: 245, y: 0, vx: 25, lane: 0, mode: 'normal' },
    { id: 'rearTarget', x: 155, y: 0, vx: 25, lane: 0, mode: 'adversarial' }
  ],
  expectedVerdict: 'SAFE',
  expectedSMSRange: [75, 100],
  adversarialAggression: 1.0
};

const guaranteedUnsafe = {
  name: 'Guaranteed Unsafe',
  description: 'Rear neighbor dangerously close and faster. Collision inevitable within 1 timestep.',
  ego: { x: 200, y: 0, vx: 20, vy: 0, lane: 1 },
  neighbors: [
    { id: 'front', x: 225, y: 0, vx: 20, lane: 1, mode: 'normal' },
    { id: 'rear', x: 192, y: 0, vx: 25, lane: 1, mode: 'adversarial' },
    { id: 'frontTarget', x: 210, y: 0, vx: 20, lane: 0, mode: 'adversarial' },
    { id: 'rearTarget', x: 194, y: 0, vx: 25, lane: 0, mode: 'adversarial' }
  ],
  expectedVerdict: 'UNSAFE',
  expectedSMSRange: [0, 25],
  adversarialAggression: 1.0
};

const borderlineGap = {
  name: 'Borderline Gap',
  description: 'Rear gap at exactly 1.1× the threshold. Flips to UNSAFE when threshold slider increases by 10%.',
  ego: { x: 200, y: 0, vx: 22, vy: 0, lane: 1 },
  neighbors: [
    { id: 'front', x: 235, y: 0, vx: 22, lane: 1, mode: 'normal' },
    { id: 'rear', x: 178, y: 0, vx: 24, lane: 1, mode: 'adversarial' },
    { id: 'frontTarget', x: 237, y: 0, vx: 22, lane: 0, mode: 'normal' },
    { id: 'rearTarget', x: 180, y: 0, vx: 24, lane: 0, mode: 'adversarial' }
  ],
  defaultParams: {
    rearGapThreshold: 20,  // rear gap (22m) = 1.1 × threshold (20m) → SAFE
  },
  flipCondition: 'Increase rearGapThreshold to 22 or above → verdict flips to UNSAFE',
  expectedVerdict: 'SAFE',
  expectedSMSRange: [55, 70],
  adversarialAggression: 0.8
};

const borderlineSpeed = {
  name: 'Borderline Speed',
  description: 'TTC at exactly threshold + 0.5s. Flips to UNSAFE when TTC threshold slider moves up.',
  ego: { x: 200, y: 0, vx: 22, vy: 0, lane: 1 },
  neighbors: [
    { id: 'front', x: 240, y: 0, vx: 22, lane: 1, mode: 'normal' },
    { id: 'rear', x: 176, y: 0, vx: 26, lane: 1, mode: 'adversarial' },
    { id: 'frontTarget', x: 242, y: 0, vx: 22, lane: 0, mode: 'normal' },
    { id: 'rearTarget', x: 178, y: 0, vx: 26, lane: 0, mode: 'adversarial' }
  ],
  defaultParams: {
    ttcThreshold: 5.5,  // actual TTC = 24/4 = 6s = threshold + 0.5s → SAFE
  },
  flipCondition: 'Increase ttcThreshold to 6 or above → verdict flips to UNSAFE',
  expectedVerdict: 'SAFE',
  expectedSMSRange: [55, 70],
  adversarialAggression: 0.7
};

export const scenarios = {
  guaranteedSafe,
  guaranteedUnsafe,
  borderlineGap,
  borderlineSpeed
};

export const scenarioList = [
  guaranteedSafe,
  guaranteedUnsafe,
  borderlineGap,
  borderlineSpeed
];

export const DEFAULT_PARAMS = {
  frontGapThreshold: 20,   // meters
  rearGapThreshold: 20,    // meters
  ttcThreshold: 5,         // seconds
  depth: 4,                // search depth (steps)
  adversarialAggression: 1.0  // 0=passive, 1=fully adversarial
};
