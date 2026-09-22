from ipaddress import ip_address


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
