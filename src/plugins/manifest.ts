import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { formatSchemaErrors, validatePluginSchema } from './schema.js';

export interface PluginManifest {
  name: string;
  displayName?: string;
  description?: string;
  version?: string;
  author?: { name: string; email?: string };
  publisher?: string;
  license?: string;
  repository?: string;
  homepage?: string;
  minClientVersions?: Record<string, string>;
  commands?: string | string[];
  skills?: string | string[];
  rules?: string | string[];
  agents?: string | string[];
  hooks?: string | Record<string, unknown>;
  variables?: {
    type: 'object';
    properties?: Record<string, { type?: string }>;
    required?: string[];
  };
  mcpServers?: string | Record<string, unknown> | Array<string | Record<string, unknown>>;
}

export interface ManifestDiagnostic {
  level: 'error' | 'warning';
  code: string;
  message: string;
}

export function readPluginManifest(pluginRoot: string): { manifest: PluginManifest | null; diagnostics: ManifestDiagnostic[] } {
  const file = join(pluginRoot, '.cursor-plugin', 'plugin.json');
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(file, 'utf8'));
  } catch (err) {
    return {
      manifest: null,
      diagnostics: [{ level: 'error', code: 'MANIFEST_UNREADABLE', message: err instanceof Error ? err.message : String(err) }],
    };
  }
  if (!validatePluginSchema(raw)) {
    return {
      manifest: null,
      diagnostics: formatSchemaErrors(validatePluginSchema.errors).map((message) => ({
        level: 'error' as const,
        code: 'SCHEMA_INVALID',
        message,
      })),
    };
  }
  return { manifest: raw as PluginManifest, diagnostics: [] };
}

export function asPathList(value: string | string[] | undefined): string[] {
  if (!value) return [];
  return Array.isArray(value) ? value : [value];
}
