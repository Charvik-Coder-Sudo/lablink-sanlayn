import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { getSupabaseEnvVar } from "@/integrations/supabase/env";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";

const bookingInputSchema = z.object({
  equipment_id: z.string().uuid(),
  booking_date: z.string(),
  start_time: z.string(),
  end_time: z.string(),
  quantity: z.number().int().positive(),
  purpose: z.string().min(1),
});

export const createBookingServerFn = createServerFn({ method: "POST" })
  .validator(bookingInputSchema)
  .handler(async ({ data, request }) => {
    const authHeader = request.headers.get("authorization");
    const token = authHeader?.replace(/^Bearer\s+/i, "").trim();

    if (!token) {
      throw new Error("Unauthorized");
    }

    const supabaseUrl = getSupabaseEnvVar("SUPABASE_URL");
    const supabaseServiceRoleKey = getSupabaseEnvVar("SUPABASE_SERVICE_ROLE_KEY");

    if (!supabaseUrl || !supabaseServiceRoleKey) {
      throw new Error("Supabase environment is not configured");
    }

    const supabase = createClient<Database>(supabaseUrl, supabaseServiceRoleKey, {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
      },
    });

    const { data: userData, error: userError } = await supabase.auth.getUser(token);
    const userId = userData?.user?.id;

    if (userError || !userId) {
      throw new Error(userError?.message ?? "Unable to resolve the authenticated user");
    }

    const payload = {
      equipment_id: data.equipment_id,
      user_id: userId,
      booking_date: data.booking_date,
      start_time: data.start_time,
      end_time: data.end_time,
      quantity: data.quantity,
      purpose: data.purpose,
      status: "booked" as const,
    };

    const { data: createdBooking, error } = await supabase.from("bookings").insert(payload).select().single();

    if (error) {
      throw new Error(error.message);
    }

    return createdBooking;
  });
