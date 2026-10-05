"""OCS -> Windows PowerShell AD -> inventory API. Python 3.10+, standard library."""

import argparse
import ipaddress
import json
import math
import os
import re
import subprocess
import sys
import tempfile
import urllib.error
import urllib.parse
import urllib.request
from collections import defaultdict
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from pathlib import Path
from uuid import UUID, uuid4


DEFAULT_LAPTOP_NAMES = (
    "Notebook-RTI", "NOTEBOOK-CHPU-DISP", "LAPTOP-COM", "NOTE-PROXIMA-1",
    "NOTE-BUH-2", "NOTE-HR-1", "UP-OP-NOTES1", "NOTE-WED-1",
    "Notebook-sar1", "Ershov-Note",
)
COUNTERS = (
    "employees_created", "employees_updated", "workplaces_created",
    "computers_created", "computers_updated", "monitors_created", "monitors_updated",
    "assets_assigned", "warnings", "conflicts", "skipped", "unchanged",
)


class CollectorError(ValueError):
    pass


def text(value, limit=255):
    if value is None:
        return None
    if not isinstance(value, (str, int, float)) or isinstance(value, bool):
        return None
    return str(value).strip()[:limit] or None


def decode_json(value):
    if isinstance(value, bytes):
        value = value.decode("utf-8-sig")
    for _ in range(2):
        if not isinstance(value, str):
            return value
        value = json.loads(value)
    if isinstance(value, str):
        raise CollectorError("The response contains a string instead of JSON data")
    return value


def url_base(value):
    parsed = urllib.parse.urlsplit(value)
    if (parsed.scheme not in ("http", "https") or not parsed.hostname
            or parsed.username or parsed.password or parsed.query or parsed.fragment):
        raise CollectorError("Use an HTTP(S) base URL without credentials, query or fragment")
    return value.rstrip("/")


def fixed_timezone(value):
    if value.upper() == "UTC":
        return timezone.utc
    match = re.fullmatch(r"([+-])(\d{2}):(\d{2})", value)
    if not match:
        raise CollectorError("ocs_timezone must be UTC or an explicit offset such as +04:00")
    hours, minutes = int(match[2]), int(match[3])
    if hours > 14 or minutes > 59 or (hours == 14 and minutes):
        raise CollectorError("Invalid ocs_timezone offset")
    return timezone(timedelta(minutes=(hours * 60 + minutes) * (1 if match[1] == "+" else -1)))


@dataclass
class Config:
    ocs_url: str
    app_url: str
    ad_server: str
    ad_domain: str
    ocs_timezone: str
    source_key: str = "main"
    batch_size: int = 200
    max_age_days: int = 30
    http_timeout_seconds: int = 30
    ad_timeout_seconds: int = 120
    powershell_executable: str = "powershell.exe"
    import_token_env: str = "OCS_AD_IMPORT_TOKEN"
    output_directory: str = "output"
    excluded_logins: list = field(default_factory=lambda: ["administrator", "admin"])
    laptop_names: list = field(default_factory=lambda: list(DEFAULT_LAPTOP_NAMES))

    def __post_init__(self):
        for key in ("ocs_url", "app_url", "ad_server", "ad_domain", "ocs_timezone", "source_key",
                    "powershell_executable", "import_token_env", "output_directory"):
            if not isinstance(getattr(self, key), str) or not getattr(self, key).strip():
                raise CollectorError(f"{key} must be a non-empty string")
        self.ocs_url = url_base(self.ocs_url)
        self.app_url = url_base(self.app_url)
        self.ad_domain = self.ad_domain.strip().lower().rstrip(".")
        self.source_key = self.source_key.strip().lower()
        if not self.ad_domain or not self.ad_server or not self.source_key or len(self.source_key) > 100:
            raise CollectorError("ad_domain, ad_server and source_key must be specified")
        fixed_timezone(self.ocs_timezone)
        for key, low, high in (
            ("batch_size", 1, 500), ("max_age_days", 1, 3650),
            ("http_timeout_seconds", 1, 300), ("ad_timeout_seconds", 1, 3600),
        ):
            value = getattr(self, key)
            if type(value) is not int or not low <= value <= high:
                raise CollectorError(f"{key} must be an integer between {low} and {high}")
        for key in ("excluded_logins", "laptop_names"):
            values = getattr(self, key)
            if not isinstance(values, list) or any(not isinstance(v, str) for v in values):
                raise CollectorError(f"{key} must be an array of strings")

    @classmethod
    def load(cls, path):
        try:
            config = cls(**json.loads(path.read_text(encoding="utf-8-sig")))
        except (OSError, TypeError, json.JSONDecodeError) as exc:
            raise CollectorError("Cannot load config; copy config.example.json to config.json and check its fields") from exc
        directory = Path(config.output_directory)
        config.output_directory = str(directory if directory.is_absolute() else path.resolve().parent / directory)
        return config

    @property
    def import_url(self):
        base = self.app_url if self.app_url.endswith("/api") else self.app_url + "/api"
        return base + "/integrations/ocs-ad/import"


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


