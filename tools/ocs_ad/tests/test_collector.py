import io
import json
import os
import shutil
import subprocess
import tempfile
import unittest
from contextlib import redirect_stderr, redirect_stdout
from datetime import datetime, timedelta, timezone
from pathlib import Path
from unittest.mock import MagicMock, patch

from tools.ocs_ad import collector as c


def config(**changes):
    values = dict(ocs_url="http://ocs/ocsapi/v1", app_url="http://app:3000",
                  ad_server="ruskon.local", ad_domain="ruskon.local", ocs_timezone="+04:00")
    values.update(changes)
    return c.Config(**values)


def card(ident="94", name="WS-TEST-01", login="m.shutov", serial="PC-001"):
    return {ident: {
        "": {"ignored": True}, "software": [{"KEY": "DO-NOT-EXPORT-LICENSE"}],
        "hardware": [{"ID": int(ident), "NAME": name, "USERID": login, "USERDOMAIN": None,
                      "WORKGROUP": "ruskon.local", "LASTDATE": datetime.now(timezone.utc).isoformat(),
                      "MEMORY": 4096, "PROCESSORT": "Intel i3", "OSNAME": "Windows 11 Pro",
                      "OSVERSION": "10.0.26200", "IPADDR": "172.16.55.197"}],
        "bios": [{"TYPE": "Desktop", "SMANUFACTURER": "Acer", "SMODEL": "Aspire", "SSN": serial}],
        "videos": [{"NAME": "Intel UHD"}],
        "storages": [{"ID": 1, "TYPE": "Fixed hard disk media", "DISKSIZE": 244191, "MODEL": "PHYSICALDRIVE0", "NAME": "NE-256"}],
        "networks": [
            {"DESCRIPTION": "vEthernet Virtual", "IPADDRESS": "172.16.55.197", "MACADDR": "00:11:22:33:44:55", "STATUS": "Up", "VIRTUALDEV": 1},
            {"DESCRIPTION": "Realtek", "IPADDRESS": "172.16.55.197", "MACADDR": "1c-69-7a-9e-c7-ac", "STATUS": "Up"},
        ],
        "monitors": [{"ID": 72, "CAPTION": "S24D300", "MANUFACTURER": "Samsung", "SERIAL": ""}],
    }}


def ad_users(queries, _):
    result = {}
    for index, query in enumerate(queries):
        result[query["key"]] = {"status": "found", "employee": {
            "ad_login": query["raw_login"], "domain": "ruskon.local",
            "ad_guid": f"00000000-0000-0000-0000-{index + 1:012d}",
            "full_name": "Шутов Максим", "ad_enabled": True,
        }}
    return result


