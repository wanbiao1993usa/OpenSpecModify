import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getGlobalDataDir } from '../global-config.js';
import { parseSchema, SchemaValidationError } from './schema.js';
import type { SchemaYaml } from './types.js';

/**
 * Error thrown when loading a schema fails.
 */
export class SchemaLoadError extends Error {
  constructor(
    message: string,
    public readonly schemaPath: string,
    public readonly cause?: Error
  ) {
    super(message);
    this.name = 'SchemaLoadError';
  }
}

// ---------------------------------------------------------------------------
// Source type
// ---------------------------------------------------------------------------

/**
 * Source indicating where a schema was resolved from.
 */
export type SchemaSource =
  | 'project'
  | 'project-blueprint'
  | 'user'
  | 'user-blueprint'
  | 'package'
  | 'package-blueprint';

// ---------------------------------------------------------------------------
// Directory path helpers — schemas
// ---------------------------------------------------------------------------

export function getPackageSchemasDir(): string {
  const currentFile = fileURLToPath(import.meta.url);
  return path.join(path.dirname(currentFile), '..', '..', '..', 'schemas');
}

export function getUserSchemasDir(): string {
  return path.join(getGlobalDataDir(), 'schemas');
}

export function getProjectSchemasDir(projectRoot: string): string {
  return path.join(projectRoot, 'openspec', 'schemas');
}

// ---------------------------------------------------------------------------
// Directory path helpers — blueprints
// ---------------------------------------------------------------------------

export function getPackageBlueprintsSchemasDir(): string {
  const currentFile = fileURLToPath(import.meta.url);
  return path.join(path.dirname(currentFile), '..', '..', '..', 'blueprints', 'schemas');
}

export function getUserBlueprintsSchemasDir(): string {
  return path.join(getGlobalDataDir(), 'blueprints', 'schemas');
}

export function getProjectBlueprintsSchemasDir(projectRoot: string): string {
  return path.join(projectRoot, 'openspec', 'blueprints', 'schemas');
}

/**
 * Resolves a schema name to its directory path.
 *
 * Resolution order (when projectRoot is provided):
 * 1. Project-local: <projectRoot>/openspec/schemas/<name>/schema.yaml
 * 2. User override: ${XDG_DATA_HOME}/openspec/schemas/<name>/schema.yaml
 * 3. Package built-in: <package>/schemas/<name>/schema.yaml
 *
 * When projectRoot is not provided, only user override and package built-in are checked
 * (backward compatible behavior).
 *
 * @param name - Schema name (e.g., "spec-driven")
 * @param projectRoot - Optional project root directory for project-local schema resolution
 * @returns The path to the schema directory, or null if not found
 */
export function getSchemaDir(
  name: string,
  projectRoot?: string
): string | null {
  // 1. Project schemas
  if (projectRoot) {
    const dir = path.join(getProjectSchemasDir(projectRoot), name);
    if (fs.existsSync(path.join(dir, 'schema.yaml'))) return dir;
  }

  // 2. Project blueprints
  if (projectRoot) {
    const dir = path.join(getProjectBlueprintsSchemasDir(projectRoot), name);
    if (fs.existsSync(path.join(dir, 'schema.yaml'))) return dir;
  }

  // 3. User schemas
  {
    const dir = path.join(getUserSchemasDir(), name);
    if (fs.existsSync(path.join(dir, 'schema.yaml'))) return dir;
  }

  // 4. User blueprints
  {
    const dir = path.join(getUserBlueprintsSchemasDir(), name);
    if (fs.existsSync(path.join(dir, 'schema.yaml'))) return dir;
  }

  // 5. Package schemas
  {
    const dir = path.join(getPackageSchemasDir(), name);
    if (fs.existsSync(path.join(dir, 'schema.yaml'))) return dir;
  }

  // 6. Package blueprints
  {
    const dir = path.join(getPackageBlueprintsSchemasDir(), name);
    if (fs.existsSync(path.join(dir, 'schema.yaml'))) return dir;
  }

  return null;
}

/**
 * Resolves a schema name to a SchemaYaml object.
 *
 * Resolution order (when projectRoot is provided):
 * 1. Project-local: <projectRoot>/openspec/schemas/<name>/schema.yaml
 * 2. User override: ${XDG_DATA_HOME}/openspec/schemas/<name>/schema.yaml
 * 3. Package built-in: <package>/schemas/<name>/schema.yaml
 *
 * When projectRoot is not provided, only user override and package built-in are checked
 * (backward compatible behavior).
 *
 * @param name - Schema name (e.g., "spec-driven")
 * @param projectRoot - Optional project root directory for project-local schema resolution
 * @returns The resolved schema object
 * @throws Error if schema is not found in any location
 */