class HttpClient:
    def __init__(self, timeout):
        self.timeout = timeout
        self.opener = urllib.request.build_opener(NoRedirect())

    def request(self, url, payload=None, token=None):
        headers = {"Accept": "application/json"}
        data = None
        if payload is not None:
            data = json.dumps(payload, ensure_ascii=False).encode("utf-8")
            headers["Content-Type"] = "application/json; charset=utf-8"
        if token:
            headers["Authorization"] = "Bearer " + token
        request = urllib.request.Request(url, data=data, headers=headers)
        try:
            with self.opener.open(request, timeout=self.timeout) as response:
                raw = response.read(16 * 1024 * 1024 + 1)
            if len(raw) > 16 * 1024 * 1024:
                raise CollectorError("HTTP response exceeds 16 MiB")
            return decode_json(raw)
        except urllib.error.HTTPError as exc:
            # Never print response bodies: they can contain credentials or raw OCS inventories.
            hint = " (check URL; redirects are refused)" if 300 <= exc.code < 400 else ""
            raise CollectorError(f"HTTP {exc.code}{hint}") from exc
        except (urllib.error.URLError, TimeoutError, OSError) as exc:
            hint = "; the apply may already have committed, inspect the application before retrying" if payload and payload.get("dry_run") is False else ""
            raise CollectorError("HTTP connection failed or timed out; check address and network access" + hint) from exc
        except (UnicodeError, json.JSONDecodeError) as exc:
            raise CollectorError("The endpoint did not return valid UTF-8 JSON") from exc


def rows(card, section):
    value = card.get(section)
    if isinstance(value, list):
        return [row for row in value if isinstance(row, dict)]
    if isinstance(value, dict):
        if value and all(isinstance(v, dict) for v in value.values()):
            return list(value.values())
        return [value] if value else []
    return []


def number(value):
    try:
        result = float(value)
        return result if math.isfinite(result) and result >= 0 and not isinstance(value, bool) else None
    except (ValueError, TypeError):
        return None


def valid_ip(value):
    for candidate in re.split(r"[,;\s]+", text(value) or ""):
        try:
            address = ipaddress.ip_address(candidate.split("%")[0])
            if not (address.is_loopback or address.is_link_local or address.is_multicast or address.is_unspecified):
                return str(address)
        except ValueError:
            continue
    return None


def valid_mac(value):
    value = (text(value) or "").replace("-", ":").upper()
    if re.fullmatch(r"(?:[0-9A-F]{2}:){5}[0-9A-F]{2}", value) and value not in (
        "00:00:00:00:00:00", "FF:FF:FF:FF:FF:FF",
    ):
        return value
    return None


