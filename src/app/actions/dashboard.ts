'use server'

import { db } from '@/db'
import {
  conversations,
  contacts,
  deals,
  messages,
  pipelineStages,
  pipelines,
  automations,
  automationLogs,
  broadcasts,
} from '@/db/schema'
import { eq, gte, lt, and, count, sql } from 'drizzle-orm'
import { auth } from '@/auth'
import {
  daysAgoStart,
  lastNDayKeys,
  localDayKey,
  mondayIndex,
  startOfLocalDay,
} from '@/lib/dashboard/date-utils'
import type {
  MetricsBundle,
  ConversationsSeriesPoint,
  PipelineDonutData,
  PipelineStageSlice,
  ResponseTimeSummary,
  ResponseTimeBucket,
  ActivityItem,
} from '@/lib/dashboard/types'

export async function getDashboardMetrics(): Promise<MetricsBundle> {
  const session = await auth()
  if (!session?.user?.id) {
    throw new Error('Unauthorized')
  }
  const userId = session.user.id

  const todayStart = startOfLocalDay()
  const yesterdayStart = daysAgoStart(1)

  // 1. Open conversations current
  const [openConvCur] = await db
    .select({ count: count() })
    .from(conversations)
    .where(and(eq(conversations.status, 'open'), eq(conversations.userId, userId)))

  // 2. New open conversations today
  const [newConvToday] = await db
    .select({ count: count() })
    .from(conversations)
    .where(
      and(
        eq(conversations.status, 'open'),
        eq(conversations.userId, userId),
        gte(conversations.createdAt, todayStart)
      )
    )

  // 3. New open conversations yesterday
  const [newConvYesterday] = await db
    .select({ count: count() })
    .from(conversations)
    .where(
      and(
        eq(conversations.status, 'open'),
        eq(conversations.userId, userId),
        gte(conversations.createdAt, yesterdayStart),
        lt(conversations.createdAt, todayStart)
      )
    )

  // 4. New contacts today
  const [newContactsToday] = await db
    .select({ count: count() })
    .from(contacts)
    .where(and(eq(contacts.userId, userId), gte(contacts.createdAt, todayStart)))

  // 5. New contacts yesterday
  const [newContactsYesterday] = await db
    .select({ count: count() })
    .from(contacts)
    .where(
      and(
        eq(contacts.userId, userId),
        gte(contacts.createdAt, yesterdayStart),
        lt(contacts.createdAt, todayStart)
      )
    )

  // 6. Open deals
  const openDealsRows = await db
    .select({ value: deals.value, status: deals.status })
    .from(deals)
    .where(and(eq(deals.status, 'open'), eq(deals.userId, userId)))

  // 7. Messages sent today (agent)
  const [messagesToday] = await db
    .select({ count: count() })
    .from(messages)
    .innerJoin(conversations, eq(messages.conversationId, conversations.id))
    .where(
      and(
        eq(conversations.userId, userId),
        eq(messages.senderType, 'agent'),
        gte(messages.createdAt, todayStart)
      )
    )

  // 8. Messages sent yesterday (agent)
  const [messagesYesterday] = await db
    .select({ count: count() })
    .from(messages)
    .innerJoin(conversations, eq(messages.conversationId, conversations.id))
    .where(
      and(
        eq(conversations.userId, userId),
        eq(messages.senderType, 'agent'),
        gte(messages.createdAt, yesterdayStart),
        lt(messages.createdAt, todayStart)
      )
    )

  const openDealsValue = openDealsRows.reduce((sumVal, d) => sumVal + Number(d.value ?? 0), 0)

  return {
    activeConversations: {
      current: openConvCur.count ?? 0,
      previous: (newConvToday.count ?? 0) - (newConvYesterday.count ?? 0),
    },
    newContactsToday: {
      current: newContactsToday.count ?? 0,
      previous: newContactsYesterday.count ?? 0,
    },
    openDealsValue,
    openDealsCount: openDealsRows.length,
    messagesSentToday: {
      current: messagesToday.count ?? 0,
      previous: messagesYesterday.count ?? 0,
    },
  }
}

export async function getConversationsSeries(rangeDays: number): Promise<ConversationsSeriesPoint[]> {
  const session = await auth()
  if (!session?.user?.id) {
    throw new Error('Unauthorized')
  }
  const userId = session.user.id

  const start = daysAgoStart(rangeDays - 1)

  const rows = await db
    .select({
      createdAt: messages.createdAt,
      senderType: messages.senderType,
    })
    .from(messages)
    .innerJoin(conversations, eq(messages.conversationId, conversations.id))
    .where(
      and(
        eq(conversations.userId, userId),
        gte(messages.createdAt, start)
      )
    )
    .orderBy(messages.createdAt)

  const keys = lastNDayKeys(rangeDays)
  const buckets = new Map<string, { incoming: number; outgoing: number }>()
  for (const k of keys) buckets.set(k, { incoming: 0, outgoing: 0 })

  for (const row of rows) {
    const key = localDayKey(row.createdAt)
    const bucket = buckets.get(key)
    if (!bucket) continue
    if (row.senderType === 'customer') bucket.incoming += 1
    else bucket.outgoing += 1
  }

  return keys.map((day) => ({
    day,
    ...(buckets.get(day) ?? { incoming: 0, outgoing: 0 }),
  }))
}

