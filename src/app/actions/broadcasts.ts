'use server'

import { db } from '@/db'
import { broadcasts, broadcastRecipients, contacts, tags, contactTags, contactCustomValues } from '@/db/schema'
import { auth } from '@/auth'
import { eq, desc, inArray, and, sql } from 'drizzle-orm'
import { revalidatePath } from 'next/cache'

export async function resolveAudienceContactsAction(audience: {
  type: 'all' | 'tags' | 'custom_field' | 'csv'
  tagIds?: string[]
  customField?: { fieldId: string; operator: 'is' | 'is_not' | 'contains'; value: string }
  excludeTagIds?: string[]
}) {
  const session = await auth()
  if (!session?.user?.id) {
    throw new Error('Unauthorized')
  }

  let list: any[] = []

  if (audience.type === 'all') {
    list = await db.query.contacts.findMany({
      where: eq(contacts.userId, session.user.id),
    })
  } else if (audience.type === 'tags' && audience.tagIds && audience.tagIds.length > 0) {
    const contactTagsRows = await db
      .select({ contactId: contactTags.contactId })
      .from(contactTags)
      .innerJoin(tags, eq(contactTags.tagId, tags.id))
      .where(
        and(
          eq(tags.userId, session.user.id),
          inArray(contactTags.tagId, audience.tagIds)
        )
      )
    const uniqueContactIds = [...new Set(contactTagsRows.map((ct) => ct.contactId))]
    if (uniqueContactIds.length > 0) {
      list = await db.query.contacts.findMany({
        where: and(
          eq(contacts.userId, session.user.id),
          inArray(contacts.id, uniqueContactIds)
        )
      })
    }
  } else if (audience.type === 'custom_field' && audience.customField) {
    const { fieldId, operator, value } = audience.customField
    let whereCond: any = eq(contactCustomValues.customFieldId, fieldId)

    if (operator === 'is') {
      whereCond = and(whereCond, eq(contactCustomValues.value, value))
    } else if (operator === 'is_not') {
      whereCond = and(whereCond, sql`${contactCustomValues.value} != ${value}`)
    } else if (operator === 'contains') {
      whereCond = and(whereCond, sql`${contactCustomValues.value} ILIKE ${'%' + value + '%'}`)
    }

    const matches = await db
      .select({ contactId: contactCustomValues.contactId })
      .from(contactCustomValues)
      .where(whereCond)
    const contactIds = [...new Set(matches.map((m) => m.contactId))]
    if (contactIds.length > 0) {
      list = await db.query.contacts.findMany({
        where: and(
          eq(contacts.userId, session.user.id),
          inArray(contacts.id, contactIds)
        )
      })
    }
  }

  if (audience.excludeTagIds && audience.excludeTagIds.length > 0 && list.length > 0) {
    const excludeRows = await db
      .select({ contactId: contactTags.contactId })
      .from(contactTags)
      .innerJoin(tags, eq(contactTags.tagId, tags.id))
      .where(
        and(
          eq(tags.userId, session.user.id),
          inArray(contactTags.tagId, audience.excludeTagIds)
        )
      )
    const excludedIds = new Set(excludeRows.map((r) => r.contactId))
    list = list.filter((c) => !excludedIds.has(c.id))
  }

  return list
}

export async function upsertCsvContactsAction(csvRows: { phone: string; name?: string }[]) {
  const session = await auth()
  if (!session?.user?.id) {
    throw new Error('Unauthorized')
  }

  if (csvRows.length === 0) return []

  const uniqueByPhone = new Map<string, { phone: string; name?: string }>()
  for (const row of csvRows) {
    if (row.phone) uniqueByPhone.set(row.phone, row)
  }
  const phones = [...uniqueByPhone.keys()]

  // Lookup existing contacts
  const existing = await db.query.contacts.findMany({
    where: and(
      eq(contacts.userId, session.user.id),
      inArray(contacts.phone, phones)
    )
  })

  const byPhone = new Map<string, any>()
  for (const c of existing) {
    if (c.phone) byPhone.set(c.phone, c)
  }

  const missing = phones
    .filter((p) => !byPhone.has(p))
    .map((phone) => ({
      userId: session.user.id,
      phone,
      name: uniqueByPhone.get(phone)?.name ?? null,
    }))

  if (missing.length > 0) {
    const inserted = await db.insert(contacts).values(missing).returning()
    for (const c of inserted) {
      if (c.phone) byPhone.set(c.phone, c)
    }
  }

  return phones
    .map((p) => byPhone.get(p))
    .filter((c) => Boolean(c))
}

