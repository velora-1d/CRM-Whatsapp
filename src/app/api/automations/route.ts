import { NextResponse } from 'next/server'
import { auth } from '@/auth'
import { db } from '@/db'
import { automations } from '@/db/schema'
import { eq, desc } from 'drizzle-orm'
import { getTemplate } from '@/lib/automations/templates'
import { insertSteps, type BuilderStepInput } from '@/lib/automations/steps-tree'
import {
  validateStepsForActivation,
  validateTriggerForActivation,
} from '@/lib/automations/validate'

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

export async function GET() {
  const session = await auth()
  const user = session?.user
  if (!user || !user.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  try {
    const data = await db
      .select()
      .from(automations)
      .where(eq(automations.userId, user.id))
      .orderBy(desc(automations.createdAt))
    return NextResponse.json({ automations: data.map(mapAutomationToSnakeCase) })
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || String(err) }, { status: 500 })
  }
}

export async function POST(request: Request) {
  const session = await auth()
  const user = session?.user
  if (!user || !user.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await request.json().catch(() => null)
  if (!body) return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })

  const { name, description, trigger_type, trigger_config, is_active, steps, template } = body

  let effectiveSteps: BuilderStepInput[] | undefined = steps
  let effectiveName = name
  let effectiveDescription = description
  let effectiveTriggerType = trigger_type
  let effectiveTriggerConfig = trigger_config

  if (template && (!steps || steps.length === 0)) {
    const t = getTemplate(template)
    if (t) {
      effectiveName = effectiveName ?? t.name
      effectiveDescription = effectiveDescription ?? t.description
      effectiveTriggerType = effectiveTriggerType ?? t.trigger_type
      effectiveTriggerConfig = effectiveTriggerConfig ?? t.trigger_config
      effectiveSteps = t.steps as unknown as BuilderStepInput[]
    }
  }

  if (!effectiveName || !effectiveTriggerType) {
    return NextResponse.json(
      { error: 'name and trigger_type are required' },
      { status: 400 },
    )
  }

  // Block activation of a clearly broken automation up-front instead of
  // letting every trigger silently produce a failed log row. Drafts
  // (is_active=false) are allowed to be incomplete so users can save
  // progress mid-build.
  if (is_active) {
    const issues = [
      ...validateTriggerForActivation(effectiveTriggerType, effectiveTriggerConfig ?? {}),
      ...validateStepsForActivation(
        (effectiveSteps ?? []) as unknown as { step_type: string; step_config: Record<string, unknown> }[],
      ),
    ]
    if (issues.length > 0) {
      return NextResponse.json(
        { error: 'Cannot activate automation with invalid configuration', issues },
        { status: 400 },
      )
    }
  }

  try {
    const [automation] = await db
      .insert(automations)
      .values({
        userId: user.id,
        name: effectiveName,
        description: effectiveDescription ?? null,
        triggerType: effectiveTriggerType,
        triggerConfig: effectiveTriggerConfig ?? {},
        isActive: !!is_active,
      })
      .returning()

    if (!automation) {
      return NextResponse.json({ error: 'insert failed' }, { status: 500 })
    }

    if (effectiveSteps && effectiveSteps.length > 0) {
      const err = await insertSteps(automation.id, effectiveSteps)
      if (err) return NextResponse.json({ error: err }, { status: 500 })
    }

    return NextResponse.json({ automation: mapAutomationToSnakeCase(automation) }, { status: 201 })
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || String(err) }, { status: 500 })
  }
}


