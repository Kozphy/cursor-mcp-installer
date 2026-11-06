import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const here = dirname(fileURLToPath(import.meta.url));
const schemaDir = join(here, '..', '..', 'vendor', 'cursor-plugins', 'schemas');

interface SchemaError {
  instancePath: string;
  message?: string;
}

export interface ValidateFunction {
  (data: unknown): boolean;
  errors?: SchemaError[] | null;
}

interface AjvInstance {
  compile: (schema: object) => ValidateFunction;
}

const AjvCtor = require('ajv') as new (options?: object) => AjvInstance;
const addFormats = require('ajv-formats') as (ajv: AjvInstance) => void;
const ajv = new AjvCtor({ allErrors: true, strict: false });
addFormats(ajv);

const pluginSchema = JSON.parse(readFileSync(join(schemaDir, 'plugin.schema.json'), 'utf8')) as object;
const marketplaceSchema = JSON.parse(readFileSync(join(schemaDir, 'marketplace.schema.json'), 'utf8')) as object;

export const validatePluginSchema: ValidateFunction = ajv.compile(pluginSchema);
export const validateMarketplaceSchema: ValidateFunction = ajv.compile(marketplaceSchema);

export function formatSchemaErrors(errors: SchemaError[] | null | undefined): string[] {
  return (errors ?? []).map((error) => `${error.instancePath || '/'} ${error.message ?? 'invalid'}`);
}
