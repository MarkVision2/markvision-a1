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
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

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
    const { email, password, name, phone, login, role, modules, project_ids } = body

    // Логин — ГЛАВНЫЙ идентификатор входа. Если он задан, auth-email всегда
    // синтетический <login>@markvision.app — независимо от поля email (иначе
    // аккаунт создавался бы на введённый email, а вход по логину не проходил).
    // Поле email используется как auth-идентификатор только когда логина нет.
    // (Форма входа сама дописывает @markvision.app для значений без «@».)
    const cleanLogin = typeof login === 'string' ? login.trim().toLowerCase().replace(/\s+/g, '_') : ''
    const authEmail = cleanLogin
      ? `${cleanLogin}@markvision.app`
      : (typeof email === 'string' && email.includes('@') ? email.trim().toLowerCase() : '')

    if (!authEmail || !password || !name) {
      return new Response(JSON.stringify({ error: 'Нужны логин (или email), пароль и имя' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const admin = createClient(supabaseUrl, serviceKey)

    const { data: created, error: createErr } = await admin.auth.admin.createUser({
      email: authEmail,
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
      login: cleanLogin || null,
      display_role: role ?? null,
    }).eq('id', newId)

    // role
    if (role) {
      const { error: roleDeleteError } = await admin.from('user_roles').delete().eq('user_id', newId)
      if (roleDeleteError) throw roleDeleteError
      const { error: roleInsertError } = await admin.from('user_roles').insert({ user_id: newId, role })
      if (roleInsertError) throw roleInsertError
    }

    // modules
    if (Array.isArray(modules)) {
      const { error: modulesDeleteError } = await admin.from('team_member_modules').delete().eq('user_id', newId)
      if (modulesDeleteError) throw modulesDeleteError
      if (modules.length) {
        const { error: modulesInsertError } = await admin.from('team_member_modules').insert(
          modules.map((m: string) => ({ user_id: newId, module_key: m })),
        )
        if (modulesInsertError) throw modulesInsertError
      }
    }

    // project memberships
    if (Array.isArray(project_ids) && project_ids.length) {
      const { error: membersDeleteError } = await admin.from('project_members').delete().eq('user_id', newId)
      if (membersDeleteError) throw membersDeleteError
      const { error: membersInsertError } = await admin.from('project_members').insert(
        project_ids.map((pid: string) => ({ project_id: pid, user_id: newId, role: 'member' })),
      )
      if (membersInsertError) throw membersInsertError
      const { error: activeProjectError } = await admin.from('user_active_project').upsert(
        { user_id: newId, project_id: project_ids[0] },
        { onConflict: 'user_id' },
      )
      if (activeProjectError) throw activeProjectError
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
