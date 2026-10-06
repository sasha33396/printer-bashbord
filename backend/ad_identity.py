from uuid import UUID


def normalize_ad_login(value):
    if value is None:
        return None
    value = value.strip().lower()
    if not value:
        return None
    if "\\" in value or "@" in value or any(char.isspace() for char in value):
        raise ValueError("Укажите короткий логин AD без домена и пробелов")
    return value


def normalize_ad_domain(value):
    if value is None:
        return None
    return value.strip().lower().rstrip(".") or None


def normalize_ad_guid(value):
    return str(UUID(str(value))) if value else None
