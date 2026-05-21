import { NextResponse } from 'next/server'
import { db } from '@/db'
import { automationPendingExecutions } from '@/db/schema'
import { and, eq, lte, asc } from 'drizzle-orm'
import { resumePendingExecution } from '@/lib/automations/engine'
import type { AutomationContext } from '@/lib/automations/engine'

/**
 * Drain due `automation_pending_executions` rows. Meant to be hit
 * on a schedule (Vercel Cron / external pinger) — requires a shared
 * secret via the `x-cron-secret` header to match
 * `AUTOMATION_CRON_SECRET`.
 *
 * The claim step (status = 'running') serves as a simple lock so
 * overlapping invocations don't double-process rows. Best-effort
 * only; expensive SELECT ... FOR UPDATE is avoided in favor of a
 * two-step UPDATE-by-id.
 */
export async function GET(request: Request) {
  const expected = process.env.AUTOMATION_CRON_SECRET
  if (!expected) {
    return NextResponse.json({ error: 'cron not configured' }, { status: 503 })
  }
  const supplied = request.headers.get('x-cron-secret')
  if (supplied !== expected) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const due = await db
      .select()
      .from(automationPendingExecutions)
      .where(
        and(
          eq(automationPendingExecutions.status, 'pending'),
          lte(automationPendingExecutions.runAt, new Date())
        )
      )
      .orderBy(asc(automationPendingExecutions.runAt))
      .limit(50)

    if (!due || due.length === 0) return NextResponse.json({ processed: 0 })

    let processed = 0
    for (const row of due) {
      const [claim] = await db
        .update(automationPendingExecutions)
        .set({ status: 'running' })
        .where(
          and(
            eq(automationPendingExecutions.id, row.id),
            eq(automationPendingExecutions.status, 'pending')
          )
        )
        .returning({ id: automationPendingExecutions.id })

      if (!claim) continue

      await resumePendingExecution({
        id: row.id,
        automation_id: row.automationId,
        user_id: row.userId,
        contact_id: row.contactId,
        log_id: row.logId,
        parent_step_id: row.parentStepId,
        branch: row.branch as any,
        next_step_position: row.nextStepPosition,
        context: (row.context as AutomationContext) ?? {},
      })
      processed++
    }

    return NextResponse.json({ processed })
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || String(err) }, { status: 500 })
  }
}

