import { createClient } from 'jsr:@supabase/supabase-js@2';

const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!;

// Service-role client bypasses RLS (auth creation + users inserts).
const admin = createClient(supabaseUrl, serviceRoleKey);

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

/**
 * POST /provision-user
 * Creates a Supabase Auth user + a `users` role row (admin/hod/faculty).
 *
 * Bootstrap: allowed without a token when the `users` table is empty
 * (creates the very first admin). Otherwise requires an authenticated admin.
 *
 * Body: { email, password, name, role, department_id?, faculty_id? }
 */
Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  if (req.method !== 'POST') return json(405, { error: 'method_not_allowed' });

  const authHeader = req.headers.get('Authorization') || '';
  const token = authHeader.replace(/^Bearer\s+/i, '');

  let actingUser: { id: string; role: string } | null = null;
  const userClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: `Bearer ${token}` } },
  });

  const { count, error: countError } = await admin.from('users').select('id', { count: 'exact', head: true });
  if (countError) return json(500, { error: { message: countError.message } });
  const userCount = count || 0;

  if (userCount > 0) {
    if (!token) return json(403, { error: { message: 'Admin authentication required' } });
    const { data: u, error: authError } = await userClient.auth.getUser();
    if (authError || !u?.user) return json(401, { error: { message: 'Invalid token' } });
    const { data: profile, error: profileError } = await userClient
      .from('users')
      .select('id, role')
      .eq('id', u.user.id)
      .maybeSingle();
    if (profileError || !profile) return json(403, { error: { message: 'Not provisioned' } });
    if (profile.role !== 'admin') return json(403, { error: { message: 'Only admins can create users' } });
    actingUser = profile;
  }

  let body: {
    email: string;
    password: string;
    name: string;
    role: 'admin' | 'hod' | 'faculty';
    department_id?: string | null;
    faculty_id?: string | null;
  };
  try {
    body = await req.json();
  } catch {
    return json(400, { error: { message: 'Invalid JSON body' } });
  }

  if (!body.email || !body.password || !body.name || !body.role) {
    return json(400, { error: { message: 'email, password, name and role are required' } });
  }
  if (body.role === 'faculty' && !body.faculty_id) {
    return json(400, { error: { message: 'faculty_id is required for faculty role' } });
  }
  if (body.role === 'hod' && !body.department_id) {
    return json(400, { error: { message: 'department_id is required for hod role' } });
  }

  // Faculty: email must match the linked faculty record; derive department.
  let departmentId = body.department_id || null;
  if (body.role === 'faculty') {
    const { data: fac, error: fe } = await admin.from('faculty').select('*').eq('id', body.faculty_id).maybeSingle();
    if (fe || !fac) return json(422, { error: { message: 'Linked faculty record does not exist' } });
    if (fac.email !== body.email) {
      return json(400, { error: { message: 'Email must match the linked faculty email' } });
    }
    departmentId = fac.department_id ?? null;
  }

  const { data: created, error: createError } = await admin.auth.admin.createUser({
    email: body.email,
    password: body.password,
    email_confirm: true,
    user_metadata: { name: body.name },
  });
  if (createError) {
    if (/already registered/i.test(createError.message)) {
      return json(409, { error: { message: 'A user with this email already exists' } });
    }
    return json(500, { error: { message: createError.message } });
  }

  const { error: insertError } = await admin.from('users').insert({
    id: created.user.id,
    role: body.role,
    department_id: departmentId,
    faculty_id: body.faculty_id || null,
  });
  if (insertError) {
    await admin.auth.admin.deleteUser(created.user.id).catch(() => {});
    return json(500, { error: { message: insertError.message } });
  }

  const { error: auditError } = await admin.from('audit_logs').insert({
    user_id: actingUser?.id || created.user.id,
    action: 'user_created',
    entity_type: 'users',
    entity_id: created.user.id,
    metadata: { role: body.role },
  });
  if (auditError) {
    console.error('audit insert failed', auditError.message);
  }

  return json(201, {
    user: { id: created.user.id, email: body.email, role: body.role, department_id: departmentId, faculty_id: body.faculty_id || null },
  });
});