export async function createBroadcastRecordAction(payload: {
  name: string
  templateName: string
  templateLanguage: string
  variables: any
  audienceFilter: any
  totalRecipients: number
}) {
  const session = await auth()
  if (!session?.user?.id) {
    throw new Error('Unauthorized')
  }

  const [broadcast] = await db.insert(broadcasts).values({
    userId: session.user.id,
    name: payload.name,
    templateName: payload.templateName,
    templateLanguage: payload.templateLanguage,
    templateVariables: payload.variables,
    audienceFilter: payload.audienceFilter,
    status: 'sending',
    totalRecipients: payload.totalRecipients,
    sentCount: 0,
    deliveredCount: 0,
    readCount: 0,
    repliedCount: 0,
    failedCount: 0,
  }).returning()

  return broadcast
}

export async function insertBroadcastRecipientsAction(
  broadcastId: string,
  recipientRows: { contactId: string; status: 'pending' }[]
) {
  const session = await auth()
  if (!session?.user?.id) {
    throw new Error('Unauthorized')
  }

  try {
    const values = recipientRows.map((r) => ({
      broadcastId,
      contactId: r.contactId,
      status: r.status,
    }))

    const INSERT_BATCH_SIZE = 200
    for (let i = 0; i < values.length; i += INSERT_BATCH_SIZE) {
      const batch = values.slice(i, i + INSERT_BATCH_SIZE)
      await db.insert(broadcastRecipients).values(batch)
    }
  } catch (error) {
    // update status broadcast ke failed
    await db
      .update(broadcasts)
      .set({
        status: 'failed',
        failedCount: recipientRows.length,
      })
      .where(eq(broadcasts.id, broadcastId))
    throw error
  }
}

export async function fetchBroadcastRecipientsForSendingAction(broadcastId: string) {
  const session = await auth()
  if (!session?.user?.id) {
    throw new Error('Unauthorized')
  }

  const list = await db.query.broadcastRecipients.findMany({
    where: eq(broadcastRecipients.broadcastId, broadcastId),
    with: {
      contact: true,
    }
  })
  return list
}

export async function preloadCustomValuesIndexAction(contactIds: string[]) {
  const session = await auth()
  if (!session?.user?.id) {
    throw new Error('Unauthorized')
  }

  const indexMap: Record<string, Record<string, string>> = {}
  if (contactIds.length === 0) return indexMap

  const PAGE = 500
  for (let i = 0; i < contactIds.length; i += PAGE) {
    const slice = contactIds.slice(i, i + PAGE)
    const rows = await db.query.contactCustomValues.findMany({
      where: inArray(contactCustomValues.contactId, slice),
    })

    for (const row of rows) {
      if (!indexMap[row.contactId]) {
        indexMap[row.contactId] = {}
      }
      indexMap[row.contactId][row.customFieldId] = row.value ?? ''
    }
  }
  return indexMap
}

export async function updateRecipientStatusAction(
  recipientId: string,
  payload: {
    status: 'sent' | 'failed'
    whatsappMessageId?: string | null
    errorMessage?: string | null
  }
) {
  const session = await auth()
  if (!session?.user?.id) {
    throw new Error('Unauthorized')
  }

  await db
    .update(broadcastRecipients)
    .set({
      status: payload.status,
      sentAt: payload.status === 'sent' ? new Date() : null,
      whatsappMessageId: payload.whatsappMessageId,
      errorMessage: payload.errorMessage,
    })
    .where(eq(broadcastRecipients.id, recipientId))
}

export async function finalizeBroadcastStatusAction(broadcastId: string, finalStatus: 'sent' | 'failed') {
  const session = await auth()
  if (!session?.user?.id) {
    throw new Error('Unauthorized')
  }

  await db
    .update(broadcasts)
    .set({ status: finalStatus })
    .where(eq(broadcasts.id, broadcastId))
}