def network(card, hardware):
    preferred = valid_ip(hardware.get("IPADDR"))
    candidates = []
    for row in rows(card, "networks"):
        description = (text(row.get("DESCRIPTION")) or "").lower()
        if (str(row.get("VIRTUALDEV", 0)).lower() in ("1", "true")
                or any(word in description for word in ("virtual", "vethernet", "loopback", "filter", "tunnel"))):
            continue
        status = (text(row.get("STATUS")) or "").lower()
        if status in ("down", "disconnected", "disabled"):
            continue
        address = valid_ip(row.get("IPADDRESS"))
        if address:
            score = (status == "up", address == preferred, bool(row.get("IPGATEWAY")))
            candidates.append((score, address, valid_mac(row.get("MACADDR"))))
    if candidates:
        _, address, mac = max(candidates, key=lambda item: item[0])
        return {"ip_address": address, "mac_address": mac}
    return {"ip_address": preferred, "mac_address": None}


def storage(card):
    capacity = 0
    kinds, seen = set(), set()
    for index, row in enumerate(rows(card, "storages")):
        kind = (text(row.get("TYPE")) or "").lower()
        description = (text(row.get("DESCRIPTION")) or "").lower()
        if any(word in kind + " " + description for word in ("removable", "cd-rom", "cdrom", "dvd", "optical", "network")):
            continue
        size = number(row.get("DISKSIZE"))
        if not size:
            continue
        # OCS MODEL commonly holds PHYSICALDRIVE0. Never deduplicate by product NAME.
        model = text(row.get("MODEL")) or ""
        identity = model.casefold() if "physicaldrive" in model.lower() else str(row.get("ID", index))
        if identity in seen:
            continue
        seen.add(identity)
        capacity += size
        label = kind + " " + (text(row.get("NAME")) or "").lower()
        if re.search(r"\bssd\b|solid state", label):
            kinds.add("SSD")
        elif re.search(r"\bhdd\b|hard disk drive", label):
            kinds.add("HDD")
    return {
        "storage_capacity_gb": int(capacity / 1024 + 0.5) if capacity else None,
        "storage_type": "HDD/SSD" if len(kinds) == 2 else next(iter(kinds), None),
    }


def form_factor(bios, name, known_names):
    if name.upper() in {item.strip().upper() for item in known_names}:
        return "laptop"
    value = (text(bios.get("TYPE")) or "").lower().replace("-", " ")
    if value in ("portable", "laptop", "notebook", "sub notebook", "convertible", "detachable", "8", "9", "10", "14", "31", "32"):
        return "laptop"
    if value in ("desktop", "low profile desktop", "mini tower", "tower", "all in one", "3", "4", "6", "7", "13"):
        return "desktop"
    return None


@dataclass
class Candidate:
    record: dict
    raw_login: str
    domain_hint: str
    warnings: list = field(default_factory=list)


def normalize_card(ocs_id, response, config):
    response = decode_json(response)
    if not isinstance(response, dict):
        raise CollectorError("OCS computer response must be an object")
    card = response.get(str(ocs_id), response if "hardware" in response else None)
    if not isinstance(card, dict):
        raise CollectorError("OCS response has no card for the requested ID")
    hardware_rows = rows(card, "hardware")
    if len(hardware_rows) != 1:
        raise CollectorError("Expected exactly one hardware record")
    hardware = hardware_rows[0]
    if hardware.get("ID") is not None and str(hardware["ID"]) != str(ocs_id):
        raise CollectorError("Hardware ID does not match the requested OCS ID")
    name = text(hardware.get("NAME"))
    if not name:
        raise CollectorError("OCS computer name is missing")
    date = text(hardware.get("LASTDATE"))
    try:
        observed = datetime.fromisoformat((date or "").replace("Z", "+00:00"))
    except ValueError as exc:
        raise CollectorError("OCS LASTDATE is missing or invalid") from exc
    if observed.tzinfo is None:
        observed = observed.replace(tzinfo=fixed_timezone(config.ocs_timezone))
    bios = next(iter(rows(card, "bios")), {})
    memory = number(hardware.get("MEMORY"))
    video_names = list(dict.fromkeys(
        value for row in rows(card, "videos") if (value := text(row.get("NAME")))
    ))
    computer = {
        "manufacturer": text(bios.get("SMANUFACTURER")), "model": text(bios.get("SMODEL")),
        "serial_number": text(bios.get("SSN"), 100),
        "ram_gb": int(memory / 1024 + 0.5) if memory else None,
        "processor": text(hardware.get("PROCESSORT")), "graphics": text("; ".join(video_names)),
        "os_name": text(hardware.get("OSNAME")), "os_version": text(hardware.get("OSVERSION"), 100),
        **network(card, hardware), **storage(card),
    }
    factor = form_factor(bios, name, config.laptop_names)
    if factor:
        computer["form_factor"] = factor
    monitors, warnings = [], []
    for row in rows(card, "monitors"):
        ident = text(row.get("ID"), 100)
        caption = text(row.get("CAPTION"))
        if not ident or not caption:
            warnings.append("Monitor skipped: OCS ID or CAPTION is missing")
            continue
        monitors.append({
            "ocs_id": ident, "name": caption, "model": caption,
            "manufacturer": text(row.get("MANUFACTURER")), "serial_number": text(row.get("SERIAL"), 100),
        })
    if len(monitors) > 20:
        raise CollectorError("More than 20 monitors; manual review required")
    record = {
        "ocs_id": str(ocs_id), "computer_name": name.upper(),
        "last_inventory_at": observed.isoformat(), "computer": computer, "monitors": monitors,
    }
    return Candidate(record, text(hardware.get("USERID")) or "",
                     text(hardware.get("USERDOMAIN")) or text(hardware.get("WORKGROUP")) or "", warnings)


