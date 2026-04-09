import { z } from 'zod';

/**
 * Micro artifact definition.
 * Lightweight: only id, instruction, and dependency requirements.
 * No generates (no file output), no template.
 */
export const MicroArtifactSchema = z.object({
  id: z.string().min(1, { error: 'Artifact ID is required' }),
  instruction: z.string().min(1, { error: 'instruction field is required' }),
  description: z.string().optional(),
  requires: z.array(z.string()).default([]),
});

/**
 * Micro schema YAML structure.
 */
export const MicroSchemaYaml = z.object({
  name: z.string().min(1, { error: 'Schema name is required' }),
  version: z.number().int().positive({ error: 'Version must be a positive integer' }),
  description: z.string().optional(),
  artifacts: z.array(MicroArtifactSchema).min(1, { error: 'At least one artifact required' }),
});

export type MicroArtifact = z.infer<typeof MicroArtifactSchema>;
export type MicroSchema = z.infer<typeof MicroSchemaYaml>;
