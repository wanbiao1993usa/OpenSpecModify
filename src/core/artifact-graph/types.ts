import { z } from 'zod';

// Heavy-mode artifact definition schema (existing: generates + template + instruction)
export const HeavyArtifactSchema = z.object({
  id: z.string().min(1, { error: 'Artifact ID is required' }),
  generates: z.string().min(1, { error: 'generates field is required' }),
  description: z.string(),
  template: z.string().min(1, { error: 'template field is required' }),
  instruction: z.string().optional(),
  requires: z.array(z.string()).default([]),
});

// Lightweight artifact definition schema (task + generates)
export const LightArtifactSchema = z.object({
  id: z.string().min(1, { error: 'Artifact ID is required' }),
  generates: z.string().min(1, { error: 'generates field is required' }),
  task: z.string().min(1, { error: 'task field is required' }),
  requires: z.array(z.string()).default([]),
});

// Union artifact schema that accepts either heavy or light mode
// Validation logic is handled in parseSchema for better error messages
export const ArtifactSchema = z.object({
  id: z.string().min(1, { error: 'Artifact ID is required' }),
  // Heavy-mode fields (optional for light mode)
  generates: z.string().optional(),
  description: z.string().optional(),
  template: z.string().optional(),
  instruction: z.string().optional(),
  // Light-mode fields
  task: z.string().optional(),
  requires: z.array(z.string()).default([]),
});

// Apply phase configuration for schema-aware apply instructions
export const ApplyPhaseSchema = z.object({
  // Artifact IDs that must exist before apply is available
  requires: z.array(z.string()).min(1, { error: 'At least one required artifact' }),
  // Path to file with checkboxes for progress (relative to change dir), or null if no tracking
  tracks: z.string().nullable().optional(),
  // Custom guidance for the apply phase
  instruction: z.string().optional(),
});

// Full schema YAML structure
export const SchemaYamlSchema = z.object({
  name: z.string().min(1, { error: 'Schema name is required' }),
  version: z.number().int().positive({ error: 'Version must be a positive integer' }),
  description: z.string().optional(),
  artifacts: z.array(ArtifactSchema).min(1, { error: 'At least one artifact required' }),
  // Optional apply phase configuration (for schema-aware apply instructions)
  apply: ApplyPhaseSchema.optional(),
});

// Derived TypeScript types
export type Artifact = z.infer<typeof ArtifactSchema>;
export type HeavyArtifact = z.infer<typeof HeavyArtifactSchema>;
export type LightArtifact = z.infer<typeof LightArtifactSchema>;
export type ApplyPhase = z.infer<typeof ApplyPhaseSchema>;
export type SchemaYaml = z.infer<typeof SchemaYamlSchema>;

/**
 * Determines if an artifact is in lightweight mode.
 * Light mode: has `task` field, no `template`.
 */
export function isLightArtifact(artifact: Artifact): boolean {
  return !!artifact.task && !artifact.template;
}

/**
 * Determines if an artifact is in heavy (traditional) mode.
 * Heavy mode: has `instruction` or `template` + `generates`.
 */
export function isHeavyArtifact(artifact: Artifact): boolean {
  return !!artifact.template && !!artifact.generates;
}

// Per-change metadata schema
// Note: schema field is validated at parse time against available schemas
// using a lazy import to avoid circular dependencies
export const ChangeMetadataSchema = z.object({
  // Required: which workflow schema this change uses
  schema: z.string().min(1, { message: 'schema is required' }),

  // Optional: creation timestamp (ISO date string or ISO datetime string)
  created: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}(:\d{2})?)?$/, {
      message: 'created must be YYYY-MM-DD or ISO datetime format',
    })
    .optional(),

  // Optional: parent change name (for lineage tracking)
  parent: z.string().optional(),

  // Optional: source change name (for --from artifact reuse)
  from: z.string().optional(),
});

export type ChangeMetadata = z.infer<typeof ChangeMetadataSchema>;

// Runtime state types (not Zod - internal only)

// Slice 1: Simple completion tracking via filesystem
export type CompletedSet = Set<string>;

// Set of stale artifact IDs
export type StaleSet = Set<string>;

// Return type for blocked query
export interface BlockedArtifacts {
  [artifactId: string]: string[];
}

