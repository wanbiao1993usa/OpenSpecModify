/**
 * Micro Instruction Loader
 *
 * Generates instructions and status for micro artifacts.
 * Pure data — no file system dependencies beyond reading schema/meta.
 */

import { loadMicroSchema } from './resolver.js';
import { readMicroMeta, detectMicroCompleted, detectMicroStale } from './state.js';
import { topologicalSort } from './topo.js';
import type { MicroSchema } from './types.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface MicroContext {
  schema: MicroSchema;
  completed: Set<string>;
  stale: Set<string>;
  name: string;
  projectRoot: string;
}

export interface MicroInstructions {
  /** Schema name */
  schemaName: string;
  /** Artifact ID */
  artifactId: string;
  /** Instruction text */
  instruction: string;
  /** Artifact description */
  description: string;
  /** Dependency status list */
  dependencies: MicroDependencyInfo[];
  /** Artifacts unlocked by completing this one */
  unlocks: string[];
}

export interface MicroDependencyInfo {
  id: string;
  done: boolean;
  description: string;
}

export type MicroArtifactStatusType = 'done' | 'stale' | 'ready' | 'blocked';

export interface MicroArtifactStatus {
  id: string;
  status: MicroArtifactStatusType;
  missingDeps?: string[];
}

export interface MicroStatus {
  name: string;
  description: string;
  isComplete: boolean;
  artifacts: MicroArtifactStatus[];
}

// ---------------------------------------------------------------------------
// Context loading
// ---------------------------------------------------------------------------

/**
 * Loads micro context: schema + meta → completed set + stale set.
 */
export function loadMicroContext(name: string, projectRoot: string): MicroContext {
  const schema = loadMicroSchema(name, projectRoot);
  const meta = readMicroMeta(name, projectRoot);
  const completed = detectMicroCompleted(schema, meta);
  const stale = detectMicroStale(schema, meta, completed);

  return { schema, completed, stale, name, projectRoot };
}

// ---------------------------------------------------------------------------
// Instruction generation
// ---------------------------------------------------------------------------

/**
 * Generates instructions for a specific artifact.
 */
export function generateMicroInstructions(
  context: MicroContext,
  artifactId: string
): MicroInstructions {
  const artifact = context.schema.artifacts.find(a => a.id === artifactId);
  if (!artifact) {
    const available = context.schema.artifacts.map(a => a.id);
    throw new Error(
      `Artifact '${artifactId}' not found in micro schema '${context.name}'. Available: ${available.join(', ')}`
    );
  }

  const dependencies: MicroDependencyInfo[] = artifact.requires.map(id => {
    const dep = context.schema.artifacts.find(a => a.id === id);
    return {
      id,
      done: context.completed.has(id),
      description: dep?.description ?? '',
    };
  });

  const unlocks = getUnlockedArtifacts(context.schema, artifactId);

  return {
    schemaName: context.schema.name,
    artifactId: artifact.id,
    instruction: artifact.instruction,
    description: artifact.description || '',
    dependencies,
    unlocks,
  };
}

/**
 * Gets the next artifact(s) that are ready to execute.
 * Returns artifact IDs whose dependencies are all completed.
 */
export function getNextArtifacts(context: MicroContext): string[] {
  const ready: string[] = [];

  for (const artifact of context.schema.artifacts) {
    if (context.completed.has(artifact.id)) continue;
    const allDepsCompleted = artifact.requires.every(id => context.completed.has(id));
    if (allDepsCompleted) {
      ready.push(artifact.id);
    }
  }

  return ready.sort();
}

// ---------------------------------------------------------------------------
// Status formatting
// ---------------------------------------------------------------------------

/**
 * Formats status of all artifacts in a micro schema run.
 */
export function formatMicroStatus(context: MicroContext): MicroStatus {
  const { schema, completed, stale } = context;

  // Build blocked map
  const blocked: Record<string, string[]> = {};
  for (const artifact of schema.artifacts) {
    if (completed.has(artifact.id)) continue;
    const unmet = artifact.requires.filter(id => !completed.has(id));
    if (unmet.length > 0) {
      blocked[artifact.id] = unmet.sort();
    }
  }

  // Compute topological order for consistent output
  const buildOrder = topologicalSort(schema);
  const orderMap = new Map(buildOrder.map((id, idx) => [id, idx]));

  const artifacts: MicroArtifactStatus[] = schema.artifacts.map(artifact => {
    if (completed.has(artifact.id)) {
      if (stale.has(artifact.id)) {
        return { id: artifact.id, status: 'stale' as const };
      }
      return { id: artifact.id, status: 'done' as const };
    }

    if (blocked[artifact.id]) {
      return {
        id: artifact.id,
        status: 'blocked' as const,
        missingDeps: blocked[artifact.id],
      };
    }

    return { id: artifact.id, status: 'ready' as const };
  });

  artifacts.sort((a, b) => (orderMap.get(a.id) ?? 0) - (orderMap.get(b.id) ?? 0));

  const isComplete = schema.artifacts.every(a => completed.has(a.id));

  return {
    name: schema.name,
    description: schema.description || '',
    isComplete,
    artifacts,
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getUnlockedArtifacts(schema: MicroSchema, artifactId: string): string[] {
  return schema.artifacts
    .filter(a => a.requires.includes(artifactId))
    .map(a => a.id)
    .sort();
}

