'use server'

import { db } from '@/db'
import { pipelines, pipelineStages, deals, contacts, profiles } from '@/db/schema'
import { eq, and, asc, desc, sql } from 'drizzle-orm'
import { auth } from '@/auth'

const SPEC_DEFAULT_STAGES = [
  { name: 'New Lead', color: '#3b82f6', position: 0 },
  { name: 'Qualified', color: '#eab308', position: 1 },
  { name: 'Proposal Sent', color: '#f97316', position: 2 },
  { name: 'Negotiation', color: '#8b5cf6', position: 3 },
  { name: 'Won', color: '#22c55e', position: 4 },
]

export async function getPipelines() {
  try {
    const session = await auth()
    if (!session?.user?.id) {
      return { error: 'Unauthorized' }
    }
    const userId = session.user.id

    const rows = await db
      .select()
      .from(pipelines)
      .where(eq(pipelines.userId, userId))
      .orderBy(pipelines.createdAt)

    const formatted = rows.map((p) => ({
      id: p.id,
      user_id: p.userId,
      name: p.name,
      created_at: p.createdAt.toISOString(),
    }))

    return { success: true, data: formatted }
  } catch (error: any) {
    console.error('Error fetching pipelines:', error)
    return { error: error.message || 'Gagal mengambil data pipeline' }
  }
}

export async function getPipelineStages(pipelineId: string) {
  try {
    const session = await auth()
    if (!session?.user?.id) {
      return { error: 'Unauthorized' }
    }

    const rows = await db
      .select()
      .from(pipelineStages)
      .where(eq(pipelineStages.pipelineId, pipelineId))
      .orderBy(asc(pipelineStages.position))

    const formatted = rows.map((s) => ({
      id: s.id,
      pipeline_id: s.pipelineId,
      name: s.name,
      color: s.color,
      position: s.position,
      created_at: s.createdAt.toISOString(),
    }))

    return { success: true, data: formatted }
  } catch (error: any) {
    console.error('Error fetching pipeline stages:', error)
    return { error: error.message || 'Gagal mengambil data tahapan pipeline' }
  }
}

export async function getPipelineDeals(pipelineId: string) {
  try {
    const session = await auth()
    if (!session?.user?.id) {
      return { error: 'Unauthorized' }
    }
    const userId = session.user.id

    // Menggunakan relational query Drizzle
    const rows = await db.query.deals.findMany({
      where: and(eq(deals.pipelineId, pipelineId), eq(deals.userId, userId)),
      orderBy: [desc(deals.createdAt)],
      with: {
        contact: true,
        assignedAgent: true,
      },
    })

    const formatted = rows.map((d) => ({
      id: d.id,
      user_id: d.userId,
      pipeline_id: d.pipelineId,
      stage_id: d.stageId,
      contact_id: d.contactId,
      conversation_id: d.conversationId,
      title: d.title,
      value: parseFloat(d.value) || 0,
      currency: d.currency,
      notes: d.notes,
      expected_close_date: d.expectedCloseDate,
      status: d.status,
      assigned_to: d.assignedTo,
      created_at: d.createdAt.toISOString(),
      updated_at: d.updatedAt.toISOString(),
      contact: d.contact
        ? {
            id: d.contact.id,
            user_id: d.contact.userId,
            phone: d.contact.phone,
            name: d.contact.name,
            email: d.contact.email,
            company: d.contact.company,
            avatar_url: d.contact.avatarUrl,
            created_at: d.contact.createdAt.toISOString(),
            updated_at: d.contact.updatedAt.toISOString(),
          }
        : null,
      assignee: d.assignedAgent
        ? {
            id: d.assignedAgent.id,
            user_id: d.assignedAgent.userId,
            full_name: d.assignedAgent.fullName,
            email: d.assignedAgent.email,
            avatar_url: d.assignedAgent.avatarUrl,
            role: d.assignedAgent.role,
            created_at: d.assignedAgent.createdAt.toISOString(),
            updated_at: d.assignedAgent.updatedAt.toISOString(),
          }
        : null,
    }))

    return { success: true, data: formatted }
  } catch (error: any) {
    console.error('Error fetching pipeline deals:', error)
    return { error: error.message || 'Gagal mengambil data deal pipeline' }
  }
}

export async function createPipeline(name: string) {
  try {
    const session = await auth()
    if (!session?.user?.id) {
      return { error: 'Unauthorized' }
    }
    const userId = session.user.id

    // Insert pipeline
    const [pipeline] = await db
      .insert(pipelines)
      .values({
        userId,
        name,
      })
      .returning()

    // Insert default stages
    const stagesPayload = SPEC_DEFAULT_STAGES.map((s) => ({
      pipelineId: pipeline.id,
      name: s.name,
      color: s.color,
      position: s.position,
    }))
    await db.insert(pipelineStages).values(stagesPayload)

    return {
      success: true,
      data: {
        id: pipeline.id,
        user_id: pipeline.userId,
        name: pipeline.name,
        created_at: pipeline.createdAt.toISOString(),
      },
    }
  } catch (error: any) {
    console.error('Error creating pipeline:', error)
    return { error: error.message || 'Gagal membuat pipeline baru' }
  }
}

