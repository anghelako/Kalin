// Handoff generation is disabled unless both deployment and circle consent are enabled.
import { createClient } from 'npm:@supabase/supabase-js@2.45.4';
import { createHandoffHandler } from './handler.mjs';

Deno.serve(createHandoffHandler({ env: (name: string) => Deno.env.get(name), createClient }));
