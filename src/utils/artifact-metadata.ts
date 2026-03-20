/**
 * Artifact Metadata
 *
 * Reads and writes per-artifact metadata (.artifact-meta.yaml) in change directories.
 * Metadata includes completion time, duration, and summary for each artifact.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import * as yaml from 'yaml';

const METADATA_FILENAME = '.artifact-meta.yaml';

export interface ArtifactMeta {
  completed_at: string;
  duration_seconds?: number;
  summary?: string;
}

export interface ArtifactMetadataFile {
  artifacts: Record<string, ArtifactMeta>;
}

/**
 * Reads artifact metadata from .artifact-meta.yaml in the change directory.
 *
 * @param changeDir - The path to the change directory
 * @returns The metadata, or an empty structure if no file exists
 */
export function readArtifactMetadata(changeDir: string): ArtifactMetadataFile {
  const metaPath = path.join(changeDir, METADATA_FILENAME);

  if (!fs.existsSync(metaPath)) {
    return { artifacts: {} };
  }

  try {
    const content = fs.readFileSync(metaPath, 'utf-8');
    const parsed = yaml.parse(content);
    if (parsed && typeof parsed === 'object' && parsed.artifacts) {
      return parsed as ArtifactMetadataFile;
    }
    return { artifacts: {} };
  } catch {
    return { artifacts: {} };
  }
}

/**
 * Writes or updates artifact metadata for a specific artifact.
 *
 * @param changeDir - The path to the change directory
 * @param artifactId - The artifact ID
 * @param meta - The metadata to write
 */
export function writeArtifactMeta(
  changeDir: string,
  artifactId: string,
  meta: ArtifactMeta
): void {
  const metaPath = path.join(changeDir, METADATA_FILENAME);
  const existing = readArtifactMetadata(changeDir);

  existing.artifacts[artifactId] = meta;

  const content = yaml.stringify(existing);
  fs.writeFileSync(metaPath, content, 'utf-8');
}
