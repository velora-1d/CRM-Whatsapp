import { NextResponse } from 'next/server'
import { db } from '@/db'
import { conversations } from '@/db/schema'
import { eq, and, gt } from 'drizzle-orm'
import { auth } from '@/auth'
import { count } from 'drizzle-orm'

export async function GET() {
  try {
    const session = await auth()
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    const userId = session.user.id

    const [result] = await db
      .select({ val: count() })
      .from(conversations)
      .where(
        and(
          eq(conversations.userId, userId),
          gt(conversations.unreadCount, 0)
        )
      )

    return NextResponse.json({ total: result?.val ?? 0 })
  } catch (error: any) {
    console.error('Error getting unread conversations count:', error)
    return NextResponse.json({ error: error.message || 'Internal Server Error' }, { status: 500 })
  }
}
