'use client';

import { useState } from 'react';
import { Contact, MessageTemplate } from '@/types';
import {
  resolveAudienceContactsAction,
  upsertCsvContactsAction,
  createBroadcastRecordAction,
  insertBroadcastRecipientsAction,
  fetchBroadcastRecipientsForSendingAction,
  preloadCustomValuesIndexAction,
  updateRecipientStatusAction,
  finalizeBroadcastStatusAction,
} from '@/app/actions/broadcasts';

export type CustomFieldOperator = 'is' | 'is_not' | 'contains';

export interface CustomFieldFilter {
  fieldId: string;
  operator: CustomFieldOperator;
  value: string;
}

export interface AudienceConfig {
  type: 'all' | 'tags' | 'custom_field' | 'csv';
  tagIds?: string[];
  customField?: CustomFieldFilter;
  csvContacts?: { phone: string; name?: string }[];
  /** Contacts carrying any of these tags are subtracted from the result. */
  excludeTagIds?: string[];
}

/**
 * Variable mapping — each template placeholder (by key, usually "1",
 * "2", …) is resolved at send time. `field` maps to a built-in contact
 * field (name/phone/email/company); `custom_field` maps to a
 * contact_custom_values.value row keyed by the custom_fields.id stored
 * in `value`.
 */
export type VariableMapping =
  | { type: 'static'; value: string }
  | { type: 'field'; value: string }
  | { type: 'custom_field'; value: string };

interface BroadcastPayload {
  name: string;
  template: MessageTemplate;
  audience: AudienceConfig;
  variables: Record<string, VariableMapping>;
}

interface UseBroadcastSendingReturn {
  createAndSendBroadcast: (payload: BroadcastPayload) => Promise<string>;
  isProcessing: boolean;
  progress: number;
}

/**
 * Meta rate-limit buffer. 10 per batch + 1 s pause matches the spec
 * and keeps us comfortably under Meta's per-phone-number messaging
 * rate so a large broadcast never trips the upstream limiter.
 */
const SEND_BATCH_SIZE = 10;
const SEND_BATCH_DELAY_MS = 1000;

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

interface BroadcastApiResult {
  phone: string;
  status: 'sent' | 'failed';
  whatsapp_message_id?: string;
  error?: string;
}

/**
 * Per-contact resolution of custom-field placeholders. Static and
 * built-in-field mappings resolve synchronously; custom fields read
 * from a pre-built index to avoid N+1 queries during the send loop.
 */
export function resolveVariables(
  variables: Record<string, VariableMapping>,
  contact: Contact,
  customValues?: Record<string, string>,
): string[] {
  // Keys are typically "1","2",... — numeric-aware sort keeps
  // {{1}} before {{10}}.
  const keys = Object.keys(variables).sort((a, b) => {
    const an = Number(a);
    const bn = Number(b);
    if (Number.isFinite(an) && Number.isFinite(bn)) return an - bn;
    return a.localeCompare(b);
  });

  return keys.map((key) => {
    const v = variables[key];
    if (v.type === 'static') return v.value;

    if (v.type === 'field') {
      const fieldMap: Record<string, string | undefined> = {
        name: contact.name,
        phone: contact.phone,
        email: contact.email,
        company: contact.company,
      };
      return fieldMap[v.value] ?? '';
    }

    // custom_field
    return customValues?.[v.value] ?? '';
  });
}

