import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.95.0'
import { corsHeaders } from 'https://esm.sh/@supabase/supabase-js@2.95.0/cors'

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const authHeader = req.headers.get('Authorization')
    if (!authHeader) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!
    // Lovable Cloud reserves the SUPABASE_ prefix for its own managed secrets,
    // so the service-role key is exposed under a custom name (set in Lovable
    // Cloud → Secrets as ADMIN_SERVICE_ROLE_KEY).
    const serviceKey = Deno.env.get('ADMIN_SERVICE_ROLE_KEY')
      ?? Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
    if (!serviceKey) {
      return new Response(
        JSON.stringify({ error: 'Server misconfigured: ADMIN_SERVICE_ROLE_KEY secret not set' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      )
    }

    // verify caller is admin
    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    })
    const { data: { user }, error: userErr } = await userClient.auth.getUser()
    if (userErr || !user) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }
    const { data: roles } = await userClient.from('user_roles').select('role').eq('user_id', user.id)
    const isAdmin = (roles ?? []).some((r: { role: string }) => r.role === 'admin')
    if (!isAdmin) {
      return new Response(JSON.stringify({ error: 'Forbidden' }), {
        status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const body = await req.json()
    const { email, password, name, phone, login, role, modules } = body
    if (!email || !password || !name) {
      return new Response(JSON.stringify({ error: 'Missing required fields' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const admin = createClient(supabaseUrl, serviceKey)

    const { data: created, error: createErr } = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { name, phone },
    })
    if (createErr || !created.user) {
      return new Response(JSON.stringify({ error: createErr?.message ?? 'Create failed' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }
    const newId = created.user.id

    // profile (handle_new_user already inserted base row via trigger)
    await admin.from('profiles').update({
      name,
      phone: phone ?? null,
      login: login ?? null,
      display_role: role ?? null,
    }).eq('id', newId)

    // role
    if (role) {
      await admin.from('user_roles').delete().eq('user_id', newId)
      await admin.from('user_roles').insert({ user_id: newId, role })
    }

    // modules
    if (Array.isArray(modules)) {
      await admin.from('team_member_modules').delete().eq('user_id', newId)
      if (modules.length) {
        await admin.from('team_member_modules').insert(
          modules.map((m: string) => ({ user_id: newId, module_key: m })),
        )
      }
    }

    return new Response(JSON.stringify({ id: newId }), {
      status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  } catch (e) {
    return new Response(JSON.stringify({ error: (e as Error).message }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
})
