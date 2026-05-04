import {
  Zap,
  Bell,
  MessageCircle,
  CreditCard,
  Calendar,
  MapPin,
  Check,
  Ban,
  type LucideIcon,
} from "lucide-react";
import type { LeadStage } from "@/types/crm";

const ICONS: Record<LeadStage["icon"], LucideIcon> = {
  zap: Zap,
  bell: Bell,
  message: MessageCircle,
  card: CreditCard,
  calendar: Calendar,
  map: MapPin,
  check: Check,
  ban: Ban,
};

export function getStageIcon(stage: LeadStage): LucideIcon {
  return ICONS[stage.icon] ?? Zap;
}

export function stageColorClasses(color: string) {
  switch (color) {
    case "warning":
      return {
        text: "text-warning",
        bg: "bg-warning/15",
        ring: "ring-warning/30",
        bar: "bg-warning",
      };
    case "success":
      return {
        text: "text-success",
        bg: "bg-success/15",
        ring: "ring-success/30",
        bar: "bg-success",
      };
    case "destructive":
      return {
        text: "text-destructive",
        bg: "bg-destructive/15",
        ring: "ring-destructive/30",
        bar: "bg-destructive",
      };
    default:
      return {
        text: "text-primary",
        bg: "bg-primary/15",
        ring: "ring-primary/30",
        bar: "bg-primary",
      };
  }
}