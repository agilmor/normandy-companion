// A static server for playing locally: node serve.mjs [port], then open http://localhost:8061/
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { dirname, extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(fileURLToPath(import.meta.url));
const port = Number(process.argv[2] ?? 8061);
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.json': 'application/json', '.css': 'text/css',
    '.svg': 'image/svg+xml', '.png': 'image/png', '.wav': 'audio/wav', '.ogg': 'audio/ogg', '.txt': 'text/plain' };
createServer(async (req, res) => {
    const path = normalize(decodeURIComponent(new URL(req.url, 'http://x').pathname)).replace(/^([/\\])+/, '');
    if (path.startsWith('..')) return res.writeHead(403).end();
    try {
        const file = path || 'index.html';
        const body = await readFile(join(ROOT, file));
        res.writeHead(200, { 'content-type': (TYPES[extname(file)] ?? 'application/octet-stream') + '; charset=utf-8' }).end(body);
    } catch {
        res.writeHead(404).end('not found');
    }
}).listen(port, () => console.log(`http://localhost:${port}/`));
