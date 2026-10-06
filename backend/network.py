from ipaddress import ip_address
import re


_MAC_HEX = re.compile(r"^[0-9A-Fa-f]{12}$")


def normalize_ip_address(value: str | None) -> str | None:
    """Store optional IPv4/IPv6 addresses in a canonical form."""
    if value is None:
        return None
    if not isinstance(value, str):
        raise ValueError("IP-адрес должен быть строкой")
    value = value.strip()
    if not value:
        return None
    if "%" in value:
        raise ValueError("Укажите IP-адрес без идентификатора интерфейса")
    try:
        return str(ip_address(value))
    except ValueError as exc:
        raise ValueError("Укажите корректный IPv4 или IPv6 адрес без порта и протокола") from exc


def normalize_mac_address(value: str | None) -> str | None:
    """Store optional MAC addresses as AA:BB:CC:DD:EE:FF."""
    if value is None:
        return None
    if not isinstance(value, str):
        raise ValueError("MAC-адрес должен быть строкой")
    value = value.strip()
    if not value:
        return None
    compact = value.replace(":", "").replace("-", "").replace(".", "")
    if not _MAC_HEX.fullmatch(compact):
        raise ValueError("Укажите MAC-адрес в формате AA:BB:CC:DD:EE:FF")
    compact = compact.upper()
    return ":".join(compact[index:index + 2] for index in range(0, 12, 2))