export async function savePipeline(
  pipelineId: string,
  name: string,
  stagesList: { id?: string; name: string; color: string; position: number }[]
) {
  try {
    const session = await auth()
    if (!session?.user?.id) {
      return { error: 'Unauthorized' }
    }
    const userId = session.user.id

    // Rename pipeline
    await db
      .update(pipelines)
      .set({ name: name.trim() })
      .where(and(eq(pipelines.id, pipelineId), eq(pipelines.userId, userId)))

    // Upsert stages
    for (const s of stagesList) {
      if (s.id) {
        // Update stage yang ada
        await db
          .update(pipelineStages)
          .set({
            name: s.name,
            color: s.color,
            position: s.position,
          })
          .where(
            and(
              eq(pipelineStages.id, s.id),
              eq(pipelineStages.pipelineId, pipelineId)
            )
          )
      } else {
        // Tambah stage baru jika tidak memiliki ID (seharusnya handleAddStage melakukan insert langsung, tapi untuk fallback)
        await db.insert(pipelineStages).values({
          pipelineId,
          name: s.name,
          color: s.color,
          position: s.position,
        })
      }
    }

    return { success: true }
  } catch (error: any) {
    console.error('Error saving pipeline:', error)
    return { error: error.message || 'Gagal menyimpan perubahan pipeline' }
  }
}

export async function addPipelineStage(
  pipelineId: string,
  name: string,
  color: string,
  position: number
) {
  try {
    const session = await auth()
    if (!session?.user?.id) {
      return { error: 'Unauthorized' }
    }

    const [newStage] = await db
      .insert(pipelineStages)
      .values({
        pipelineId,
        name: name.trim(),
        color,
        position,
      })
      .returning()

    const formatted = {
      id: newStage.id,
      pipeline_id: newStage.pipelineId,
      name: newStage.name,
      color: newStage.color,
      position: newStage.position,
      created_at: newStage.createdAt.toISOString(),
    }

    return { success: true, data: formatted }
  } catch (error: any) {
    console.error('Error adding pipeline stage:', error)
    return { error: error.message || 'Gagal menambahkan tahapan pipeline' }
  }
}

export async function deletePipelineStage(stageId: string) {
  try {
    const session = await auth()
    if (!session?.user?.id) {
      return { error: 'Unauthorized' }
    }

    // Cek apakah ada deals di stage ini
    const [dealCount] = await db
      .select({ count: sql<number>`count(*)` })
      .from(deals)
      .where(eq(deals.stageId, stageId))

    if (Number(dealCount?.count || 0) > 0) {
      return { error: 'Pindahkan atau hapus deal di tahapan ini terlebih dahulu' }
    }

    await db.delete(pipelineStages).where(eq(pipelineStages.id, stageId))

    return { success: true }
  } catch (error: any) {
    console.error('Error deleting pipeline stage:', error)
    return { error: error.message || 'Gagal menghapus tahapan pipeline' }
  }
}

export async function deletePipeline(pipelineId: string) {
  try {
    const session = await auth()
    if (!session?.user?.id) {
      return { error: 'Unauthorized' }
    }
    const userId = session.user.id

    // ON DELETE CASCADE pada database akan secara otomatis menangani deals & stages.
    await db
      .delete(pipelines)
      .where(and(eq(pipelines.id, pipelineId), eq(pipelines.userId, userId)))

    return { success: true }
  } catch (error: any) {
    console.error('Error deleting pipeline:', error)
    return { error: error.message || 'Gagal menghapus pipeline' }
  }
}

export async function updateDealStage(dealId: string, stageId: string) {
  try {
    const session = await auth()
    if (!session?.user?.id) {
      return { error: 'Unauthorized' }
    }
    const userId = session.user.id

    await db
      .update(deals)
      .set({
        stageId,
        updatedAt: new Date(),
      })
      .where(and(eq(deals.id, dealId), eq(deals.userId, userId)))

    return { success: true }
  } catch (error: any) {
    console.error('Error updating deal stage:', error)
    return { error: error.message || 'Gagal memindahkan deal' }
  }
}

