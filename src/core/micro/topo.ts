/**
 * Topological Sort (Kahn's Algorithm) for Micro Artifacts
 *
 * Shared utility used by both state detection and instruction loader.
 */

import type { MicroSchema } from './types.js';

/**
 * Returns artifact IDs in topological (build) order using Kahn's algorithm.
 * Ties are broken alphabetically for deterministic output.
 */
export function topologicalSort(schema: MicroSchema): string[] {
  const inDegree = new Map<string, number>();
  const dependents = new Map<string, string[]>();

  for (const a of schema.artifacts) {
    inDegree.set(a.id, a.requires.length);
    dependents.set(a.id, []);
  }
  for (const a of schema.artifacts) {
    for (const req of a.requires) {
      dependents.get(req)!.push(a.id);
    }
  }

  const queue = [...schema.artifacts]
    .filter(a => inDegree.get(a.id) === 0)
    .map(a => a.id)
    .sort();
  const result: string[] = [];

  while (queue.length > 0) {
    const current = queue.shift()!;
    result.push(current);
    const newlyReady: string[] = [];
    for (const dep of dependents.get(current)!) {
      const nd = inDegree.get(dep)! - 1;
      inDegree.set(dep, nd);
      if (nd === 0) newlyReady.push(dep);
    }
    queue.push(...newlyReady.sort());
  }

  return result;
}
