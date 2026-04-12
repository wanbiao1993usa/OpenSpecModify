/**
 * Schemas Command
 *
 * Lists available workflow schemas with descriptions.
 */

import chalk from 'chalk';
import { listSchemasWithInfo } from '../../core/artifact-graph/index.js';

// -----------------------------------------------------------------------------
// Types
// -----------------------------------------------------------------------------

export interface SchemasOptions {
  json?: boolean;
  blueprints?: boolean;
  schemasOnly?: boolean;
}

// -----------------------------------------------------------------------------
// Command Implementation
// -----------------------------------------------------------------------------

export async function schemasCommand(options: SchemasOptions): Promise<void> {
  const projectRoot = process.cwd();
  let schemas = listSchemasWithInfo(projectRoot);

  // Filter by blueprint / non-blueprint
  if (options.blueprints) {
    schemas = schemas.filter(s => s.source.includes('blueprint'));
  } else if (options.schemasOnly) {
    schemas = schemas.filter(s => !s.source.includes('blueprint'));
  }

  if (options.json) {
    console.log(JSON.stringify(schemas, null, 2));
    return;
  }

  const label = options.blueprints
    ? 'Blueprint schemas'
    : options.schemasOnly
      ? 'Schemas (non-blueprint)'
      : 'Available schemas';

  console.log(`${label}:`);
  console.log();

  if (schemas.length === 0) {
    console.log('  (none)');
    return;
  }

  for (const schema of schemas) {
    let sourceLabel = '';
    switch (schema.source) {
      case 'project':
        sourceLabel = chalk.cyan(' (project)');
        break;
      case 'project-blueprint':
        sourceLabel = chalk.cyan(' (project blueprint)');
        break;
      case 'user':
        sourceLabel = chalk.dim(' (user)');
        break;
      case 'user-blueprint':
        sourceLabel = chalk.dim(' (user blueprint)');
        break;
      case 'package':
        sourceLabel = '';
        break;
      case 'package-blueprint':
        sourceLabel = chalk.dim(' (blueprint)');
        break;
    }
    console.log(`  ${chalk.bold(schema.name)}${sourceLabel}`);
    console.log(`    ${schema.description}`);
    console.log(`    Artifacts: ${schema.artifacts.join(' → ')}`);
    console.log();
  }
}
