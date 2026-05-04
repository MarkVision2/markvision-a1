import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.95.0'
import { corsHeaders } from 'https://esm.sh/@supabase/supabase-js@2.95.0/cors'

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }
  try {
    const authHeader = req.headers.get('Authorization')
    if (!authHeader) return new Response('Unauthorized', { status: 401, headers: corsHeaders })

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    })
    const { data: { user } } = await userClient.auth.getUser()
    if (!user) return new Response('Unauthorized', { status: 401, headers: corsHeaders })
    const { data: roles } = await userClient.from('user_roles').select('role').eq('user_id', user.id)
    const isAdmin = (roles ?? []).some((r: { role: string }) => r.role === 'admin')
    if (!isAdmin) return new Response('Forbidden', { status: 403, headers: corsHeaders })

    const { user_id } = await req.json()
    if (!user_id) return new Response('Missing user_id', { status: 400, headers: corsHeaders })

    const admin = createClient(supabaseUrl, serviceKey)
    const { error } = await admin.auth.admin.deleteUser(user_id)
    if (error) {
      return new Response(JSON.stringify({ error: error.message }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }
    return new Response(JSON.stringify({ ok: true }), {
      status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  } catch (e) {
    return new Response(JSON.stringify({ error: (e as Error).message }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
})
