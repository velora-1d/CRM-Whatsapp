'use server'

import { db } from '@/db'
import { contacts, tags, contactTags } from '@/db/schema'
import { eq, and, or, ilike, inArray, desc, sql } from 'drizzle-orm'
import { auth } from '@/auth'
import { Contact, CustomField, Tag } from '@/types'

const PAGE_SIZE = 25

export async function getContacts(page: number, search: string) {
  try {
    const session = await auth()
    if (!session?.user?.id) {
      return { error: 'Unauthorized' }
    }
    const userId = session.user.id

    // Setup filter pencarian
    let whereClause = eq(contacts.userId, userId)
    if (search.trim()) {
      const term = `%${search.trim()}%`
      whereClause = and(
        eq(contacts.userId, userId),
        or(
          ilike(contacts.name, term),
          ilike(contacts.phone, term),
          ilike(contacts.email, term)
        )
      ) as any
    }

    // Ambil total count
    const [countResult] = await db
      .select({ count: sql<number>`count(*)` })
      .from(contacts)
      .where(whereClause)

    const totalCount = Number(countResult?.count || 0)

    if (totalCount === 0) {
      return { success: true, data: [], totalCount: 0 }
    }

    // Ambil data kontak dengan relational query Drizzle
    const data = await db.query.contacts.findMany({
      where: whereClause,
      orderBy: [desc(contacts.createdAt)],
      limit: PAGE_SIZE,
      offset: page * PAGE_SIZE,
      with: {
        contactTags: {
          with: {
            tag: true,
          },
        },
      },
    })

    // Format output agar sesuai dengan snake_case yang diharapkan frontend
    const formattedContacts = data.map((c) => ({
      id: c.id,
      user_id: c.userId,
      phone: c.phone,
      name: c.name,
      email: c.email,
      company: c.company,
      avatar_url: c.avatarUrl,
      created_at: c.createdAt.toISOString(),
      updated_at: c.updatedAt.toISOString(),
      tags: c.contactTags
        ? c.contactTags.map((ct) => ({
            id: ct.tag.id,
            user_id: ct.tag.userId,
            name: ct.tag.name,
            color: ct.tag.color,
            created_at: ct.tag.createdAt.toISOString(),
          }))
        : [],
    }))

    return { success: true, data: formattedContacts, totalCount }
  } catch (error: any) {
    console.error('Error fetching contacts:', error)
    return { error: error.message || 'Gagal mengambil data kontak' }
  }
}

export async function getTags() {
  try {
    const session = await auth()
    if (!session?.user?.id) {
      return { error: 'Unauthorized' }
    }
    const userId = session.user.id

    const rows = await db
      .select()
      .from(tags)
      .where(eq(tags.userId, userId))
      .orderBy(tags.name)

    const formatted = rows.map((t) => ({
      id: t.id,
      user_id: t.userId,
      name: t.name,
      color: t.color,
      created_at: t.createdAt.toISOString(),
    }))

    return { success: true, data: formatted }
  } catch (error: any) {
    console.error('Error fetching tags:', error)
    return { error: error.message || 'Gagal mengambil data tag' }
  }
}

export async function getContactTagIds(contactId: string) {
  try {
    const session = await auth()
    if (!session?.user?.id) {
      return { error: 'Unauthorized' }
    }

    const rows = await db
      .select()
      .from(contactTags)
      .where(eq(contactTags.contactId, contactId))

    const formatted = rows.map((ct) => ({
      id: ct.id,
      contact_id: ct.contactId,
      tag_id: ct.tagId,
      created_at: ct.createdAt.toISOString(),
    }))

    return { success: true, data: formatted }
  } catch (error: any) {
    console.error('Error fetching contact tag IDs:', error)
    return { error: error.message || 'Gagal mengambil data relasi tag kontak' }
  }
}

export async function deleteContact(contactId: string) {
  try {
    const session = await auth()
    if (!session?.user?.id) {
      return { error: 'Unauthorized' }
    }
    const userId = session.user.id

    await db
      .delete(contacts)
      .where(and(eq(contacts.id, contactId), eq(contacts.userId, userId)))

    return { success: true }
  } catch (error: any) {
    console.error('Error deleting contact:', error)
    return { error: error.message || 'Gagal menghapus kontak' }
  }
}

