/** Реэкспорт чистых правил автоматизаций из edge-функций — чтобы тесты видели один и тот же код. */
export {
  awaitingReply,
  pickStageMapRow,
  type ReplyState,
  type StageMapRow,
} from "../../supabase/functions/_lib/automationRules";
