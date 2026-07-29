#!/usr/bin/env python3
"""DISABLED: do not reclaim Green API webhookUrl to MarkVision CRM.

History: a VPS cron (`/etc/cron.d/markvision-greenapi-webhook-guard`, every
minute) fought an n8n watcher that pointed the same instance at the bot.
Each setSettings reload thrashed the instance → 0 greetings for hours.

Bot owns the Green API webhook. CRM must receive copies via n8n forward
(or a dedicated second instance), not by stealing webhookUrl.
"""
from __future__ import annotations

import sys


def main() -> int:
    print(
        "disabled: CRM webhook auto-reclaim is off "
        "(bot owns Green API webhook; see scripts/ensure-greenapi-crm-webhook.py)"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
