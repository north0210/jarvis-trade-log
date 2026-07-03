import { createClient } from "@supabase/supabase-js";

// Phase 2 以降、銘柄は localStorage（src/lib/storage/stockRepository.ts）に保存する。
// この Supabase クライアントは holdings / journal など未移行の機能が引き続き利用する。
// .env.local 未設定でも import 時にクラッシュしない様、プレースホルダ値へフォールバックする
// （createClient は URL が falsy だと例外を投げるため）。実際の接続には .env.local が必要。
const url = process.env.NEXT_PUBLIC_SUPABASE_URL || "https://placeholder.supabase.co";
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "placeholder-anon-key";

export const supabase = createClient(url, anonKey);
