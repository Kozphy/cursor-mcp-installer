export type RiskLevel = 'low' | 'high';

export interface CapabilityDecision {
  component: string;
  risk: RiskLevel;
  status: 'allowed' | 'approval_required' | 'rejected';
  detail: string;
}

const HIGH_RISK = new Set(['hooks', 'mcp_command']);

export function decideCapability(component: string, detail: string, approved: boolean): CapabilityDecision {
  if (HIGH_RISK.has(component) && !approved) {
    return {
      component,
      risk: 'high',
      status: 'approval_required',
      detail,
    };
  }
  return {
    component,
    risk: HIGH_RISK.has(component) ? 'high' : 'low',
    status: 'allowed',
    detail,
  };
}
