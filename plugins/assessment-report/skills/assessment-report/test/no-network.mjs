// Preloaded with --import: any attempt to open a network connection or spawn a process fails the run loudly.
import dns from "node:dns";
import net from "node:net";
import tls from "node:tls";
import http from "node:http";
import https from "node:https";
import child from "node:child_process";

const deny = (what) => () => {
  throw new Error(`NETWORK-OR-PROCESS-ACCESS-ATTEMPTED: ${what}`);
};
globalThis.fetch = deny("fetch");
net.Socket.prototype.connect = deny("net.Socket.connect");
net.connect = deny("net.connect");
tls.connect = deny("tls.connect");
http.request = deny("http.request");
https.request = deny("https.request");
dns.lookup = deny("dns.lookup");
for (const k of ["spawn", "spawnSync", "exec", "execSync", "execFile", "execFileSync", "fork"]) child[k] = deny(`child_process.${k}`);
