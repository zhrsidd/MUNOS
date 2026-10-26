import './lifecycle-registry.mjs';
// Preload for child-process tests: records and blocks every network attempt (fetch, sockets, DNS) and prints "NETWORK <what>" to stderr.
import net from 'node:net';
import dns from 'node:dns';
const record = (what) => { process.stderr.write(`NETWORK ${what}\n`); };
globalThis.fetch = async (input) => { record(`fetch ${typeof input === 'string' ? input : input?.url ?? String(input)}`); throw new TypeError('network blocked by test'); };
net.Socket.prototype.connect = function () { record('socket connect'); throw new Error('network blocked by test'); };
dns.lookup = function (host) { record(`dns ${host}`); throw new Error('network blocked by test'); };