export async function calculateEstimatedReach(audience: {
  type: string
  tagIds?: string[]
  csvContacts?: any[]
}) {
  const session = await auth()
  if (!session?.user?.id) {
    throw new Error('Unauthorized')
  }

  try {
    if (audience.type === 'all') {
      const [result] = await db
        .select({ count: sql<number>`count(*)` })
        .from(contacts)
        .where(eq(contacts.userId, session.user.id))
      return Number(result?.count ?? 0)
    }

    if (audience.type === 'tags' && audience.tagIds && audience.tagIds.length > 0) {
      const result = await db
        .select({ contactId: contactTags.contactId })
        .from(contactTags)
        .innerJoin(tags, eq(contactTags.tagId, tags.id))
        .where(
          and(
            eq(tags.userId, session.user.id),
            inArray(contactTags.tagId, audience.tagIds)
          )
        )
      const uniqueIds = new Set(result.map((r) => r.contactId))
      return uniqueIds.size
    }

    if (audience.type === 'csv' && audience.csvContacts) {
      return audience.csvContacts.length
    }

    return 0
  } catch (error) {
    console.error('Failed to calculate estimated reach:', error)
    return 0
  }
}

export async function getBroadcasts() {
  const session = await auth()
  if (!session?.user?.id) {
    throw new Error('Unauthorized')
  }

  try {
    const list = await db.query.broadcasts.findMany({
      where: eq(broadcasts.userId, session.user.id),
      orderBy: [desc(broadcasts.createdAt)],
    })
    return list
  } catch (error) {
    console.error('Failed to get broadcasts:', error)
    throw new Error('Gagal memuat daftar broadcast')
  }
}

export async function getBroadcastById(id: string) {
  const session = await auth()
  if (!session?.user?.id) {
    throw new Error('Unauthorized')
  }

  try {
    const broadcast = await db.query.broadcasts.findFirst({
      where: eq(broadcasts.id, id),
    })

    if (!broadcast) {
      return null
    }

    // verify ownership
    if (broadcast.userId !== session.user.id) {
      throw new Error('Forbidden')
    }

    const recipients = await db.query.broadcastRecipients.findMany({
      where: eq(broadcastRecipients.broadcastId, id),
      with: {
        contact: true,
      },
      orderBy: [desc(broadcastRecipients.createdAt)],
    })

    return {
      ...broadcast,
      recipients,
    }
  } catch (error) {
    console.error('Failed to get broadcast details:', error)
    throw new Error('Gagal memuat detail broadcast')
  }
}

export async function deleteBroadcast(id: string) {
  const session = await auth()
  if (!session?.user?.id) {
    throw new Error('Unauthorized')
  }

  try {
    const broadcast = await db.query.broadcasts.findFirst({
      where: eq(broadcasts.id, id),
    })

    if (!broadcast) {
      throw new Error('Broadcast tidak ditemukan')
    }

    if (broadcast.userId !== session.user.id) {
      throw new Error('Forbidden')
    }

    if (broadcast.status === 'sending') {
      throw new Error('Tidak dapat menghapus broadcast yang sedang dikirim')
    }

    await db.delete(broadcasts).where(eq(broadcasts.id, id))

    revalidatePath('/broadcasts')
    return { success: true }
  } catch (error) {
    console.error('Failed to delete broadcast:', error)
    throw error
  }
}

export async function saveBroadcastDraft(payload: {
  name: string
  templateName: string
  templateLanguage: string
  variables: any
  audienceFilter: any
}) {
  const session = await auth()
  if (!session?.user?.id) {
    throw new Error('Unauthorized')
  }

  try {
    const [draft] = await db.insert(broadcasts).values({
      userId: session.user.id,
      name: payload.name.trim(),
      templateName: payload.templateName,
      templateLanguage: payload.templateLanguage,
      templateVariables: payload.variables,
      audienceFilter: payload.audienceFilter,
      status: 'draft',
      totalRecipients: 0,
      sentCount: 0,
      deliveredCount: 0,
      readCount: 0,
      repliedCount: 0,
      failedCount: 0,
    }).returning()

    revalidatePath('/broadcasts')
    return draft
  } catch (error) {
    console.error('Failed to save broadcast draft:', error)
    throw new Error('Gagal menyimpan draf broadcast')
  }
}