export async function saveDeal(data: {
  id?: string
  title: string
  value: number
  currency: string
  contactId: string
  pipelineId: string
  stageId: string
  assignedTo?: string | null
  notes?: string | null
  expectedCloseDate?: string | null
}) {
  try {
    const session = await auth()
    if (!session?.user?.id) {
      return { error: 'Unauthorized' }
    }
    const userId = session.user.id

    const payload = {
      title: data.title.trim(),
      value: String(data.value || 0),
      currency: data.currency,
      contactId: data.contactId || null,
      pipelineId: data.pipelineId,
      stageId: data.stageId,
      assignedTo: data.assignedTo || null,
      notes: data.notes?.trim() || null,
      expectedCloseDate: data.expectedCloseDate || null,
      updatedAt: new Date(),
    }

    if (data.id) {
      // Update
      await db
        .update(deals)
        .set(payload)
        .where(and(eq(deals.id, data.id), eq(deals.userId, userId)))
    } else {
      // Insert new deal
      await db.insert(deals).values({
        ...payload,
        userId,
        status: 'open',
      })
    }

    return { success: true }
  } catch (error: any) {
    console.error('Error saving deal:', error)
    return { error: error.message || 'Gagal menyimpan deal' }
  }
}

export async function updateDealStatus(dealId: string, status: 'open' | 'won' | 'lost') {
  try {
    const session = await auth()
    if (!session?.user?.id) {
      return { error: 'Unauthorized' }
    }
    const userId = session.user.id

    await db
      .update(deals)
      .set({
        status,
        updatedAt: new Date(),
      })
      .where(and(eq(deals.id, dealId), eq(deals.userId, userId)))

    return { success: true }
  } catch (error: any) {
    console.error('Error updating deal status:', error)
    return { error: error.message || 'Gagal memperbarui status deal' }
  }
}

export async function deleteDeal(dealId: string) {
  try {
    const session = await auth()
    if (!session?.user?.id) {
      return { error: 'Unauthorized' }
    }
    const userId = session.user.id

    await db
      .delete(deals)
      .where(and(eq(deals.id, dealId), eq(deals.userId, userId)))

    return { success: true }
  } catch (error: any) {
    console.error('Error deleting deal:', error)
    return { error: error.message || 'Gagal menghapus deal' }
  }
}

export async function getContactsList() {
  try {
    const session = await auth()
    if (!session?.user?.id) {
      return { error: 'Unauthorized' }
    }
    const userId = session.user.id

    const rows = await db
      .select()
      .from(contacts)
      .where(eq(contacts.userId, userId))
      .orderBy(contacts.name)

    const formatted = rows.map((c) => ({
      id: c.id,
      user_id: c.userId,
      phone: c.phone,
      name: c.name,
      email: c.email,
      company: c.company,
      avatar_url: c.avatarUrl,
      created_at: c.createdAt.toISOString(),
      updated_at: c.updatedAt.toISOString(),
    }))

    return { success: true, data: formatted }
  } catch (error: any) {
    console.error('Error fetching contacts list:', error)
    return { error: error.message || 'Gagal mengambil daftar kontak' }
  }
}

export async function getProfilesList() {
  try {
    const session = await auth()
    if (!session?.user?.id) {
      return { error: 'Unauthorized' }
    }
    const userId = session.user.id

    const rows = await db
      .select()
      .from(profiles)
      .where(eq(profiles.userId, userId))
      .orderBy(profiles.fullName)

    const formatted = rows.map((p) => ({
      id: p.id,
      user_id: p.userId,
      full_name: p.fullName,
      email: p.email,
      avatar_url: p.avatarUrl,
      role: p.role,
      created_at: p.createdAt.toISOString(),
      updated_at: p.updatedAt.toISOString(),
    }))

    return { success: true, data: formatted }
  } catch (error: any) {
    console.error('Error fetching profiles list:', error)
    return { error: error.message || 'Gagal mengambil daftar profil' }
  }
}

export async function getLinkedConversation(contactId: string) {
  try {
    const session = await auth()
    if (!session?.user?.id) {
      return { error: 'Unauthorized' }
    }
    const userId = session.user.id

    const { conversations } = await import('@/db/schema')
    const row = await db.query.conversations.findFirst({
      where: and(
        eq(conversations.contactId, contactId),
        eq(conversations.userId, userId)
      ),
      orderBy: [desc(conversations.lastMessageAt)],
    })

    if (!row) {
      return { success: true, data: null }
    }

    const formatted = {
      id: row.id,
      user_id: row.userId,
      contact_id: row.contactId,
      status: row.status,
      assigned_agent_id: row.assignedAgentId,
      last_message_text: row.lastMessageText,
      last_message_at: row.lastMessageAt ? row.lastMessageAt.toISOString() : null,
      unread_count: row.unreadCount,
      created_at: row.createdAt.toISOString(),
      updated_at: row.updatedAt.toISOString(),
    }

    return { success: true, data: formatted }
  } catch (error: any) {
    console.error('Error fetching linked conversation:', error)
    return { error: error.message || 'Gagal mengambil percakapan terkait' }
  }
}
