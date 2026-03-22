import * as fs from 'node:fs';
import * as path from 'node:path';
import fg from 'fast-glob';
import type { CompletedSet, StaleSet } from './types.js';
import { isLightArtifact } from './types.js';
import type { ArtifactGraph } from './graph.js';
import { FileSystemUtils } from '../../utils/file-system.js';
import { readArtifactMetadata } from '../../utils/artifact-metadata.js';

/**
 * Detects which artifacts are completed by checking file existence in the change directory.
 * Returns a Set of completed artifact IDs.
 *
 * @param graph - The artifact graph to check
 * @param changeDir - The change directory to scan for files
 * @returns Set of artifact IDs whose generated files exist
 */
export function detectCompleted(graph: ArtifactGraph, changeDir: string): CompletedSet {
  const completed = new Set<string>();

  // Handle missing change directory gracefully
  if (!fs.existsSync(changeDir)) {
    return completed;
  }

  // Read artifact metadata once for light-mode checks
  const artifactMeta = readArtifactMetadata(changeDir);

  for (const artifact of graph.getAllArtifacts()) {
    if (isLightArtifact(artifact)) {
      // Light mode: check metadata first, then output file existence
      if (artifactMeta.artifacts[artifact.id]) {
        completed.add(artifact.id);
      } else {
        const outputPath = path.join(changeDir, '.artifact-output', `${artifact.id}.md`);
        if (fs.existsSync(outputPath)) {
          completed.add(artifact.id);
        }
      }
    } else {
      // Heavy mode: check generated file existence (existing behavior)
      if (isArtifactComplete(artifact.generates!, changeDir)) {
        completed.add(artifact.id);
      }
    }
  }

  return completed;
}

/**
 * Checks if an artifact is complete by checking if its generated file(s) exist.
 * Supports both simple paths and glob patterns.
 */
function isArtifactComplete(generates: string, changeDir: string): boolean {
  const fullPattern = path.join(changeDir, generates);

  // Check if it's a glob pattern
  if (isGlobPattern(generates)) {
    return hasGlobMatches(fullPattern);
  }

  // Simple file path - check if file exists
  return fs.existsSync(fullPattern);
}

/**
 * Checks if a path contains glob pattern characters.
 */
function isGlobPattern(pattern: string): boolean {
  return pattern.includes('*') || pattern.includes('?') || pattern.includes('[');
}

/**
 * Checks if a glob pattern has any matches.
 * Normalizes Windows backslashes to forward slashes for cross-platform glob compatibility.
 */
function hasGlobMatches(pattern: string): boolean {
  const normalizedPattern = FileSystemUtils.toPosixPath(pattern);
  const matches = fg.sync(normalizedPattern, { onlyFiles: true });
  return matches.length > 0;
}

/**
 * Gets the latest modification time of an artifact's generated files.
 * For glob patterns, returns the latest mtime across all matching files.
 *
 * @param generates - The generates pattern (path or glob)
 * @param changeDir - The change directory
 * @returns The latest mtime in milliseconds, or null if no files exist
 */
export function getArtifactMtime(generates: string, changeDir: string): number | null {
  const fullPattern = path.join(changeDir, generates);

  if (isGlobPattern(generates)) {
    const normalizedPattern = FileSystemUtils.toPosixPath(fullPattern);
    const matches = fg.sync(normalizedPattern, { onlyFiles: true });
    if (matches.length === 0) return null;

    let latest = 0;
    for (const match of matches) {
      const stat = fs.statSync(match);
      if (stat.mtimeMs > latest) {
        latest = stat.mtimeMs;
      }
    }
    return latest;
  }

  // Simple file path
  if (!fs.existsSync(fullPattern)) return null;
  return fs.statSync(fullPattern).mtimeMs;
}

/**
 * Detects which completed artifacts are stale (their upstream dependencies have newer files).
 * An artifact is stale if any of its required (upstream) artifacts have a more recent
 * modification time than itself.
 *
 * @param graph - The artifact graph
 * @param completed - Set of completed artifact IDs
 * @param changeDir - The change directory to scan for files
 * @returns Set of stale artifact IDs
 */
/**
 * Gets the completion timestamp for an artifact, handling both light and heavy modes.
 * - Light mode: uses completedAt from .artifact-meta.yaml
 * - Heavy mode: uses file mtime from generates output
 * Returns milliseconds since epoch, or null if no timestamp available.
 */
function getArtifactTimestamp(
  artifact: ReturnType<ArtifactGraph['getArtifact']>,
  changeDir: string,
  artifactMeta: ReturnType<typeof readArtifactMetadata>
): number | null {
  if (!artifact) return null;

  if (isLightArtifact(artifact)) {
    // Light mode: use completedAt from metadata
    const meta = artifactMeta.artifacts[artifact.id];
    if (meta?.completed_at) {
      return new Date(meta.completed_at).getTime();
    }
    // Fallback: check output file mtime
    const outputPath = path.join(changeDir, '.artifact-output', `${artifact.id}.md`);
    if (fs.existsSync(outputPath)) {
      return fs.statSync(outputPath).mtimeMs;
    }
    return null;
  }

  // Heavy mode: use file mtime
  return getArtifactMtime(artifact.generates!, changeDir);
}

export function detectStale(
  graph: ArtifactGraph,
  completed: CompletedSet,
  changeDir: string
): StaleSet {
  const stale = new Set<string>();

  if (!fs.existsSync(changeDir)) {
    return stale;
  }

  // Read artifact metadata for light-mode timestamp comparisons
  const artifactMeta = readArtifactMetadata(changeDir);

  // Cache timestamps to avoid redundant reads
  const timestampCache = new Map<string, number | null>();

  function getTimestamp(artifactId: string): number | null {
    if (timestampCache.has(artifactId)) {
      return timestampCache.get(artifactId)!;
    }
    const artifact = graph.getArtifact(artifactId);
    const ts = getArtifactTimestamp(artifact, changeDir, artifactMeta);
    timestampCache.set(artifactId, ts);
    return ts;
  }

  // Process artifacts in build order to propagate staleness
  const buildOrder = graph.getBuildOrder();

  for (const artifactId of buildOrder) {
    if (!completed.has(artifactId)) continue;

    const artifact = graph.getArtifact(artifactId);
    if (!artifact || artifact.requires.length === 0) continue;

    const currentTimestamp = getTimestamp(artifactId);
    if (currentTimestamp === null) continue;

    for (const reqId of artifact.requires) {
      // If upstream is stale, downstream is also stale
      if (stale.has(reqId)) {
        stale.add(artifactId);
        break;
      }

      // If upstream timestamp is newer than current artifact, it's stale
      if (completed.has(reqId)) {
        const upstreamTimestamp = getTimestamp(reqId);
        if (upstreamTimestamp !== null && upstreamTimestamp > currentTimestamp) {
          stale.add(artifactId);
          break;
        }
      }
    }
  }

  return stale;
}