def resolve_ad(queries, config):
    if not queries:
        return {}
    script = Path(__file__).with_name("get_ad_users.ps1")
    with tempfile.TemporaryDirectory(prefix="ocs-ad-") as folder:
        input_file, output_file = Path(folder) / "input.json", Path(folder) / "output.json"
        input_file.write_text(json.dumps(queries, ensure_ascii=False), encoding="utf-8")
        command = [
            config.powershell_executable, "-NoLogo", "-NoProfile", "-NonInteractive",
            "-ExecutionPolicy", "Bypass", "-File", str(script),
            "-InputPath", str(input_file), "-OutputPath", str(output_file),
            "-Server", config.ad_server, "-ExpectedDomain", config.ad_domain,
        ]
        try:
            process = subprocess.run(command, capture_output=True, timeout=config.ad_timeout_seconds, check=False)
            result = json.loads(output_file.read_text(encoding="utf-8-sig")) if output_file.exists() else {}
        except (OSError, subprocess.TimeoutExpired, json.JSONDecodeError) as exc:
            raise CollectorError("AD lookup failed; check PowerShell, RSAT ActiveDirectory and domain access") from exc
        if process.returncode or result.get("ok") is not True:
            phase = result.get("error")
            phase = phase if phase in ("ad_module", "ad_connection", "ad_domain_mismatch", "ad_input") else "powershell"
            raise CollectorError(f"AD lookup failed ({phase}); check RSAT ActiveDirectory, ad_server, ad_domain and Windows account permissions")
        return {str(row["key"]): row for row in result.get("users", [])}


def trusted_serial(value):
    value = (text(value) or "").lower()
    if value in ("", "default string", "unknown", "none", "n/a", "not specified", "system serial number", "to be filled by o.e.m."):
        return None
    return value if value.replace("0", "").replace("-", "").replace(" ", "") else None


def remove_duplicates(records, outcomes):
    identities = defaultdict(set)
    for index, record in enumerate(records):
        keys = [
            ("id", record["ocs_id"]), ("name", record["computer_name"]),
            ("login", record["domain"], record["ad_login"]), ("guid", record["ad_guid"]),
        ]
        if serial := trusted_serial(record["computer"].get("serial_number")):
            keys.append(("computer_serial", serial))
        for monitor in record["monitors"]:
            keys.append(("monitor", monitor["ocs_id"]))
            if serial := trusted_serial(monitor.get("serial_number")):
                keys.append(("monitor_serial", serial))
        # Count occurrences, including repeated monitors within a single card.
        local = set()
        for key in keys:
            if key in local:
                identities[key].add(-1)
            local.add(key)
            identities[key].add(index)
    ambiguous = {index for indexes in identities.values() if len(indexes) > 1 for index in indexes if index >= 0}
    for index in ambiguous:
        outcome = outcomes[records[index]["ocs_id"]]
        outcome.update(status="conflict", message="Repeated device, AD employee or monitor in the scan; manual review required")
    return [record for index, record in enumerate(records) if index not in ambiguous]