export async function saveContact(data: {
  id?: string
  name: string | null
  phone: string
  email: string | null
  company: string | null
  tagIds: string[]
}) {
  try {
    const session = await auth()
    if (!session?.user?.id) {
      return { error: 'Unauthorized' }
    }
    const userId = session.user.id

    let contactId = data.id

    if (contactId) {
      // Update
      await db
        .update(contacts)
        .set({
          name: data.name,
          phone: data.phone,
          email: data.email,
          company: data.company,
          updatedAt: new Date(),
        })
        .where(and(eq(contacts.id, contactId), eq(contacts.userId, userId)))
    } else {
      // Insert
      const [newContact] = await db
        .insert(contacts)
        .values({
          userId,
          name: data.name,
          phone: data.phone,
          email: data.email,
          company: data.company,
        })
        .returning()
      contactId = newContact.id
    }

    // Sync tags
    if (contactId) {
      await db.delete(contactTags).where(eq(contactTags.contactId, contactId))

      if (data.tagIds.length > 0) {
        const rowsToInsert = data.tagIds.map((tagId) => ({
          contactId: contactId!,
          tagId,
        }))
        await db.insert(contactTags).values(rowsToInsert)
      }
    }

    return { success: true, contactId }
  } catch (error: any) {
    console.error('Error saving contact:', error)
    return { error: error.message || 'Gagal menyimpan kontak' }
  }
}

export async function getContact(contactId: string) {
  try {
    const session = await auth()
    if (!session?.user?.id) {
      return { error: 'Unauthorized' }
    }
    const userId = session.user.id

    const data = await db.query.contacts.findFirst({
      where: and(eq(contacts.id, contactId), eq(contacts.userId, userId)),
    })

    if (!data) {
      return { error: 'Kontak tidak ditemukan' }
    }

    const formatted = {
      id: data.id,
      user_id: data.userId,
      phone: data.phone,
      name: data.name,
      email: data.email,
      company: data.company,
      avatar_url: data.avatarUrl,
      created_at: data.createdAt.toISOString(),
      updated_at: data.updatedAt.toISOString(),
    }

    return { success: true, data: formatted }
  } catch (error: any) {
    console.error('Error fetching contact:', error)
    return { error: error.message || 'Gagal mengambil detail kontak' }
  }
}

export async function getContactCustomFieldsAndValues(contactId: string) {
  try {
    const session = await auth()
    if (!session?.user?.id) {
      return { error: 'Unauthorized' }
    }
    const userId = session.user.id

    const { customFields: cfSchema, contactCustomValues: ccvSchema } = await import('@/db/schema')

    const fields = await db
      .select()
      .from(cfSchema)
      .where(eq(cfSchema.userId, userId))
      .orderBy(cfSchema.fieldName)

    const values = await db
      .select()
      .from(ccvSchema)
      .where(eq(ccvSchema.contactId, contactId))

    const formattedFields = fields.map((f) => ({
      id: f.id,
      user_id: f.userId,
      field_name: f.fieldName,
      field_type: f.fieldType,
      field_options: f.fieldOptions,
      created_at: f.createdAt.toISOString(),
    }))

    const formattedValues = values.map((v) => ({
      id: v.id,
      contact_id: v.contactId,
      custom_field_id: v.customFieldId,
      value: v.value,
      created_at: v.createdAt.toISOString(),
    }))

    return { success: true, fields: formattedFields, values: formattedValues }
  } catch (error: any) {
    console.error('Error fetching custom fields & values:', error)
    return { error: error.message || 'Gagal mengambil field kustom' }
  }
}

export async function saveContactCustomFields(
  contactId: string,
  valuesList: { fieldId: string; value: string }[]
) {
  try {
    const session = await auth()
    if (!session?.user?.id) {
      return { error: 'Unauthorized' }
    }

    const { contactCustomValues: ccvSchema } = await import('@/db/schema')

    // Hapus nilai kustom lama untuk kontak ini
    await db.delete(ccvSchema).where(eq(ccvSchema.contactId, contactId))

    // Insert nilai kustom baru yang tidak kosong
    const rowsToInsert = valuesList
      .filter((v) => v.value.trim() !== '')
      .map((v) => ({
        contactId,
        customFieldId: v.fieldId,
        value: v.value.trim(),
      }))

    if (rowsToInsert.length > 0) {
      await db.insert(ccvSchema).values(rowsToInsert)
    }

    return { success: true }
  } catch (error: any) {
    console.error('Error saving custom fields:', error)
    return { error: error.message || 'Gagal menyimpan field kustom' }
  }
}

export async function deleteContactNote(noteId: string) {
  try {
    const session = await auth()
    if (!session?.user?.id) {
      return { error: 'Unauthorized' }
    }
    const userId = session.user.id

    const { contactNotes: cnSchema } = await import('@/db/schema')

    await db
      .delete(cnSchema)
      .where(and(eq(cnSchema.id, noteId), eq(cnSchema.userId, userId)))

    return { success: true }
  } catch (error: any) {
    console.error('Error deleting note:', error)
    return { error: error.message || 'Gagal menghapus catatan' }
  }
}