export async function getPipelineDonut(): Promise<PipelineDonutData> {
  const session = await auth()
  if (!session?.user?.id) {
    throw new Error('Unauthorized')
  }
  const userId = session.user.id

  const stages = await db
    .select({
      id: pipelineStages.id,
      name: pipelineStages.name,
      color: pipelineStages.color,
    })
    .from(pipelineStages)
    .innerJoin(pipelines, eq(pipelineStages.pipelineId, pipelines.id))
    .where(eq(pipelines.userId, userId))
    .orderBy(pipelineStages.position)

  const dealsRows = await db
    .select({
      stageId: deals.stageId,
      value: deals.value,
    })
    .from(deals)
    .where(and(eq(deals.status, 'open'), eq(deals.userId, userId)))

  const byStage = new Map<string, { count: number; total: number }>()
  for (const d of dealsRows) {
    const row = byStage.get(d.stageId) ?? { count: 0, total: 0 }
    row.count += 1
    row.total += Number(d.value ?? 0)
    byStage.set(d.stageId, row)
  }

  const slices: PipelineStageSlice[] = stages
    .map((s) => ({
      id: s.id,
      name: s.name,
      color: s.color || '#64748b',
      dealCount: byStage.get(s.id)?.count ?? 0,
      totalValue: byStage.get(s.id)?.total ?? 0,
    }))
    .filter((s) => s.totalValue > 0 || s.dealCount > 0)

  return {
    stages: slices,
    totalValue: slices.reduce((sum, s) => sum + s.totalValue, 0),
  }
}

export async function getResponseTime(): Promise<ResponseTimeSummary> {
  const session = await auth()
  if (!session?.user?.id) {
    throw new Error('Unauthorized')
  }
  const userId = session.user.id

  const fourteenDaysAgo = daysAgoStart(13)

  const rows = await db
    .select({
      conversationId: messages.conversationId,
      senderType: messages.senderType,
      createdAt: messages.createdAt,
    })
    .from(messages)
    .innerJoin(conversations, eq(messages.conversationId, conversations.id))
    .where(
      and(
        eq(conversations.userId, userId),
        gte(messages.createdAt, fourteenDaysAgo)
      )
    )
    .orderBy(messages.conversationId, messages.createdAt)

  interface Sample {
    customerAt: Date
    responseAt: Date
  }
  const samples: Sample[] = []

  let currentConv = ''
  let pendingCustomer: Date | null = null
  for (const row of rows) {
    if (row.conversationId !== currentConv) {
      currentConv = row.conversationId
      pendingCustomer = null
    }
    const ts = new Date(row.createdAt)
    if (row.senderType === 'customer') {
      if (!pendingCustomer) pendingCustomer = ts
    } else if (pendingCustomer) {
      samples.push({ customerAt: pendingCustomer, responseAt: ts })
      pendingCustomer = null
    }
  }

  const now = new Date()
  const thisWeekStart = daysAgoStart(mondayIndex(now))
  const lastWeekStart = daysAgoStart(mondayIndex(now) + 7)

  const byDow = new Map<number, number[]>()
  for (let i = 0; i < 7; i++) byDow.set(i, [])
  const thisWeekMins: number[] = []
  const lastWeekMins: number[] = []

  for (const s of samples) {
    const diffMin = (s.responseAt.getTime() - s.customerAt.getTime()) / 60_000
    if (diffMin < 0) continue
    const dow = mondayIndex(s.customerAt)
    byDow.get(dow)!.push(diffMin)
    if (s.customerAt >= thisWeekStart) {
      thisWeekMins.push(diffMin)
    } else if (s.customerAt >= lastWeekStart && s.customerAt < thisWeekStart) {
      lastWeekMins.push(diffMin)
    }
  }

  const avg = (arr: number[]) =>
    arr.length === 0 ? null : arr.reduce((a, b) => a + b, 0) / arr.length

  const buckets: ResponseTimeBucket[] = Array.from({ length: 7 }, (_, dow) => {
    const samples = byDow.get(dow) ?? []
    return {
      dow,
      avgMinutes: avg(samples),
      samples: samples.length,
    }
  })

  return {
    buckets,
    thisWeekAvg: avg(thisWeekMins),
    lastWeekAvg: avg(lastWeekMins),
  }
}

