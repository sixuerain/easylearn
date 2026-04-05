export { default } from 'next-auth/middleware'

export const config = {
  matcher: ['/((?!login|api/auth|api/img|api/audio|_next/static|_next/image|favicon.ico|manifest.json|manifest.webmanifest|sw.js|icons/|uploads/).*)'],
}
