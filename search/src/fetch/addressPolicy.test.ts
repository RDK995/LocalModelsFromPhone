import { describe, it, expect } from "bun:test";
import { isPublicAddress } from "./addressPolicy";

describe("isPublicAddress", () => {
  const nonPublic = [
    // IPv4: loopback, RFC 1918, link-local, CGNAT / tailnet, unspecified, multicast, broadcast
    "127.0.0.1",
    "127.255.255.254",
    "10.0.0.1",
    "10.255.255.255",
    "172.16.0.1",
    "172.31.255.255",
    "192.168.0.1",
    "192.168.1.1",
    "169.254.169.254",
    "100.64.0.1",
    "100.100.100.100",
    "100.127.255.255",
    "0.0.0.0",
    "0.1.2.3",
    "224.0.0.1",
    "239.255.255.250",
    "240.0.0.1",
    "255.255.255.255",
    // IPv6: unspecified, loopback, ULA, link-local, multicast, IPv4-mapped / embedded forms
    "::",
    "::1",
    "0:0:0:0:0:0:0:1",
    "fc00::1",
    "fd12::1",
    "fd7a:115c:a1e0::1",
    "fe80::1",
    "fe80::1%en0",
    "febf::1",
    "fec0::1",
    "ff02::1",
    "::ffff:127.0.0.1",
    "::ffff:192.168.1.1",
    "::ffff:7f00:1",
    "::ffff:10.0.0.1",
    "::127.0.0.1",
    "64:ff9b::127.0.0.1",
    "2002:7f00:1::",
    "2001:db8::1",
    "2001::1",
    "100::1",
    // Not addresses at all: fail closed
    "",
    "localhost",
    "example.com",
    "1.2.3",
    "256.1.1.1",
    "1.2.3.4.5",
    "::ffff:1.2.3.4.5",
    "1::2::3",
    "gggg::1",
  ];
  for (const ip of nonPublic) {
    it(`rejects ${JSON.stringify(ip)}`, () => {
      expect(isPublicAddress(ip)).toBe(false);
    });
  }

  const publicAddrs = [
    "93.184.216.34",
    "1.1.1.1",
    "8.8.8.8",
    "172.15.255.255",
    "172.32.0.1",
    "100.63.255.255",
    "100.128.0.1",
    "2606:4700::1111",
    "2a00:1450:4009:81f::200e",
    "::ffff:93.184.216.34",
    "::ffff:5db8:d822",
    "64:ff9b::1.1.1.1",
  ];
  for (const ip of publicAddrs) {
    it(`accepts ${ip}`, () => {
      expect(isPublicAddress(ip)).toBe(true);
    });
  }
});
