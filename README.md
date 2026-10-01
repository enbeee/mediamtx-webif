**Started as a vibe-coded project and probably riddled with bugs. Don't @ me!** — it has since been rewritten from scratch (still zero dependencies, no build step), with the MediaMTX API surface updated through **v1.21** and the worst bugs and security issues fixed.

Add your API-enabled instance in Settings (or the + button in the top bar). Connection info/credentials are only saved in local storage in your web browser — you can also choose to keep the password session-only.

## Features

- Multi-instance management (add/edit/test/delete), Basic auth or Bearer/JWT tokens
- Dashboard: paths, available streams, live sessions, throughput, server info
- Live Players: WebRTC (WHEP) with automatic HLS fallback, snapshot, fullscreen, stream info
- Paths: full config editor (source, recording, availability, forwarding, hooks), path defaults, catch-all handling
- Connections: RTSP/RTSPS/RTMP/RTMPS/SRT/WebRTC/HLS/MoQ sessions & connections, with kick
- Recordings: segment browsing, MP4 playback (incl. custom time ranges), segment deletion
- Users & permissions editor (`authInternalUsers`)
- Service toggles (hot-applied via the API)
- Prometheus metrics browser
- Import/export of server config and instance backups
- Works with older servers too: endpoints are auto-selected per server version (newer nested names on ≥ v1.21, deprecated flat names before)

Remember that changes made through the API won't be saved to the YAML config of your instance on old MediaMTX versions — use the import/export feature on the Settings page as a backup.

## Development

`dev/stub_mediamtx.py` is a dependency-free Python stub that fakes the MediaMTX API and serves this app, for local testing:

```bash
python3 dev/stub_mediamtx.py 8099
# then open http://127.0.0.1:8099/  (login: admin / mypassword)
```
