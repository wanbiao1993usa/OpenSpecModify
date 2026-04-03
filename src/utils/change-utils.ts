import path from 'path';
import * as fs from 'node:fs';
import fg from 'fast-glob';
import { FileSystemUtils } from './file-system.js';
import { writeChangeMetadata, validateSchemaName, resolveSchemaForChange } from './change-metadata.js';
import { readProjectConfig } from '../core/project-config.js';
import { ArtifactGraph } from '../core/artifact-graph/graph.js';
import { detectCompleted } from '../core/artifact-graph/state.js';
import { resolveSchema } from '../core/artifact-graph/resolver.js';
import { readArtifactMetadata, writeArtifactMeta } from './artifact-metadata.js';
import { isLightArtifact } from '../core/artifact-graph/types.js';

const DEFAULT_SCHEMA = 'spec-driven';

/**
 * Options for creating a change.
 */
export interface CreateChangeOptions {
  /** The workflow schema to use (default: 'spec-driven') */
  schema?: string;
  /** Source change name to copy completed artifacts from */
  from?: string;
  /** Parent change name for lineage tracking */
  parent?: string;
}

/**
 * Result of creating a change.
 */
export interface CreateChangeResult {
  /** The schema that was actually used (resolved from options, config, or default) */
  schema: string;
}

/**
 * Result of validating a change name.
 */
export interface ValidationResult {
  valid: boolean;
  error?: string;
}

/**
 * Validates that a change name follows kebab-case conventions.
 *
 * Valid names:
 * - Start with a lowercase letter
 * - Contain only lowercase letters, numbers, and hyphens
 * - Do not start or end with a hyphen
 * - Do not contain consecutive hyphens
 *
 * @param name - The change name to validate
 * @returns Validation result with `valid: true` or `valid: false` with an error message
 *
 * @example
 * validateChangeName('add-auth') // { valid: true }
 * validateChangeName('Add-Auth') // { valid: false, error: '...' }
 */
export function validateChangeName(name: string): ValidationResult {
  // Pattern: starts with lowercase letter, followed by lowercase letters/numbers,
  // optionally followed by hyphen + lowercase letters/numbers (repeatable)
  const kebabCasePattern = /^[a-z][a-z0-9]*(-[a-z0-9]+)*$/;

  if (!name) {
    return { valid: false, error: 'Change name cannot be empty' };
  }

  if (!kebabCasePattern.test(name)) {
    // Provide specific error messages for common mistakes
    if (/[A-Z]/.test(name)) {
      return { valid: false, error: 'Change name must be lowercase (use kebab-case)' };
    }
    if (/\s/.test(name)) {
      return { valid: false, error: 'Change name cannot contain spaces (use hyphens instead)' };
    }
    if (/_/.test(name)) {
      return { valid: false, error: 'Change name cannot contain underscores (use hyphens instead)' };
    }
    if (name.startsWith('-')) {
      return { valid: false, error: 'Change name cannot start with a hyphen' };
    }
    if (name.endsWith('-')) {
      return { valid: false, error: 'Change name cannot end with a hyphen' };
    }
    if (/--/.test(name)) {
      return { valid: false, error: 'Change name cannot contain consecutive hyphens' };
    }
    if (/[^a-z0-9-]/.test(name)) {
      return { valid: false, error: 'Change name can only contain lowercase letters, numbers, and hyphens' };
    }
    if (/^[0-9]/.test(name)) {
      return { valid: false, error: 'Change name must start with a letter' };
    }

    return { valid: false, error: 'Change name must follow kebab-case convention (e.g., add-auth, refactor-db)' };
  }

  return { valid: true };
}

