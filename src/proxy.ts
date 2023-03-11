import net from 'node:net'
import url from 'node:url'
import http, { IncomingMessage, ServerResponse } from 'node:http'
import type { Socket } from 'node:net'
import assert from 'node:assert'
import debugUtil from 'debug'
import pkg from '../package.json'
import { middleware } from './middleware/index'

interface CustomError extends Error {
	code?: string;
}


// log levels
const debug = {
	request: debugUtil('proxy ← ← ←'),
	response: debugUtil('proxy → → →'),
	proxyRequest: debugUtil('proxy ↑ ↑ ↑'),
	proxyResponse: debugUtil('proxy ↓ ↓ ↓')
}

// hostname
const hostname = require('os').hostname();

// proxy server version
const version = pkg.version;

/**
 * Sets up an `http.Server` or `https.Server` instance with the necessary
 * "request" and "connect" event listeners in order to make the server act as an
 * HTTP proxy.
 */

export function setup ({ port }: { port: number }) {
	const server = http.createServer()
	server.on('request', onrequest);
	server.on('connect', onconnect);
	server.listen(port, () => {
		console.log('HTTP(s) proxy server listening on port %d', port);
	})
	return server;
}

/**
 * 13.5.1 End-to-end and Hop-by-hop Headers
 *
 * Hop-by-hop headers must be removed by the proxy before passing it on to the
 * next endpoint. Per-request basis hop-by-hop headers MUST be listed in a
 * Connection header, (section 14.10) to be introduced into HTTP/1.1 (or later).
 */

const hopByHopHeaders = [
	'Connection',
	'Keep-Alive',
	'Proxy-Authenticate',
	'Proxy-Authorization',
	'TE',
	'Trailers',
	'Transfer-Encoding',
	'Upgrade'
];

// create a case-insensitive RegExp to match "hop by hop" headers
const isHopByHop = new RegExp('^(' + hopByHopHeaders.join('|') + ')$', 'i');

/**
 * Iterator function for the request/response's "headers".
 * Invokes `fn` for "each" header entry in the request.
 *
 * @api private
 */

function eachHeader (obj: Record<string, any>, fn: (key: string, value: any) => void) {
	if (Array.isArray(obj.rawHeaders)) {
		// ideal scenario... >= node v0.11.x
		// every even entry is a "key", every odd entry is a "value"
		let key: string | null = null;
		obj.rawHeaders.forEach(function (v) {
			if (key === null) {
				key = v;
			} else {
				fn(key, v);
				key = null;
			}
		});
	} else {
		// otherwise we can *only* proxy the header names as lowercase'd
		var headers = obj.headers;
		if (!headers) return;
		Object.keys(headers).forEach(function (key) {
			var value = headers[key];
			if (Array.isArray(value)) {
				// set-cookie
				value.forEach(function (val) {
					fn(key, val);
				});
			} else {
				fn(key, value);
			}
		});
	}
}

/**
 * HTTP GET/POST/DELETE/PUT, etc. proxy requests.
 */

function onrequest (req: IncomingMessage, res: ServerResponse) {
	debug.request('%s %s HTTP/%s ', req.method, req.url, req.httpVersion);

	const socket = req.socket;

	// pause the socket during authentication so no data is lost
	const parsed: Record<string, any> = new url.URL(req.url!);

	// proxy the request HTTP method
	parsed.method = req.method;

	// setup outbound proxy request HTTP headers
	const headers: Record<string, any> = {};
	var hasXForwardedFor = false;
	var hasVia = false;
	var via = '1.1 ' + hostname + ' (proxy/' + version + ')';

	parsed.headers = headers;
	eachHeader(req, function (key, value) {
		debug.request('Request Header: "%s: %s"', key, value);
		var keyLower = key.toLowerCase();

		if (!hasXForwardedFor && 'x-forwarded-for' === keyLower) {
			// append to existing "X-Forwarded-For" header
			// http://en.wikipedia.org/wiki/X-Forwarded-For
			hasXForwardedFor = true;
			value += ', ' + socket.remoteAddress;
			debug.proxyRequest(
				'appending to existing "%s" header: "%s"',
				key,
				value
			);
		}

		if (!hasVia && 'via' === keyLower) {
			// append to existing "Via" header
			hasVia = true;
			value += ', ' + via;
			debug.proxyRequest(
				'appending to existing "%s" header: "%s"',
				key,
				value
			);
		}

		if (isHopByHop.test(key)) {
			debug.proxyRequest('ignoring hop-by-hop header "%s"', key);
		} else {
			var v = headers[key];
			if (Array.isArray(v)) {
				v.push(value);
			} else if (null != v) {
				headers[key] = [v, value];
			} else {
				headers[key] = value;
			}
		}
	});

	// add "X-Forwarded-For" header if it's still not here by now
	// http://en.wikipedia.org/wiki/X-Forwarded-For
	if (!hasXForwardedFor) {
		headers['X-Forwarded-For'] = socket.remoteAddress;
		debug.proxyRequest(
			'adding new "X-Forwarded-For" header: "%s"',
			headers['X-Forwarded-For']
		);
	}

	// add "Via" header if still not set by now
	if (!hasVia) {
		headers.Via = via;
		debug.proxyRequest('adding new "Via" header: "%s"', headers.Via);
	}

	if (null == parsed.port) {
		// default the port number if not specified, for >= node v0.11.6...
		// https://github.com/joyent/node/issues/6199
		parsed.port = 80;
	}

	if ('http:' != parsed.protocol) {
		// only "http://" is supported, "https://" should use CONNECT method
		res.writeHead(400);
		res.end('Only "http:" protocol prefix is supported\n');
		return;
	}

	var gotResponse = false;
	var proxyReq = http.request(parsed);
	debug.proxyRequest('%s %s HTTP/1.1 ', proxyReq.method, proxyReq.path);

	proxyReq.on('response', function (proxyRes) {
		debug.proxyResponse('HTTP/1.1 %s', proxyRes.statusCode);
		gotResponse = true;

		const headers: Record<string, any> = {};

		middleware.forEach(fn => fn(req, proxyRes))

		eachHeader(proxyRes, function (key, value) {
			debug.proxyResponse(
				'Proxy Response Header: "%s: %s"',
				key,
				value
			);
			if (isHopByHop.test(key)) {
				debug.response('ignoring hop-by-hop header "%s"', key);
			} else {
				var v = headers[key];
				if (Array.isArray(v)) {
					v.push(value);
				} else if (null != v) {
					headers[key] = [v, value];
				} else {
					headers[key] = value;
				}
			}
		});

		debug.response('HTTP/1.1 %s', proxyRes.statusCode);
		res.writeHead(proxyRes.statusCode!, headers);
		proxyRes.pipe(res);
		res.on('finish', onfinish);
	});
	proxyReq.on('error', function (err) {
		debug.proxyResponse(
			'proxy HTTP request "error" event\n%s',
			err.stack || err
		);
		cleanup();
		if (gotResponse) {
			debug.response(
				'already sent a response, just destroying the socket...'
			);
			socket.destroy();
		} else if ('ENOTFOUND' === (err as any).code) {
			debug.response('HTTP/1.1 404 Not Found');
			res.writeHead(404);
			res.end();
		} else {
			debug.response('HTTP/1.1 500 Internal Server Error');
			res.writeHead(500);
			res.end();
		}
	});

	// if the client closes the connection prematurely,
	// then close the upstream socket
	function onclose () {
		debug.request(
			'client socket "close" event, aborting HTTP request to "%s"',
			req.url
		);
		proxyReq.abort();
		cleanup();
	}
	socket.on('close', onclose);

	function onfinish () {
		debug.response('"finish" event');
		cleanup();
	}

	function cleanup () {
		debug.response('cleanup');
		socket.removeListener('close', onclose);
		res.removeListener('finish', onfinish);
	}

	req.pipe(proxyReq);
}

