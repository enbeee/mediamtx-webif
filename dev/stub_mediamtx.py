#!/usr/bin/env python3
"""Minimal MediaMTX API stub for testing the web UI. Python stdlib only.

Serves the app statically from the repo root AND fakes the MediaMTX v1.21
control API (auth, pagination, CORS, in-memory state) on one port.

Usage: python3 dev/stub_mediamtx.py [port]     (default 8099)
Credentials: admin / mypassword   (override: STUB_USER / STUB_PASS env)
Inject errors by appending &__err=500 (or ?__err=401) to any API request.
"""
import base64
import json
import os
import sys
import urllib.parse
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8099
HOST = '127.0.0.1'
USER = os.environ.get('STUB_USER', 'admin')
PASS = os.environ.get('STUB_PASS', 'mypassword')
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

CONTENT_TYPES = {
    '.html': 'text/html; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.json': 'application/json',
    '.png': 'image/png',
    '.svg': 'image/svg+xml',
    '.ico': 'image/x-icon',
}

def user_with_api_perms(name):
    return {
        'user': name, 'pass': PASS, 'ips': [],
        'permissions': [{'action': a, 'path': ''} for a in
                        ['publish', 'read', 'playback', 'api', 'metrics', 'pprof']],
    }

STATE = {
    'info': {'version': 'v1.21.1', 'startUtc': '2026-10-01T10:00:00Z'},
    'global': {
        'logLevel': 'info',
        'authMethod': 'internal',
        'authInternalUsers': [user_with_api_perms(USER)],
        'api': {'enabled': True, 'address': ':' + str(PORT)},
        'apiAddress': ':' + str(PORT),
        'metrics': {'enabled': True, 'address': ':' + str(PORT)},
        'metricsAddress': ':' + str(PORT),
        'pprof': {'enabled': False, 'address': ':9999'},
        'pprofAddress': ':9999',
        'playback': {'enabled': True, 'address': ':' + str(PORT)},
        'playbackAddress': ':' + str(PORT),
        'rtsp': True, 'rtspAddress': ':8554',
        'rtmp': True, 'rtmpAddress': ':1935',
        'srt': True, 'srtAddress': ':8890',
        'hls': True, 'hlsAddress': ':59998', 'hlsEncryption': False,
        'webrtc': True, 'webrtcAddress': ':59999', 'webrtcEncryption': False,
        'moq': True, 'moqHTTP2Address': ':8080',
        'pathDefaults': {'record': False, 'recordPath': '%path/%Y-%m-%d_%H-%M-%S-%f'},
        'paths': {},
    },
    'pathDefaults': {'record': False, 'recordPath': '%path/%Y-%m-%d_%H-%M-%S-%f'},
    'paths': {
        'cam1': {'name': 'cam1', 'source': 'publisher', 'record': True,
                 'recordPath': '%path/%Y-%m-%d_%H-%M-%S-%f', 'sourceOnDemand': False},
        'cam2': {'name': 'cam2', 'source': 'rtsp://192.168.1.42:554/stream', 'record': False,
                 'sourceOnDemand': True, 'maxReaders': 4},
        'all_others': {'name': 'all_others', 'source': 'publisher', 'record': False},
    },
    'recordings': [
        {'name': 'cam1', 'segments': [
            {'start': '2026-10-01T09:00:00Z', 'duration': 60.0, 'size': 15728640},
            {'start': '2026-10-01T09:01:00Z', 'duration': 60.0, 'size': 16252928},
            {'start': '2026-10-01T09:02:00Z', 'duration': 42.5, 'size': 11534336},
        ]},
        {'name': 'cam2', 'segments': [
            {'start': '2026-09-30T22:10:00Z', 'duration': 120.0, 'size': 31457280},
        ]},
    ],
    'bytes_counter': 1_234_567_890,
    'patches': [],
    'deleted_segments': [],
}

