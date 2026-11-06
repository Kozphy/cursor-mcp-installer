export interface ApprovalSet {
  hooks: boolean;
  remote: boolean;
  mcpWrite: boolean;
}

export function approvalsFromFlags(flags: {
  approveHooks?: boolean;
  approveRemote?: boolean;
  writeMcp?: boolean;
}): ApprovalSet {
  return {
    hooks: flags.approveHooks === true,
    remote: flags.approveRemote === true,
    mcpWrite: flags.writeMcp === true,
  };
}
