/**
 * Micro Schema Resolver
 *
 * Discovers, loads, and validates micro schemas from openspec/micro/ directory.
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

/**
 * Gets the micro schemas directory path.
 */
export function getMicroDir(projectRoot: string): string {
  return path.join(projectRoot, 'openspec', 'micro');
}

/**
 * Parses and validates a micro schema from YAML content.
 */
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

/**
 * Loads a micro schema by name from openspec/micro/<name>.yaml.
 */
export function loadMicroSchema(name: string, projectRoot: string): MicroSchema {
  const nameCheck = validateMicroName(name);
  if (!nameCheck.valid) {
    throw new MicroSchemaValidationError(`Invalid micro schema name '${name}': ${nameCheck.error}`);
  }

  const microDir = getMicroDir(projectRoot);
  const filePath = path.join(microDir, `${name}.yaml`);

  if (!fs.existsSync(filePath)) {
    const available = listMicroSchemas(projectRoot);
    const availableStr = available.length > 0 ? available.join(', ') : '(none)';
    throw new MicroSchemaValidationError(
      `Micro schema '${name}' not found. Available: ${availableStr}`
    );
  }

  const content = fs.readFileSync(filePath, 'utf-8');
  return parseMicroSchema(content);
}

/**
 * Lists all available micro schema names.
 */
export function listMicroSchemas(projectRoot: string): string[] {
  const microDir = getMicroDir(projectRoot);

  if (!fs.existsSync(microDir)) {
    return [];
  }

  return fs.readdirSync(microDir)
    .filter(f => f.endsWith('.yaml') && !f.startsWith('.'))
    .map(f => f.replace(/\.yaml$/, ''))
    .sort();
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
