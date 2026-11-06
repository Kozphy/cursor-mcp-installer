import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { formatSchemaErrors, validateMarketplaceSchema } from './schema.js';

export interface MarketplaceEntry {
  name: string;
  source: string;
  description?: string;
  minClientVersions?: Record<string, string>;
}

export interface MarketplaceFile {
  name: string;
  owner?: { name: string; email?: string };
  metadata?: { description?: string };
  plugins: MarketplaceEntry[];
}

export function loadMarketplace(filePath: string): { marketplace: MarketplaceFile; root: string } {
  const raw = JSON.parse(readFileSync(filePath, 'utf8')) as unknown;
  if (!validateMarketplaceSchema(raw)) {
    const details = formatSchemaErrors(validateMarketplaceSchema.errors).join('; ');
    throw new Error(`Marketplace schema invalid: ${details}`);
  }
  const marketplace = raw as MarketplaceFile;
  const names = new Set<string>();
  for (const plugin of marketplace.plugins) {
    if (names.has(plugin.name)) {
      throw new Error(`Duplicate plugin in marketplace: ${plugin.name}`);
    }
    names.add(plugin.name);
  }
  return { marketplace, root: resolve(filePath, '..') };
}

export function searchMarketplace(marketplace: MarketplaceFile, query: string): MarketplaceEntry[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return marketplace.plugins;
  return marketplace.plugins.filter((plugin) =>
    plugin.name.includes(needle) || (plugin.description ?? '').toLowerCase().includes(needle),
  );
}
