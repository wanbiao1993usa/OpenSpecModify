/**
 * Micro State Management
 *
 * Tracks completion and staleness for micro artifacts via meta files.
 * Meta files: openspec/micro/.<name>.meta.yaml
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';
import { getMicroDir } from './resolver.js';
import { topologicalSort } from './topo.js';
import type { MicroSchema } from './types.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface MicroArtifactMeta {
  completed_at: string;
  dialog_log?: string;
  line_start?: number;
  line_end?: number;
}

export interface MicroMetaFile {
  artifacts: Record<string, MicroArtifactMeta>;
}

// ---------------------------------------------------------------------------
// Meta file read/write
// ---------------------------------------------------------------------------

function getMetaPath(name: string, projectRoot: string): string {
  return path.join(getMicroDir(projectRoot), `.${name}.meta.yaml`);
}

/**
 * Reads the micro meta file. Returns empty structure if not found.
 */
export function readMicroMeta(name: string, projectRoot: string): MicroMetaFile {
  const metaPath = getMetaPath(name, projectRoot);

  if (!fs.existsSync(metaPath)) {
    return { artifacts: {} };
  }

  try {
    const content = fs.readFileSync(metaPath, 'utf-8');
    const parsed = parseYaml(content);
    if (parsed && typeof parsed === 'object' && parsed.artifacts) {
      return parsed as MicroMetaFile;
    }
    return { artifacts: {} };
  } catch {
    return { artifacts: {} };
  }
}

/**
 * Options for writeMicroComplete.
 */
export interface WriteMicroCompleteOptions {
  dialogLog?: string;
  lineStart?: number;
  lineEnd?: number;
}

/**
 * Marks an artifact as complete by writing to the meta file.
 */
export function writeMicroComplete(
  name: string,
  artifactId: string,
  projectRoot: string,
  options?: WriteMicroCompleteOptions
): void {
  const metaPath = getMetaPath(name, projectRoot);
  const existing = readMicroMeta(name, projectRoot);

  const meta: MicroArtifactMeta = {
    completed_at: new Date().toISOString(),
  };

  if (options?.dialogLog) {
    meta.dialog_log = options.dialogLog;
  }
  if (options?.lineStart != null) {
    meta.line_start = options.lineStart;
  }
  if (options?.lineEnd != null) {
    meta.line_end = options.lineEnd;
  }

  existing.artifacts[artifactId] = meta;

  fs.writeFileSync(metaPath, stringifyYaml(existing), 'utf-8');
}

/**
 * Resets the entire micro run by deleting the meta file.
 */
export function resetMicroMeta(name: string, projectRoot: string): void {
  const metaPath = getMetaPath(name, projectRoot);
  if (fs.existsSync(metaPath)) {
    fs.unlinkSync(metaPath);
  }
}

/**
 * Resets a single artifact by removing its entry from the meta file.
 * Returns true if the artifact was found and removed, false otherwise.
 */
export function resetMicroArtifact(
  name: string,
  artifactId: string,
  projectRoot: string
): boolean {
  const metaPath = getMetaPath(name, projectRoot);
  const existing = readMicroMeta(name, projectRoot);

  if (!(artifactId in existing.artifacts)) {
    return false;
  }

  delete existing.artifacts[artifactId];

  // If no artifacts left, remove the file entirely
  if (Object.keys(existing.artifacts).length === 0) {
    if (fs.existsSync(metaPath)) {
      fs.unlinkSync(metaPath);
    }
  } else {
    fs.writeFileSync(metaPath, stringifyYaml(existing), 'utf-8');
  }

  return true;
}

// ---------------------------------------------------------------------------
// Completion and staleness detection
// ---------------------------------------------------------------------------

/**
 * Builds a CompletedSet from micro meta.
 */
export function detectMicroCompleted(
  schema: MicroSchema,
  meta: MicroMetaFile
): Set<string> {
  const completed = new Set<string>();
  for (const artifact of schema.artifacts) {
    if (meta.artifacts[artifact.id]) {
      completed.add(artifact.id);
    }
  }
  return completed;
}

/**
 * Detects stale artifacts.
 * An artifact is stale if any upstream dependency has a newer completed_at.
 */
export function detectMicroStale(
  schema: MicroSchema,
  meta: MicroMetaFile,
  completed: Set<string>
): Set<string> {
  const stale = new Set<string>();

  const artifactMap = new Map(schema.artifacts.map(a => [a.id, a]));
  const buildOrder = topologicalSort(schema);

  function getTimestamp(id: string): number | null {
    const m = meta.artifacts[id];
    if (m?.completed_at) {
      return new Date(m.completed_at).getTime();
    }
    return null;
  }

  for (const artifactId of buildOrder) {
    if (!completed.has(artifactId)) continue;

    const artifact = artifactMap.get(artifactId);
    if (!artifact || artifact.requires.length === 0) continue;

    const currentTs = getTimestamp(artifactId);
    if (currentTs === null) continue;

    for (const reqId of artifact.requires) {
      // Staleness propagates
      if (stale.has(reqId)) {
        stale.add(artifactId);
        break;
      }

      if (completed.has(reqId)) {
        const upstreamTs = getTimestamp(reqId);
        if (upstreamTs !== null && upstreamTs > currentTs) {
          stale.add(artifactId);
          break;
        }
      }
    }
  }

  return stale;
}