export function resolveSchema(name: string, projectRoot?: string): SchemaYaml {
  // Normalize name (remove .yaml extension if provided)
  const normalizedName = name.replace(/\.ya?ml$/, '');

  const schemaDir = getSchemaDir(normalizedName, projectRoot);
  if (!schemaDir) {
    const availableSchemas = listAllSchemas(projectRoot);
    throw new Error(
      `Schema '${normalizedName}' not found. Available schemas: ${availableSchemas.join(', ')}`
    );
  }

  const schemaPath = path.join(schemaDir, 'schema.yaml');

  // Load and parse the schema
  let content: string;
  try {
    content = fs.readFileSync(schemaPath, 'utf-8');
  } catch (err) {
    const ioError = err instanceof Error ? err : new Error(String(err));
    throw new SchemaLoadError(
      `Failed to read schema at '${schemaPath}': ${ioError.message}`,
      schemaPath,
      ioError
    );
  }

  try {
    return parseSchema(content);
  } catch (err) {
    if (err instanceof SchemaValidationError) {
      throw new SchemaLoadError(
        `Invalid schema at '${schemaPath}': ${err.message}`,
        schemaPath,
        err
      );
    }
    const parseError = err instanceof Error ? err : new Error(String(err));
    throw new SchemaLoadError(
      `Failed to parse schema at '${schemaPath}': ${parseError.message}`,
      schemaPath,
      parseError
    );
  }
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/** Scan a directory for subdirectories that contain schema.yaml */
function scanSchemaDir(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true })
    .filter(e => e.isDirectory() && fs.existsSync(path.join(dir, e.name, 'schema.yaml')))
    .map(e => e.name);
}

/** Collect all non-blueprint schema directories (project → user → package) */
function collectSchemaDirs(projectRoot?: string): Array<{ dir: string; source: SchemaSource }> {
  const dirs: Array<{ dir: string; source: SchemaSource }> = [];
  if (projectRoot) dirs.push({ dir: getProjectSchemasDir(projectRoot), source: 'project' });
  dirs.push({ dir: getUserSchemasDir(), source: 'user' });
  dirs.push({ dir: getPackageSchemasDir(), source: 'package' });
  return dirs;
}

/** Collect all blueprint schema directories (project → user → package) */
function collectBlueprintDirs(projectRoot?: string): Array<{ dir: string; source: SchemaSource }> {
  const dirs: Array<{ dir: string; source: SchemaSource }> = [];
  if (projectRoot) dirs.push({ dir: getProjectBlueprintsSchemasDir(projectRoot), source: 'project-blueprint' });
  dirs.push({ dir: getUserBlueprintsSchemasDir(), source: 'user-blueprint' });
  dirs.push({ dir: getPackageBlueprintsSchemasDir(), source: 'package-blueprint' });
  return dirs;
}

// ---------------------------------------------------------------------------
// Listing functions
// ---------------------------------------------------------------------------

/**
 * Lists schema names from non-blueprint directories only.
 */
export function listSchemas(projectRoot?: string): string[] {
  const names = new Set<string>();
  for (const { dir } of collectSchemaDirs(projectRoot)) {
    for (const name of scanSchemaDir(dir)) names.add(name);
  }
  return [...names].sort();
}

/**
 * Lists schema names from blueprint directories only.
 */
export function listBlueprintSchemas(projectRoot?: string): string[] {
  const names = new Set<string>();
  for (const { dir } of collectBlueprintDirs(projectRoot)) {
    for (const name of scanSchemaDir(dir)) names.add(name);
  }
  return [...names].sort();
}

/**
 * Lists all schema names from both schemas and blueprints directories.
 */
export function listAllSchemas(projectRoot?: string): string[] {
  const names = new Set<string>();
  for (const { dir } of [...collectSchemaDirs(projectRoot), ...collectBlueprintDirs(projectRoot)]) {
    for (const name of scanSchemaDir(dir)) names.add(name);
  }
  return [...names].sort();
}

/**
 * Schema info with metadata (name, description, artifacts, source).
 */
export interface SchemaInfo {
  name: string;
  description: string;
  artifacts: string[];
  source: SchemaSource;
}

/**
 * Scan a single directory and produce SchemaInfo entries for unseen names.
 */
function scanSchemasWithInfo(
  dir: string,
  source: SchemaSource,
  seenNames: Set<string>,
  results: SchemaInfo[]
): void {
  for (const name of scanSchemaDir(dir)) {
    if (seenNames.has(name)) continue;
    const schemaPath = path.join(dir, name, 'schema.yaml');
    try {
      const schema = parseSchema(fs.readFileSync(schemaPath, 'utf-8'));
      results.push({
        name,
        description: schema.description || '',
        artifacts: schema.artifacts.map(a => a.id),
        source,
      });
      seenNames.add(name);
    } catch {
      // Skip invalid schemas
    }
  }
}

/**
 * Lists all available schemas with metadata, respecting resolution priority.
 * Order: project → project-blueprint → user → user-blueprint → package → package-blueprint.
 */
export function listSchemasWithInfo(projectRoot?: string): SchemaInfo[] {
  const results: SchemaInfo[] = [];
  const seenNames = new Set<string>();

  // Interleave schemas and blueprints at each level
  const allDirs = [
    ...( projectRoot ? [
      { dir: getProjectSchemasDir(projectRoot), source: 'project' as SchemaSource },
      { dir: getProjectBlueprintsSchemasDir(projectRoot), source: 'project-blueprint' as SchemaSource },
    ] : []),
    { dir: getUserSchemasDir(), source: 'user' as SchemaSource },
    { dir: getUserBlueprintsSchemasDir(), source: 'user-blueprint' as SchemaSource },
    { dir: getPackageSchemasDir(), source: 'package' as SchemaSource },
    { dir: getPackageBlueprintsSchemasDir(), source: 'package-blueprint' as SchemaSource },
  ];

  for (const { dir, source } of allDirs) {
    scanSchemasWithInfo(dir, source, seenNames, results);
  }

  return results.sort((a, b) => a.name.localeCompare(b.name));
}
