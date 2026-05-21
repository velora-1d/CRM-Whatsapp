import { NextResponse } from 'next/server'
import { db } from '@/db'
import { whatsappConfig, messageTemplates } from '@/db/schema'
import { eq, and } from 'drizzle-orm'
import { auth } from '@/auth'
import { decrypt } from '@/lib/whatsapp/encryption'

const META_API_VERSION = 'v21.0'
const META_API_BASE = `https://graph.facebook.com/${META_API_VERSION}`

interface MetaTemplateComponent {
  type: string
  text?: string
  format?: string
}

interface MetaTemplate {
  id: string
  name: string
  language: string
  status: 'APPROVED' | 'PENDING' | 'REJECTED' | 'PAUSED'
  category: string
  components?: MetaTemplateComponent[]
}

function normalizeCategory(
  meta: string,
): 'Marketing' | 'Utility' | 'Authentication' {
  const upper = meta.toUpperCase()
  if (upper === 'UTILITY') return 'Utility'
  if (upper === 'AUTHENTICATION') return 'Authentication'
  return 'Marketing'
}

function normalizeStatus(
  meta: string,
): 'Draft' | 'Pending' | 'Approved' | 'Rejected' {
  switch (meta.toUpperCase()) {
    case 'APPROVED':
      return 'Approved'
    case 'PENDING':
    case 'IN_APPEAL':
    case 'PENDING_DELETION':
      return 'Pending'
    case 'REJECTED':
    case 'DISABLED':
    case 'PAUSED':
      return 'Rejected'
    default:
      return 'Draft'
  }
}

export async function POST() {
  try {
    const session = await auth()
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    const userId = session.user.id

    // Fetch config
    const [config] = await db
      .select()
      .from(whatsappConfig)
      .where(eq(whatsappConfig.userId, userId))
      .limit(1)

    if (!config) {
      return NextResponse.json(
        {
          error:
            'WhatsApp not configured. Connect your WhatsApp Business account in Settings first.',
        },
        { status: 400 },
      )
    }

    if (!config.wabaId) {
      return NextResponse.json(
        {
          error:
            'WABA (WhatsApp Business Account) ID missing. Re-connect your account in Settings.',
        },
        { status: 400 },
      )
    }

    if (!config.accessToken) {
      return NextResponse.json(
        {
          error:
            'Access token is missing. Re-configure your account in Settings.',
        },
        { status: 400 },
      )
    }

    const accessToken = decrypt(config.accessToken)

    const metaTemplates: MetaTemplate[] = []
    let nextUrl:
      | string
      | null = `${META_API_BASE}/${config.wabaId}/message_templates?limit=100&fields=id,name,language,status,category,components`
    const PAGE_CAP = 20
    let pageCount = 0

    while (nextUrl && pageCount < PAGE_CAP) {
      pageCount++
      const metaRes: Response = await fetch(nextUrl, {
        headers: { Authorization: `Bearer ${accessToken}` },
      })

      if (!metaRes.ok) {
        let metaErr = `Meta API error: ${metaRes.status}`
        try {
          const body = await metaRes.json()
          if (body?.error?.message) metaErr = body.error.message
        } catch {
          // ignore
        }
        return NextResponse.json({ error: metaErr }, { status: 502 })
      }

      const metaBody: {
        data?: MetaTemplate[]
        paging?: { next?: string }
      } = await metaRes.json()
      if (metaBody.data) metaTemplates.push(...metaBody.data)
      nextUrl = metaBody.paging?.next ?? null
    }

    let inserted = 0
    let updated = 0
    const errors: { name: string; language: string; message: string }[] = []

    for (const t of metaTemplates) {
      const body = (t.components ?? []).find((c) => c.type === 'BODY')
      const header = (t.components ?? []).find((c) => c.type === 'HEADER')
      const footer = (t.components ?? []).find((c) => c.type === 'FOOTER')

      const [existing] = await db
        .select({ id: messageTemplates.id })
        .from(messageTemplates)
        .where(
          and(
            eq(messageTemplates.userId, userId),
            eq(messageTemplates.name, t.name),
            eq(messageTemplates.language, t.language)
          )
        )
        .limit(1)

      try {
        if (existing?.id) {
          await db
            .update(messageTemplates)
            .set({
              category: normalizeCategory(t.category),
              headerType: header?.format?.toLowerCase() ?? null,
              headerContent: header?.text ?? null,
              bodyText: body?.text ?? '',
              footerText: footer?.text ?? null,
              status: normalizeStatus(t.status),
              updatedAt: new Date(),
            })
            .where(eq(messageTemplates.id, existing.id))
          updated++
        } else {
          await db
            .insert(messageTemplates)
            .values({
              userId,
              name: t.name,
              category: normalizeCategory(t.category),
              language: t.language || 'en_US',
              headerType: header?.format?.toLowerCase() ?? null,
              headerContent: header?.text ?? null,
              bodyText: body?.text ?? '',
              footerText: footer?.text ?? null,
              status: normalizeStatus(t.status),
              createdAt: new Date(),
              updatedAt: new Date(),
            })
          inserted++
        }
      } catch (err: any) {
        errors.push({
          name: t.name,
          language: t.language,
          message: err.message || 'Database error',
        })
      }
    }

    return NextResponse.json({
      success: errors.length === 0,
      total: metaTemplates.length,
      inserted,
      updated,
      errors,
      truncated: pageCount >= PAGE_CAP && nextUrl !== null,
    })
  } catch (error: any) {
    console.error('Error syncing WhatsApp templates:', error)
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : 'Failed to sync templates',
      },
      { status: 500 },
    )
  }
}

