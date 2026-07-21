// The Rule contract. Every rule takes a BrewingContext and returns a Result: Ok with
// the modified context, or Err with a Failure. The pipeline short-circuits on the first
// Err, so a rule is never called with an already-failed context (ADR-004).

import type { FailureReason } from '../domain/enums.js';
import type { Result } from '../domain/result.js';
import type { BrewingContext } from './context.js';

export interface Failure {
  reason: FailureReason;
  message?: string;
}

export interface Rule {
  readonly name: string;
  apply(context: BrewingContext): Result<BrewingContext, Failure>;
}
