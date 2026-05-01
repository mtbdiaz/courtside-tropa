import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@supabase/ssr';
import { isScorerEmail } from '@/lib/auth-role';

export async function proxy(request: NextRequest) {
  let response = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
          response = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) => {
            response.cookies.set(name, value, options);
          });
        },
      },
    }
  );

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (request.nextUrl.pathname.startsWith('/dashboard') && !user) {
    const redirectUrl = request.nextUrl.clone();
    redirectUrl.pathname = '/login';
    redirectUrl.searchParams.set('next', request.nextUrl.pathname);
    return NextResponse.redirect(redirectUrl);
  }

  if (user && isScorerEmail(user.email)) {
    const isDashboardPath = request.nextUrl.pathname.startsWith('/dashboard');
    const isScorePath = request.nextUrl.pathname.startsWith('/dashboard/score');
    if (isDashboardPath && !isScorePath) {
      const redirectUrl = request.nextUrl.clone();
      redirectUrl.pathname = '/dashboard/score';
      redirectUrl.search = '';
      return NextResponse.redirect(redirectUrl);
    }
  }

  if (request.nextUrl.pathname === '/' && user) {
    const redirectUrl = request.nextUrl.clone();
    redirectUrl.pathname = isScorerEmail(user.email) ? '/dashboard/score' : '/dashboard';
    return NextResponse.redirect(redirectUrl);
  }

  return response;
}

export const config = {
  matcher: ['/', '/dashboard/:path*'],
};