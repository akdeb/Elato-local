import socket


def get_local_ip() -> str:
    for target in ("8.8.8.8", "1.1.1.1"):
        try:
            sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
            sock.connect((target, 80))
            ip = sock.getsockname()[0]
            sock.close()
            if ip and not ip.startswith("127."):
                return ip
        except Exception:
            pass

    try:
        host = socket.gethostname()
        _name, _aliases, addrs = socket.gethostbyname_ex(host)
        for ip in addrs:
            if ip and not ip.startswith("127.") and not ip.startswith("169.254."):
                return ip
    except Exception:
        pass

    return "127.0.0.1"
