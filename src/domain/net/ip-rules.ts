/**
 * Which addresses Radar refuses to fetch from.
 *
 * Radar fetches URLs that ultimately come from the internet, so server-side
 * request forgery is a first-order risk: a crafted source could otherwise make
 * the server read its own cloud metadata endpoint, or reach a service on the
 * private network that has no authentication because it was never meant to be
 * reachable from outside.
 *
 * Kept pure and separate so the whole table can be asserted against a list of
 * hostile inputs without a network or a DNS resolver.
 */

export interface BlockedRange {
  cidr: string;
  reason: string;
}

export const BLOCKED_IPV4: BlockedRange[] = [
  { cidr: '0.0.0.0/8', reason: 'this host' },
  { cidr: '10.0.0.0/8', reason: 'private network' },
  { cidr: '100.64.0.0/10', reason: 'carrier-grade NAT' },
  { cidr: '127.0.0.0/8', reason: 'loopback' },
  { cidr: '169.254.0.0/16', reason: 'link-local, including cloud metadata' },
  { cidr: '172.16.0.0/12', reason: 'private network' },
  { cidr: '192.0.0.0/24', reason: 'IETF protocol assignments' },
  { cidr: '192.0.2.0/24', reason: 'documentation range' },
  { cidr: '192.168.0.0/16', reason: 'private network' },
  { cidr: '198.18.0.0/15', reason: 'benchmarking range' },
  { cidr: '224.0.0.0/4', reason: 'multicast' },
  { cidr: '240.0.0.0/4', reason: 'reserved' },
];

export const BLOCKED_IPV6: BlockedRange[] = [
  { cidr: '::/128', reason: 'unspecified address' },
  { cidr: '::1/128', reason: 'loopback' },
  { cidr: 'fc00::/7', reason: 'unique local address' },
  { cidr: 'fe80::/10', reason: 'link-local' },
  { cidr: 'ff00::/8', reason: 'multicast' },
  { cidr: '2001:db8::/32', reason: 'documentation range' },
];

/** Addresses that are routable but must still never be fetched. */
export const BLOCKED_EXACT = new Map<string, string>([
  ['169.254.169.254', 'cloud instance metadata'],
  ['fd00:ec2::254', 'cloud instance metadata'],
  ['100.100.100.200', 'cloud instance metadata'],
  ['192.0.0.192', 'cloud instance metadata'],
]);

export interface AddressVerdict {
  allowed: boolean;
  reason: string | null;
}

export function checkAddress(address: string, family: 4 | 6): AddressVerdict {
  const normalised = normaliseAddress(address);

  const exact = BLOCKED_EXACT.get(normalised);
  if (exact) return { allowed: false, reason: `${normalised} is ${exact}` };

  // An IPv4 address expressed in IPv6 form still points at the same host, so it
  // has to be unwrapped before the IPv4 rules can apply.
  const mapped = unwrapIpv4Mapped(normalised);
  if (mapped) return checkAddress(mapped, 4);

  if (family === 4) {
    const value = ipv4ToNumber(normalised);
    if (value === null) return { allowed: false, reason: `${address} is not a valid IPv4 address` };

    for (const range of BLOCKED_IPV4) {
      if (ipv4InCidr(value, range.cidr)) {
        return { allowed: false, reason: `${normalised} is in ${range.cidr} (${range.reason})` };
      }
    }
    return { allowed: true, reason: null };
  }

  const bytes = ipv6ToBytes(normalised);
  if (!bytes) return { allowed: false, reason: `${address} is not a valid IPv6 address` };

  for (const range of BLOCKED_IPV6) {
    if (ipv6InCidr(bytes, range.cidr)) {
      return { allowed: false, reason: `${normalised} is in ${range.cidr} (${range.reason})` };
    }
  }

  return { allowed: true, reason: null };
}

function normaliseAddress(address: string): string {
  // Strip an IPv6 zone identifier: fe80::1%eth0 is the same address as fe80::1.
  return address.trim().toLowerCase().split('%')[0] ?? '';
}

function unwrapIpv4Mapped(address: string): string | null {
  const match = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(address);
  if (match) return match[1] ?? null;

  // The hex form of the same thing, e.g. ::ffff:7f00:1 for 127.0.0.1.
  const hex = /^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/.exec(address);
  if (!hex) return null;

  const high = Number.parseInt(hex[1]!, 16);
  const low = Number.parseInt(hex[2]!, 16);
  return [high >> 8, high & 0xff, low >> 8, low & 0xff].join('.');
}

export function ipv4ToNumber(address: string): number | null {
  const parts = address.split('.');
  if (parts.length !== 4) return null;

  let value = 0;
  for (const part of parts) {
    // Leading zeros are rejected deliberately: some resolvers read 0177.0.0.1
    // as octal, which would smuggle a loopback address past a decimal parse.
    if (!/^\d{1,3}$/.test(part) || (part.length > 1 && part.startsWith('0'))) return null;
    const octet = Number(part);
    if (octet > 255) return null;
    value = value * 256 + octet;
  }
  return value;
}

function ipv4InCidr(value: number, cidr: string): boolean {
  const [base, bitsText] = cidr.split('/');
  const baseValue = ipv4ToNumber(base ?? '');
  const bits = Number(bitsText);
  if (baseValue === null || !Number.isInteger(bits)) return false;
  if (bits === 0) return true;

  const mask = (0xffffffff << (32 - bits)) >>> 0;
  return ((value & mask) >>> 0) === ((baseValue & mask) >>> 0);
}

export function ipv6ToBytes(address: string): Uint8Array | null {
  const halves = address.split('::');
  if (halves.length > 2) return null;

  const parse = (text: string): number[] | null => {
    if (!text) return [];
    const groups: number[] = [];
    for (const part of text.split(':')) {
      if (!/^[0-9a-f]{1,4}$/.test(part)) return null;
      groups.push(Number.parseInt(part, 16));
    }
    return groups;
  };

  const head = parse(halves[0] ?? '');
  const tail = halves.length === 2 ? parse(halves[1] ?? '') : [];
  if (head === null || tail === null) return null;

  const total = head.length + tail.length;
  if (total > 8 || (halves.length === 1 && total !== 8)) return null;

  const groups = [...head, ...Array<number>(8 - total).fill(0), ...tail];
  const bytes = new Uint8Array(16);
  groups.forEach((group, index) => {
    bytes[index * 2] = group >> 8;
    bytes[index * 2 + 1] = group & 0xff;
  });
  return bytes;
}

function ipv6InCidr(bytes: Uint8Array, cidr: string): boolean {
  const [base, bitsText] = cidr.split('/');
  const baseBytes = ipv6ToBytes(base ?? '');
  const bits = Number(bitsText);
  if (!baseBytes || !Number.isInteger(bits)) return false;

  const fullBytes = Math.floor(bits / 8);
  for (let index = 0; index < fullBytes; index += 1) {
    if (bytes[index] !== baseBytes[index]) return false;
  }

  const remaining = bits % 8;
  if (remaining === 0) return true;

  const mask = (0xff << (8 - remaining)) & 0xff;
  return (bytes[fullBytes]! & mask) === (baseBytes[fullBytes]! & mask);
}
