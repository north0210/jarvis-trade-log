import { createClient } from "@supabase/supabase-js";

// 【レガシー・現在未使用】
// 本アプリは全データを localStorage に保存する完全ローカル構成へ移行済み。
// stocks / holdings / journal / trades / strategies いずれも Repository（src/lib/storage/*）
// 経由で localStorage に保存され、この Supabase クライアントはどこからも import されていない。
// `supabase/migrations/0001_init.sql` と併せてレガシー資産（削除はせず温存）。
// .env.local 未設定でも import 時にクラッシュしない様プレースホルダ値へフォールバックする
// （createClient は URL が falsy だと例外を投げるため）。将来 DB 同期を復活させる場合の足場として残置。
const url = process.env.NEXT_PUBLIC_SUPABASE_URL || "https://placeholder.supabase.co";
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "placeholder-anon-key";

export const supabase = createClient(url, anonKey);
