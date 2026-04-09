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
  getMicroDir,
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