class NormalizationTests(unittest.TestCase):
    def test_real_ocs_shape_maps_hardware_and_omits_sensitive_sections(self):
        candidate = c.normalize_card("94", card(), config())
        data = candidate.record["computer"]
        self.assertEqual((data["ram_gb"], data["storage_capacity_gb"]), (4, 238))
        self.assertIsNone(data["storage_type"])  # Fixed hard disk media does not prove HDD.
        self.assertEqual(data["mac_address"], "1C:69:7A:9E:C7:AC")
        self.assertEqual(data["processor"], "Intel i3")
        self.assertEqual(data["form_factor"], "desktop")
        self.assertEqual(candidate.record["monitors"][0]["serial_number"], None)
        self.assertNotIn("DO-NOT-EXPORT", json.dumps(candidate.record))
        self.assertNotIn("software", candidate.record)

    def test_string_encoded_json_and_singleton_sections_are_supported(self):
        value = card()
        for section in ("hardware", "bios"):
            value["94"][section] = value["94"][section][0]
        result = c.normalize_card("94", json.dumps(json.dumps(value)), config())
        self.assertEqual(result.raw_login, "m.shutov")
        self.assertEqual(result.domain_hint, "ruskon.local")

    def test_dates_use_configured_offset_without_inventing_missing_date(self):
        value = card()
        value["94"]["hardware"][0]["LASTDATE"] = "2026-10-05 07:52:29"
        result = c.normalize_card("94", value, config())
        self.assertEqual(result.record["last_inventory_at"], "2026-10-05T07:52:29+04:00")
        value["94"]["hardware"][0]["LASTDATE"] = None
        with self.assertRaises(c.CollectorError):
            c.normalize_card("94", value, config())

    def test_laptop_names_override_chassis_and_portable_chassis_is_recognized(self):
        value = card(name="Ershov-Note")
        self.assertEqual(c.normalize_card("94", value, config()).record["computer"]["form_factor"], "laptop")
        value["94"]["hardware"][0]["NAME"] = "WS-MOBILE-01"
        value["94"]["bios"][0]["TYPE"] = "Notebook"
        self.assertEqual(c.normalize_card("94", value, config()).record["computer"]["form_factor"], "laptop")

    def test_physical_disks_are_summed_without_optical_or_duplicate_rows(self):
        value = card()
        value["94"]["storages"] = [
            {"ID": 1, "MODEL": "PHYSICALDRIVE0", "NAME": "SSD", "DISKSIZE": 256 * 1024},
            {"ID": 2, "MODEL": "PHYSICALDRIVE0", "NAME": "SSD", "DISKSIZE": 256 * 1024},
            {"ID": 3, "MODEL": "PHYSICALDRIVE1", "NAME": "HDD", "DISKSIZE": 1024 * 1024},
            {"ID": 4, "TYPE": "DVD", "DISKSIZE": 10 * 1024},
        ]
        data = c.normalize_card("94", value, config()).record["computer"]
        self.assertEqual((data["storage_capacity_gb"], data["storage_type"]), (1280, "HDD/SSD"))

    def test_invalid_network_values_are_not_sent(self):
        value = card()
        value["94"]["hardware"][0]["IPADDR"] = "not-an-ip"
        value["94"]["networks"] = [{"IPADDRESS": "127.0.0.1", "MACADDR": "bad"}]
        result = c.normalize_card("94", value, config()).record["computer"]
        self.assertIsNone(result["ip_address"])
        self.assertIsNone(result["mac_address"])

    def test_mismatched_id_and_oversized_monitor_list_are_rejected(self):
        value = card()
        value["94"]["hardware"][0]["ID"] = 95
        with self.assertRaises(c.CollectorError):
            c.normalize_card("94", value, config())
        value = card()
        value["94"]["monitors"] *= 21
        with self.assertRaises(c.CollectorError):
            c.normalize_card("94", value, config())

    def test_unknown_chassis_does_not_force_desktop_for_existing_laptop(self):
        value = card()
        value["94"]["bios"][0]["TYPE"] = "Unknown"
        self.assertNotIn("form_factor", c.normalize_card("94", value, config()).record["computer"])


