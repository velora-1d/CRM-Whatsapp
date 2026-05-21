import { getToken } from 'next-auth/jwt'
import { NextResponse, type NextRequest } from 'next/server'

async function readSessionToken(req: NextRequest) {
  const forwardedProto = req.headers.get('x-forwarded-proto')
  const secureCookie =
    forwardedProto === 'https' || req.nextUrl.protocol === 'https:'

  return (
    (await getToken({
      req,
      secret: process.env.NEXTAUTH_SECRET,
      secureCookie,
    })) ??
    (await getToken({
      req,
      secret: process.env.NEXTAUTH_SECRET,
      secureCookie: !secureCookie,
    }))
  )
}

export default async function middleware(req: NextRequest) {
  const token = await readSessionToken(req)
  const isLoggedIn = !!token
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
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
}
