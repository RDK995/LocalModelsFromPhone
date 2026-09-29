/**
 * Search service entry point: 127.0.0.1:7790 (loopback host is not overridable).
 * Test-only override: SEARCH_PORT (listen port).
 */
import { startServer } from "./http/server";

const DEFAULT_PORT = 7790;
const port = process.env.SEARCH_PORT ? Number(process.env.SEARCH_PORT) : DEFAULT_PORT;

const server = startServer(port);
console.log(`search service listening on http://${server.hostname}:${server.port}`);
