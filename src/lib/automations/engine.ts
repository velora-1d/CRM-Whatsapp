import type {
  Automation,
  AutomationLogStepResult,
  AutomationStep,
  AutomationTriggerType,
  AutomationStepType,
  ConditionStepConfig,
  KeywordMatchTriggerConfig,
  SendMessageStepConfig,
  SendTemplateStepConfig,
  SendWebhookStepConfig,
  TagStepConfig,
  UpdateContactFieldStepConfig,
  WaitStepConfig,
  CreateDealStepConfig,
  AssignConversationStepConfig,
} from '@/types'
import { db } from '@/db'
import {
  automations as automationsTable,
  automationSteps,
  automationLogs,
  automationPendingExecutions,
  contactTags,
  contacts,
  conversations,
  profiles,
  deals,
  messages,
} from '@/db/schema'
import { eq, and, gte, isNull, asc, sql } from 'drizzle-orm'
import { engineSendText, engineSendTemplate } from './meta-send'

// ------------------------------------------------------------
// Public API
// ------------------------------------------------------------

export interface AutomationContext {
  /** Raw message text, for keyword_match + message_content conditions. */
  message_text?: string
  /** Conversation the event belongs to, if any. */
  conversation_id?: string
  /** Arbitrary variables accumulated during execution. */
  vars?: Record<string, unknown>
  /** The tag id that was added, for tag_added trigger. */
  tag_id?: string
  /** Agent the conversation was assigned to, for conversation_assigned. */
  agent_id?: string
}

export interface DispatchInput {
  userId: string
  triggerType: AutomationTriggerType
  contactId?: string | null
  context?: AutomationContext
}

/**
 * Fire all active automations matching the given trigger for a user.
 *
 * Must never throw — callers use fire-and-forget from the webhook.
 * All errors are caught and logged; per-automation failures are
 * recorded into automation_logs with status='failed'.
 */
export async function runAutomationsForTrigger(input: DispatchInput): Promise<void> {
  try {
    const automations = await db.query.automations.findMany({
      where: and(
        eq(automationsTable.userId, input.userId),
        eq(automationsTable.triggerType, input.triggerType),
        eq(automationsTable.isActive, true)
      )
    })

    if (!automations || automations.length === 0) return

    for (const automation of automations) {
      if (!triggerMatches(automation as any, input.context)) continue
      try {
        await executeAutomation(automation as any, input)
      } catch (err) {
        console.error('[automations] execute failed:', automation.id, err)
      }
    }
  } catch (err) {
    console.error('[automations] dispatch failed:', err)
  }
}

/**
 * Resume a run that was parked at a wait step. Called from the cron
 * endpoint after it grabs a due `automation_pending_executions` row.
 */
export async function resumePendingExecution(pending: {
  id: string
  automation_id: string
  user_id: string
  contact_id: string | null
  log_id: string | null
  parent_step_id: string | null
  branch: 'yes' | 'no' | null
  next_step_position: number
  context: AutomationContext
}): Promise<void> {
  const automation = await db.query.automations.findFirst({
    where: eq(automationsTable.id, pending.automation_id)
  })

  if (!automation) {
    console.error('[automations] resume: missing automation', pending.automation_id)
    await markPending(pending.id, 'failed')
    return
  }

  try {
    await executeStepsFrom({
      automation: {
        id: automation.id,
        userId: automation.userId,
        name: automation.name,
      },
      contactId: pending.contact_id,
      context: pending.context ?? {},
      parentStepId: pending.parent_step_id,
      branch: pending.branch,
      startPosition: pending.next_step_position,
      logId: pending.log_id,
      triggerEvent: 'resumed_wait',
    })
    await markPending(pending.id, 'done')
  } catch (err) {
    console.error('[automations] resume failed:', err)
    await markPending(pending.id, 'failed')
  }
}

// ------------------------------------------------------------
// Internal execution
// ------------------------------------------------------------

async function executeAutomation(automation: { id: string; userId: string; name: string }, input: DispatchInput) {
  try {
    const [log] = await db
      .insert(automationLogs)
      .values({
        automationId: automation.id,
        userId: automation.userId,
        contactId: input.contactId ?? null,
        triggerEvent: input.triggerType,
        stepsExecuted: [],
        status: 'success',
      })
      .returning()

    if (!log) {
      console.error('[automations] cannot create log')
      return
    }

    await executeStepsFrom({
      automation: automation as any,
      contactId: input.contactId ?? null,
      context: input.context ?? {},
      parentStepId: null,
      branch: null,
      startPosition: 0,
      logId: log.id,
      triggerEvent: input.triggerType,
    })

    // Atomic counter update via Drizzle
    await db
      .update(automationsTable)
      .set({
        executionCount: sql`${automationsTable.executionCount} + 1`,
        lastExecutedAt: new Date()
      })
      .where(eq(automationsTable.id, automation.id))

  } catch (err) {
    console.error('[automations] executeAutomation failed:', err)
  }
}

