import * as fs from 'node:fs';
import { parse as parseYaml } from 'yaml';
import { SchemaYamlSchema, type SchemaYaml, type Artifact, isLightArtifact, isHeavyArtifact } from './types.js';

export class SchemaValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SchemaValidationError';
  }
}

/**
 * Loads and validates an artifact schema from a YAML file.
 */
export function loadSchema(filePath: string): SchemaYaml {
  const content = fs.readFileSync(filePath, 'utf-8');
  return parseSchema(content);
}

/**
 * Parses and validates an artifact schema from YAML content.
 */
export function parseSchema(yamlContent: string): SchemaYaml {
  const parsed = parseYaml(yamlContent);

  // Validate with Zod
  const result = SchemaYamlSchema.safeParse(parsed);
  if (!result.success) {
    const errors = result.error.issues.map(e => `${e.path.join('.')}: ${e.message}`).join(', ');
    throw new SchemaValidationError(`Invalid schema: ${errors}`);
  }

  const schema = result.data;

  // Validate artifact mode (light vs heavy) for each artifact
  validateArtifactModes(schema.artifacts);

  // Check for duplicate artifact IDs
  validateNoDuplicateIds(schema.artifacts);

  // Check that all requires references are valid
  validateRequiresReferences(schema.artifacts);

  // Check for cycles
  validateNoCycles(schema.artifacts);

  return schema;
}

/**
 * Validates artifact mode consistency for each artifact.
 * - Both modes: must have `generates`
 * - Heavy mode: must have `template` + `generates`, must NOT have `task`
 * - Light mode: must have `task` + `generates`, must NOT have `template` or `instruction`
 */
function validateArtifactModes(artifacts: Artifact[]): void {
  for (const artifact of artifacts) {
    const hasTask = !!artifact.task;
    const hasInstruction = !!artifact.instruction;
    const hasTemplate = !!artifact.template;
    const hasGenerates = !!artifact.generates;

    // Rule 1: Cannot have both task and instruction (mixing modes)
    if (hasTask && hasInstruction) {
      throw new SchemaValidationError(
        `Artifact '${artifact.id}': cannot have both 'task' and 'instruction'. Use either light mode (task + generates) or heavy mode (instruction + template + generates).`
      );
    }

    // Rule 2: Cannot have task with template
    if (hasTask && hasTemplate) {
      throw new SchemaValidationError(
        `Artifact '${artifact.id}': light mode artifact with 'task' cannot have 'template'.`
      );
    }

    // Rule 3: Both modes require generates
    if (!hasGenerates) {
      throw new SchemaValidationError(
        `Artifact '${artifact.id}': 'generates' field is required for both light mode and heavy mode.`
      );
    }

    // Rule 4: Light mode — has task + generates, OK
    if (hasTask) {
      continue;
    }

    // Rule 5: Heavy mode — must have template
    if (!hasTemplate) {
      throw new SchemaValidationError(
        `Artifact '${artifact.id}': heavy mode artifact requires 'template' field.`
      );
    }
  }
}

/**
 * Validates that there are no duplicate artifact IDs.
 */
function validateNoDuplicateIds(artifacts: Artifact[]): void {
  const seen = new Set<string>();
  for (const artifact of artifacts) {
    if (seen.has(artifact.id)) {
      throw new SchemaValidationError(`Duplicate artifact ID: ${artifact.id}`);
    }
    seen.add(artifact.id);
  }
}

/**
 * Validates that all `requires` references point to valid artifact IDs.
 */
function validateRequiresReferences(artifacts: Artifact[]): void {
  const validIds = new Set(artifacts.map(a => a.id));

  for (const artifact of artifacts) {
    for (const req of artifact.requires) {
      if (!validIds.has(req)) {
        throw new SchemaValidationError(
          `Invalid dependency reference in artifact '${artifact.id}': '${req}' does not exist`
        );
      }
    }
  }
}

/**
 * Validates that there are no cyclic dependencies.
 * Uses DFS to detect cycles and reports the full cycle path.
 */
function validateNoCycles(artifacts: Artifact[]): void {
  const artifactMap = new Map(artifacts.map(a => [a.id, a]));
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
        // Found a cycle - reconstruct the path
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

  for (const artifact of artifacts) {
    if (!visited.has(artifact.id)) {
      const cycle = dfs(artifact.id);
      if (cycle) {
        throw new SchemaValidationError(`Cyclic dependency detected: ${cycle}`);
      }
    }
  }
}