/**
 * HTTP CONNECT proxy requests.
 */

function onconnect (req: IncomingMessage, socket: Socket, head: Buffer) {
	debug.request('%s %s HTTP/%s ', req.method, req.url, req.httpVersion);
	assert(
		!head || 0 == head.length,
		'"head" should be empty for proxy requests'
	);

	let res: ServerResponse | undefined = undefined;
	let target: Socket;
	var gotResponse = false;

	// define request socket event listeners
	socket.on('close', function onclientclose () {
		debug.request('HTTP request %s socket "close" event', req.url);
	});

	socket.on('end', function onclientend () {
		debug.request('HTTP request %s socket "end" event', req.url);
	});

	socket.on('error', function onclienterror (err) {
		debug.request(
			'HTTP request %s socket "error" event:\n%s',
			req.url,
			err.stack || err
		);
	});

	// define target socket event listeners
	function ontargetclose () {
		debug.proxyResponse('proxy target %s "close" event', req.url);
		socket.destroy();
	}

	function ontargetend () {
		debug.proxyResponse('proxy target %s "end" event', req.url);
	}

	function ontargeterror (err: CustomError) {
		debug.proxyResponse(
			'proxy target %s "error" event:\n%s',
			req.url,
			err.stack || err
		);
		if (gotResponse) {
			debug.response(
				'already sent a response, just destroying the socket...'
			);
			socket.destroy();
		} else if ('ENOTFOUND' == err.code) {
			debug.response('HTTP/1.1 404 Not Found');
			res!.writeHead(404);
			res!.end();
		} else {
			debug.response('HTTP/1.1 500 Internal Server Error');
			res!.writeHead(500);
			res!.end();
		}
	}

	function ontargetconnect () {
		debug.proxyResponse('proxy target %s "connect" event', req.url);
		debug.response('HTTP/1.1 200 Connection established');
		gotResponse = true;
		res!.removeListener('finish', onfinish);

		res!.writeHead(200, 'Connection established');
		res!.flushHeaders();

		// relinquish control of the `socket` from the ServerResponse instance
		res!.detachSocket(socket);

		// nullify the ServerResponse object, so that it can be cleaned
		// up before this socket proxying is completed
		res = undefined;

		socket.pipe(target);
		target.pipe(socket);
	}

	// create the `res` instance for this request since Node.js
	// doesn't provide us with one :(
	// XXX: this is undocumented API, so it will break some day (ノಠ益ಠ)ノ彡┻━┻
	res = new http.ServerResponse(req);
	res.shouldKeepAlive = false;
	res.chunkedEncoding = false;
	res.useChunkedEncodingByDefault = false;
	res.assignSocket(socket);

	// called for the ServerResponse's "finish" event
	// XXX: normally, node's "http" module has a "finish" event listener that would
	// take care of closing the socket once the HTTP response has completed, but
	// since we're making this ServerResponse instance manually, that event handler
	// never gets hooked up, so we must manually close the socket...
	function onfinish () {
		debug.response('response "finish" event');
		res!.detachSocket(socket);
		socket.end();
	}
	res.once('finish', onfinish);

	var parts = req.url!.split(':');
	var host = parts[0];
	var port = +parts[1];
	var opts = { host: host, port: port };

	debug.proxyRequest('connecting to proxy target %j', opts);
	target = net.connect(opts);
	target.on('connect', ontargetconnect);
	target.on('close', ontargetclose);
	target.on('error', ontargeterror);
	target.on('end', ontargetend);
}
