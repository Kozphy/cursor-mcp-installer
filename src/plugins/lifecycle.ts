export const LIFECYCLE = [
  'DISCOVER',
  'VALIDATE',
  'RESOLVE',
  'INSPECT',
  'PLAN',
  'APPROVE',
  'STAGE',
  'VERIFY',
  'COMMIT',
  'AUDIT',
] as const;

export type LifecycleStage = (typeof LIFECYCLE)[number];

export interface StageResult {
  stage: LifecycleStage;
  status: 'ok' | 'failed' | 'blocked';
  detail: string;
}
