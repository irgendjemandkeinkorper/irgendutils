import csv
import json
import sys
from datetime import datetime, timezone
from typing import Dict, Any, List, Optional


def build_unified_report(inventory: Dict[str, Any], findings: List[Dict[str, Any]], is_multisite_scope: bool) -> Dict[str, Any]:
    """
    Combine raw inventory, findings, and metadata into a single unified report dictionary.
    """
    total_plugins = len(inventory.get("plugins", []))
    total_themes = len(inventory.get("themes", []))
    total_mu = len(inventory.get("mu_plugins", []))
    total_findings = len(findings)

    # Calculate finding counts by severity
    severity_counts = {"critical": 0, "high": 0, "medium": 0, "low": 0}
    for f in findings:
        sev = f.get("severity", "medium").lower()
        if sev in severity_counts:
            severity_counts[sev] += 1

    # Calculate plugin/theme statuses
    plugin_active = sum(1 for p in inventory.get("plugins", []) if p.get("status") in ("active", "network-active"))
    plugin_inactive = total_plugins - plugin_active

    theme_active = sum(1 for t in inventory.get("themes", []) if t.get("status") == "active")
    theme_inactive = total_themes - theme_active

    return {
        "metadata": {
            "scan_date": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
            "scope": "multisite" if is_multisite_scope else "single-site",
            "counts": {
                "plugins": {
                    "total": total_plugins,
                    "active": plugin_active,
                    "inactive": plugin_inactive
                },
                "themes": {
                    "total": total_themes,
                    "active": theme_active,
                    "inactive": theme_inactive
                },
                "mu_plugins": {
                    "total": total_mu
                },
                "findings": {
                    "total": total_findings,
                    "by_severity": severity_counts
                }
            }
        },
        "inventory": inventory,
        "findings": findings
    }


def format_terminal_summary(report: Dict[str, Any], output_stream=sys.stdout) -> None:
    """
    Print a beautiful terminal layout representing inventory and findings.
    """
    meta = report["metadata"]
    inv = report["inventory"]
    findings = report["findings"]

    # Title
    output_stream.write("=========================================================\n")
    output_stream.write("          WORDPRESS EXTENSION & RISK REPORT              \n")
    output_stream.write("=========================================================\n\n")

    # Metadata
    output_stream.write(f"Scan Date:      {meta['scan_date']}\n")
    output_stream.write(f"Scope:          {meta['scope'].upper()}\n")
    core_version = inv.get("core", {}).get("version", "Unknown")
    output_stream.write(f"WP Core:        {core_version}\n\n")

    # Helper to print aligned tables
    def print_table(headers: List[str], rows: List[List[str]]):
        widths = [len(h) for h in headers]
        for row in rows:
            for idx, cell in enumerate(row):
                widths[idx] = max(widths[idx], len(str(cell)))

        header_str = "  ".join(f"{str(cell).ljust(widths[idx])}" for idx, cell in enumerate(headers))
        output_stream.write(header_str + "\n")
        output_stream.write("-" * (sum(widths) + 2 * (len(headers) - 1)) + "\n")

        for row in rows:
            row_str = "  ".join(f"{str(cell).ljust(widths[idx])}" for idx, cell in enumerate(row))
            output_stream.write(row_str + "\n")
        output_stream.write("\n")

    # Plugins Table
    output_stream.write("--- INSTALLED PLUGINS ---\n")
    plugin_rows = []
    for p in inv.get("plugins", []):
        plugin_rows.append([
            p.get("name", "N/A"),
            p.get("version", "N/A") or "Unknown",
            p.get("status", "N/A").upper(),
            p.get("auto_update", "N/A").upper(),
            p.get("update", "N/A").upper()
        ])
    if plugin_rows:
        print_table(["Name", "Version", "Status", "Auto-Update", "Update Avail"], plugin_rows)
    else:
        output_stream.write("No plugins found.\n\n")

    # Themes Table
    output_stream.write("--- INSTALLED THEMES ---\n")
    theme_rows = []
    for t in inv.get("themes", []):
        theme_rows.append([
            t.get("name", "N/A"),
            t.get("version", "N/A") or "Unknown",
            t.get("status", "N/A").upper(),
            t.get("auto_update", "N/A").upper(),
            t.get("update", "N/A").upper()
        ])
    if theme_rows:
        print_table(["Name", "Version", "Status", "Auto-Update", "Update Avail"], theme_rows)
    else:
        output_stream.write("No themes found.\n\n")

    # MU Plugins Table
    if inv.get("mu_plugins"):
        output_stream.write("--- MUST-USE PLUGINS ---\n")
        mu_rows = []
        for mu in inv.get("mu_plugins", []):
            mu_rows.append([
                mu.get("name", "N/A"),
                mu.get("version", "N/A") or "Unknown",
                "MUST-USE"
            ])
        print_table(["Name", "Version", "Type"], mu_rows)

    # Risk Findings Section
    output_stream.write("=========================================================\n")
    output_stream.write("                     RISK FINDINGS                       \n")
    output_stream.write("=========================================================\n")

    if findings:
        for idx, f in enumerate(findings, 1):
            sev = f.get("severity", "MEDIUM").upper()
            rule = f.get("rule", "Unknown")
            name = f.get("name", "Unknown")
            msg = f.get("message", "")

            output_stream.write(f"[{idx}] [{sev}] {name} ({rule.replace('_', ' ').title()})\n")
            output_stream.write(f"    {msg}\n\n")
    else:
        output_stream.write("No security or compliance risks identified. Clean scan!\n\n")

    # Summary Statistics
    counts = meta["counts"]
    output_stream.write("=========================================================\n")
    output_stream.write("                     SUMMARY STATS                       \n")
    output_stream.write("=========================================================\n")
    output_stream.write(f"Plugins:        {counts['plugins']['total']} total "
                        f"({counts['plugins']['active']} active, {counts['plugins']['inactive']} inactive)\n")
    output_stream.write(f"Themes:         {counts['themes']['total']} total "
                        f"({counts['themes']['active']} active, {counts['themes']['inactive']} inactive)\n")
    output_stream.write(f"MU-Plugins:     {counts['mu_plugins']['total']}\n")

    f_counts = counts["findings"]["by_severity"]
    output_stream.write(f"Total Risks:    {counts['findings']['total']} "
                        f"(Critical: {f_counts['critical']}, High: {f_counts['high']}, "
                        f"Medium: {f_counts['medium']}, Low: {f_counts['low']})\n")
    output_stream.write("=========================================================\n")


