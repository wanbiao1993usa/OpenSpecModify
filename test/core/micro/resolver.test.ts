/**
 * Tests for micro schema resolver.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { stringify as stringifyYaml } from 'yaml';
import {
  parseMicroSchema,
  loadMicroSchema,
  listMicroSchemas,
  listMicroBlueprints,
  listAllMicroSchemas,
  listMicroSchemasWithInfo,
  getMicroDir,
  getMicroBlueprintsDir,
  MicroSchemaValidationError,
  validateMicroName,
} from '../../../src/core/micro/resolver.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

let tmpDir: string;

function setupTmpDir(): string {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'micro-resolver-test-'));
  return tmpDir;
}

function writeMicroSchema(projectRoot: string, name: string, content: object): void {
  const microDir = getMicroDir(projectRoot);
  fs.mkdirSync(microDir, { recursive: true });
  fs.writeFileSync(path.join(microDir, `${name}.yaml`), stringifyYaml(content), 'utf-8');
}

function writeMicroBlueprint(projectRoot: string, name: string, content: object): void {
  const bpDir = getMicroBlueprintsDir(projectRoot);
  fs.mkdirSync(bpDir, { recursive: true });
  fs.writeFileSync(path.join(bpDir, `${name}.yaml`), stringifyYaml(content), 'utf-8');
}

beforeEach(() => {
  setupTmpDir();
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// parseMicroSchema
// ---------------------------------------------------------------------------

describe('parseMicroSchema', () => {
  it('parses valid YAML content', () => {
    const yaml = stringifyYaml({
      name: 'test',
      version: 1,
      artifacts: [
        { id: 'a', instruction: 'Do A' },
        { id: 'b', instruction: 'Do B', requires: ['a'] },
      ],
    });

    const schema = parseMicroSchema(yaml);
    expect(schema.name).toBe('test');
    expect(schema.artifacts).toHaveLength(2);
    expect(schema.artifacts[1].requires).toEqual(['a']);
  });

  it('throws MicroSchemaValidationError for invalid YAML structure', () => {
    const yaml = stringifyYaml({ name: '', version: 1, artifacts: [{ id: 'a', instruction: 'Do A' }] });
    expect(() => parseMicroSchema(yaml)).toThrow(MicroSchemaValidationError);
  });

  it('detects duplicate artifact IDs', () => {
    const yaml = stringifyYaml({
      name: 'test',
      version: 1,
      artifacts: [
        { id: 'a', instruction: 'Do A' },
        { id: 'a', instruction: 'Do A again' },
      ],
    });
    expect(() => parseMicroSchema(yaml)).toThrow(/Duplicate artifact ID/);
  });

  it('detects invalid dependency references', () => {
    const yaml = stringifyYaml({
      name: 'test',
      version: 1,
      artifacts: [
        { id: 'a', instruction: 'Do A', requires: ['nonexistent'] },
      ],
    });
    expect(() => parseMicroSchema(yaml)).toThrow(/does not exist/);
  });

  it('detects cyclic dependencies', () => {
    const yaml = stringifyYaml({
      name: 'test',
      version: 1,
      artifacts: [
        { id: 'a', instruction: 'Do A', requires: ['b'] },
        { id: 'b', instruction: 'Do B', requires: ['a'] },
      ],
    });
    expect(() => parseMicroSchema(yaml)).toThrow(/Cyclic dependency/);
  });

  it('detects self-referencing dependency', () => {
    const yaml = stringifyYaml({
      name: 'test',
      version: 1,
      artifacts: [
        { id: 'a', instruction: 'Do A', requires: ['a'] },
      ],
    });
    expect(() => parseMicroSchema(yaml)).toThrow(/Cyclic dependency/);
  });
});

// ---------------------------------------------------------------------------
// loadMicroSchema
// ---------------------------------------------------------------------------

describe('loadMicroSchema', () => {
  it('loads a schema by name', () => {
    writeMicroSchema(tmpDir, 'my-plan', {
      name: 'my-plan',
      version: 1,
      artifacts: [{ id: 'step1', instruction: 'First step' }],
    });

    const schema = loadMicroSchema('my-plan', tmpDir);
    expect(schema.name).toBe('my-plan');
    expect(schema.artifacts).toHaveLength(1);
  });

  it('throws when schema not found', () => {
    expect(() => loadMicroSchema('nonexistent', tmpDir)).toThrow(MicroSchemaValidationError);
    expect(() => loadMicroSchema('nonexistent', tmpDir)).toThrow(/not found/);
  });
});

// ---------------------------------------------------------------------------
// listMicroSchemas
// ---------------------------------------------------------------------------

describe('listMicroSchemas', () => {
  it('returns empty when no micro directory exists', () => {
    expect(listMicroSchemas(tmpDir)).toEqual([]);
  });

  it('lists schema files, excluding meta files', () => {
    const microDir = getMicroDir(tmpDir);
    fs.mkdirSync(microDir, { recursive: true });
    fs.writeFileSync(path.join(microDir, 'alpha.yaml'), 'name: alpha\nversion: 1\nartifacts:\n  - id: a\n    instruction: x', 'utf-8');
    fs.writeFileSync(path.join(microDir, 'beta.yaml'), 'name: beta\nversion: 1\nartifacts:\n  - id: b\n    instruction: y', 'utf-8');
    fs.writeFileSync(path.join(microDir, '.alpha.meta.yaml'), 'artifacts: {}', 'utf-8');

    const schemas = listMicroSchemas(tmpDir);
    expect(schemas).toEqual(['alpha', 'beta']);
  });

  it('returns sorted names', () => {
    const microDir = getMicroDir(tmpDir);
    fs.mkdirSync(microDir, { recursive: true });
    fs.writeFileSync(path.join(microDir, 'zeta.yaml'), '', 'utf-8');
    fs.writeFileSync(path.join(microDir, 'alpha.yaml'), '', 'utf-8');

    const schemas = listMicroSchemas(tmpDir);
    expect(schemas).toEqual(['alpha', 'zeta']);
  });
});

// ---------------------------------------------------------------------------
// getMicroDir
// ---------------------------------------------------------------------------

describe('getMicroDir', () => {
  it('returns openspec/micro under project root', () => {
    expect(getMicroDir('/project')).toBe(path.join('/project', 'openspec', 'micro'));
  });
});

// ---------------------------------------------------------------------------
// validateMicroName
// ---------------------------------------------------------------------------

describe('validateMicroName', () => {
  it('accepts valid names', () => {
    expect(validateMicroName('my-schema').valid).toBe(true);
    expect(validateMicroName('test_plan').valid).toBe(true);
    expect(validateMicroName('Plan123').valid).toBe(true);
  });

  it('rejects empty names', () => {
    expect(validateMicroName('').valid).toBe(false);
    expect(validateMicroName('  ').valid).toBe(false);
  });

  it('rejects path traversal', () => {
    expect(validateMicroName('../../etc').valid).toBe(false);
    expect(validateMicroName('foo/bar').valid).toBe(false);
    expect(validateMicroName('foo\\bar').valid).toBe(false);
  });

  it('rejects names starting with non-alphanumeric', () => {
    expect(validateMicroName('-bad').valid).toBe(false);
    expect(validateMicroName('_bad').valid).toBe(false);
    expect(validateMicroName('.hidden').valid).toBe(false);
  });

  it('rejects names with spaces or special chars', () => {
    expect(validateMicroName('my schema').valid).toBe(false);
    expect(validateMicroName('my@schema').valid).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// getMicroBlueprintsDir
// ---------------------------------------------------------------------------

describe('getMicroBlueprintsDir', () => {
  it('returns openspec/blueprints/micro under project root', () => {
    expect(getMicroBlueprintsDir('/project')).toBe(path.join('/project', 'openspec', 'blueprints', 'micro'));
  });
});

// ---------------------------------------------------------------------------
// Blueprint loading
// ---------------------------------------------------------------------------

describe('loadMicroSchema with blueprints', () => {
  it('loads from blueprints when not in micro dir', () => {
    writeMicroBlueprint(tmpDir, 'curated-plan', {
      name: 'curated-plan',
      version: 1,
      artifacts: [{ id: 'step1', instruction: 'First step' }],
    });

    const schema = loadMicroSchema('curated-plan', tmpDir);
    expect(schema.name).toBe('curated-plan');
    expect(schema.artifacts).toHaveLength(1);
  });

  it('prefers micro dir over blueprints dir', () => {
    writeMicroSchema(tmpDir, 'shared-plan', {
      name: 'shared-plan-schema',
      version: 2,
      artifacts: [{ id: 'a', instruction: 'Schema version' }],
    });
    writeMicroBlueprint(tmpDir, 'shared-plan', {
      name: 'shared-plan-bp',
      version: 1,
      artifacts: [{ id: 'b', instruction: 'Blueprint version' }],
    });

    const schema = loadMicroSchema('shared-plan', tmpDir);
    expect(schema.name).toBe('shared-plan-schema');
    expect(schema.version).toBe(2);
  });

  it('shows all available schemas in error message', () => {
    writeMicroSchema(tmpDir, 'plan-a', {
      name: 'plan-a', version: 1, artifacts: [{ id: 'x', instruction: 'X' }],
    });
    writeMicroBlueprint(tmpDir, 'plan-b', {
      name: 'plan-b', version: 1, artifacts: [{ id: 'y', instruction: 'Y' }],
    });

    try {
      loadMicroSchema('nonexistent', tmpDir);
      expect.fail('Should have thrown');
    } catch (e) {
      const error = e as Error;
      expect(error.message).toContain('plan-a');
      expect(error.message).toContain('plan-b');
    }
  });
});

// ---------------------------------------------------------------------------
// Blueprint listing
// ---------------------------------------------------------------------------

describe('listMicroBlueprints', () => {
  it('returns empty when no blueprints directory exists', () => {
    expect(listMicroBlueprints(tmpDir)).toEqual([]);
  });

  it('lists only blueprint schemas', () => {
    writeMicroBlueprint(tmpDir, 'curated-a', {
      name: 'curated-a', version: 1, artifacts: [{ id: 'a', instruction: 'A' }],
    });
    writeMicroSchema(tmpDir, 'regular-b', {
      name: 'regular-b', version: 1, artifacts: [{ id: 'b', instruction: 'B' }],
    });

    const blueprints = listMicroBlueprints(tmpDir);
    expect(blueprints).toEqual(['curated-a']);
  });
});

describe('listAllMicroSchemas', () => {
  it('includes both micro and blueprint schemas', () => {
    writeMicroSchema(tmpDir, 'regular', {
      name: 'regular', version: 1, artifacts: [{ id: 'a', instruction: 'A' }],
    });
    writeMicroBlueprint(tmpDir, 'curated', {
      name: 'curated', version: 1, artifacts: [{ id: 'b', instruction: 'B' }],
    });

    const all = listAllMicroSchemas(tmpDir);
    expect(all).toContain('regular');
    expect(all).toContain('curated');
  });

  it('deduplicates same-name schemas', () => {
    writeMicroSchema(tmpDir, 'shared', {
      name: 'shared', version: 1, artifacts: [{ id: 'a', instruction: 'A' }],
    });
    writeMicroBlueprint(tmpDir, 'shared', {
      name: 'shared', version: 1, artifacts: [{ id: 'a', instruction: 'A' }],
    });

    expect(listAllMicroSchemas(tmpDir).filter(s => s === 'shared').length).toBe(1);
  });
});

describe('listMicroSchemasWithInfo', () => {
  it('returns correct source for micro vs blueprint schemas', () => {
    writeMicroSchema(tmpDir, 'regular', {
      name: 'regular', version: 1, artifacts: [{ id: 'a', instruction: 'A' }],
    });
    writeMicroBlueprint(tmpDir, 'curated', {
      name: 'curated', version: 1, artifacts: [{ id: 'b', instruction: 'B' }, { id: 'c', instruction: 'C' }],
    });

    const infos = listMicroSchemasWithInfo(tmpDir);
    const regular = infos.find(i => i.name === 'regular');
    const curated = infos.find(i => i.name === 'curated');

    expect(regular!.source).toBe('project');
    expect(regular!.artifactCount).toBe(1);
    expect(curated!.source).toBe('project-blueprint');
    expect(curated!.artifactCount).toBe(2);
  });

  it('shadows blueprint with same-name micro schema', () => {
    writeMicroSchema(tmpDir, 'shared', {
      name: 'shared-schema', version: 2, artifacts: [{ id: 'a', instruction: 'Schema' }],
    });
    writeMicroBlueprint(tmpDir, 'shared', {
      name: 'shared-bp', version: 1, artifacts: [{ id: 'b', instruction: 'BP' }, { id: 'c', instruction: 'C' }],
    });

    const infos = listMicroSchemasWithInfo(tmpDir);
    const shared = infos.find(i => i.name === 'shared');
    expect(shared!.source).toBe('project');
    expect(shared!.artifactCount).toBe(1);
  });
});
