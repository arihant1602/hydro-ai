"""Start the server on HTTP :8000 (ESP32 + dashboard) and HTTPS :8443 (phone camera) in one process.

Phone browsers only allow live camera access on HTTPS pages, but the ESP32 talks plain HTTP,
so both listeners share one app (and its in-memory link state). The HTTPS certificate is
self-signed: the phone shows a warning once; tap Advanced -> Proceed.

  python -m hydro.run
"""
import asyncio
import ipaddress
import os
import socket
import subprocess
from pathlib import Path

import uvicorn

ROOT = Path(__file__).resolve().parent.parent
CERTS = ROOT / "data" / "certs"
HTTP_PORT = int(os.environ.get("HYDRO_HTTP_PORT", 8000))
HTTPS_PORT = int(os.environ.get("HYDRO_HTTPS_PORT", 8443))


def lan_ip():
    """IP of the interface that routes outward (no packet is actually sent)."""
    with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as s:
        try:
            s.connect(("10.255.255.255", 1))
            return s.getsockname()[0]
        except OSError:
            return "127.0.0.1"


def ensure_cert(ip):
    """Self-signed cert for this LAN IP; regenerated when the laptop's IP changes (new hotspot)."""
    CERTS.mkdir(parents=True, exist_ok=True)
    cert, key, stamp = CERTS / "cert.pem", CERTS / "key.pem", CERTS / "ip.txt"
    if cert.exists() and key.exists() and stamp.exists() and stamp.read_text() == ip:
        return cert, key
    ipaddress.ip_address(ip)  # refuse to put anything odd into the openssl command
    subprocess.run(["openssl", "req", "-x509", "-newkey", "rsa:2048", "-nodes", "-days", "825",
                    "-keyout", str(key), "-out", str(cert), "-subj", "/CN=Hydro AI (local)",
                    "-addext", f"subjectAltName=IP:{ip},IP:127.0.0.1,DNS:localhost"],
                   check=True, capture_output=True)
    key.chmod(0o600)
    stamp.write_text(ip)
    return cert, key


async def main():
    ip = lan_ip()
    cert, key = ensure_cert(ip)
    os.environ["HYDRO_LAN_IP"] = ip
    servers = [
        uvicorn.Server(uvicorn.Config("hydro.server:app", host="0.0.0.0", port=HTTP_PORT)),
        uvicorn.Server(uvicorn.Config("hydro.server:app", host="0.0.0.0", port=HTTPS_PORT,
                                      ssl_certfile=str(cert), ssl_keyfile=str(key))),
    ]
    print(f"dashboard: http://{ip}:{HTTP_PORT}   phone camera: https://{ip}:{HTTPS_PORT}/camera", flush=True)
    await asyncio.gather(*(s.serve() for s in servers))


if __name__ == "__main__":
    asyncio.run(main())
