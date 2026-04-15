/**
 * Micro Step — atomic complete-then-query operation.
 *
 * Merges the complete → status → instructions cycle into a single call:
 *   1. (optional) Mark done artifacts as complete
 *   2. Reload context (schema + meta → completed + stale)
 *   3. Return all ready artifacts with instructions, or terminal state
 */

import { loadMicroSchema } from './resolver.js';
import {
  readMicroMeta,
  writeMicroComplete,
  detectMicroCompleted,
  detectMicroStale,
  type MicroMetaFile,
} from './state.js';
import {
  generateMicroInstructions,
  getNextArtifacts,
  type MicroContext,
  type DialogLogRef,
  type MicroDependencyInfo,
} from './instruction-loader.js';
import { resolveArtifactMode, type MicroSchema, type MicroMode } from './types.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** A single done report for an artifact. */
export interface StepDoneItem {
  artifact: string;
  dialogLog?: string;
}

/** A ready artifact with its full instructions. */
export interface StepNextItem {
  artifact: string;
  instruction: string;
  description: string;
  dependencies: MicroDependencyInfo[];
  unlocks: string[];
  previousDialogLog?: DialogLogRef;
  mode: MicroMode;
}

/** Stuck information when no artifacts are ready but not all done. */
export interface StepStuck {
  stale: string[];
  blocked: string[];
}

/** Progress counters. */
export interface StepProgress {
  done: number;
  ready: number;
  blocked: number;
  stale: number;
}

/** The full step result. */
export interface MicroStepResult {
  next: StepNextItem[];
  all_done: boolean;
  stuck: StepStuck | null;
  progress: StepProgress;
}

/** Input parameters for microStep. */
export interface MicroStepParams {
  name: string;
  projectRoot: string;
  done?: StepDoneItem[];
}

// ---------------------------------------------------------------------------
// Core function
// ---------------------------------------------------------------------------

/**
 * Executes one micro step: optionally complete artifacts, then return next ready batch.
 */
export function microStep(params: MicroStepParams): MicroStepResult {
  const { name, projectRoot, done } = params;

  // 1. Mark done artifacts as complete
  if (done && done.length > 0) {
    for (const item of done) {
      writeMicroComplete(name, item.artifact, projectRoot, {
        dialogLog: item.dialogLog,
      });
    }
  }

  // 2. Reload context (fresh meta after writes)
  const schema = loadMicroSchema(name, projectRoot);
  const meta = readMicroMeta(name, projectRoot);
  const completed = detectMicroCompleted(schema, meta);
  const stale = detectMicroStale(schema, meta, completed);
  const context: MicroContext = { schema, meta, completed, stale, name, projectRoot };

  // 3. Compute progress
  const readyIds = getNextArtifacts(context);
  const total = schema.artifacts.length;
  const doneCount = completed.size;
  const staleCount = stale.size;

  // Blocked: not completed, not ready
  const readySet = new Set(readyIds);
  let blockedCount = 0;
  for (const artifact of schema.artifacts) {
    if (!completed.has(artifact.id) && !readySet.has(artifact.id)) {
      blockedCount++;
    }
  }

  const progress: StepProgress = {
    done: doneCount,
    ready: readyIds.length,
    blocked: blockedCount,
    stale: staleCount,
  };

  // 4. Check terminal states
  const allDone = total > 0 && doneCount === total;

  if (allDone) {
    return { next: [], all_done: true, stuck: null, progress };
  }

  // 5. Build next array with full instructions
  const artifactMap = new Map(schema.artifacts.map(a => [a.id, a]));
  const next: StepNextItem[] = readyIds.map(id => {
    const inst = generateMicroInstructions(context, id);
    const artifact = artifactMap.get(id)!;
    return {
      artifact: inst.artifactId,
      instruction: inst.instruction,
      description: inst.description,
      dependencies: inst.dependencies,
      unlocks: inst.unlocks,
      previousDialogLog: inst.previousDialogLog,
      mode: resolveArtifactMode(schema, artifact),
    };
  });

  // 6. Determine stuck state
  let stuck: StepStuck | null = null;
  if (next.length === 0 && !allDone) {
    const staleList: string[] = [];
    const blockedList: string[] = [];
    for (const artifact of schema.artifacts) {
      if (completed.has(artifact.id)) {
        if (stale.has(artifact.id)) {
          staleList.push(artifact.id);
        }
      } else {
        // Not completed and not ready → blocked
        blockedList.push(artifact.id);
      }
    }
    stuck = { stale: staleList.sort(), blocked: blockedList.sort() };
  }

  return { next, all_done: false, stuck, progress };
}
