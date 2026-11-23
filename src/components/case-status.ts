export const statusTone = (status: string) =>
  ({ IN_PROGRESS: "good", OPEN: "info", ON_HOLD: "warn", CLOSED: "neutral" })[status] ?? "neutral";

export const typeColor = (type: string) =>
  `var(--cat-${["CIVIL", "COMMERCIAL", "CRIMINAL", "PERSONAL_STATUS", "ADMINISTRATIVE"].indexOf(type) + 1})`;

const actionLabels: Record<string, string> = {
  CASE_CREATED: "فُتحت القضية", CASE_UPDATED: "عُدّلت بيانات القضية", CASE_DELETED: "حُذفت القضية", CASE_UPDATE_ADDED: "أضيف تحديث",
  HEARING_CREATED: "سُجلت جلسة", HEARING_UPDATED: "عُدّلت جلسة", HEARING_DELETED: "حُذفت جلسة",
  JUDGMENT_CREATED: "سُجل حكم", JUDGMENT_UPDATED: "عُدّل حكم", JUDGMENT_DELETED: "حُذف حكم", JUDGMENT_CONFIRMDEADLINE: "أُكد موعد الطعن", JUDGMENT_DISMISSDEADLINE: "أُلغي اقتراح موعد الطعن",
  DOCUMENT_UPLOADED: "رُفع مستند", DOCUMENT_UPDATED: "عُدّل مستند", DOCUMENT_DELETED: "حُذف مستند", DOCUMENT_VIEWED: "فُتح مستند", DOCUMENT_DOWNLOADED: "نُزّل مستند",
  MESSAGE_DRAFT_CREATED: "أنشئت مسودة رسالة", MESSAGE_APPROVE: "اعتُمدت رسالة", MESSAGE_MARKSENT: "سُجل إرسال رسالة", MESSAGE_SENT_API: "أُرسلت رسالة عبر واتساب", MESSAGE_CANCEL: "أُلغيت رسالة", MESSAGE_EDITED: "عُدّلت رسالة", MESSAGE_RECEIVED: "وردت رسالة",
  AI_QUESTION: "سؤال للمساعد", AI_DRAFT_CREATED: "جهّز المساعد مسودة", AI_MESSAGE_DRAFT_CREATED: "جهّز المساعد رسالة",
  DRAFT_APPROVE: "اعتُمدت مسودة", DRAFT_REJECT: "رُفضت مسودة", DRAFT_REOPEN: "أعيد فتح مسودة", DRAFT_FROM_TEMPLATE: "أنشئت مسودة من قالب",
  INVOICE_CREATED: "أنشئت فاتورة", INVOICE_DELETED: "حُذفت فاتورة", PAYMENT_RECORDED: "سُجلت دفعة", INTAKE_ACCEPTED: "فُتحت من ملف التوزيع",
  TASK_CREATED: "أضيفت مهمة", TASK_UPDATED: "عُدّلت مهمة", TASK_DELETED: "حُذفت مهمة", NATIONAL_ID_VIEWED: "عُرض الرقم الوطني", RECORD_RESTORED: "استُرجع سجل",
  SETTINGS_UPDATED: "عُدّلت الإعدادات", TEMPLATE_UPDATED: "عُدّل قالب", DEADLINE_RULE_CREATED: "أضيفت قاعدة موعد", DEADLINE_RULE_DELETED: "حُذفت قاعدة موعد",
  PASSWORD_CHANGED: "غُيّرت كلمة المرور", STAFF_CREATED: "أضيف موظف", STAFF_ACTIVATED: "فُعّل موظف", STAFF_DEACTIVATED: "عُطّل موظف", STAFF_PASSWORD_RESET: "أعيد تعيين كلمة مرور موظف",
  EXPENSE_CREATED: "سُجل مصروف", EXPENSE_DELETED: "حُذف مصروف", TIME_LOGGED: "سُجلت ساعات عمل", TIME_DELETED: "حُذفت ساعات عمل", INVOICE_SCHEDULED: "جُدولت دفعات فاتورة",
};
export const actionLabel = (action: string) => actionLabels[action] ?? action;
