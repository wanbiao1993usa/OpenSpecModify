import { z } from 'zod';

/**
 * Execution mode for micro artifacts.
 * - sub-agent: dispatch to a sub-agent (parallel-friendly, dialog_log required)
 * - main-agent: execute in the main agent session (serial, dialog_log optional)
 */
export const MicroModeSchema = z.enum(['sub-agent', 'main-agent']);
export type MicroMode = z.infer<typeof MicroModeSchema>;

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
  preferred_mode: MicroModeSchema.optional(),
});

/**
 * Micro schema YAML structure.
 */
export const MicroSchemaYaml = z.object({
  name: z.string().min(1, { error: 'Schema name is required' }),
  version: z.number().int().positive({ error: 'Version must be a positive integer' }),
  description: z.string().optional(),
  preferred_mode: MicroModeSchema.optional(),
  artifacts: z.array(MicroArtifactSchema).min(1, { error: 'At least one artifact required' }),
});

export type MicroArtifact = z.infer<typeof MicroArtifactSchema>;
export type MicroSchema = z.infer<typeof MicroSchemaYaml>;

/**
 * Resolves the effective mode for an artifact.
 * Artifact-level overrides schema-level; defaults to 'main-agent' if neither set.
 */
export function resolveArtifactMode(schema: MicroSchema, artifact: MicroArtifact): MicroMode {
  return artifact.preferred_mode ?? schema.preferred_mode ?? 'main-agent';
}
