import subprocess
import sys
from pathlib import Path
from typing import Dict, List


def list_serial_ports() -> List[str]:
    try:
        from serial.tools import list_ports  # type: ignore

        ports = [p.device for p in list_ports.comports() if getattr(p, "device", None)]
        ports = [p for p in ports if isinstance(p, str) and p]
        return sorted(list(dict.fromkeys(ports)))
    except Exception:
        paths = []
        paths.extend(Path("/dev").glob("tty.*"))
        paths.extend(Path("/dev").glob("cu.*"))
        return sorted(list(dict.fromkeys([str(p) for p in paths])))


def firmware_bin_path() -> Path:
    repo_root = Path(__file__).resolve().parents[3]
    return repo_root / "resources" / "firmware" / "firmware.bin"


def run_firmware_flash(
    *,
    port: str,
    baud: int,
    chip: str,
    offset: str,
    firmware_path: Path,
) -> Dict[str, object]:
    cmd = [
        sys.executable,
        "-m",
        "esptool",
        "--before",
        "default_reset",
        "--after",
        "hard_reset",
        "--chip",
        chip,
        "--port",
        port,
        "--baud",
        str(baud),
        "write_flash",
        "-z",
        offset,
        str(firmware_path),
    ]
    proc = subprocess.run(cmd, capture_output=True, text=True)
    out = (proc.stdout or "") + ("\n" if proc.stdout and proc.stderr else "") + (proc.stderr or "")
    return {
        "ok": proc.returncode == 0,
        "exit_code": proc.returncode,
        "command": " ".join(cmd),
        "output": out,
    }