interface ExecuteArgs {
  automation: { id: string; userId: string; name: string }
  contactId: string | null
  context: AutomationContext
  parentStepId: string | null
  branch: 'yes' | 'no' | null
  startPosition: number
  logId: string | null
  triggerEvent: string
}

async function executeStepsFrom(args: ExecuteArgs): Promise<void> {
  const steps = await db
    .select()
    .from(automationSteps)
    .where(
      and(
        eq(automationSteps.automationId, args.automation.id),
        gte(automationSteps.position, args.startPosition),
        args.parentStepId === null
          ? isNull(automationSteps.parentStepId)
          : and(
              eq(automationSteps.parentStepId, args.parentStepId),
              eq(automationSteps.branch, args.branch ?? 'yes')
            )
      )
    )
    .orderBy(asc(automationSteps.position))

  if (!steps || steps.length === 0) {
    if (args.parentStepId === null && args.logId) {
      await finalizeLog(args.logId, 'success', null)
    }
    return
  }

  const results: AutomationLogStepResult[] = []
  let status: 'success' | 'partial' | 'failed' = 'success'
  let errorMessage: string | null = null

  for (const step of steps) {
    // `wait` is the suspension point: enqueue and stop processing this
    // scope. The cron endpoint will pick it up later.
    if (step.stepType === 'wait') {
      const cfg = step.stepConfig as WaitStepConfig
      const ms = waitMs(cfg)
      await db.insert(automationPendingExecutions).values({
        automationId: args.automation.id,
        userId: args.automation.userId,
        contactId: args.contactId,
        logId: args.logId,
        parentStepId: args.parentStepId,
        branch: args.branch,
        nextStepPosition: step.position + 1,
        context: args.context,
        runAt: new Date(Date.now() + ms),
        status: 'pending',
      })
      results.push({
        step_id: step.id,
        step_type: step.stepType,
        status: 'success',
        detail: `waiting ${cfg.amount} ${cfg.unit}`,
      })
      status = 'partial'
      await appendResults(args.logId, results, status, errorMessage)
      return
    }

    try {
      if (step.stepType === 'condition') {
        const cfg = step.stepConfig as ConditionStepConfig
        const taken = await evaluateCondition(cfg, args)
        results.push({
          step_id: step.id,
          step_type: 'condition',
          status: 'success',
          detail: `branch=${taken ? 'yes' : 'no'}`,
        })
        // Recurse into the chosen branch at position 0 (children use their
        // own ordering within the branch scope).
        await executeStepsFrom({
          ...args,
          parentStepId: step.id,
          branch: taken ? 'yes' : 'no',
          startPosition: 0,
          logId: args.logId,
        })
        continue
      }

      const detail = await runStep(step as any, args)
      results.push({
        step_id: step.id,
        step_type: step.stepType as AutomationStepType,
        status: 'success',
        detail,
      })
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      results.push({
        step_id: step.id,
        step_type: step.stepType as AutomationStepType,
        status: 'failed',
        detail: msg,
      })
      status = 'failed'
      errorMessage = msg
      break
    }
  }

  if (args.parentStepId === null) {
    await appendResults(args.logId, results, status, errorMessage)
  } else {
    // Nested branch — just append results; parent scope decides final status.
    await appendResults(args.logId, results, null, errorMessage)
  }
}

