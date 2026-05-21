import { NextResponse } from 'next/server'
import { auth } from '@/auth'
import { db } from '@/db'
import { automations, automationSteps } from '@/db/schema'
import { eq, and, asc } from 'drizzle-orm'

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

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params
  const session = await auth()
  const user = session?.user
  if (!user || !user.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  try {
    const original = await db.query.automations.findFirst({
      where: and(
        eq(automations.id, id),
        eq(automations.userId, user.id)
      )
    })

    if (!original) return NextResponse.json({ error: 'Not found' }, { status: 404 })

    const [copy] = await db
      .insert(automations)
      .values({
        userId: user.id,
        name: `${original.name} (Copy)`,
        description: original.description,
        triggerType: original.triggerType,
        triggerConfig: original.triggerConfig as any,
        isActive: false,
      })
      .returning()

    if (!copy) {
      return NextResponse.json({ error: 'copy failed' }, { status: 500 })
    }

    const steps = await db
      .select()
      .from(automationSteps)
      .where(eq(automationSteps.automationId, id))
      .orderBy(asc(automationSteps.position))

    if (steps && steps.length > 0) {
      // Re-map parent_step_id: build old→new id map first so the second
      // pass inserts rows with correct parent references.
      const idMap = new Map<string, string>()
      const uid = () =>
        typeof crypto !== 'undefined' && 'randomUUID' in crypto
          ? crypto.randomUUID()
          : Math.random().toString(36).slice(2) + Date.now().toString(36)
      for (const row of steps) idMap.set(row.id, uid())

      const rows = steps.map((row) => ({
        id: idMap.get(row.id)!,
        automationId: copy.id,
        parentStepId: row.parentStepId ? idMap.get(row.parentStepId) : null,
        branch: row.branch as any,
        stepType: row.stepType,
        stepConfig: row.stepConfig as any,
        position: row.position,
      }))
      await db.insert(automationSteps).values(rows)
    }

    return NextResponse.json({ automation: mapAutomationToSnakeCase(copy) }, { status: 201 })
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || String(err) }, { status: 500 })
  }
}