def prepare_records(client, ids, config, lookup=None):
    lookup = lookup or resolve_ad
    candidates, queries, outcomes = [], {}, {}
    now = datetime.now(timezone.utc)
    for ident in ids:
        outcome = {"ocs_id": ident, "status": "skipped", "warnings": []}
        outcomes[ident] = outcome
        try:
            candidate = normalize_card(ident, client.request(config.ocs_url + "/computer/" + ident), config)
            record = candidate.record
            outcome.update(computer_name=record["computer_name"], warnings=candidate.warnings)
            observed = datetime.fromisoformat(record["last_inventory_at"])
            if observed < now - timedelta(days=config.max_age_days):
                outcome["message"] = "OCS inventory is stale"
                continue
            if observed > now + timedelta(minutes=5):
                outcome["message"] = "OCS inventory is in the future; check ocs_timezone"
                continue
            if not candidate.raw_login:
                outcome["message"] = "OCS USERID is empty"
                continue
            key = (candidate.raw_login.lower(), candidate.domain_hint.lower())
            if key not in queries:
                queries[key] = {"key": str(len(queries)), "raw_login": candidate.raw_login, "domain_hint": candidate.domain_hint}
            candidates.append((candidate, queries[key]["key"]))
        except CollectorError as exc:
            outcome.update(status="error", message=str(exc))
    users = lookup(list(queries.values()), config)
    records = []
    excluded = {value.strip().lower() for value in config.excluded_logins}
    for candidate, key in candidates:
        record = candidate.record
        outcome = outcomes[record["ocs_id"]]
        user = users.get(key, {"status": "query_error"})
        status = user.get("status")
        if status != "found":
            outcome.update(status="error" if status == "query_error" else "skipped", message="AD: " + str(status))
            continue
        try:
            employee = user["employee"]
            login = text(employee["ad_login"])
            domain = (text(employee["domain"]) or "").lower().rstrip(".")
            name = text(employee["full_name"])
            guid = str(UUID(employee["ad_guid"]))
            if not login or any(char.isspace() for char in login) or "\\" in login or "@" in login:
                raise ValueError("Invalid confirmed AD login")
            if not name or domain != config.ad_domain or type(employee["ad_enabled"]) is not bool:
                raise ValueError("Incomplete or foreign AD identity")
            if not employee["ad_enabled"] or login.lower() in excluded:
                outcome["message"] = "AD account is disabled or excluded"
                continue
            record.update(
                ad_login=login.lower(), domain=domain, ad_guid=guid, full_name=name, ad_enabled=True,
                position=text(employee.get("position")), email=text(employee.get("email")), phone=text(employee.get("phone"), 100),
            )
            records.append(record)
            outcome["status"] = "prepared"
        except (KeyError, ValueError, TypeError):
            outcome.update(status="error", message="AD returned an invalid identity")
    return remove_duplicates(records, outcomes), list(outcomes.values())


def computer_ids(value):
    if not isinstance(value, list):
        raise CollectorError("OCS listID response must be an array")
    result = []
    for row in value:
        ident = str(row.get("ID", "")) if isinstance(row, dict) else ""
        if not re.fullmatch(r"[1-9]\d*", ident):
            raise CollectorError("OCS listID contains an invalid computer ID")
        if ident not in result:
            result.append(ident)
    return result


