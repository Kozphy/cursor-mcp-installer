export function compareSemver(left: string, right: string): number {
  const parse = (value: string) => value.split('-')[0].split('.').map((part) => Number(part));
  const a = parse(left);
  const b = parse(right);
  for (let i = 0; i < 3; i++) {
    const delta = (a[i] ?? 0) - (b[i] ?? 0);
    if (delta !== 0) return delta > 0 ? 1 : -1;
  }
  return 0;
}

export function checkClientCompatibility(
  requirements: Record<string, string> | undefined,
  client: string,
  clientVersion: string,
): { compatible: boolean; reason: string } {
  if (!requirements || !(client in requirements)) {
    return { compatible: true, reason: 'no minimum declared for client' };
  }
  const required = requirements[client];
  if (required === 'never') {
    return { compatible: false, reason: `${client} is excluded by minClientVersions=never` };
  }
  if (compareSemver(clientVersion, required) < 0) {
    return { compatible: false, reason: `${client} ${clientVersion} is below required ${required}` };
  }
  return { compatible: true, reason: `${client} ${clientVersion} satisfies ${required}` };
}