class PipelineTests(unittest.TestCase):
    def test_servers_and_virtual_machines_are_skipped_before_ad_and_duplicates(self):
        server = card("95", "DC3")
        server["95"]["hardware"][0]["OSNAME"] = "Microsoft Windows Server 2019 Standard"
        vm = card("96", "VM-TIMUR")
        vm["96"]["bios"][0]["SMODEL"] = "Virtual Machine"
        rack = card("97", "LINUX-SERVER")
        rack["97"]["bios"][0]["TYPE"] = "Rack Mount Chassis"
        client = MagicMock()
        client.request.side_effect = [server, vm, rack, card()]
        lookup = MagicMock(side_effect=ad_users)
        records, report = c.prepare_records(client, ["95", "96", "97", "94"], config(), lookup)
        self.assertEqual([row["ocs_id"] for row in records], ["94"])
        self.assertEqual([row["status"] for row in report], ["skipped", "skipped", "skipped", "prepared"])
        self.assertEqual(len(lookup.call_args.args[0]), 1)
        self.assertIn("Server", report[0]["message"])
        self.assertIn("Virtual machine", report[1]["message"])

    def test_laptop_and_primary_pc_are_allowed_and_kept_in_same_batch(self):
        client = MagicMock()
        laptop = card("95", "NOTE-BUH-2", serial="LAP-001")
        laptop["95"]["monitors"] = []
        client.request.side_effect = [laptop, card()]
        records, report = c.prepare_records(client, ["95", "94"], config(), ad_users)
        self.assertEqual(len(records), 2)
        self.assertTrue(all(row["status"] == "prepared" for row in report))
        batches = c.build_batches(records, 2)
        self.assertEqual([[r["ocs_id"] for r in batch] for batch in batches], [["94", "95"]])
        with self.assertRaises(c.CollectorError):
            c.build_batches(records, 1)

    def test_shared_monitor_still_blocks_pc_and_laptop(self):
        client = MagicMock()
        client.request.side_effect = [card(), card("95", "NOTE-BUH-2", serial="LAP-001")]
        records, report = c.prepare_records(client, ["94", "95"], config(), ad_users)
        self.assertEqual(records, [])
        self.assertEqual(report[0]["duplicate_keys"], [["monitor", "72"]])

    def test_blocked_primary_does_not_leave_laptop_to_create_another_workplace(self):
        laptop = card("95", "NOTE-BUH-2", serial="LAP-001")
        laptop["95"]["monitors"] = []
        other = card("96", "OTHER-PC", login="a.other", serial="PC-002")
        client = MagicMock()
        client.request.side_effect = [card(), laptop, other]
        records, report = c.prepare_records(client, ["94", "95", "96"], config(), ad_users)
        self.assertEqual(records, [])
        self.assertTrue(all(row["status"] == "conflict" for row in report))
        self.assertEqual(report[1]["duplicate_keys"][0][0], "employee_group")

    def test_confirmed_op_krd_match_is_explicit_and_checks_source_name(self):
        computer = c.normalize_card("555", card("555", "OP-KRD-1"), config()).record["computer"]
        self.assertEqual(computer["match_existing_name"], "OP-KRD-1")
        with self.assertRaises(c.CollectorError):
            c.normalize_card("555", card("555", "UNEXPECTED-PC"), config())
        explicit = config(computer_matches={"555": {"name": "OP-KRD-1", "item_id": 123}})
        computer = c.normalize_card("555", card("555", "OP-KRD-1"), explicit).record["computer"]
        self.assertEqual(computer["item_id"], 123)
        self.assertNotIn("match_existing_name", computer)

    def test_stale_empty_and_unreachable_cards_are_reported_before_ad(self):
        old = card("95")
        old["95"]["hardware"][0]["LASTDATE"] = (datetime.now(timezone.utc) - timedelta(days=40)).isoformat()
        empty = card("96", login="")
        client = MagicMock()
        client.request.side_effect = [old, empty, c.CollectorError("HTTP 500")]
        lookup = MagicMock(return_value={})
        records, report = c.prepare_records(client, ["95", "96", "97"], config(), lookup)
        self.assertEqual(records, [])
        self.assertEqual([row["status"] for row in report], ["skipped", "skipped", "error"])
        lookup.assert_called_once_with([], unittest.mock.ANY)

    def test_duplicate_employee_is_not_imported_first_from_different_batches(self):
        client = MagicMock()
        client.request.side_effect = [card(), card("95", "WS-TEST-02", serial="PC-002")]
        records, report = c.prepare_records(client, ["94", "95"], config(batch_size=1), ad_users)
        self.assertEqual(records, [])
        self.assertTrue(all(row["status"] == "conflict" for row in report))

    def test_foreign_disabled_and_missing_ad_users_are_not_imported(self):
        for status in ("foreign_domain", "disabled", "not_found", "query_error"):
            with self.subTest(status=status):
                client = MagicMock()
                client.request.return_value = card()
                lookup = lambda queries, cfg: {"0": {"status": status}}
                records, report = c.prepare_records(client, ["94"], config(), lookup)
                self.assertEqual(records, [])
                self.assertEqual(report[0]["status"], "error" if status == "query_error" else "skipped")

    def test_malformed_or_foreign_confirmed_identity_is_rejected(self):
        for changes in ({"domain": "other.local"}, {"ad_enabled": "True"}, {"ad_guid": "not-a-guid"}):
            with self.subTest(changes=changes):
                def lookup(queries, cfg):
                    result = ad_users(queries, cfg)
                    result["0"]["employee"].update(changes)
                    return result
                client = MagicMock()
                client.request.return_value = card()
                self.assertEqual(c.prepare_records(client, ["94"], config(), lookup)[1][0]["status"], "error")