async function runStep(step: AutomationStep, args: ExecuteArgs): Promise<string> {
  switch (step.step_type) {
    case 'send_message': {
      const cfg = step.step_config as SendMessageStepConfig
      if (!args.contactId) throw new Error('send_message needs a contact')
      const text = interpolate(cfg.text, args)
      if (!text.trim()) throw new Error('send_message has empty text')
      const conversationId = await resolveConversationId(args)
      const { whatsapp_message_id } = await engineSendText({
        userId: args.automation.userId,
        conversationId,
        contactId: args.contactId,
        text,
      })
      return `sent via WA (${whatsapp_message_id})`
    }

    case 'send_template': {
      const cfg = step.step_config as SendTemplateStepConfig
      if (!args.contactId) throw new Error('send_template needs a contact')
      if (!cfg.template_name) throw new Error('send_template needs template_name')
      const conversationId = await resolveConversationId(args)
      // Meta templates use positional {{1}}, {{2}}, … placeholders, so
      // we MUST emit params in strict numeric order. Lexicographic sort
      // of "1", "2", …, "10" yields "1", "10", "2", … which silently
      // scrambles every template with ≥10 variables.
      const params = cfg.variables
        ? Object.keys(cfg.variables)
            .sort((a, b) => {
              const na = Number(a)
              const nb = Number(b)
              const aNum = Number.isFinite(na)
              const bNum = Number.isFinite(nb)
              if (aNum && bNum) return na - nb
              if (aNum) return -1
              if (bNum) return 1
              return a.localeCompare(b)
            })
            .map((k) => String(cfg.variables![k]))
        : []
      const { whatsapp_message_id } = await engineSendTemplate({
        userId: args.automation.userId,
        conversationId,
        contactId: args.contactId,
        templateName: cfg.template_name,
        language: cfg.language,
        params,
      })
      return `template sent via WA (${whatsapp_message_id})`
    }

    case 'add_tag': {
      const cfg = step.step_config as TagStepConfig
      if (!args.contactId || !cfg.tag_id) throw new Error('add_tag needs contact + tag_id')
      await db
        .insert(contactTags)
        .values({
          contactId: args.contactId,
          tagId: cfg.tag_id,
        })
        .onConflictDoNothing({
          target: [contactTags.contactId, contactTags.tagId]
        })
      return `tag ${cfg.tag_id} added`
    }

    case 'remove_tag': {
      const cfg = step.step_config as TagStepConfig
      if (!args.contactId || !cfg.tag_id) throw new Error('remove_tag needs contact + tag_id')
      await db
        .delete(contactTags)
        .where(
          and(
            eq(contactTags.contactId, args.contactId),
            eq(contactTags.tagId, cfg.tag_id)
          )
        )
      return `tag ${cfg.tag_id} removed`
    }

    case 'assign_conversation': {
      const cfg = step.step_config as AssignConversationStepConfig
      if (!args.contactId) throw new Error('assign_conversation needs a contact')
      let agentId = cfg.agent_id
      if (cfg.mode === 'round_robin') {
        const profile = await db.query.profiles.findFirst({
          where: eq(profiles.userId, args.automation.userId)
        })
        agentId = profile?.id ?? undefined
      }
      if (!agentId) return 'no agent resolved'
      await db
        .update(conversations)
        .set({ assignedAgentId: agentId })
        .where(
          and(
            eq(conversations.userId, args.automation.userId),
            eq(conversations.contactId, args.contactId)
          )
        )
      return `assigned to ${agentId}`
    }

    case 'update_contact_field': {
      const cfg = step.step_config as UpdateContactFieldStepConfig
      if (!args.contactId) throw new Error('update_contact_field needs a contact')
      const allowed = new Set(['name', 'email', 'company'])
      if (!allowed.has(cfg.field)) {
        return `field ${cfg.field} not writable from automations`
      }
      await db
        .update(contacts)
        .set({ [cfg.field]: cfg.value, updatedAt: new Date() })
        .where(eq(contacts.id, args.contactId))
      return `${cfg.field} updated`
    }

    case 'create_deal': {
      const cfg = step.step_config as CreateDealStepConfig
      if (!cfg.pipeline_id || !cfg.stage_id) throw new Error('create_deal needs pipeline + stage')
      await db.insert(deals).values({
        userId: args.automation.userId,
        pipelineId: cfg.pipeline_id,
        stageId: cfg.stage_id,
        contactId: args.contactId,
        title: interpolate(cfg.title, args),
        value: String(cfg.value ?? 0),
        status: 'open',
      })
      return 'deal created'
    }

    case 'send_webhook': {
      const cfg = step.step_config as SendWebhookStepConfig
      if (!cfg.url) throw new Error('send_webhook needs url')
      const body = cfg.body_template ? interpolate(cfg.body_template, args) : JSON.stringify(args.context)
      const res = await fetch(cfg.url, {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...(cfg.headers ?? {}) },
        body,
      })
      if (!res.ok) throw new Error(`webhook returned ${res.status}`)
      return `webhook ${res.status}`
    }

    case 'close_conversation': {
      if (!args.contactId) throw new Error('close_conversation needs a contact')
      await db
        .update(conversations)
        .set({ status: 'closed', updatedAt: new Date() })
        .where(
          and(
            eq(conversations.userId, args.automation.userId),
            eq(conversations.contactId, args.contactId)
          )
        )
      return 'conversation closed'
    }

    default:
      return `unknown step: ${step.step_type}`
  }
}

// ------------------------------------------------------------
// Helpers
// ------------------------------------------------------------

/**
 * Pick the conversation a send-type step should use. Prefer the id the
 * webhook handed us (it's the one that just got the inbound message);
 * fall back to the contact's conversation for resumed/wait paths and
 * manual engine POSTs. Throws if none exists — send steps have
 * no meaningful target without a conversation.
 */
