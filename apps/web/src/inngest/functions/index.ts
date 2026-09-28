import { processLeadImport } from "./process-lead-import";
import { schedulerTick } from "./scheduler-tick";
import { sendEmail } from "./send-email";
import { verifyLeads } from "./verify-leads";

export const functions = [processLeadImport, verifyLeads, schedulerTick, sendEmail];