/**
 * Creates a new change directory with metadata file.
 *
 * @param projectRoot - The root directory of the project (where `openspec/` lives)
 * @param name - The change name (must be valid kebab-case)
 * @param options - Optional settings for the change
 * @throws Error if the change name is invalid
 * @throws Error if the schema name is invalid
 * @throws Error if the change directory already exists
 *
 * @returns Result containing the resolved schema name
 *
 * @example
 * // Creates openspec/changes/add-auth/ with default schema
 * const result = await createChange('/path/to/project', 'add-auth')
 * console.log(result.schema) // 'spec-driven' or value from config
 *
 * @example
 * // Creates openspec/changes/add-auth/ with custom schema
 * const result = await createChange('/path/to/project', 'add-auth', { schema: 'my-workflow' })
 * console.log(result.schema) // 'my-workflow'
 */
export async function createChange(
  projectRoot: string,
  name: string,
  options: CreateChangeOptions = {}
): Promise<CreateChangeResult> {
  // Validate the name first
  const validation = validateChangeName(name);
  if (!validation.valid) {
    throw new Error(validation.error);
  }

  // Determine schema: explicit option → project config → hardcoded default
  let schemaName: string;
  if (options.schema) {
    schemaName = options.schema;
  } else {
    // Try to read from project config
    try {
      const config = readProjectConfig(projectRoot);
      schemaName = config?.schema ?? DEFAULT_SCHEMA;
    } catch {
      // If config read fails, use default
      schemaName = DEFAULT_SCHEMA;
    }
  }

  // Validate the resolved schema
  validateSchemaName(schemaName, projectRoot);

  // Build the change directory path
  const changeDir = path.join(projectRoot, 'openspec', 'changes', name);

  // Check if change already exists
  if (await FileSystemUtils.directoryExists(changeDir)) {
    throw new Error(`Change '${name}' already exists at ${changeDir}`);
  }

  // Validate --from source change exists
  if (options.from) {
    const fromDir = path.join(projectRoot, 'openspec', 'changes', options.from);
    if (!fs.existsSync(fromDir) || !fs.statSync(fromDir).isDirectory()) {
      throw new Error(`Source change '${options.from}' not found at ${fromDir}`);
    }
  }

  // Validate --parent change exists
  if (options.parent) {
    const parentDir = path.join(projectRoot, 'openspec', 'changes', options.parent);
    if (!fs.existsSync(parentDir) || !fs.statSync(parentDir).isDirectory()) {
      throw new Error(`Parent change '${options.parent}' not found at ${parentDir}`);
    }
  }

  // Create the directory (including parent directories if needed)
  await FileSystemUtils.createDirectory(changeDir);

  // Write metadata file with schema, creation timestamp, and lineage
  const now = new Date().toISOString().replace(/\.\d{3}Z$/, '');
  writeChangeMetadata(changeDir, {
    schema: schemaName,
    created: now,
    parent: options.parent,
    from: options.from,
  }, projectRoot);

  // Copy completed artifacts from source change if --from is specified
  if (options.from) {
    const fromDir = path.join(projectRoot, 'openspec', 'changes', options.from);
    await copyCompletedArtifacts(fromDir, changeDir, schemaName, projectRoot);
  }

  return { schema: schemaName };
}

/**
 * Copies completed artifact output files from a source change to a destination change.
 * Only copies artifacts that exist in the destination's schema (matched by artifact ID).
 *
 * @param srcChangeDir - Source change directory
 * @param destChangeDir - Destination change directory
 * @param destSchemaName - Schema name for the destination change
 * @param projectRoot - Project root directory
 * @returns Number of artifacts copied
 */