async function resolveConversationId(args: ExecuteArgs): Promise<string> {
  const fromCtx = args.context.conversation_id
  if (fromCtx) return fromCtx
  if (!args.contactId) throw new Error('cannot resolve conversation: no contact')

  const data = await db.query.conversations.findFirst({
    where: and(
      eq(conversations.userId, args.automation.userId),
      eq(conversations.contactId, args.contactId)
    ),
    columns: { id: true }
  })

  if (!data?.id) throw new Error('no conversation for contact')
  return data.id as string
}

function triggerMatches(automation: Automation, ctx: AutomationContext | undefined): boolean {
  if (automation.trigger_type !== 'keyword_match') return true
  const cfg = automation.trigger_config as KeywordMatchTriggerConfig
  if (!cfg?.keywords || cfg.keywords.length === 0) return false
  const text = (ctx?.message_text ?? '').toString()
  if (!text) return false
  const haystack = cfg.case_sensitive ? text : text.toLowerCase()
  return cfg.keywords.some((raw) => {
    const k = cfg.case_sensitive ? raw : raw.toLowerCase()
    return cfg.match_type === 'exact' ? haystack === k : haystack.includes(k)
  })
}

async function evaluateCondition(cfg: ConditionStepConfig, args: ExecuteArgs): Promise<boolean> {
  switch (cfg.subject) {
    case 'tag_presence': {
      if (!args.contactId || !cfg.operand) return false
      const tagCount = await db
        .select({ count: sql<number>`count(*)` })
        .from(contactTags)
        .where(
          and(
            eq(contactTags.contactId, args.contactId),
            eq(contactTags.tagId, cfg.operand)
          )
        )
      return (Number(tagCount[0]?.count) || 0) > 0
    }
    case 'contact_field': {
      if (!args.contactId || !cfg.operand) return false
      const contactData = await db.query.contacts.findFirst({
        where: eq(contacts.id, args.contactId)
      })
      const v = (contactData as any)?.[cfg.operand]
      return v != null && String(v) === String(cfg.value ?? '')
    }
    case 'message_content': {
      const text = (args.context.message_text ?? '').toString()
      return text.toLowerCase().includes((cfg.value ?? '').toLowerCase())
    }
    case 'time_of_day': {
      // operand form "HH:mm-HH:mm" — true if now is within that window
      // (supports over-midnight ranges like "18:00-09:00").
      const [from, to] = (cfg.operand ?? '').split('-')
      if (!from || !to) return false
      const now = new Date()
      const mins = now.getHours() * 60 + now.getMinutes()
      const parse = (s: string) => {
        const [h, m] = s.split(':').map(Number)
        return (h || 0) * 60 + (m || 0)
      }
      const f = parse(from)
      const t = parse(to)
      return f <= t ? mins >= f && mins < t : mins >= f || mins < t
    }
    default:
      return false
  }
}

function waitMs(cfg: WaitStepConfig): number {
  const unitMs = cfg.unit === 'days' ? 86_400_000 : cfg.unit === 'hours' ? 3_600_000 : 60_000
  return Math.max(1_000, cfg.amount * unitMs)
}

function interpolate(s: string, args: ExecuteArgs): string {
  return s.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_, key) => {
    const [ns, prop] = String(key).split('.')
    if (ns === 'message' && prop === 'text') return String(args.context.message_text ?? '')
    if (ns === 'vars' && prop) return String(args.context.vars?.[prop] ?? '')
    return ''
  })
}

async function appendResults(
  logId: string | null,
  newItems: AutomationLogStepResult[],
  status: 'success' | 'partial' | 'failed' | null,
  errorMessage: string | null,
) {
  if (!logId) return
  const existing = await db.query.automationLogs.findFirst({
    where: eq(automationLogs.id, logId),
    columns: { stepsExecuted: true }
  })
  const merged = [
    ...((existing?.stepsExecuted as AutomationLogStepResult[] | undefined) ?? []),
    ...newItems,
  ]
  const update: Record<string, unknown> = { stepsExecuted: merged }
  // Only overwrite status on the outermost scope — nested branches pass null.
  if (status !== null) {
    update.status = status
  }
  if (errorMessage) update.errorMessage = errorMessage
  await db.update(automationLogs).set(update).where(eq(automationLogs.id, logId))
}

async function finalizeLog(
  logId: string | null,
  status: 'success' | 'partial' | 'failed',
  errorMessage: string | null,
) {
  if (!logId) return
  await db
    .update(automationLogs)
    .set({ status, errorMessage })
    .where(eq(automationLogs.id, logId))
}

async function markPending(id: string, status: 'done' | 'failed') {
  await db
    .update(automationPendingExecutions)
    .set({ status })
    .where(eq(automationPendingExecutions.id, id))
}