export async function toggleContactTag(
  contactId: string,
  tagId: string,
  action: 'add' | 'remove'
) {
  try {
    const session = await auth()
    if (!session?.user?.id) {
      return { error: 'Unauthorized' }
    }

    if (action === 'remove') {
      await db
        .delete(contactTags)
        .where(and(eq(contactTags.contactId, contactId), eq(contactTags.tagId, tagId)))
    } else {
      await db
        .insert(contactTags)
        .values({
          contactId,
          tagId,
        })
        .onConflictDoNothing()
    }

    return { success: true }
  } catch (error: any) {
    console.error('Error toggling contact tag:', error)
    return { error: error.message || 'Gagal memperbarui tag kontak' }
  }
}

export async function importContacts(
  contactsList: {
    phone: string
    name?: string
    email?: string
    company?: string
  }[]
) {
  try {
    const session = await auth()
    if (!session?.user?.id) {
      return { error: 'Unauthorized' }
    }
    const userId = session.user.id

    let imported = 0
    let failed = 0

    const chunkSize = 50
    for (let i = 0; i < contactsList.length; i += chunkSize) {
      const chunk = contactsList.slice(i, i + chunkSize)
      const rowsToInsert = chunk.map((row) => ({
        userId,
        phone: row.phone,
        name: row.name || null,
        email: row.email || null,
        company: row.company || null,
      }))

      try {
        await db.insert(contacts).values(rowsToInsert)
        imported += chunk.length
      } catch (err) {
        // Jika batch gagal, coba satu per satu
        for (const row of rowsToInsert) {
          try {
            await db.insert(contacts).values(row)
            imported++
          } catch (singleErr) {
            failed++
          }
        }
      }
    }

    return { success: true, imported, failed }
  } catch (error: any) {
    console.error('Error importing contacts:', error)
    return { error: error.message || 'Gagal mengimpor kontak' }
  }
}

export async function createTag(name: string, color: string) {
  try {
    const session = await auth()
    if (!session?.user?.id) {
      return { error: 'Unauthorized' }
    }
    const userId = session.user.id

    const [inserted] = await db
      .insert(tags)
      .values({
        userId,
        name,
        color,
      })
      .returning()

    return { success: true, data: inserted }
  } catch (error: any) {
    console.error('Error creating tag:', error)
    return { error: error.message || 'Gagal membuat tag' }
  }
}

export async function deleteTag(id: string) {
  try {
    const session = await auth()
    if (!session?.user?.id) {
      return { error: 'Unauthorized' }
    }
    const userId = session.user.id

    await db
      .delete(tags)
      .where(and(eq(tags.id, id), eq(tags.userId, userId)))

    return { success: true }
  } catch (error: any) {
    console.error('Error deleting tag:', error)
    return { error: error.message || 'Gagal menghapus tag' }
  }
}

export async function getCustomFields() {
  try {
    const session = await auth()
    if (!session?.user?.id) {
      return { error: 'Unauthorized' }
    }
    const userId = session.user.id
    
    const { customFields: cfSchema } = await import('@/db/schema')
    const fields = await db
      .select()
      .from(cfSchema)
      .where(eq(cfSchema.userId, userId))
      .orderBy(cfSchema.fieldName)

    const formattedFields: CustomField[] = fields.map((f) => ({
      id: f.id,
      user_id: f.userId,
      field_name: f.fieldName,
      field_type: f.fieldType,
      field_options: (f.fieldOptions as Record<string, unknown>) || undefined,
      created_at: f.createdAt.toISOString(),
    }))

    return { success: true, data: formattedFields }
  } catch (error: any) {
    console.error('Error fetching custom fields:', error)
    return { error: error.message || 'Gagal mengambil field kustom' }
  }
}