def write_json(path, value):
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--config", type=Path, default=Path(__file__).with_name("config.json"))
    selection = parser.add_mutually_exclusive_group(required=True)
    selection.add_argument("--computer-id", action="append", help="OCS ID; repeat to select several devices")
    selection.add_argument("--all", action="store_true", help="Scan all OCS IDs")
    mode = parser.add_mutually_exclusive_group()
    mode.add_argument("--apply", action="store_true", help="Write accepted records to the application")
    mode.add_argument("--collect-only", action="store_true", help="Write normalized requests locally, without calling the application")
    parser.add_argument("--limit", type=int, help="Maximum number of selected devices")
    args = parser.parse_args(argv)
    report, directory = None, None
    try:
        config = Config.load(args.config)
        token = os.getenv(config.import_token_env, "").strip()
        if not args.collect_only and (not token or "\r" in token or "\n" in token):
            raise CollectorError(f"Set {config.import_token_env} to the application's import token, or use --collect-only")
        if args.limit is not None and args.limit < 1:
            raise CollectorError("--limit must be positive")
        client = HttpClient(config.http_timeout_seconds)
        if args.computer_id:
            ids = computer_ids([{"ID": ident} for ident in args.computer_id])
        else:
            ids = computer_ids(client.request(config.ocs_url + "/computers/listID"))
        if args.limit:
            ids = ids[:args.limit]
        directory = Path(config.output_directory) / (datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ-") + uuid4().hex[:8])
        directory.mkdir(parents=True, exist_ok=False)
        report = {"started_at": datetime.now(timezone.utc).isoformat(), "source_key": config.source_key,
                  "mode": "collect-only" if args.collect_only else "apply" if args.apply else "dry-run",
                  "selected": len(ids), "prepared": 0, "collector_records": [], "batches": [], "totals": {key: 0 for key in COUNTERS}}
        write_json(directory / "report.json", report)
        records, outcomes = prepare_records(client, ids, config)
        report.update(prepared=len(records), collector_records=outcomes)
        requests = [{"source": "ocs", "source_key": config.source_key, "dry_run": not args.apply,
                     "max_age_days": config.max_age_days, "records": records[start:start + config.batch_size]}
                    for start in range(0, len(records), config.batch_size)]
        write_json(directory / "requests.json", requests)
        write_json(directory / "report.json", report)
        if not args.collect_only:
            for index, request in enumerate(requests):
                # No POST retries: on connection loss an apply may already have committed.
                report["pending_batch"] = index
                write_json(directory / "report.json", report)
                result = client.request(config.import_url, request, token)
                if not isinstance(result, dict) or not isinstance(result.get("records"), list) or result.get("dry_run") is not (not args.apply):
                    raise CollectorError("Unexpected import response; inspect application logs before retrying an apply")
                if any(type(result.get(key, 0)) is not int or result.get(key, 0) < 0 for key in COUNTERS):
                    raise CollectorError("Invalid counters in import response")
                report["batches"].append({"batch": index, "result": result})
                report.pop("pending_batch", None)
                for key in COUNTERS:
                    report["totals"][key] += result.get(key, 0)
                write_json(directory / "report.json", report)
        report["finished_at"] = datetime.now(timezone.utc).isoformat()
        write_json(directory / "report.json", report)
        print(f"Mode: {report['mode']}; selected: {len(ids)}; prepared: {len(records)}")
        if not args.collect_only:
            print("API totals: " + json.dumps(report["totals"]))
        for row in outcomes:
            if row["status"] != "prepared":
                print(f"OCS {row['ocs_id']}: {row['status']}: {row.get('message', '')}")
        print("Report: " + str(directory / "report.json"))
        print("Requests: " + str(directory / "requests.json"))
        return 2 if report["totals"]["conflicts"] or any(row["status"] in ("error", "conflict") for row in outcomes) else 0
    except (CollectorError, OSError, KeyboardInterrupt) as exc:
        if report is not None:
            report.update(error=str(exc) or "Interrupted", finished_at=datetime.now(timezone.utc).isoformat())
            try:
                write_json(directory / "report.json", report)
            except OSError:
                pass
            print("Report: " + str(directory / "report.json"), file=sys.stderr)
        print("ERROR: " + (str(exc) or "Interrupted"), file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