export async function copyCompletedArtifacts(
  srcChangeDir: string,
  destChangeDir: string,
  destSchemaName: string,
  projectRoot: string
): Promise<number> {
  // Resolve the source change's schema
  const srcSchemaName = resolveSchemaForChange(srcChangeDir);
  const srcSchema = resolveSchema(srcSchemaName, projectRoot);
  const srcGraph = ArtifactGraph.fromSchema(srcSchema);
  const srcCompleted = detectCompleted(srcGraph, srcChangeDir);

  // Resolve the destination schema and build a map of artifact id → generates
  const destSchema = resolveSchema(destSchemaName, projectRoot);
  const destArtifactMap = new Map(destSchema.artifacts.map(a => [a.id, a]));

  // Read source artifact metadata
  const srcMeta = readArtifactMetadata(srcChangeDir);

  // Find artifacts that are completed in source AND exist in destination schema
  let copiedCount = 0;

  for (const artifact of srcGraph.getAllArtifacts()) {
    if (!srcCompleted.has(artifact.id)) continue;

    const destArtifact = destArtifactMap.get(artifact.id);
    if (!destArtifact) continue;

    let filesCopied = false;

    // Source generates path (where to read from)
    const srcGenerates = artifact.generates!;
    // Destination generates path (where to write to)
    const destGenerates = destArtifact.generates!;

    if (isGlobPatternUtil(srcGenerates)) {
      // Handle glob patterns - copy all matching files from source
      const fullPattern = path.join(srcChangeDir, srcGenerates);
      const normalizedPattern = FileSystemUtils.toPosixPath(fullPattern);
      const matches = fg.sync(normalizedPattern, { onlyFiles: false });

      if (isGlobPatternUtil(destGenerates)) {
        // Both are globs: copy preserving relative structure under dest
        // Extract the static prefix from dest generates (e.g., "yyy/" from "yyy/**/*.md")
        const destPrefix = destGenerates.split(/[*?[]/)[0];
        const srcPrefix = srcGenerates.split(/[*?[]/)[0];

        for (const srcFile of matches) {
          const relativePath = path.relative(path.join(srcChangeDir, srcPrefix), srcFile);
          const destFile = path.join(destChangeDir, destPrefix, relativePath);
          await copyFileOrDir(srcFile, destFile);
        }
      } else {
        // Source is glob, dest is simple file — copy first match only
        if (matches.length > 0) {
          const destFile = path.join(destChangeDir, destGenerates);
          await copyFileOrDir(matches[0], destFile);
        }
      }
      filesCopied = matches.length > 0;
    } else {
      // Simple file or directory path
      const srcFile = path.join(srcChangeDir, srcGenerates);
      if (fs.existsSync(srcFile)) {
        const destFile = path.join(destChangeDir, destGenerates);
        await copyFileOrDir(srcFile, destFile);
        filesCopied = true;
      }
    }

    // Copy artifact metadata alongside the files
    const existingMeta = srcMeta.artifacts[artifact.id];
    if (existingMeta) {
      // Source has metadata — copy it (counts as copied even without output file for light mode)
      writeArtifactMeta(destChangeDir, artifact.id, existingMeta);
      if (!filesCopied) filesCopied = true;  // metadata alone counts for light mode
    } else if (filesCopied) {
      // Source lacks .artifact-meta.yaml (old version) — generate default entry
      const srcChangeName = path.basename(srcChangeDir);
      writeArtifactMeta(destChangeDir, artifact.id, {
        completed_at: new Date().toISOString().replace(/\.\d{3}Z$/, ''),
        summary: `从 ${srcChangeName} 复制`,
      });
    }

    if (filesCopied) {
      copiedCount++;
    }
  }

  return copiedCount;
}

/**
 * Copies a file or directory recursively from src to dest.
 * Handles both regular files and directories (e.g., partitioned Parquet datasets).
 */
async function copyFileOrDir(src: string, dest: string): Promise<void> {
  const stat = fs.statSync(src);
  if (stat.isDirectory()) {
    // Recursive directory copy
    fs.cpSync(src, dest, { recursive: true });
  } else {
    await FileSystemUtils.createDirectory(path.dirname(dest));
    fs.copyFileSync(src, dest);
  }
}

/**
 * Checks if a pattern is a glob pattern.
 */
function isGlobPatternUtil(pattern: string): boolean {
  return pattern.includes('*') || pattern.includes('?') || pattern.includes('[');
}
