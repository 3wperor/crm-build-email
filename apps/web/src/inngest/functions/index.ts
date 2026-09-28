import { warmupSend, warmupTick } from "./warmup";
import { abEvaluate } from "./ab-evaluate";
import { imapSyncAccount, imapSyncTick } from "./imap-sync";
import { processLeadImport } from "./process-lead-import";
import { schedulerTick } from "./scheduler-tick";
import { sendEmail } from "./send-email";
import { verifyLeads } from "./verify-leads";

export const functions = [processLeadImport, verifyLeads, schedulerTick, sendEmail, imapSyncTick, imapSyncAccount, abEvaluate, warmupTick, warmupSend];