export async function getEstimatedAudienceCount(audience: {
  type: 'all' | 'tags' | 'custom_field' | 'csv'
  tagIds?: string[]
  customField?: {
    fieldId: string
    operator: 'is' | 'is_not' | 'contains'
    value: string
  }
  csvContacts?: { phone: string; name?: string }[]
  excludeTagIds?: string[]
}) {
  try {
    const session = await auth()
    if (!session?.user?.id) {
      return { error: 'Unauthorized' }
    }
    const userId = session.user.id

    if (audience.type === 'csv') {
      return { success: true, count: audience.csvContacts?.length ?? 0 }
    }

    // Set exclude
    let excludeContactIds: string[] = []
    if (audience.excludeTagIds && audience.excludeTagIds.length > 0) {
      const { contactTags: ctSchema } = await import('@/db/schema')
      const rows = await db
        .select({ contactId: ctSchema.contactId })
        .from(ctSchema)
        .where(inArray(ctSchema.tagId, audience.excludeTagIds))
      excludeContactIds = rows.map((r) => r.contactId)
    }

    let query: any = db
      .select({ id: contacts.id })
      .from(contacts)
      .where(eq(contacts.userId, userId))

    // Filter berdasarkan tipe
    if (audience.type === 'tags' && audience.tagIds && audience.tagIds.length > 0) {
      const { contactTags: ctSchema } = await import('@/db/schema')
      const matchingContactTags = await db
        .select({ contactId: ctSchema.contactId })
        .from(ctSchema)
        .where(inArray(ctSchema.tagId, audience.tagIds))
      const matchingIds = matchingContactTags.map((r) => r.contactId)
      
      if (matchingIds.length === 0) {
        return { success: true, count: 0 }
      }
      
      query = db
        .select({ id: contacts.id })
        .from(contacts)
        .where(
          and(
            eq(contacts.userId, userId),
            inArray(contacts.id, matchingIds)
          )
        )
    } else if (
      audience.type === 'custom_field' &&
      audience.customField?.fieldId &&
      audience.customField.value
    ) {
      const { contactCustomValues: ccvSchema } = await import('@/db/schema')
      const { fieldId, operator, value } = audience.customField
      
      let whereCond: any = eq(ccvSchema.customFieldId, fieldId)
      if (operator === 'is') {
        whereCond = and(whereCond, eq(ccvSchema.value, value))
      } else if (operator === 'is_not') {
        whereCond = and(whereCond, sql`${ccvSchema.value} != ${value}`)
      } else {
        whereCond = and(whereCond, ilike(ccvSchema.value, `%${value}%`))
      }
      
      const matchingCustomValues = await db
        .select({ contactId: ccvSchema.contactId })
        .from(ccvSchema)
        .where(whereCond)
        
      const matchingIds = matchingCustomValues.map((r) => r.contactId)
      if (matchingIds.length === 0) {
        return { success: true, count: 0 }
      }
      
      query = db
        .select({ id: contacts.id })
        .from(contacts)
        .where(
          and(
            eq(contacts.userId, userId),
            inArray(contacts.id, matchingIds)
          )
        )
    }

    const allMatching = await query
    let allMatchingIds = allMatching.map((r: any) => r.id)

    // Terapkan exclude tags
    if (excludeContactIds.length > 0) {
      const excludeSet = new Set(excludeContactIds)
      allMatchingIds = allMatchingIds.filter((id: string) => !excludeSet.has(id))
    }

    return { success: true, count: allMatchingIds.length }
  } catch (error: any) {
    console.error('Error fetching estimated count:', error)
    return { error: error.message || 'Gagal menghitung estimasi penerima' }
  }
}

export async function getBroadcastPreviewData() {
  try {
    const session = await auth()
    if (!session?.user?.id) {
      return { error: 'Unauthorized' }
    }
    const userId = session.user.id

    const { customFields: cfSchema, contactCustomValues: ccvSchema } = await import('@/db/schema')

    // 1. Ambil custom fields
    const fields = await db
      .select()
      .from(cfSchema)
      .where(eq(cfSchema.userId, userId))
      .orderBy(cfSchema.fieldName)

    const formattedFields: CustomField[] = fields.map((f) => ({
      id: f.id,
      user_id: f.userId,
      field_name: f.fieldName,
      field_type: f.fieldType,
      field_options: (f.fieldOptions as Record<string, unknown>) || undefined,
      created_at: f.createdAt.toISOString(),
    }))

    // 2. Ambil 1 contact terbaru
    const latestContact = await db.query.contacts.findFirst({
      where: eq(contacts.userId, userId),
      orderBy: [desc(contacts.createdAt)],
    })

    let formattedContact: Contact | null = null
    let customValues: { custom_field_id: string; value: string | null }[] = []

    if (latestContact) {
      formattedContact = {
        id: latestContact.id,
        user_id: latestContact.userId,
        phone: latestContact.phone,
        name: latestContact.name ?? undefined,
        email: latestContact.email ?? undefined,
        company: latestContact.company ?? undefined,
        avatar_url: latestContact.avatarUrl ?? undefined,
        created_at: latestContact.createdAt.toISOString(),
        updated_at: latestContact.updatedAt.toISOString(),
      }

      // 3. Ambil custom values untuk kontak tersebut
      const vals = await db
        .select()
        .from(ccvSchema)
        .where(eq(ccvSchema.contactId, latestContact.id))

      customValues = vals.map((v) => ({
        custom_field_id: v.customFieldId,
        value: v.value,
      }))
    }

    return {
      success: true,
      customFields: formattedFields,
      contact: formattedContact,
      customValues,
    }
  } catch (error: any) {
    console.error('Error fetching broadcast preview data:', error)
    return { error: error.message || 'Gagal mengambil data preview broadcast' }
  }
}