def runtime_paths():
    STATE['bytes_counter'] += 2_400_000  # simulate traffic so bitrates move
    return [
        {
            'name': 'cam1', 'confName': 'cam1', 'available': True,
            'availableTime': '2026-10-01T10:05:00Z', 'online': True, 'onlineTime': '2026-10-01T10:05:00Z',
            'source': {'id': 'rtsp-1', 'type': 'RTSP session'},
            'tracks2': [{'codec': 'H264', 'width': 1920, 'height': 1080}, {'codec': 'Opus'}],
            'readers': [{'id': 'hls-s1', 'type': 'HLS'}, {'id': 'wrtc-s1', 'type': 'WebRTC'}],
            'inboundBytes': STATE['bytes_counter'], 'outboundBytes': 87_654_321,
        },
        {
            'name': 'cam2', 'confName': 'cam2', 'available': False, 'online': False,
            'source': {'id': '', 'type': 'inactive'}, 'tracks2': [], 'readers': [],
            'inboundBytes': 0, 'outboundBytes': 0,
        },
        {
            'name': 'ad-hoc-stream', 'confName': 'all_others', 'available': True,
            'availableTime': '2026-10-01T11:00:00Z', 'online': True, 'onlineTime': '2026-10-01T11:00:00Z',
            'source': {'id': 'rtsp-9', 'type': 'RTSP session'},
            'tracks2': [{'codec': 'H265'}], 'readers': [],
            'inboundBytes': 52_428_800, 'outboundBytes': 0,
        },
    ]

SESSIONS = {
    'rtspconns': [{'id': 'rtsp-c1', 'state': 'idle', 'ip': '192.168.1.50',
                   'created': '2026-10-01T10:04:11Z'}],
    'rtspsessions': [
        {'id': 'rtsp-s1', 'state': 'publish', 'path': 'cam1', 'user': 'cam-user',
         'remoteAddr': '192.168.1.50:44812', 'inboundBytes': 1_024_000_000,
         'outboundBytes': 0, 'created': '2026-10-01T10:05:00Z'},
        {'id': 'rtsp-s2', 'state': 'read', 'path': 'cam1', 'user': 'view',
         'remoteAddr': '192.168.1.77:50110', 'inboundBytes': 0,
         'outboundBytes': 430_000_000, 'created': '2026-10-01T10:12:40Z'},
    ],
    'rtmpconns': [{'id': 'rtmp-c1', 'state': 'read', 'path': 'cam1', 'user': 'view',
                   'remoteAddr': '10.0.0.5:39114', 'inboundBytes': 0,
                   'outboundBytes': 98_000_000, 'created': '2026-10-01T10:20:00Z'}],
    'srtconns': [],
    'webrtcsessions': [{'id': 'wrtc-s1', 'state': 'read', 'path': 'cam1', 'user': 'admin',
                        'remoteAddr': '192.168.1.2:52133', 'inboundBytes': 0,
                        'outboundBytes': 12_000_000, 'created': '2026-10-01T11:00:00Z'}],
    'hlsmuxers': [{'id': 'm1', 'path': 'cam1'}],
    'hlssessions': [{'id': 'hls-s1', 'state': 'read', 'path': 'cam1', 'user': '',
                     'ip': '192.168.1.9', 'inboundBytes': 0, 'outboundBytes': 3_300_000,
                     'created': '2026-10-01T11:01:12Z'}],
    'moqsessions': [{'id': 'moq-s1', 'state': 'read', 'path': 'cam1', 'user': 'admin',
                     'remoteAddr': '192.168.1.2', 'inboundBytes': 0, 'outboundBytes': 900_000,
                     'created': '2026-10-01T11:02:00Z'}],
    'rtspsconns': [],
    'rtspssessions': [],
    'rtmpsconns': [],
}

# v1.21 nested route (proto, kind) -> internal collection key
NESTED = {
    ('rtsp', 'conns'): 'rtspconns',
    ('rtsp', 'sessions'): 'rtspsessions',
    ('rtsps', 'conns'): 'rtspsconns',
    ('rtsps', 'sessions'): 'rtspssessions',
    ('rtmp', 'conns'): 'rtmpconns',
    ('rtmps', 'conns'): 'rtmpsconns',
    ('srt', 'conns'): 'srtconns',
    ('webrtc', 'sessions'): 'webrtcsessions',
    ('hls', 'sessions'): 'hlssessions',
    ('hls', 'muxers'): 'hlsmuxers',
    ('moq', 'sessions'): 'moqsessions',
}


def resolve_collection(parts):
    """Map a list/get/kick route's leading parts to a collection key."""
    if len(parts) == 2 and parts[0] in SESSIONS:
        return parts[0]
    if len(parts) >= 3:
        key = NESTED.get((parts[0], parts[1]))
        if key:
            return key
    return None

