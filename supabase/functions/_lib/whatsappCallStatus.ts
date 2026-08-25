/** Shared WhatsApp call status labels for CRM communications. */

export function callStatusLabel(status: string): string {
  switch (status) {
    case "offer":
      return "входящий";
    case "pickUp":
      return "отвечен";
    case "hungUp":
      return "сброшен";
    case "declined":
    case "missed":
      return "пропущен";
    default:
      return status || "звонок";
  }
}

export function callCommStatus(status: string): string {
  switch (status) {
    case "offer":
      return "ringing";
    case "pickUp":
      return "answered";
    case "hungUp":
    case "declined":
    case "missed":
      return "missed";
    default:
      return status || "call";
  }
}

export function callContent(status: string): string {
  return `📞 WhatsApp-звонок: ${callStatusLabel(status)}`;
}