export function useBroadcastSending(): UseBroadcastSendingReturn {
  const [isProcessing, setIsProcessing] = useState(false);
  const [progress, setProgress] = useState(0);

  async function resolveAudience(audience: AudienceConfig): Promise<Contact[]> {
    if (audience.type === 'csv' && audience.csvContacts) {
      return (await upsertCsvContactsAction(audience.csvContacts)) as Contact[];
    }

    return (await resolveAudienceContactsAction(audience)) as Contact[];
  }

  async function createAndSendBroadcast(payload: BroadcastPayload): Promise<string> {
    setIsProcessing(true);
    setProgress(0);

    try {
      // ── Step 1: Resolve audience contacts ─────────────────────────
      setProgress(5);
      const contactsList = await resolveAudience(payload.audience);

      if (contactsList.length === 0) {
        throw new Error('No contacts found for this audience.');
      }

      // ── Step 2: Create broadcast row ──────────────────────────────
      setProgress(10);
      const broadcast = await createBroadcastRecordAction({
        name: payload.name,
        templateName: payload.template.name,
        templateLanguage: payload.template.language ?? 'en_US',
        variables: payload.variables,
        audienceFilter: payload.audience,
        totalRecipients: contactsList.length,
      });

      if (!broadcast) {
        throw new Error('Failed to create broadcast record');
      }

      // ── Step 3: Insert recipient rows ─────────────────────────────
      setProgress(20);
      const recipientRows = contactsList.map((contact) => ({
        contactId: contact.id,
        status: 'pending' as const,
      }));

      await insertBroadcastRecipientsAction(broadcast.id, recipientRows);

      // ── Step 4: Fetch recipients (joined contact) + preload custom values
      setProgress(30);
      const recipients = await fetchBroadcastRecipientsForSendingAction(broadcast.id);

      if (!recipients) {
        throw new Error('Failed to fetch broadcast recipients');
      }

      // One bulk fetch of custom values for every contact in this
      // broadcast, avoiding N+1 during the send loop.
      const contactIds = recipients
        .map((r) => r.contact?.id)
        .filter((id): id is string => Boolean(id));
      const customValueIndex = await preloadCustomValuesIndexAction(contactIds);

      let failedCount = 0;
      const totalRecipients = recipients.length;

      for (let i = 0; i < recipients.length; i += SEND_BATCH_SIZE) {
        const batch = recipients.slice(i, i + SEND_BATCH_SIZE);

        const apiRecipients = batch
          .filter((r) => r.contact?.phone)
          .map((r) => ({
            phone: r.contact!.phone as string,
            params: r.contact
              ? resolveVariables(
                  payload.variables,
                  r.contact as unknown as Contact,
                  customValueIndex[r.contact.id],
                )
              : [],
          }));

        if (apiRecipients.length === 0) continue;

        try {
          const res = await fetch('/api/whatsapp/broadcast', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              recipients: apiRecipients,
              template_name: payload.template.name,
              template_language: payload.template.language ?? 'en_US',
            }),
          });

          const data = await res.json();

          if (!res.ok) {
            throw new Error(data.error || 'Broadcast API request failed');
          }

          const resultsByPhone = new Map<string, BroadcastApiResult>();
          for (const r of (data.results ?? []) as BroadcastApiResult[]) {
            resultsByPhone.set(r.phone, r);
          }

          for (const recipient of batch) {
            const phone = recipient.contact?.phone;
            const result = phone ? resultsByPhone.get(phone) : undefined;

            if (!result) {
              failedCount++;
              await updateRecipientStatusAction(recipient.id, {
                status: 'failed',
                errorMessage: 'No phone number on contact',
              });
              continue;
            }

            if (result.status === 'sent') {
              await updateRecipientStatusAction(recipient.id, {
                status: 'sent',
                whatsappMessageId: result.whatsapp_message_id ?? null,
                errorMessage: null,
              });
            } else {
              failedCount++;
              await updateRecipientStatusAction(recipient.id, {
                status: 'failed',
                errorMessage: result.error ?? 'Unknown error',
              });
            }
          }
        } catch (err) {
          for (const recipient of batch) {
            failedCount++;
            await updateRecipientStatusAction(recipient.id, {
              status: 'failed',
              errorMessage: err instanceof Error ? err.message : 'Unknown error',
            });
          }
        }

        const progressPct =
          30 + Math.round(((i + batch.length) / totalRecipients) * 60);
        setProgress(progressPct);

        if (i + SEND_BATCH_SIZE < recipients.length) {
          await sleep(SEND_BATCH_DELAY_MS);
        }
      }

      // ── Step 5: Finalize status ───────────────────────────────────
      setProgress(95);
      const finalStatus = failedCount === totalRecipients ? 'failed' : 'sent';
      await finalizeBroadcastStatusAction(broadcast.id, finalStatus);

      setProgress(100);
      return broadcast.id;
    } finally {
      setIsProcessing(false);
    }
  }

  return { createAndSendBroadcast, isProcessing, progress };
}