PROM_METRICS = """# HELP mediamtx_paths Paths.
# TYPE mediamtx_paths gauge
mediamtx_paths{state="idle"} 1
mediamtx_paths{state="ready"} 2
# HELP mediamtx_hls_muxers HLS muxers.
# TYPE mediamtx_hls_muxers gauge
mediamtx_hls_muxers 1
# HELP mediamtx_bytes_received Bytes received.
# TYPE mediamtx_bytes_received counter
mediamtx_bytes_received{name="cam1"} 1024000000
"""


def paginate(items, query):
    per = int(query.get('itemsPerPage', ['100'])[0])
    page = int(query.get('page', ['0'])[0])
    return {
        'itemCount': len(items),
        'pageCount': max(1, (len(items) + per - 1) // per),
        'items': items[page * per:(page + 1) * per],
    }


class Handler(BaseHTTPRequestHandler):
    server_version = 'StubMediaMTX/1.21.1'

    def log_message(self, fmt, *args):
        sys.stderr.write('[stub] %s\n' % (fmt % args))

    # ---------- helpers ----------
    def _cors(self):
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'GET, POST, PATCH, DELETE, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Authorization, Content-Type')

    def _send(self, status, body=None, raw=None, ctype='application/json'):
        self.send_response(status)
        self._cors()
        if body is not None:
            raw = json.dumps(body).encode()
        self.send_header('Content-Type', ctype)
        self.send_header('Content-Length', str(len(raw or b'')))
        self.end_headers()
        if raw:
            self.wfile.write(raw)

    def _error(self, status, message):
        self._send(status, {'status': 'error', 'error': message})

    def _authorized(self):
        header = self.headers.get('Authorization', '')
        if not header.startswith('Basic '):
            return False
        try:
            decoded = base64.b64decode(header[6:]).decode()
        except Exception:
            return False
        return decoded == USER + ':' + PASS

    def _body(self):
        length = int(self.headers.get('Content-Length') or 0)
        if not length:
            return {}
        try:
            return json.loads(self.rfile.read(length).decode())
        except Exception:
            return {}

    def _split(self):
        parsed = urllib.parse.urlsplit(self.path)
        query = urllib.parse.parse_qs(parsed.query)
        return parsed.path, query

    def do_OPTIONS(self):
        self.send_response(204)
        self._cors()
        self.send_header('Content-Length', '0')
        self.end_headers()

    # ---------- routing ----------
    def do_GET(self):
        path, query = self._split()
        if path.startswith('/v3/') or path == '/metrics':
            self._api('GET', path, query)
        elif path == '/get':
            self._send(200, raw=b'stub-media-bytes', ctype='text/plain')
        elif path == '/list':
            self._send(200, {'items': []})
        else:
            self._static(path)

    def do_POST(self):
        path, query = self._split()
        self._api('POST', path, query)

    def do_PATCH(self):
        path, query = self._split()
        self._api('PATCH', path, query)

    def do_DELETE(self):
        path, query = self._split()
        self._api('DELETE', path, query)

    def _api(self, method, path, query):
        if not self._authorized():
            self.send_response(401)
            self._cors()
            self.send_header('WWW-Authenticate', 'Basic realm="mediamtx"')
            self.send_header('Content-Length', '0')
            self.end_headers()
            return
        if '__err' in query:
            self._error(int(query['__err'][0]), 'Injected error for testing')
            return

        parts = [p for p in path.split('/') if p][1:]  # drop 'v3'
        body = self._body()

        if method == 'GET' and parts == ['info']:
            self._send(200, STATE['info'])
        elif method == 'GET' and parts == ['metrics'] and path == '/v3/metrics':
            self._error(404, 'not found')
        elif path == '/metrics':
            self._send(200, raw=PROM_METRICS.encode(), ctype='text/plain')

        elif method == 'GET' and parts == ['config', 'global', 'get']:
            self._send(200, STATE['global'])
        elif method == 'PATCH' and parts == ['config', 'global', 'patch']:
            for key, value in body.items():
                STATE['global'][key] = value
                STATE['patches'].append((key, value))
            self._send(200, {})
        elif method == 'GET' and parts == ['config', 'path-defaults', 'get']:
            self._send(200, STATE['pathDefaults'])
        elif method == 'PATCH' and parts == ['config', 'path-defaults', 'patch']:
            STATE['pathDefaults'].update(body)
            self._send(200, {})
        elif method == 'GET' and parts == ['config', 'paths', 'list']:
            self._send(200, paginate(list(STATE['paths'].values()), query))
        elif len(parts) == 4 and parts[:3] == ['config', 'paths', 'get']:
            conf = STATE['paths'].get(urllib.parse.unquote(parts[3]))
            if conf is None:
                self._error(400, 'path not found')
            else:
                self._send(200, conf)
        elif method == 'POST' and len(parts) == 4 and parts[:3] == ['config', 'paths', 'add']:
            name = urllib.parse.unquote(parts[3])
            if name in STATE['paths']:
                self._error(400, 'path "%s" already exists' % name)
            else:
                conf = dict(STATE['pathDefaults'])
                conf.update(body)
                conf['name'] = name
                STATE['paths'][name] = conf
                self._send(200, {})
        elif method == 'POST' and len(parts) == 4 and parts[:3] == ['config', 'paths', 'replace']:
            name = urllib.parse.unquote(parts[3])
            if name not in STATE['paths']:
                self._error(400, 'path "%s" does not exist' % name)
            else:
                conf = dict(STATE['pathDefaults'])
                conf.update(body)
                conf['name'] = name
                STATE['paths'][name] = conf
                self._send(200, {})
        elif method == 'PATCH' and len(parts) == 4 and parts[:3] == ['config', 'paths', 'patch']:
            name = urllib.parse.unquote(parts[3])
            if name not in STATE['paths']:
                self._error(400, 'path "%s" does not exist' % name)
            else:
                STATE['paths'][name].update(body)
                self._send(200, {})
        elif method == 'DELETE' and len(parts) == 4 and parts[:3] == ['config', 'paths', 'delete']:
            name = urllib.parse.unquote(parts[3])
            if name not in STATE['paths']:
                self._error(400, 'path "%s" does not exist' % name)
            else:
                del STATE['paths'][name]
                self._send(200, {})

        elif method == 'GET' and parts == ['paths', 'list']:
            self._send(200, paginate(runtime_paths(), query))

        elif method == 'GET' and parts[-1] == 'list' and resolve_collection(parts):
            key = resolve_collection(parts)
            self._send(200, paginate(SESSIONS[key], query))
        elif method == 'GET' and parts[-2] == 'get' and resolve_collection(parts[:-1]):
            key = resolve_collection(parts[:-1])
            id_ = urllib.parse.unquote(parts[-1])
            for item in SESSIONS.get(key, []):
                if item['id'] == id_:
                    self._send(200, item)
                    return
            self._error(404, 'session not found')
        elif method == 'POST' and parts[-2] == 'kick' and resolve_collection(parts[:-1]):
            key = resolve_collection(parts[:-1])
            id_ = urllib.parse.unquote(parts[-1])
            SESSIONS[key] = [s for s in SESSIONS[key] if s['id'] != id_]
            self._send(200, {})

        elif method == 'GET' and parts == ['recordings', 'list']:
            self._send(200, paginate(STATE['recordings'], query))
        elif method == 'GET' and len(parts) == 3 and parts[:2] == ['recordings', 'get']:
            name = urllib.parse.unquote(parts[2])
            for rec in STATE['recordings']:
                if rec['name'] == name:
                    self._send(200, rec)
                    return
            self._error(404, 'recording not found')
        elif method == 'DELETE' and parts == ['recordings', 'segments', 'delete']:
            rec_path = query.get('path', [''])[0]
            start = query.get('start', [''])[0]
            for rec in STATE['recordings']:
                if rec['name'] == rec_path:
                    before = len(rec['segments'])
                    rec['segments'] = [s for s in rec['segments'] if s['start'] != start]
                    if len(rec['segments']) < before:
                        STATE['deleted_segments'].append((rec_path, start))
                        self._send(200, {})
                        return
            self._error(404, 'segment not found')

        else:
            self._error(404, 'unknown stub endpoint: %s %s' % (method, path))

    # ---------- static ----------
    def _static(self, path):
        if path == '/':
            path = '/index.html'
        fs_path = os.path.normpath(os.path.join(ROOT, path.lstrip('/')))
        if not fs_path.startswith(ROOT) or not os.path.isfile(fs_path):
            self._error(404, 'not found')
            return
        ext = os.path.splitext(fs_path)[1]
        with open(fs_path, 'rb') as fh:
            self._send(200, raw=fh.read(), ctype=CONTENT_TYPES.get(ext, 'application/octet-stream'))


if __name__ == '__main__':
    server = ThreadingHTTPServer((HOST, PORT), Handler)
    print('Stub MediaMTX on http://%s:%d  (user %s / pass %s, app at /)' % (HOST, PORT, USER, PASS))
    server.serve_forever()
