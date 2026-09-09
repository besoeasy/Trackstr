---
name: systemd-commands
description: "Manage services, units, and logs with systemd. Use when: (1) Starting/stopping/restarting services, (2) Enabling services at boot, (3) Diagnosing service status or reading logs, or (4) User asks to save systemd commands."
---

# Systemd Commands

Manage Linux system services and units with systemd. Covers starting and stopping services, enabling boot persistence, checking status, listing units, and reading logs.

## When to use

- Use case 1: Start, stop, or restart a service
- Use case 2: Enable/disable a service to run at boot
- Use case 3: Check service or system status and diagnose issues
- Use case 4: View or follow service logs

## Required tools / APIs

- `systemctl` — the primary systemd control tool (ships with Linux distros running systemd)

Install options:

```bash
# Ubuntu/Debian
sudo apt-get install -y systemd
```

## Skills

### service management

Start, stop, restart, and reload services.

```bash
sudo systemctl start <service>
sudo systemctl stop <service>
sudo systemctl restart <service>
sudo systemctl reload <service>
sudo systemctl status <service>
```

### enable/disable at boot

Control whether a service starts automatically at boot.

```bash
sudo systemctl enable <service>
sudo systemctl disable <service>
```

### system operations

Reload configs and list units.

```bash
sudo systemctl daemon-reload
systemctl list-units
systemctl list-unit-files
systemctl is-active <service>
```

### viewing logs

Read or follow service logs with journalctl.

```bash
journalctl -u <service>
journalctl -u <service> -f
```

## Output format

Commands return normal systemd/journalctl output. When automating:

- `systemctl is-active <service>` returns `active`, `inactive`, or `failed`
- `systemctl status` exit code 0 = running, 3 = not running, 4 = no such unit
- `journalctl -u` returns log lines with timestamp, host, and message

## Troubleshooting

**Error scenario 1: "Failed to start service"**
- Symptom: `systemctl start` fails
- Solution: Run `systemctl status <service>` and `journalctl -u <service>` to see the failure reason

**Error scenario 2: Changes not taking effect**
- Symptom: Edited unit file but `systemctl restart` still uses old config
- Solution: Run `sudo systemctl daemon-reload` after editing unit files

## See also

- [../using-telegram-bot/SKILL.md](../using-telegram-bot/SKILL.md) — Running long-lived bot services
- [../integrate-codex-ollama/SKILL.md](../integrate-codex-ollama/SKILL.md) — Installing services that may run under systemd

---

## Notes

- Replace `<service>` with the actual service name (e.g., `nginx`, `ssh`, `docker`)
- `sudo` is required for start/stop/enable/disable on most systems
