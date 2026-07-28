import { describe, expect, it } from "vitest";
import {
  buildBroadcastFunnel,
  countDelivery,
  matchRecipientLeads,
  type BroadcastLeadLite,
  type BroadcastRecipientLite,
} from "@/lib/broadcastFunnel";

const rec = (
  partial: Partial<BroadcastRecipientLite> & { id: string; status: string },
): BroadcastRecipientLite => ({
  name: "",
  phone: "+77001112233",
  leadId: null,
  sentAt: null,
  deliveredAt: null,
  readAt: null,
  repliedAt: null,
  clickedAt: null,
  convertedAt: null,
  joinedAt: null,
  error: null,
  ...partial,
});

describe("broadcastFunnel", () => {
  it("считает доставку кумулятивно", () => {
    const recipients = [
      rec({ id: "1", status: "queued" }),
      rec({ id: "2", status: "sent" }),
      rec({ id: "3", status: "delivered" }),
      rec({ id: "4", status: "read" }),
      rec({ id: "5", status: "replied" }),
      rec({ id: "6", status: "failed" }),
    ];
    const d = countDelivery(recipients);
    expect(d.total).toBe(6);
    expect(d.queued).toBe(1);
    expect(d.sent).toBe(4); // sent+delivered+read+replied
    expect(d.delivered).toBe(3);
    expect(d.read).toBe(2);
    expect(d.replied).toBe(1);
    expect(d.failed).toBe(1);
  });

  it("связывает CRM и считает продажи / группу / вебинар", () => {
    const recipients = [
      rec({ id: "a", status: "read", phone: "+77001110001", leadId: "L1", clickedAt: "2026-07-01" }),
      rec({ id: "b", status: "delivered", phone: "+77001110002", leadId: null }),
      rec({ id: "c", status: "sent", phone: "+77001110003", leadId: "L3" }),
    ];
    const leads: BroadcastLeadLite[] = [
      {
        id: "L1",
        phone: "+77001110001",
        stageKey: "paid",
        stageRole: "paid",
        paid: true,
        amount: 150000,
        depositAmount: 0,
        webinarStatus: "attended",
      },
      {
        id: "L2",
        phone: "77001110002",
        stageKey: "whatsapp",
        stageRole: "joined_group",
        paid: false,
        amount: 0,
        depositAmount: 5000,
        webinarStatus: null,
      },
      {
        id: "L3",
        phone: "+77001110003",
        stageKey: "new",
        stageRole: "new",
        paid: false,
        amount: 0,
        depositAmount: 0,
        webinarStatus: null,
      },
    ];

    const matched = matchRecipientLeads(recipients, leads);
    expect(matched.size).toBe(3);
    expect(matched.get("b")?.id).toBe("L2");

    const funnel = buildBroadcastFunnel(recipients, leads);
    expect(funnel.clicked).toBe(1);
    expect(funnel.leads).toBe(3);
    expect(funnel.groupJoined).toBe(2); // L1 paid + L2 joined_group
    expect(funnel.webinarAttended).toBe(1);
    expect(funnel.deposits).toBe(2); // L1 paid role + L2 deposit
    expect(funnel.sales).toBe(1);
    expect(funnel.revenue).toBe(150000);
  });
});
