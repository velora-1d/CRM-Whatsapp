import { auth } from '@/auth'
import { NextResponse } from 'next/server'

export default auth((req) => {
  const isLoggedIn = !!req.auth?.user
  const { nextUrl } = req

  // Auth pages - redirect to dashboard if already logged in
  const authPaths = ['/login', '/signup', '/forgot-password']
  if (isLoggedIn && authPaths.includes(nextUrl.pathname)) {
    return NextResponse.redirect(new URL('/dashboard', nextUrl))
  }

  // Protected pages - redirect to login if not authenticated
  const protectedPaths = ['/dashboard', '/inbox', '/contacts', '/pipelines', '/broadcasts', '/automations', '/settings']
  if (!isLoggedIn && protectedPaths.some(path => nextUrl.pathname.startsWith(path))) {
    return NextResponse.redirect(new URL('/login', nextUrl))
  }

  // API routes that need auth (not webhooks)
  if (!isLoggedIn && nextUrl.pathname.startsWith('/api/whatsapp/') &&
      !nextUrl.pathname.includes('/webhook')) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  return NextResponse.next()
})

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
}

