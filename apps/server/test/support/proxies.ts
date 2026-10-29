import { createServer as createHttpServer } from 'node:http';
import { connect, createServer as createTcpServer, type AddressInfo, type Server, type Socket } from 'node:net';

export interface TestProxy {
  url: string;
  /** Tunnels opened, with their destination (`host:port`). */
  destinations: string[];
  authFailures: number;
  close(): Promise<void>;
}

interface Credentials {
  username?: string;
  password?: string;
}

function tunnel(client: Socket, host: string, port: number, onReady: () => void): void {
  const upstream = connect(port, host, () => {
    onReady();
    upstream.pipe(client);
    client.pipe(upstream);
  });
  upstream.on('error', () => client.destroy());
  client.on('error', () => upstream.destroy());
  client.on('close', () => upstream.destroy());
}

async function listen(server: Server, sockets: Set<Socket>) {
  server.on('connection', (socket: Socket) => {
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  const close = async () => {
    for (const socket of sockets) socket.destroy();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  };
  return { port, close };
}

/** HTTP proxy supporting CONNECT (what undici's ProxyAgent uses), with optional Basic auth. */
export async function startHttpProxy({ username, password }: Credentials = {}): Promise<TestProxy> {
  const destinations: string[] = [];
  const stats = { authFailures: 0 };
  const sockets = new Set<Socket>();
  const server = createHttpServer((_req, res) => res.writeHead(405).end());
  server.on('connect', (req, client: Socket, head: Buffer) => {
    sockets.add(client);
    if (username !== undefined) {
      const expected = `Basic ${Buffer.from(`${username}:${password ?? ''}`).toString('base64')}`;
      if (req.headers['proxy-authorization'] !== expected) {
        stats.authFailures += 1;
        client.end('HTTP/1.1 407 Proxy Authentication Required\r\n\r\n');
        return;
      }
    }
    const target = new URL(`http://${req.url ?? ''}`);
    destinations.push(`${target.hostname}:${target.port}`);
    tunnel(client, target.hostname, Number(target.port), () => {
      client.write('HTTP/1.1 200 Connection Established\r\n\r\n');
      if (head.length > 0) client.unshift(head);
    });
  });
  const { port, close } = await listen(server, sockets);
  const auth = username === undefined ? '' : `${username}:${password ?? ''}@`;
  return {
    url: `http://${auth}127.0.0.1:${port}`,
    destinations,
    get authFailures() {
      return stats.authFailures;
    },
    close,
  };
}

/** Minimal SOCKS5 server (RFC 1928 CONNECT, RFC 1929 username/password). */
export async function startSocksProxy({ username, password }: Credentials = {}): Promise<TestProxy> {
  const destinations: string[] = [];
  const stats = { authFailures: 0 };
  const sockets = new Set<Socket>();

  const server = createTcpServer((client) => {
    client.on('error', () => client.destroy());
    const onRequest = (request: Buffer) => {
      if (request[1] !== 0x01) return void client.end(Buffer.from([5, 7, 0, 1, 0, 0, 0, 0, 0, 0]));
      let host: string;
      let offset: number;
      if (request[3] === 0x01) {
        host = [...request.subarray(4, 8)].join('.');
        offset = 8;
      } else if (request[3] === 0x03) {
        const length = request[4] ?? 0;
        host = request.subarray(5, 5 + length).toString('utf8');
        offset = 5 + length;
      } else {
        return void client.end(Buffer.from([5, 8, 0, 1, 0, 0, 0, 0, 0, 0]));
      }
      const port = request.readUInt16BE(offset);
      destinations.push(`${host}:${port}`);
      tunnel(client, host, port, () => client.write(Buffer.from([5, 0, 0, 1, 0, 0, 0, 0, 0, 0])));
    };

    client.once('data', (greeting: Buffer) => {
      const methods = [...greeting.subarray(2, 2 + (greeting[1] ?? 0))];
      const method = username === undefined ? 0x00 : 0x02;
      if (greeting[0] !== 5 || !methods.includes(method)) return void client.end(Buffer.from([5, 0xff]));
      client.write(Buffer.from([5, method]));
      if (method === 0x00) return void client.once('data', onRequest);
      client.once('data', (auth: Buffer) => {
        const userLength = auth[1] ?? 0;
        const user = auth.subarray(2, 2 + userLength).toString('utf8');
        const passLength = auth[2 + userLength] ?? 0;
        const pass = auth.subarray(3 + userLength, 3 + userLength + passLength).toString('utf8');
        if (user !== username || pass !== (password ?? '')) {
          stats.authFailures += 1;
          return void client.end(Buffer.from([1, 1]));
        }
        client.write(Buffer.from([1, 0]));
        client.once('data', onRequest);
      });
    });
  });

  const { port, close } = await listen(server, sockets);
  const auth = username === undefined ? '' : `${username}:${password ?? ''}@`;
  return {
    url: `socks5://${auth}127.0.0.1:${port}`,
    destinations,
    get authFailures() {
      return stats.authFailures;
    },
    close,
  };
}

/** Stand-in for api.ipify.org. */
export async function startIpEcho(ip = '203.0.113.7'): Promise<{ url: string; close(): Promise<void> }> {
  const server = createHttpServer((_req, res) => {
    res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ ip }));
  });
  const { port, close } = await listen(server as unknown as Server, new Set());
  return { url: `http://127.0.0.1:${port}/?format=json`, close };
}
