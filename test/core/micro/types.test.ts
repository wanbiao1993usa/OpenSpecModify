/**
 * Tests for micro types (Zod schemas).
 */

import { describe, it, expect } from 'vitest';
import { MicroArtifactSchema, MicroSchemaYaml, resolveArtifactMode } from '../../../src/core/micro/types.js';
import type { MicroSchema, MicroArtifact } from '../../../src/core/micro/types.js';

describe('MicroArtifactSchema', () => {
  it('parses a valid artifact with all fields', () => {
    const result = MicroArtifactSchema.safeParse({
      id: 'step-1',
      instruction: 'Do something',
      description: 'First step',
      requires: ['step-0'],
    });
    expect(result.success).toBe(true);
    expect(result.data).toEqual({
      id: 'step-1',
      instruction: 'Do something',
      description: 'First step',
      requires: ['step-0'],
    });
  });

  it('defaults requires to empty array', () => {
    const result = MicroArtifactSchema.safeParse({
      id: 'step-1',
      instruction: 'Do something',
    });
    expect(result.success).toBe(true);
    expect(result.data!.requires).toEqual([]);
  });

  it('rejects missing id', () => {
    const result = MicroArtifactSchema.safeParse({
      instruction: 'Do something',
    });
    expect(result.success).toBe(false);
  });

  it('rejects empty id', () => {
    const result = MicroArtifactSchema.safeParse({
      id: '',
      instruction: 'Do something',
    });
    expect(result.success).toBe(false);
  });

  it('rejects missing instruction', () => {
    const result = MicroArtifactSchema.safeParse({
      id: 'step-1',
    });
    expect(result.success).toBe(false);
  });

  it('rejects empty instruction', () => {
    const result = MicroArtifactSchema.safeParse({
      id: 'step-1',
      instruction: '',
    });
    expect(result.success).toBe(false);
  });
});

describe('MicroSchemaYaml', () => {
  it('parses a valid schema', () => {
    const result = MicroSchemaYaml.safeParse({
      name: 'test-schema',
      version: 1,
      description: 'A test schema',
      artifacts: [
        { id: 'a', instruction: 'Do A' },
      ],
    });
    expect(result.success).toBe(true);
    expect(result.data!.name).toBe('test-schema');
    expect(result.data!.artifacts).toHaveLength(1);
  });

  it('rejects empty name', () => {
    const result = MicroSchemaYaml.safeParse({
      name: '',
      version: 1,
      artifacts: [{ id: 'a', instruction: 'Do A' }],
    });
    expect(result.success).toBe(false);
  });

  it('rejects non-positive version', () => {
    const result = MicroSchemaYaml.safeParse({
      name: 'test',
      version: 0,
      artifacts: [{ id: 'a', instruction: 'Do A' }],
    });
    expect(result.success).toBe(false);
  });

  it('rejects non-integer version', () => {
    const result = MicroSchemaYaml.safeParse({
      name: 'test',
      version: 1.5,
      artifacts: [{ id: 'a', instruction: 'Do A' }],
    });
    expect(result.success).toBe(false);
  });

  it('rejects empty artifacts array', () => {
    const result = MicroSchemaYaml.safeParse({
      name: 'test',
      version: 1,
      artifacts: [],
    });
    expect(result.success).toBe(false);
  });

  it('description is optional', () => {
    const result = MicroSchemaYaml.safeParse({
      name: 'test',
      version: 1,
      artifacts: [{ id: 'a', instruction: 'Do A' }],
    });
    expect(result.success).toBe(true);
    expect(result.data!.description).toBeUndefined();
  });

  it('accepts preferred_mode at schema level', () => {
    const result = MicroSchemaYaml.safeParse({
      name: 'test',
      version: 1,
      preferred_mode: 'sub-agent',
      artifacts: [{ id: 'a', instruction: 'Do A' }],
    });
    expect(result.success).toBe(true);
    expect(result.data!.preferred_mode).toBe('sub-agent');
  });

  it('accepts preferred_mode at artifact level', () => {
    const result = MicroSchemaYaml.safeParse({
      name: 'test',
      version: 1,
      artifacts: [{ id: 'a', instruction: 'Do A', preferred_mode: 'main-agent' }],
    });
    expect(result.success).toBe(true);
    expect(result.data!.artifacts[0].preferred_mode).toBe('main-agent');
  });

  it('rejects invalid preferred_mode value', () => {
    const result = MicroSchemaYaml.safeParse({
      name: 'test',
      version: 1,
      preferred_mode: 'invalid',
      artifacts: [{ id: 'a', instruction: 'Do A' }],
    });
    expect(result.success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// resolveArtifactMode
// ---------------------------------------------------------------------------

describe('resolveArtifactMode', () => {
  const makeSchema = (mode?: string): MicroSchema => ({
    name: 'test',
    version: 1,
    preferred_mode: mode as any,
    artifacts: [],
  });

  const makeArtifact = (mode?: string): MicroArtifact => ({
    id: 'a',
    instruction: 'Do A',
    requires: [],
    preferred_mode: mode as any,
  });

  it('defaults to main-agent when neither set', () => {
    expect(resolveArtifactMode(makeSchema(), makeArtifact())).toBe('main-agent');
  });

  it('uses schema-level when artifact-level not set', () => {
    expect(resolveArtifactMode(makeSchema('sub-agent'), makeArtifact())).toBe('sub-agent');
  });

  it('uses artifact-level when schema-level not set', () => {
    expect(resolveArtifactMode(makeSchema(), makeArtifact('sub-agent'))).toBe('sub-agent');
  });

  it('artifact-level overrides schema-level', () => {
    expect(resolveArtifactMode(makeSchema('sub-agent'), makeArtifact('main-agent'))).toBe('main-agent');
  });
});