export async function getDashboardActivity(limit = 20): Promise<ActivityItem[]> {
  const session = await auth()
  if (!session?.user?.id) {
    throw new Error('Unauthorized')
  }
  const userId = session.user.id

  const [msgsRows, contactsRows, dealsRows, broadcastsRows, autoLogsRows] = await Promise.all([
    db
      .select({
        id: messages.id,
        contentText: messages.contentText,
        senderType: messages.senderType,
        createdAt: messages.createdAt,
        conversationId: messages.conversationId,
        contactName: contacts.name,
        contactPhone: contacts.phone,
      })
      .from(messages)
      .innerJoin(conversations, eq(messages.conversationId, conversations.id))
      .innerJoin(contacts, eq(conversations.contactId, contacts.id))
      .where(and(eq(conversations.userId, userId), eq(messages.senderType, 'customer')))
      .orderBy(sql`${messages.createdAt} DESC`)
      .limit(10),
    db
      .select({
        id: contacts.id,
        name: contacts.name,
        phone: contacts.phone,
        createdAt: contacts.createdAt,
      })
      .from(contacts)
      .where(eq(contacts.userId, userId))
      .orderBy(sql`${contacts.createdAt} DESC`)
      .limit(10),
    db
      .select({
        id: deals.id,
        title: deals.title,
        updatedAt: deals.updatedAt,
        stageName: pipelineStages.name,
      })
      .from(deals)
      .innerJoin(pipelineStages, eq(deals.stageId, pipelineStages.id))
      .where(eq(deals.userId, userId))
      .orderBy(sql`${deals.updatedAt} DESC`)
      .limit(10),
    db
      .select({
        id: broadcasts.id,
        name: broadcasts.name,
        status: broadcasts.status,
        totalRecipients: broadcasts.totalRecipients,
        createdAt: broadcasts.createdAt,
      })
      .from(broadcasts)
      .where(eq(broadcasts.userId, userId))
      .orderBy(sql`${broadcasts.createdAt} DESC`)
      .limit(5),
    db
      .select({
        id: automationLogs.id,
        triggerEvent: automationLogs.triggerEvent,
        status: automationLogs.status,
        createdAt: automationLogs.createdAt,
        automationName: automations.name,
        contactName: contacts.name,
        contactPhone: contacts.phone,
      })
      .from(automationLogs)
      .innerJoin(automations, eq(automationLogs.automationId, automations.id))
      .leftJoin(contacts, eq(automationLogs.contactId, contacts.id))
      .where(eq(automationLogs.userId, userId))
      .orderBy(sql`${automationLogs.createdAt} DESC`)
      .limit(10),
  ])

  const items: ActivityItem[] = []

  for (const m of msgsRows) {
    const who = m.contactName || m.contactPhone || 'Unknown'
    items.push({
      id: `msg-${m.id}`,
      kind: 'message',
      text: `New message from ${who}`,
      at: m.createdAt.toISOString(),
      href: `/inbox?c=${m.conversationId}`,
    })
  }

  for (const c of contactsRows) {
    items.push({
      id: `contact-${c.id}`,
      kind: 'contact',
      text: `New contact: ${c.name || c.phone}`,
      at: c.createdAt.toISOString(),
      href: '/contacts',
    })
  }

  for (const d of dealsRows) {
    items.push({
      id: `deal-${d.id}`,
      kind: 'deal',
      text: d.stageName
        ? `Deal "${d.title}" in ${d.stageName}`
        : `Deal "${d.title}" updated`,
      at: d.updatedAt.toISOString(),
      href: '/pipelines',
    })
  }

  for (const b of broadcastsRows) {
    const label =
      b.status === 'sent'
        ? `sent to ${b.totalRecipients} contacts`
        : `${b.status} (${b.totalRecipients} recipients)`
    items.push({
      id: `broadcast-${b.id}`,
      kind: 'broadcast',
      text: `Broadcast "${b.name}" ${label}`,
      at: b.createdAt.toISOString(),
      href: '/broadcasts',
    })
  }

  for (const l of autoLogsRows) {
    const who = l.contactName || l.contactPhone || 'a contact'
    const autoName = l.automationName || 'Automation'
    items.push({
      id: `auto-${l.id}`,
      kind: 'automation',
      text: `Automation "${autoName}" ${l.status === 'failed' ? 'failed for' : 'triggered for'} ${who}`,
      at: l.createdAt.toISOString(),
    })
  }

  return items
    .sort((a, b) => (a.at > b.at ? -1 : a.at < b.at ? 1 : 0))
    .slice(0, limit)
}
