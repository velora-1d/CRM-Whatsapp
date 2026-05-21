import { NextResponse } from 'next/server'
import { auth } from '@/auth'
import { db } from '@/db'
import { automations } from '@/db/schema'
import { eq, and } from 'drizzle-orm'
import {
  loadStepsTree,
  replaceSteps,
  type BuilderStepInput,
} from '@/lib/automations/steps-tree'
import {
  validateStepsForActivation,
  validateTriggerForActivation,
} from '@/lib/automations/validate'

async function requireUser() {
  const session = await auth()
  return session?.user
}

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
  const user = await requireUser()
  if (!user || !user.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  try {
    const automation = await db.query.automations.findFirst({
      where: and(
        eq(automations.id, id),
        eq(automations.userId, user.id)
      )
    })

    if (!automation) return NextResponse.json({ error: 'Not found' }, { status: 404 })

    const steps = await loadStepsTree(id)
    return NextResponse.json({ automation: mapAutomationToSnakeCase(automation), steps })
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || String(err) }, { status: 500 })
  }
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params
  const user = await requireUser()
  if (!user || !user.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await request.json().catch(() => null)
  if (!body) return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })

  try {
    // Ownership check before we touch anything.
    const existing = await db.query.automations.findFirst({
      where: and(
        eq(automations.id, id),
        eq(automations.userId, user.id)
      )
    })

    if (!existing) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 })
    }

    const update: Record<string, unknown> = {}
    if ('name' in body) update.name = body.name
    if ('description' in body) update.description = body.description
    if ('trigger_type' in body) update.triggerType = body.trigger_type
    if ('trigger_config' in body) update.triggerConfig = body.trigger_config
    if ('is_active' in body) update.isActive = body.is_active

    // If this PATCH leaves the automation active (either explicitly
    // activating it OR editing an already-active one), validate the
    // merged configuration first.
    const willBeActive =
      typeof update.isActive === 'boolean' ? update.isActive : existing.isActive
    if (willBeActive) {
      const mergedTriggerType = (update.triggerType ?? existing.triggerType) as string
      const mergedTriggerConfig = (update.triggerConfig ?? existing.triggerConfig) as any
      const mergedSteps = Array.isArray(body.steps)
        ? (body.steps as { step_type: string; step_config: Record<string, unknown> }[])
        : await loadStepsTree(id)
      const issues = [
        ...validateTriggerForActivation(mergedTriggerType, mergedTriggerConfig),
        ...validateStepsForActivation(mergedSteps),
      ]
      if (issues.length > 0) {
        return NextResponse.json(
          {
            error: 'Cannot keep automation active with invalid configuration',
            issues,
          },
          { status: 400 },
        )
      }
    }

    if (Object.keys(update).length > 0) {
      await db
        .update(automations)
        .set({
          ...update,
          updatedAt: new Date()
        })
        .where(eq(automations.id, id))
    }

    if (Array.isArray(body.steps)) {
      const err = await replaceSteps(id, body.steps as BuilderStepInput[])
      if (err) return NextResponse.json({ error: err }, { status: 500 })
    }

    return NextResponse.json({ ok: true })
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || String(err) }, { status: 500 })
  }
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params
  const user = await requireUser()
  if (!user || !user.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  try {
    await db
      .delete(automations)
      .where(
        and(
          eq(automations.id, id),
          eq(automations.userId, user.id)
        )
      )
    return NextResponse.json({ ok: true })
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || String(err) }, { status: 500 })
  }
}

