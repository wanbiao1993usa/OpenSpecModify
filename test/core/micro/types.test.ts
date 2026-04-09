/**
 * Tests for micro types (Zod schemas).
 */

import { describe, it, expect } from 'vitest';
import { MicroArtifactSchema, MicroSchemaYaml } from '../../../src/core/micro/types.js';

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
});
