type VariadicMotionOperation = 'add' | 'mul' | 'min' | 'max';
export type MotionExpression = number |
  readonly ['input', string] |
  readonly ['curve', MotionExpression, readonly (readonly [number, number])[]] |
  readonly ['sin' | 'cos' | 'abs' | 'exp', MotionExpression] |
  readonly ['sub' | 'div' | 'pow' | 'mod', MotionExpression, MotionExpression] |
  readonly ['clamp' | 'smooth' | 'mix', MotionExpression, MotionExpression, MotionExpression] |
  readonly [VariadicMotionOperation, MotionExpression, MotionExpression] |
  readonly [VariadicMotionOperation, MotionExpression, MotionExpression, MotionExpression] |
  readonly [VariadicMotionOperation, MotionExpression, MotionExpression, MotionExpression, MotionExpression] |
  readonly [VariadicMotionOperation, MotionExpression, MotionExpression, MotionExpression, MotionExpression, MotionExpression] |
  readonly [VariadicMotionOperation, MotionExpression, MotionExpression, MotionExpression, MotionExpression, MotionExpression, MotionExpression] |
  readonly [VariadicMotionOperation, MotionExpression, MotionExpression, MotionExpression, MotionExpression, MotionExpression, MotionExpression, MotionExpression] |
  readonly [VariadicMotionOperation, MotionExpression, MotionExpression, MotionExpression, MotionExpression, MotionExpression, MotionExpression, MotionExpression, MotionExpression];
export interface MotionBudget {remaining: number}
export type MotionInputValues = Readonly<Record<string, number | boolean>>;
/** Validates untrusted expressions and returns the visited node count. */
export function validateExpression(expression: unknown, options?: {
  maxNodes?: number; maxDepth?: number; hostInputs?: readonly string[];
}): number;
/** Evaluate only validated expressions; the supplied operation budget is consumed. */
export function evaluate(expression: MotionExpression, inputs?: MotionInputValues, budget?: MotionBudget): number;
/** An empty frame list returns undefined. Returned frames retain their supplied fields. */
export function selectFrame<F extends {duration: number}>(animation: {
  frames: readonly F[]; progress: MotionExpression; loop?: boolean;
}, inputs?: MotionInputValues, budget?: MotionBudget): F | undefined;
export interface MotionInputs {
  tilt?: {x?: unknown; y?: unknown};
  angle?: number;
  time?: unknown;
  revealProgress?: number;
  flipProgress?: number;
  pointer?: {x?: number; y?: number};
  pressed?: unknown;
  focused?: unknown;
  host?: Readonly<Record<string, unknown>>;
}
export type NormalizedMotionInputs = Record<string, number | boolean> & Record<
  'tilt.x' | 'tilt.y' | 'angle' | 'time.active' | 'reveal.progress' | 'flip.progress' |
  'pointer.x' | 'pointer.y' | 'pressed' | 'focused', number>;
export function normalizedInputs(input?: MotionInputs): NormalizedMotionInputs;
