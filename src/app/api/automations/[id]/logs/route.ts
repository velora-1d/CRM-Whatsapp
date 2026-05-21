import { NextResponse } from 'next/server'
import { db } from '@/db'
import { automations, automationLogs, contacts } from '@/db/schema'
import { eq, and, desc } from 'drizzle-orm'
import { auth } from '@/auth'

function mapAutomationToSnakeCase(auto: any) {
  if (!auto) return null
  return {
    id: auto.id,
    user_id: auto.userId,
    name: auto.name,
    description: auto.description,
    trigger_type: auto.triggerType,
    trigger_config: auto.triggerConfig,
    is_active: auto.isActive,
    execution_count: auto.executionCount,
    last_executed_at: auto.lastExecutedAt,
    created_at: auto.createdAt,
    updated_at: auto.updatedAt,
  }
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params
  
  try {
    const session = await auth()
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    const userId = session.user.id

    // Fetch automation
    const automation = await db.query.automations.findFirst({
      where: and(
        eq(automations.id, id),
        eq(automations.userId, userId)
      )
    })

    if (!automation) {
      return NextResponse.json({ error: 'Automation not found' }, { status: 404 })
    }

    // Fetch automation logs join contacts
    const logsData = await db
      .select({
        id: automationLogs.id,
        automationId: automationLogs.automationId,
        userId: automationLogs.userId,
        contactId: automationLogs.contactId,
        triggerEvent: automationLogs.triggerEvent,
        stepsExecuted: automationLogs.stepsExecuted,
        status: automationLogs.status,
        errorMessage: automationLogs.errorMessage,
        createdAt: automationLogs.createdAt,
        contact: {
          id: contacts.id,
          name: contacts.name,
          phone: contacts.phone,
        }
      })
      .from(automationLogs)
      .leftJoin(contacts, eq(automationLogs.contactId, contacts.id))
      .where(
        and(
          eq(automationLogs.automationId, id),
          eq(automationLogs.userId, userId)
        )
      )
      .orderBy(desc(automationLogs.createdAt))
      .limit(100)

    const formattedLogs = logsData.map((log) => ({
      id: log.id,
      automation_id: log.automationId,
      user_id: log.userId,
      contact_id: log.contactId,
      trigger_event: log.triggerEvent,
      steps_executed: log.stepsExecuted,
      status: log.status,
      error_message: log.errorMessage,
      created_at: log.createdAt.toISOString(),
      contact: log.contact ? {
        id: log.contact.id,
        name: log.contact.name,
        phone: log.contact.phone,
      } : null
    }))

    return NextResponse.json({
      automation: mapAutomationToSnakeCase(automation),
      logs: formattedLogs
    })
  } catch (error: any) {
    console.error('Error fetching automation logs:', error)
    return NextResponse.json({ error: error.message || 'Internal Server Error' }, { status: 500 })
  }
}
