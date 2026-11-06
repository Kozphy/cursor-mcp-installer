export const CURSOR_PLUGINS_SCHEMA_SHA = '2776ddd2355d6d6c8747d3964600f28daf62f049';

export interface Provenance {
  kind: 'local-path' | 'git-commit';
  identity: string;
  revision: string;
  schemaSha: string;
}

export function localProvenance(identity: string, revision: string): Provenance {
  return {
    kind: 'local-path',
    identity,
    revision,
    schemaSha: CURSOR_PLUGINS_SCHEMA_SHA,
  };
}