def generate_json(report: Dict[str, Any]) -> str:
    """
    Serialize the unified report into a formatted JSON string.
    """
    return json.dumps(report, indent=2)


def generate_csv_stream(report: Dict[str, Any], output_stream) -> None:
    """
    Export the entire extension inventory with status and risk flags into a single CSV stream.
    """
    inv = report["inventory"]
    findings = report["findings"]

    # Create mapping of (Type, Name) -> (List of Findings, Highest Severity)
    item_risks = {}
    for f in findings:
        f_type = f.get("type")
        f_name = f.get("name")
        key = (f_type, f_name)
        if key not in item_risks:
            item_risks[key] = {"messages": [], "severities": []}
        item_risks[key]["messages"].append(f.get("message"))
        item_risks[key]["severities"].append(f.get("severity", "medium").lower())

    def get_risk_info(item_type: str, item_name: str):
        key = (item_type, item_name)
        if key not in item_risks:
            return "None", "None"
        info = item_risks[key]
        messages = "; ".join(info["messages"])

        # Determine highest severity
        priority = {"critical": 4, "high": 3, "medium": 2, "low": 1}
        highest_sev = "low"
        highest_val = 0
        for s in info["severities"]:
            val = priority.get(s, 0)
            if val > highest_val:
                highest_val = val
                highest_sev = s
        return messages, highest_sev.upper()

    headers = [
        "Type", "Name", "Installed Version", "Status", "Auto-Update", "Update Available", "Risk Findings", "Highest Severity"
    ]

    writer = csv.writer(output_stream)
    writer.writerow(headers)

    # Write WordPress Core row
    core_version = inv.get("core", {}).get("version", "Unknown")
    core_up_avail = "none"
    core_updates = inv.get("core", {}).get("updates", [])
    if core_updates:
        latest_update = core_updates[0].get("version")
        if latest_update:
            core_up_avail = f"available ({latest_update})"

    core_msg, core_sev = get_risk_info("core", "WordPress Core")
    writer.writerow([
        "core", "WordPress Core", core_version, "active", "N/A", core_up_avail, core_msg, core_sev
    ])

    # Write Plugins
    for p in inv.get("plugins", []):
        p_name = p.get("name", "")
        p_ver = p.get("version", "")
        p_status = p.get("status", "")
        p_auto = p.get("auto_update", "N/A")
        p_up = p.get("update", "none")
        if p_up == "available" and p.get("update_version"):
            p_up = f"available ({p['update_version']})"

        p_msg, p_sev = get_risk_info("plugin", p_name)
        writer.writerow([
            "plugin", p_name, p_ver, p_status, p_auto, p_up, p_msg, p_sev
        ])

    # Write Themes
    for t in inv.get("themes", []):
        t_name = t.get("name", "")
        t_ver = t.get("version", "")
        t_status = t.get("status", "")
        t_auto = t.get("auto_update", "N/A")
        t_up = t.get("update", "none")
        if t_up == "available" and t.get("update_version"):
            t_up = f"available ({t['update_version']})"

        t_msg, t_sev = get_risk_info("theme", t_name)
        writer.writerow([
            "theme", t_name, t_ver, t_status, t_auto, t_up, t_msg, t_sev
        ])

    # Write MU Plugins
    for mu in inv.get("mu_plugins", []):
        mu_name = mu.get("name", "")
        mu_ver = mu.get("version", "")
        mu_msg, mu_sev = get_risk_info("mu-plugin", mu_name)
        writer.writerow([
            "mu-plugin", mu_name, mu_ver, "must-use", "N/A", "N/A", mu_msg, mu_sev
        ])
