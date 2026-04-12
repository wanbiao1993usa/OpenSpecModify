/**
 * Micro Schema Resolver
 *
 * Discovers, loads, and validates micro schemas from openspec/micro/ directory.
 * Supports blueprints subdivision at the project level.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { parse as parseYaml } from 'yaml';
import { MicroSchemaYaml, type MicroSchema } from './types.js';

export class MicroSchemaValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MicroSchemaValidationError';
  }
}

/**
 * Source indicating where a micro schema was resolved from.
 */
export type MicroSchemaSource = 'project' | 'project-blueprint';

/**
 * Validates a micro schema name. Must be alphanumeric with hyphens/underscores, no path traversal.
 */
export function validateMicroName(name: string): { valid: boolean; error?: string } {
  if (!name || name.trim().length === 0) {
    return { valid: false, error: 'Name is required' };
  }
  if (/[\/\\]/.test(name) || name.includes('..')) {
    return { valid: false, error: 'Name must not contain path separators or ".."' };
  }
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]*$/.test(name)) {
    return { valid: false, error: 'Name must start with alphanumeric and contain only letters, digits, hyphens, and underscores' };
  }
  return { valid: true };
}

// ---------------------------------------------------------------------------
// Directory path helpers
// ---------------------------------------------------------------------------

export function getMicroDir(projectRoot: string): string {
  return path.join(projectRoot, 'openspec', 'micro');
}

export function getMicroBlueprintsDir(projectRoot: string): string {
  return path.join(projectRoot, 'openspec', 'blueprints', 'micro');
}

// ---------------------------------------------------------------------------
// Parsing
// ---------------------------------------------------------------------------

export function parseMicroSchema(yamlContent: string): MicroSchema {
  const parsed = parseYaml(yamlContent);

  const result = MicroSchemaYaml.safeParse(parsed);
  if (!result.success) {
    const errors = result.error.issues.map(e => `${e.path.join('.')}: ${e.message}`).join(', ');
    throw new MicroSchemaValidationError(`Invalid micro schema: ${errors}`);
  }

  const schema = result.data;

  validateNoDuplicateIds(schema);
  validateRequiresReferences(schema);
  validateNoCycles(schema);

  return schema;
}

// ---------------------------------------------------------------------------
// Loading
// ---------------------------------------------------------------------------

/**
 * Loads a micro schema by name.
 * Resolution order: project micro → project blueprints micro.
 */
export function loadMicroSchema(name: string, projectRoot: string): MicroSchema {
  const nameCheck = validateMicroName(name);
  if (!nameCheck.valid) {
    throw new MicroSchemaValidationError(`Invalid micro schema name '${name}': ${nameCheck.error}`);
  }

  // 1. Project micro
  const projectPath = path.join(getMicroDir(projectRoot), `${name}.yaml`);
  if (fs.existsSync(projectPath)) {
    return parseMicroSchema(fs.readFileSync(projectPath, 'utf-8'));
  }

  // 2. Project blueprints micro
  const blueprintPath = path.join(getMicroBlueprintsDir(projectRoot), `${name}.yaml`);
  if (fs.existsSync(blueprintPath)) {
    return parseMicroSchema(fs.readFileSync(blueprintPath, 'utf-8'));
  }

  const available = listAllMicroSchemas(projectRoot);
  const availableStr = available.length > 0 ? available.join(', ') : '(none)';
  throw new MicroSchemaValidationError(
    `Micro schema '${name}' not found. Available: ${availableStr}`
  );
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function scanMicroDir(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir)
    .filter(f => f.endsWith('.yaml') && !f.startsWith('.'))
    .map(f => f.replace(/\.yaml$/, ''));
}

// ---------------------------------------------------------------------------
// Listing functions
// ---------------------------------------------------------------------------

export function listMicroSchemas(projectRoot: string): string[] {
  return [...new Set(scanMicroDir(getMicroDir(projectRoot)))].sort();
}

export function listMicroBlueprints(projectRoot: string): string[] {
  return [...new Set(scanMicroDir(getMicroBlueprintsDir(projectRoot)))].sort();
}

export function listAllMicroSchemas(projectRoot: string): string[] {
  const all = new Set<string>();
  for (const name of scanMicroDir(getMicroDir(projectRoot))) all.add(name);
  for (const name of scanMicroDir(getMicroBlueprintsDir(projectRoot))) all.add(name);
  return [...all].sort();
}

export interface MicroSchemaInfo {
  name: string;
  artifactCount: number;
  source: MicroSchemaSource;
}

/**
 * Lists all micro schemas with metadata.
 * Project micro schemas shadow project blueprint schemas of the same name.
 */
export function listMicroSchemasWithInfo(projectRoot: string): MicroSchemaInfo[] {
  const results: MicroSchemaInfo[] = [];
  const seenNames = new Set<string>();

  const dirs: Array<{ dir: string; source: MicroSchemaSource }> = [
    { dir: getMicroDir(projectRoot), source: 'project' },
    { dir: getMicroBlueprintsDir(projectRoot), source: 'project-blueprint' },
  ];

  for (const { dir, source } of dirs) {
    for (const name of scanMicroDir(dir)) {
      if (seenNames.has(name)) continue;
      try {
        const filePath = path.join(dir, `${name}.yaml`);
        const schema = parseMicroSchema(fs.readFileSync(filePath, 'utf-8'));
        results.push({ name, artifactCount: schema.artifacts.length, source });
        seenNames.add(name);
      } catch {
        // Skip invalid schemas
      }
    }
  }

  return results.sort((a, b) => a.name.localeCompare(b.name));
}

// ---------------------------------------------------------------------------
// Validation helpers
// ---------------------------------------------------------------------------

function validateNoDuplicateIds(schema: MicroSchema): void {
  const seen = new Set<string>();
  for (const artifact of schema.artifacts) {
    if (seen.has(artifact.id)) {
      throw new MicroSchemaValidationError(`Duplicate artifact ID: ${artifact.id}`);
    }
    seen.add(artifact.id);
  }
}

function validateRequiresReferences(schema: MicroSchema): void {
  const validIds = new Set(schema.artifacts.map(a => a.id));
  for (const artifact of schema.artifacts) {
    for (const req of artifact.requires) {
      if (!validIds.has(req)) {
        throw new MicroSchemaValidationError(
          `Invalid dependency in artifact '${artifact.id}': '${req}' does not exist`
        );
      }
    }
  }
}

function validateNoCycles(schema: MicroSchema): void {
  const artifactMap = new Map(schema.artifacts.map(a => [a.id, a]));
  const visited = new Set<string>();
  const inStack = new Set<string>();
  const parent = new Map<string, string>();

  function dfs(id: string): string | null {
    visited.add(id);
    inStack.add(id);

    const artifact = artifactMap.get(id);
    if (!artifact) return null;

    for (const dep of artifact.requires) {
      if (!visited.has(dep)) {
        parent.set(dep, id);
        const cycle = dfs(dep);
        if (cycle) return cycle;
      } else if (inStack.has(dep)) {
        const cyclePath = [dep];
        let current = id;
        while (current !== dep) {
          cyclePath.unshift(current);
          current = parent.get(current)!;
        }
        cyclePath.unshift(dep);
        return cyclePath.join(' → ');
      }
    }

    inStack.delete(id);
    return null;
  }

  for (const artifact of schema.artifacts) {
    if (!visited.has(artifact.id)) {
      const cycle = dfs(artifact.id);
      if (cycle) {
        throw new MicroSchemaValidationError(`Cyclic dependency detected: ${cycle}`);
      }
    }
  }
}
