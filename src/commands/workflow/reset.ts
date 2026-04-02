/**
 * Reset Command
 *
 * Resets a single artifact (or cascade to all downstream) by deleting its output files.
 */

import ora from 'ora';
import chalk from 'chalk';
import path from 'path';
import * as fs from 'fs';
import fg from 'fast-glob';
import { loadChangeContext } from '../../core/artifact-graph/index.js';
import { validateChangeExists } from './shared.js';
import { FileSystemUtils } from '../../utils/file-system.js';
import { readArtifactMetadata } from '../../utils/artifact-metadata.js';
import * as yaml from 'yaml';

// -----------------------------------------------------------------------------
// Types
// -----------------------------------------------------------------------------

export interface ResetOptions {
  change?: string;
  cascade?: boolean;
  yes?: boolean;
  schema?: string;
}

// Protected files that should never be deleted
const PROTECTED_FILES = new Set(['.openspec.yaml', 'README.md', '.artifact-meta.yaml']);

// -----------------------------------------------------------------------------
// Command Implementation
// -----------------------------------------------------------------------------

export async function resetCommand(artifactId: string | undefined, options: ResetOptions): Promise<void> {
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

  // Determine which artifacts to reset
  const artifactsToReset: string[] = [artifactId];
  if (options.cascade) {
    const downstream = context.graph.getDependants(artifactId);
    artifactsToReset.push(...downstream);
  }

  // Collect files to delete
  const filesToDelete: string[] = [];
  const artifactFileMap = new Map<string, string[]>();

  for (const aid of artifactsToReset) {
    const a = context.graph.getArtifact(aid);
    if (!a) continue;

    const files: string[] = [];

    // Both light and heavy modes use generates for output path
    const generates = a.generates!;

    if (isGlobPattern(generates)) {
      const fullPattern = path.join(context.changeDir, generates);
      const normalizedPattern = FileSystemUtils.toPosixPath(fullPattern);
      const matches = fg.sync(normalizedPattern, { onlyFiles: true });
      for (const match of matches) {
        const rel = path.relative(context.changeDir, match);
        if (!PROTECTED_FILES.has(rel)) {
          files.push(match);
        }
      }
    } else {
      const fullPath = path.join(context.changeDir, generates);
      if (fs.existsSync(fullPath) && !PROTECTED_FILES.has(generates)) {
        files.push(fullPath);
      }
    }

    if (files.length > 0) {
      artifactFileMap.set(aid, files);
      filesToDelete.push(...files);
    }
  }

  if (filesToDelete.length === 0) {
    console.log('No files to delete. All target artifacts have no output files.');
    return;
  }

  // Show what will be deleted
  console.log(`\nArtifacts to reset in change '${changeName}':`);
  for (const [aid, files] of artifactFileMap) {
    console.log(`  ${chalk.yellow(aid)}:`);
    for (const file of files) {
      console.log(`    ${chalk.red('delete')} ${path.relative(context.changeDir, file)}`);
    }
  }
  console.log();

  // Confirm unless --yes
  if (!options.yes) {
    const readline = await import('readline');
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    const answer = await new Promise<string>((resolve) => {
      rl.question(`Delete ${filesToDelete.length} file(s)? [y/N] `, (answer) => {
        rl.close();
        resolve(answer);
      });
    });

    if (answer.toLowerCase() !== 'y' && answer.toLowerCase() !== 'yes') {
      console.log('Aborted.');
      return;
    }
  }

  // Delete files
  const spinner = ora('Deleting files...').start();
  let deletedCount = 0;

  for (const file of filesToDelete) {
    try {
      fs.unlinkSync(file);
      deletedCount++;
    } catch (err) {
      spinner.warn(`Failed to delete ${file}: ${(err as Error).message}`);
    }
  }

  // Clean up artifact metadata for reset artifacts
  const metaFile = readArtifactMetadata(context.changeDir);
  let metaChanged = false;
  for (const aid of artifactsToReset) {
    if (metaFile.artifacts[aid]) {
      delete metaFile.artifacts[aid];
      metaChanged = true;
    }
  }
  if (metaChanged) {
    const metaPath = path.join(context.changeDir, '.artifact-meta.yaml');
    fs.writeFileSync(metaPath, yaml.stringify(metaFile), 'utf-8');
  }

  spinner.succeed(`Reset ${artifactsToReset.length} artifact(s), deleted ${deletedCount} file(s).`);
}

function isGlobPattern(pattern: string): boolean {
  return pattern.includes('*') || pattern.includes('?') || pattern.includes('[');
}