class CliTests(unittest.TestCase):
    def execute(self, mode=None, token="test-secret", post_error=None):
        directory = tempfile.TemporaryDirectory()
        self.addCleanup(directory.cleanup)
        config_file = Path(directory.name) / "config.json"
        settings = vars(config())
        settings["output_directory"] = "output"
        config_file.write_text(json.dumps(settings), encoding="utf-8")
        client = MagicMock()
        response = {"dry_run": mode != "--apply", "records": [], "computers_created": 1}
        client.request.side_effect = [card(), post_error or response]
        stream = io.StringIO()
        with patch.object(c, "HttpClient", return_value=client), patch.object(c, "resolve_ad", side_effect=ad_users), \
                patch.dict(os.environ, {"OCS_AD_IMPORT_TOKEN": token}), redirect_stdout(stream), redirect_stderr(stream):
            code = c.main(["--config", str(config_file), "--computer-id", "94"] + ([mode] if mode else []))
        report_files = list(Path(directory.name).glob("output/*/report.json"))
        report = json.loads(report_files[0].read_text(encoding="utf-8")) if report_files else None
        return code, client, report, stream.getvalue(), directory.name

    def test_default_is_dry_run_and_token_never_appears_in_reports(self):
        code, client, report, output, folder = self.execute()
        self.assertEqual(code, 0)
        self.assertEqual(report["mode"], "dry-run")
        sent = client.request.call_args_list[1]
        self.assertEqual(sent.args[0], "http://app:3000/api/integrations/ocs-ad/import")
        self.assertTrue(sent.args[1]["dry_run"])
        self.assertEqual(sent.args[2], "test-secret")
        self.assertNotIn("test-secret", output)
        for path in Path(folder).glob("output/*/*.json"):
            self.assertNotIn("test-secret", path.read_text(encoding="utf-8"))

    def test_collect_only_requires_no_token_and_never_posts(self):
        code, client, report, _, _ = self.execute("--collect-only", token="")
        self.assertEqual(code, 0)
        self.assertEqual(client.request.call_count, 1)
        self.assertEqual(report["mode"], "collect-only")

    def test_apply_is_explicit_and_pending_batch_is_preserved_on_failure(self):
        code, client, report, _, _ = self.execute("--apply", post_error=c.CollectorError("HTTP timeout"))
        self.assertEqual(code, 1)
        self.assertFalse(client.request.call_args_list[1].args[1]["dry_run"])
        self.assertEqual(client.request.call_count, 2)
        self.assertEqual(report["pending_batch"], 0)
        self.assertEqual(report["error"], "HTTP timeout")

    def test_empty_token_is_rejected_before_ocs_reads(self):
        code, client, report, output, _ = self.execute(token="")
        self.assertEqual(code, 1)
        self.assertEqual(client.request.call_count, 0)
        self.assertIsNone(report)
        self.assertIn("OCS_AD_IMPORT_TOKEN", output)


class ConfigTests(unittest.TestCase):
    def test_urls_offsets_and_limits_are_validated(self):
        self.assertEqual(config().import_url, "http://app:3000/api/integrations/ocs-ad/import")
        for changes in ({"batch_size": 501}, {"max_age_days": 0}, {"ocs_timezone": "local"}, {"laptop_names": "x"},
                        {"computer_matches": []}, {"computer_matches": {"555": {"name": ""}}},
                        {"computer_matches": {"555": {"name": "OP-KRD-1", "item_id": True}}}):
            with self.subTest(changes=changes), self.assertRaises(c.CollectorError):
                config(**changes)
        for url in ("http://user:password@host", "file:///etc/passwd", "http://host?secret=x"):
            with self.assertRaises(c.CollectorError):
                c.url_base(url)

    def test_redirects_are_not_followed_with_bearer_token(self):
        self.assertIsNone(c.NoRedirect().redirect_request(None, None, 302, None, None, "http://other"))


@unittest.skipUnless(shutil.which("powershell.exe"), "Windows PowerShell is required")
class PowerShellTests(unittest.TestCase):
    def test_identity_formats_domains_disabled_users_and_utf8_without_live_ad(self):
        queries = [
            {"key": "0", "raw_login": "m.shutov", "domain_hint": "ruskon.local"},
            {"key": "1", "raw_login": "RUSKON\\m.shutov", "domain_hint": ""},
            {"key": "2", "raw_login": "OTHER\\m.shutov", "domain_hint": ""},
            {"key": "3", "raw_login": "m.shutov@ruskon.local", "domain_hint": ""},
            {"key": "4", "raw_login": "m.shutov@other.local", "domain_hint": ""},
            {"key": "5", "raw_login": "m.shutov", "domain_hint": "WORKGROUP"},
            {"key": "6", "raw_login": "disabled", "domain_hint": "ruskon.local"},
            {"key": "7", "raw_login": "00000000-0000-0000-0000-000000000001", "domain_hint": ""},
        ]
        script = Path(c.__file__).with_name("get_ad_users.ps1")
        with tempfile.TemporaryDirectory() as folder:
            input_path, output_path = Path(folder) / "input.json", Path(folder) / "output.json"
            input_path.write_text(json.dumps(queries), encoding="utf-8")
            def quote(path):
                return "'" + str(path).replace("'", "''") + "'"
            # These functions replace AD cmdlets in this test process only.
            harness = """
function Import-Module { param($Name, $ErrorAction) }
function Get-ADDomain {
    param($Server, $ErrorAction)
    return [pscustomobject]@{ DNSRoot = 'ruskon.local'; NetBIOSName = 'RUSKON' }
}
function Get-ADUser {
    param($Identity, $Filter, $Properties, $Server, $ErrorAction)
    if ($Filter) {
        $requestedUpn = Get-Variable upn -Scope 1 -ValueOnly
        if ($requestedUpn -ne 'm.shutov@ruskon.local') { return }
    }
    $sam = if ($Identity -eq 'disabled') { 'disabled' } else { 'm.shutov' }
    return [pscustomobject]@{
        SamAccountName = $sam; UserPrincipalName = ($sam + '@ruskon.local')
        ObjectGUID = [guid]'3dc0fec6-9dfa-40dd-b115-cf6eaa9b4642'
        DisplayName = 'Шутов Максим'; Name = 'Шутов Максим'
        GivenName = 'Максим'; Surname = 'Шутов'; Enabled = ($sam -ne 'disabled')
        Title = $null; EmailAddress = $null; telephoneNumber = $null
    }
}
"""
            harness += "& " + quote(script) + " -InputPath " + quote(input_path) + " -OutputPath " + quote(output_path)
            harness += " -Server 'test-dc' -ExpectedDomain 'ruskon.local'\n"
            harness_path = Path(folder) / "harness.ps1"
            harness_path.write_text(harness, encoding="utf-8-sig")
            process = subprocess.run(["powershell.exe", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass",
                                      "-File", str(harness_path)], capture_output=True, timeout=30)
            self.assertEqual(process.returncode, 0, process.stderr.decode(errors="replace"))
            result = json.loads(output_path.read_text(encoding="utf-8"))
        self.assertTrue(result["ok"])
        users = result["users"]
        self.assertEqual([user["status"] for user in users], [
            "found", "found", "foreign_domain", "found", "not_found", "foreign_domain", "disabled", "invalid_login",
        ])
        self.assertEqual(users[0]["employee"]["full_name"], "Шутов Максим")
        self.assertEqual(users[0]["employee"]["domain"], "ruskon.local")


