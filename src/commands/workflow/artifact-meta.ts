/**
 * Artifact Metadata Commands
 *
 * - `artifact complete` — record completion metadata for an artifact
 * - `artifact meta` — display artifact metadata for a change
 */

import ora from 'ora';
import chalk from 'chalk';
import path from 'path';
import { validateChangeExists } from './shared.js';
import {
  readArtifactMetadata,
  writeArtifactMeta,
  type ArtifactMeta,
} from '../../utils/artifact-metadata.js';
import { loadChangeContext } from '../../core/artifact-graph/index.js';

// -----------------------------------------------------------------------------
// Types
// -----------------------------------------------------------------------------

export interface ArtifactCompleteOptions {
  change?: string;
  duration?: string;
  summary?: string;
  schema?: string;
}

export interface ArtifactMetaOptions {
  change?: string;
  json?: boolean;
  schema?: string;
}

// -----------------------------------------------------------------------------
// Command: artifact complete
// -----------------------------------------------------------------------------

export async function artifactCompleteCommand(
  artifactId: string | undefined,
  options: ArtifactCompleteOptions
): Promise<void> {
  if (!artifactId) {
    throw new Error('Missing required argument <artifact-id>');
  }

  const projectRoot = process.cwd();
  const changeName = await validateChangeExists(options.change, projectRoot);
  const context = loadChangeContext(projectRoot, changeName, options.schema);

  // Verify the artifact exists in the schema
  const artifact = context.graph.getArtifact(artifactId);
  if (!artifact) {
    const available = context.graph.getAllArtifacts().map(a => a.id);
    throw new Error(
      `Artifact '${artifactId}' not found in schema '${context.schemaName}'. Available: ${available.join(', ')}`
    );
  }

  const meta: ArtifactMeta = {
    completed_at: new Date().toISOString().replace(/\.\d{3}Z$/, ''),
  };

  if (options.duration) {
    const duration = parseInt(options.duration, 10);
    if (!isNaN(duration) && duration >= 0) {
      meta.duration_seconds = duration;
    }
  }

  if (options.summary) {
    meta.summary = options.summary;
  }

  writeArtifactMeta(context.changeDir, artifactId, meta);

  console.log(`Recorded metadata for artifact '${artifactId}' in change '${changeName}'.`);
}

// -----------------------------------------------------------------------------
// Command: artifact meta
// -----------------------------------------------------------------------------

export async function artifactMetaCommand(options: ArtifactMetaOptions): Promise<void> {
  const projectRoot = process.cwd();
  const changeName = await validateChangeExists(options.change, projectRoot);
  const changeDir = path.join(projectRoot, 'openspec', 'changes', changeName);

  const metadata = readArtifactMetadata(changeDir);

  if (options.json) {
    console.log(JSON.stringify(metadata, null, 2));
    return;
  }

  const entries = Object.entries(metadata.artifacts);
  if (entries.length === 0) {
    console.log(`No artifact metadata found for change '${changeName}'.`);
    return;
  }

  console.log(`Artifact metadata for change '${changeName}':\n`);

  for (const [id, meta] of entries) {
    console.log(`  ${chalk.bold(id)}:`);
    console.log(`    completed: ${meta.completed_at}`);
    if (meta.duration_seconds !== undefined) {
      console.log(`    duration:  ${meta.duration_seconds}s`);
    }
    if (meta.summary) {
      console.log(`    summary:   ${meta.summary}`);
    }
    console.log();
  }
}
