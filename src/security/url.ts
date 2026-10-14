import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import ipaddr from 'ipaddr.js';
import { WebPulseError } from '../core/errors.js';

const unsafe = () =>
  new WebPulseError('UNSAFE_URL', 'Only public HTTP(S) URLs on standard ports are allowed.');
const blockedV4 = [
  '0.0.0.0/8',
  '10.0.0.0/8',
  '100.64.0.0/10',
  '127.0.0.0/8',
  '169.254.0.0/16',
  '172.16.0.0/12',
  '192.0.0.0/24',
  '192.0.2.0/24',
  '192.88.99.0/24',
  '192.168.0.0/16',
  '198.18.0.0/15',
  '198.51.100.0/24',
  '203.0.113.0/24',
  '224.0.0.0/4',
  '240.0.0.0/4',
].map((cidr) => ipaddr.parseCIDR(cidr));
const blockedV6 = ['2001::/23', '2001:db8::/32', '2002::/16', '3fff::/20'].map((cidr) =>
  ipaddr.parseCIDR(cidr),
);
export function isPublicAddress(address: string): boolean {
  try {
    const parsed = ipaddr.parse(address);
    if (parsed.kind() === 'ipv4')
      return (
        parsed.range() === 'unicast' &&
        !blockedV4.some(([network, bits]) => parsed.match(network, bits))
      );
    // DNS64 may synthesize the globally defined NAT64 prefix. Validate its
    // embedded IPv4 destination, including metadata/private ranges, before use.
    if (parsed.match(ipaddr.parse('64:ff9b::'), 96))
      return isPublicAddress(parsed.toByteArray().slice(12).join('.'));
    return (
      parsed.range() === 'unicast' &&
      parsed.match(ipaddr.parse('2000::'), 3) &&
      !blockedV6.some(([network, bits]) => parsed.match(network, bits))
    );
  } catch {
    return false;
  }
}
export function publicUrl(input: string): URL {
  if (
    input.length > 8192 ||
    /[\s\\]/u.test(input) ||
    [...input].some((character) => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127)
  )
    throw unsafe();
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    throw unsafe();
  }
  const host = url.hostname
    .replace(/^\[|\]$/g, '')
    .toLowerCase()
    .replace(/\.$/, '');
  if (
    !['http:', 'https:'].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.port ||
    !host ||
    host.includes('%')
  )
    throw unsafe();
  if (isIP(host)) {
    if (!isPublicAddress(host)) throw unsafe();
  } else if (
    !host.includes('.') ||
    /(^|\.)(localhost|local|internal|lan|localdomain|home\.arpa|test|invalid|example)$/.test(
      host,
    ) ||
    host === 'instance-data'
  )
    throw unsafe();
  url.hash = '';
  return url;
}
export type Resolver = (hostname: string) => Promise<Array<{ address: string; family: number }>>;
export const defaultResolver: Resolver = (hostname) =>
  lookup(hostname, { all: true, verbatim: true });
/** The returned address is used directly by the socket, not resolved a second time. */
export async function resolvePublic(hostname: string, resolver: Resolver = defaultResolver) {
  const addresses = await resolver(hostname);
  if (!addresses.length || addresses.some(({ address }) => !isPublicAddress(address)))
    throw unsafe();
  return addresses;
}
