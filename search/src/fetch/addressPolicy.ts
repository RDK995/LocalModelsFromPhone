/**
 * Public-address classifier for the SSRF guard (FR21, I18).
 *
 * `isPublicAddress(ip)` returns true only for an IP address that is safe to connect to from the
 * search service: a globally routable unicast address. Anything else — loopback, RFC 1918,
 * link-local, CGNAT / tailnet (100.64.0.0/10, incl. 100.100.100.100), unspecified, multicast,
 * broadcast, reserved/documentation ranges, the IPv6 equivalents, and IPv6 forms that embed an
 * IPv4 address (IPv4-mapped, IPv4-compatible, NAT64, 6to4) whose embedded address is non-public —
 * returns false. Input that is not a well-formed IP address also returns false (fail closed).
 *
 * Hand-written CIDR checks, no dependencies.
 */

type Cidr4 = readonly [base: number, prefix: number];

/** IPv4 ranges that are never a public destination. */
const BLOCKED_V4: readonly Cidr4[] = [
  [v4("0.0.0.0"), 8], // "this network" / unspecified
  [v4("10.0.0.0"), 8], // RFC 1918
  [v4("100.64.0.0"), 10], // CGNAT; Tailscale tailnet + 100.100.100.100 live here
  [v4("127.0.0.0"), 8], // loopback
  [v4("169.254.0.0"), 16], // link-local (incl. cloud metadata 169.254.169.254)
  [v4("172.16.0.0"), 12], // RFC 1918
  [v4("192.0.0.0"), 24], // IETF protocol assignments
  [v4("192.0.2.0"), 24], // TEST-NET-1
  [v4("192.88.99.0"), 24], // 6to4 relay anycast (deprecated)
  [v4("192.168.0.0"), 16], // RFC 1918
  [v4("198.18.0.0"), 15], // benchmarking
  [v4("198.51.100.0"), 24], // TEST-NET-2
  [v4("203.0.113.0"), 24], // TEST-NET-3
  [v4("224.0.0.0"), 4], // multicast
  [v4("240.0.0.0"), 4], // reserved + 255.255.255.255 broadcast
];

export function isPublicAddress(ip: string): boolean {
  if (typeof ip !== "string") return false;
  // Drop an IPv6 zone id ("fe80::1%en0"); the address part alone decides.
  const pct = ip.indexOf("%");
  const addr = pct >= 0 ? ip.slice(0, pct) : ip;

  const n4 = parseIPv4(addr);
  if (n4 !== null) return isPublicV4(n4);

  const h = parseIPv6(addr);
  if (h !== null) return isPublicV6(h);

  return false;
}

function isPublicV4(n: number): boolean {
  for (const [base, prefix] of BLOCKED_V4) {
    if (inCidr4(n, base, prefix)) return false;
  }
  return true;
}

function isPublicV6(h: number[]): boolean {
  // First 80 bits zero: ::, ::1, IPv4-compatible (::a.b.c.d) and IPv4-mapped (::ffff:a.b.c.d).
  if (h[0] === 0 && h[1] === 0 && h[2] === 0 && h[3] === 0 && h[4] === 0) {
    if (h[5] === 0xffff) return isPublicV4(embeddedV4(h[6], h[7])); // IPv4-mapped
    // Unspecified, loopback and deprecated IPv4-compatible: never a public destination.
    return false;
  }
  // NAT64 well-known prefix 64:ff9b::/96 — decide by the embedded IPv4 address.
  if (h[0] === 0x0064 && h[1] === 0xff9b && h[2] === 0 && h[3] === 0 && h[4] === 0 && h[5] === 0) {
    return isPublicV4(embeddedV4(h[6], h[7]));
  }
  // 6to4 2002::/16 — embedded IPv4 in bits 16..48.
  if (h[0] === 0x2002) return isPublicV4(embeddedV4(h[1], h[2]));

  // Only global unicast 2000::/3 can be public. This excludes fc00::/7 (ULA), fe80::/10
  // (link-local), fec0::/10 (site-local), ff00::/8 (multicast), 100::/64 (discard), etc.
  if ((h[0] & 0xe000) !== 0x2000) return false;
  // Within 2000::/3: Teredo 2001::/32 (tunnels to arbitrary IPv4), ORCHID / benchmarking
  // 2001:0000::/23 region, and documentation 2001:db8::/32.
  if (h[0] === 0x2001 && h[1] < 0x0200) return false;
  if (h[0] === 0x2001 && h[1] === 0x0db8) return false;
  return true;
}

function embeddedV4(hi: number, lo: number): number {
  return ((hi << 16) | lo) >>> 0;
}

function inCidr4(n: number, base: number, prefix: number): boolean {
  if (prefix === 0) return true;
  const mask = (0xffffffff << (32 - prefix)) >>> 0;
  return ((n & mask) >>> 0) === ((base & mask) >>> 0);
}

function v4(s: string): number {
  const n = parseIPv4(s);
  if (n === null) throw new Error(`bad IPv4 constant ${s}`);
  return n;
}

/** Strict dotted-quad parser (four decimal octets). Returns the 32-bit value or null. */
function parseIPv4(s: string): number | null {
  const parts = s.split(".");
  if (parts.length !== 4) return null;
  let n = 0;
  for (const p of parts) {
    if (!/^\d{1,3}$/.test(p)) return null;
    const v = Number(p);
    if (v > 255) return null;
    n = n * 256 + v;
  }
  return n >>> 0;
}

/** IPv6 parser (with "::" compression and optional trailing dotted IPv4). Returns 8 hextets or null. */
function parseIPv6(s: string): number[] | null {
  if (!s.includes(":")) return null;
  const dbl = s.indexOf("::");
  if (dbl !== s.lastIndexOf("::")) return null;

  const parseSide = (side: string, allowV4Tail: boolean): number[] | null => {
    if (side === "") return [];
    const groups = side.split(":");
    const out: number[] = [];
    for (let i = 0; i < groups.length; i++) {
      const g = groups[i];
      if (allowV4Tail && i === groups.length - 1 && g.includes(".")) {
        const n = parseIPv4(g);
        if (n === null) return null;
        out.push(n >>> 16, n & 0xffff);
      } else {
        if (!/^[0-9a-fA-F]{1,4}$/.test(g)) return null;
        out.push(parseInt(g, 16));
      }
    }
    return out;
  };

  if (dbl >= 0) {
    const head = parseSide(s.slice(0, dbl), false);
    const tail = parseSide(s.slice(dbl + 2), true);
    if (head === null || tail === null) return null;
    const missing = 8 - head.length - tail.length;
    if (missing < 1) return null;
    return [...head, ...new Array<number>(missing).fill(0), ...tail];
  }
  const all = parseSide(s, true);
  if (all === null || all.length !== 8) return null;
  return all;
}
