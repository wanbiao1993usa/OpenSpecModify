/**
 * Micro CLI Commands
 *
 * Commands for the micro artifact workflow: list, new, status, instructions, complete, reset, validate.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import ora from 'ora';
import chalk from 'chalk';
import { stringify as stringifyYaml } from 'yaml';
import {
  listMicroSchemas,
  loadMicroSchema,
  parseMicroSchema,
  getMicroDir,
  MicroSchemaValidationError,
  validateMicroName,
  loadMicroContext,
  generateMicroInstructions,
  getNextArtifacts,
  formatMicroStatus,
  writeMicroComplete,
  resetMicroMeta,
  type MicroStatus,
  type MicroArtifactStatus,
} from '../core/micro/index.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface MicroListOptions {
  json?: boolean;
}

export interface MicroNewOptions {
  description?: string;
}

export interface MicroStatusOptions {
  json?: boolean;
}

export interface MicroInstructionsOptions {
  json?: boolean;
}

export interface MicroCompleteOptions {
  // no extra options for now
}

export interface MicroResetOptions {
  yes?: boolean;
}

export interface MicroValidateOptions {
  json?: boolean;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getProjectRoot(): string {
  return process.cwd();
}

function getMicroStatusIndicator(status: MicroArtifactStatus['status']): string {
  switch (status) {
    case 'done':
      return chalk.green('[x]');
    case 'stale':
      return chalk.magenta('[~]');
    case 'ready':
      return chalk.yellow('[ ]');
    case 'blocked':
      return chalk.red('[-]');
  }
}

// ---------------------------------------------------------------------------
// list
// ---------------------------------------------------------------------------

export async function microListCommand(options: MicroListOptions): Promise<void> {
  const projectRoot = getProjectRoot();
  const schemas = listMicroSchemas(projectRoot);

  if (options.json) {
    console.log(JSON.stringify({ schemas }, null, 2));
    return;
  }

  if (schemas.length === 0) {
    console.log('No micro schemas found. Create one with: openspec micro new <name>');
    return;
  }

  console.log(`Micro schemas (${schemas.length}):`);
  for (const name of schemas) {
    try {
      const schema = loadMicroSchema(name, projectRoot);
      const desc = schema.description ? ` — ${schema.description}` : '';
      console.log(`  ${name} (${schema.artifacts.length} artifacts)${desc}`);
    } catch {
      console.log(`  ${name} (invalid schema)`);
    }
  }
}

// ---------------------------------------------------------------------------
// new
// ---------------------------------------------------------------------------

export async function microNewCommand(
  name: string,
  options: MicroNewOptions
): Promise<void> {
  const nameCheck = validateMicroName(name);
  if (!nameCheck.valid) {
    throw new Error(`Invalid schema name '${name}': ${nameCheck.error}`);
  }

  const projectRoot = getProjectRoot();
  const microDir = getMicroDir(projectRoot);
  const filePath = path.join(microDir, `${name}.yaml`);

  if (fs.existsSync(filePath)) {
    throw new Error(`Micro schema '${name}' already exists at ${filePath}`);
  }

  // Ensure directory exists
  fs.mkdirSync(microDir, { recursive: true });

  const template = {
    name,
    version: 1,
    description: options.description || '',
    artifacts: [
      {
        id: 'example',
        instruction: 'Replace this with your first artifact instruction.',
        description: 'Example artifact — edit or replace.',
        requires: [],
      },
    ],
  };

  fs.writeFileSync(filePath, stringifyYaml(template), 'utf-8');
  console.log(`Created micro schema: ${filePath}`);
}

// ---------------------------------------------------------------------------
// status
// ---------------------------------------------------------------------------

export async function microStatusCommand(
  name: string,
  options: MicroStatusOptions
): Promise<void> {
  const spinner = ora('Loading micro status...').start();

  try {
    const projectRoot = getProjectRoot();
    const context = loadMicroContext(name, projectRoot);
    const status = formatMicroStatus(context);

    spinner.stop();

    if (options.json) {
      console.log(JSON.stringify(status, null, 2));
      return;
    }

    printMicroStatusText(status);
  } catch (error) {
    spinner.stop();
    throw error;
  }
}

function printMicroStatusText(status: MicroStatus): void {
  const doneCount = status.artifacts.filter(
    (a) => a.status === 'done' || a.status === 'stale'
  ).length;
  const total = status.artifacts.length;

  console.log(`Micro: ${status.name}`);
  if (status.description) {
    console.log(`Description: ${status.description}`);
  }
  console.log(`Progress: ${doneCount}/${total} artifacts complete`);
  console.log();

  for (const artifact of status.artifacts) {
    const indicator = getMicroStatusIndicator(artifact.status);
    let line = `${indicator} ${artifact.id}`;

    if (artifact.status === 'stale') {
      line += chalk.magenta(` (stale — upstream changed)`);
    } else if (
      artifact.status === 'blocked' &&
      artifact.missingDeps &&
      artifact.missingDeps.length > 0
    ) {
      line += chalk.red(` (blocked by: ${artifact.missingDeps.join(', ')})`);
    }

    console.log(line);
  }

  if (status.isComplete) {
    console.log();
    console.log(chalk.green('All artifacts complete!'));
  }
}

// ---------------------------------------------------------------------------
// instructions
// ---------------------------------------------------------------------------

export async function microInstructionsCommand(
  name: string,
  artifactId: string | undefined,
  options: MicroInstructionsOptions
): Promise<void> {
  const projectRoot = getProjectRoot();
  const context = loadMicroContext(name, projectRoot);

  // If no artifact specified, pick the first ready one
  let targetId = artifactId;
  if (!targetId) {
    const next = getNextArtifacts(context);

    if (next.length === 0) {
      const status = formatMicroStatus(context);
      if (status.isComplete) {
        if (options.json) {
          console.log(JSON.stringify({ complete: true, message: 'All artifacts complete.' }, null, 2));
          return;
        }
        console.log('All artifacts are complete.');
        return;
      }

      if (options.json) {
        console.log(JSON.stringify({ complete: false, ready: [], message: 'No artifacts are ready.' }, null, 2));
        return;
      }
      console.log('No artifacts are currently ready. Check status for blocked items.');
      return;
    }

    targetId = next[0];
  }

  const instructions = generateMicroInstructions(context, targetId);

  if (options.json) {
    console.log(JSON.stringify(instructions, null, 2));
    return;
  }

  console.log(`Schema: ${instructions.schemaName}`);
  console.log(`Artifact: ${instructions.artifactId}`);
  if (instructions.description) {
    console.log(`Description: ${instructions.description}`);
  }
  console.log();

  if (instructions.dependencies.length > 0) {
    console.log('Dependencies:');
    for (const dep of instructions.dependencies) {
      const mark = dep.done ? chalk.green('✓') : chalk.red('✗');
      console.log(`  ${mark} ${dep.id}${dep.description ? ` — ${dep.description}` : ''}`);
    }
    console.log();
  }

  console.log('Instruction:');
  console.log(instructions.instruction);

  if (instructions.unlocks.length > 0) {
    console.log();
    console.log(`Unlocks: ${instructions.unlocks.join(', ')}`);
  }
}

// ---------------------------------------------------------------------------
// complete
// ---------------------------------------------------------------------------

export async function microCompleteCommand(
  name: string,
  artifactId: string,
  _options: MicroCompleteOptions
): Promise<void> {
  const projectRoot = getProjectRoot();

  // Validate that the artifact exists in the schema
  const schema = loadMicroSchema(name, projectRoot);
  const artifact = schema.artifacts.find((a) => a.id === artifactId);
  if (!artifact) {
    const available = schema.artifacts.map((a) => a.id);
    throw new Error(
      `Artifact '${artifactId}' not found in micro schema '${name}'. Available: ${available.join(', ')}`
    );
  }

  writeMicroComplete(name, artifactId, projectRoot);
  console.log(`Marked '${artifactId}' as complete in micro schema '${name}'.`);
}

// ---------------------------------------------------------------------------
// reset
// ---------------------------------------------------------------------------

export async function microResetCommand(
  name: string,
  options: MicroResetOptions
): Promise<void> {
  const projectRoot = getProjectRoot();

  // Validate schema exists
  loadMicroSchema(name, projectRoot);

  if (!options.yes) {
    // In non-interactive mode, just warn
    console.log(`Resetting all progress for micro schema '${name}'...`);
  }

  resetMicroMeta(name, projectRoot);
  console.log(`Reset complete. All artifacts in '${name}' are now pending.`);
}

// ---------------------------------------------------------------------------
// validate
// ---------------------------------------------------------------------------

export async function microValidateCommand(
  name: string,
  options: MicroValidateOptions
): Promise<void> {
  const nameCheck = validateMicroName(name);
  if (!nameCheck.valid) {
    throw new Error(`Invalid schema name '${name}': ${nameCheck.error}`);
  }

  const projectRoot = getProjectRoot();
  const microDir = getMicroDir(projectRoot);
  const filePath = path.join(microDir, `${name}.yaml`);

  if (!fs.existsSync(filePath)) {
    throw new Error(`Micro schema file not found: ${filePath}`);
  }

  const content = fs.readFileSync(filePath, 'utf-8');

  try {
    const schema = parseMicroSchema(content);

    if (options.json) {
      console.log(
        JSON.stringify(
          {
            valid: true,
            name: schema.name,
            version: schema.version,
            artifactCount: schema.artifacts.length,
          },
          null,
          2
        )
      );
      return;
    }

    console.log(chalk.green(`✓ Micro schema '${name}' is valid.`));
    console.log(`  Name: ${schema.name}`);
    console.log(`  Version: ${schema.version}`);
    console.log(`  Artifacts: ${schema.artifacts.length}`);
  } catch (error) {
    if (error instanceof MicroSchemaValidationError) {
      if (options.json) {
        console.log(
          JSON.stringify({ valid: false, error: error.message }, null, 2)
        );
        process.exitCode = 1;
        return;
      }

      console.log(chalk.red(`✗ Micro schema '${name}' is invalid:`));
      console.log(`  ${error.message}`);
      process.exitCode = 1;
      return;
    }
    throw error;
  }
}
