import { readFile, writeFile } from 'fs/promises';
import { existsSync } from 'fs';
import { resolve, parse as parsePath } from 'path';
import { createServer } from 'http';
import ws from 'ws';
import { parse as parseURL } from 'url';
import { contentType } from 'mime-types';

const modulePath = parsePath(import.meta.url);

const MESSAGE_PATH = resolve(modulePath.dir, 'messages.json');
const STATIC_CONTENT = resolve(modulePath.dir, '../../client');

// top level await not yet support for all nodejs runtimes
async function init() {
    const messages = existsSync(MESSAGE_PATH) ? JSON.parse(await readFile(MESSAGE_PATH, { encoding: 'utf-8' })) : [];
    const connectedClients = new Set();

    // create websocket server
    const webSocketServer = new ws.Server({ noServer: true });

    // create http server
    const httpServer = createServer(async (req, res) => {
        const url = parseURL(req.url, true);
        const path = url.path === '/' ? '/index.html' : url.path;
        if (req.method === 'GET' && path.startsWith('/messages')) {
            res.setHeader('Content-Type', 'application/json');
            res.writeHead(200);
            res.end(JSON.stringify(messages));
        } else if (req.method === 'GET' && existsSync(resolve(STATIC_CONTENT, path.substr(1)))) {
            const fileInfo = parsePath(resolve(STATIC_CONTENT, path.substr(1)));
            res.setHeader('Content-Type', contentType(fileInfo.ext) || 'application/octet-stream');
            res.writeHead(200);
            res.end(await readFile(resolve(fileInfo.dir, fileInfo.base)));
        } else {
            res.writeHead(404, 'Not Found');
            res.end();
        }
    });
    httpServer.on('upgrade', (req, socket, header) => {
        if (req.method === 'GET' && req.url.startsWith('/ws')) {
            webSocketServer.handleUpgrade(req, socket, header, (client) => {
                console.log('new client connected');
                webSocketServer.emit('connection', client, req);
                connectedClients.add(client);
                client.on('message', (data) => {
                    const message = data;
                    messages.push(message);
                    for (const connectedClient of connectedClients.keys()) {
                        try {
                            connectedClient.send(data);
                        } catch (e) { }
                    }
                });
                client.on('close', () => {
                    console.log('client disconnected');
                    connectedClients.delete(client);
                });
                client.on('error', () => {
                    console.log('client error - disconnected');
                    connectedClients.delete(client);
                });
            })
        } else {
            socket.destroy();
        }
    });
    httpServer.listen(8080, '0.0.0.0', () => {
        console.log(`Server started...`);
    });

    process.on('SIGINT', async () => {
        await writeFile(MESSAGE_PATH, JSON.stringify(messages), { encoding: 'utf8' });
        process.exit(0);
    })
}
init();
