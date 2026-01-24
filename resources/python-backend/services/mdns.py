import logging
import socket
from typing import Optional

from .network import get_local_ip

logger = logging.getLogger(__name__)


class MdnsService:
    def __init__(self) -> None:
        self.service_info = None
        self.zeroconf = None
        self.current_ip: Optional[str] = None

    def start(self, port: int) -> None:
        try:
            from zeroconf import ServiceInfo, Zeroconf

            local_ip = get_local_ip()
            self.service_info = ServiceInfo(
                "_elato._tcp.local.",
                "Elato Voice Server._elato._tcp.local.",
                addresses=[socket.inet_aton(local_ip)],
                port=port,
                properties={"path": "/ws/esp32"},
                server="elato.local.",
            )
            self.zeroconf = Zeroconf()
            self.zeroconf.register_service(self.service_info)
            self.current_ip = local_ip
            logger.info("mDNS service registered on %s:%s", local_ip, port)
        except ImportError:
            logger.warning("zeroconf not installed, mDNS disabled")
        except Exception as exc:
            logger.error("Failed to start mDNS service: %s", exc)

    def stop(self) -> None:
        try:
            if self.zeroconf and self.service_info:
                self.zeroconf.unregister_service(self.service_info)
                self.zeroconf.close()
                logger.info("mDNS service stopped")
        except Exception as exc:
            logger.error("Failed to stop mDNS service: %s", exc)
        finally:
            self.service_info = None
            self.zeroconf = None
            self.current_ip = None