class ApiContractTests(unittest.TestCase):
    def test_collector_payload_is_accepted_by_backend_and_is_repeatable(self):
        try:
            from fastapi import FastAPI
            from fastapi.testclient import TestClient
            from sqlalchemy import create_engine
            from sqlalchemy.orm import sessionmaker
            from sqlalchemy.pool import StaticPool
            from database import Base, get_db
            from import_schemas import OcsAdImportRequest
            from models import WarehouseItem, Employee, Workplace, WorkplaceAssetAssignment
            from routers import integrations
        except ImportError:
            self.skipTest("Run in the backend container for the real API contract check")
        client = MagicMock()
        laptop = card("95", "Ershov-Note", serial="LAP-001")
        laptop["95"]["monitors"] = []
        client.request.side_effect = [laptop, card()]
        records, _ = c.prepare_records(client, ["95", "94"], config(), ad_users)
        request = {"records": c.build_batches(records, 200)[0], "dry_run": True}
        OcsAdImportRequest.model_validate(request)
        engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
        self.addCleanup(engine.dispose)
        Base.metadata.create_all(engine)
        sessions = sessionmaker(bind=engine)
        app = FastAPI()
        app.include_router(integrations.router, prefix="/api/integrations")
        def db_override():
            with sessions() as db:
                yield db
        app.dependency_overrides[get_db] = db_override
        app.dependency_overrides[integrations.get_import_user] = lambda: {"username": "test-collector"}
        with TestClient(app) as api:
            preview = api.post("/api/integrations/ocs-ad/import", json=request)
            self.assertEqual(preview.status_code, 200, preview.text)
            self.assertEqual([r["computer_category"] for r in preview.json()["records"]], ["Компьютеры", "Ноутбуки"])
            self.assertEqual(preview.json()["employees_created"], 1)
            self.assertEqual(preview.json()["workplaces_created"], 1)
            self.assertEqual(preview.json()["conflicts"], 0)
            with sessions() as db:
                self.assertEqual(db.query(WarehouseItem).count(), 0)
            request["dry_run"] = False
            applied = api.post("/api/integrations/ocs-ad/import", json=request)
            repeated = api.post("/api/integrations/ocs-ad/import", json=request)
            self.assertEqual(applied.status_code, 200, applied.text)
            self.assertEqual(repeated.json()["computers_created"], 0)
            with sessions() as db:
                self.assertEqual({item.category for item in db.query(WarehouseItem)}, {"Компьютеры", "Ноутбуки"})
                self.assertEqual(db.query(Employee).count(), 1)
                self.assertEqual(db.query(Workplace).count(), 1)
                self.assertEqual(db.query(WorkplaceAssetAssignment).count(), 2)


if __name__ == "__main__":
    unittest.main()
