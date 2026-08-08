-- Phase 1: Drop permissive Supabase RLS placeholders (authenticated_full_access USING true).
-- Safe for SUPACLEAN POS: the Express API uses DATABASE_URL as a privileged role and bypasses RLS.
-- Run in Supabase SQL Editor against project mneolwrejlqfccnsitfx (or your production ref).
-- After running, re-export Database Linter — rls_policy_always_true warnings for these tables should clear.
-- With policies removed and RLS still enabled, anon/authenticated PostgREST access is denied by default.

BEGIN;

DROP POLICY IF EXISTS authenticated_full_access ON public.bank_accounts;
DROP POLICY IF EXISTS authenticated_full_access ON public.bank_deposits;
DROP POLICY IF EXISTS authenticated_full_access ON public.bill_items;
DROP POLICY IF EXISTS authenticated_full_access ON public.bills;
DROP POLICY IF EXISTS authenticated_full_access ON public.branch_features;
DROP POLICY IF EXISTS authenticated_full_access ON public.branch_item_prices;
DROP POLICY IF EXISTS authenticated_full_access ON public.branches;
DROP POLICY IF EXISTS authenticated_full_access ON public.bulk_sms_audit_log;
DROP POLICY IF EXISTS authenticated_full_access ON public.cleaning_expenses;
DROP POLICY IF EXISTS authenticated_full_access ON public.daily_cash_summaries;
DROP POLICY IF EXISTS authenticated_full_access ON public.delivery_notes;
DROP POLICY IF EXISTS authenticated_full_access ON public.employees;
DROP POLICY IF EXISTS authenticated_full_access ON public.expense_audit_log;
DROP POLICY IF EXISTS authenticated_full_access ON public.expense_categories;
DROP POLICY IF EXISTS authenticated_full_access ON public.expenses;
DROP POLICY IF EXISTS authenticated_full_access ON public.invoice_items;
DROP POLICY IF EXISTS authenticated_full_access ON public.invoice_payments;
DROP POLICY IF EXISTS authenticated_full_access ON public.invoices;
DROP POLICY IF EXISTS authenticated_full_access ON public.loyalty_points;
DROP POLICY IF EXISTS authenticated_full_access ON public.loyalty_rewards;
DROP POLICY IF EXISTS authenticated_full_access ON public.loyalty_transactions;
DROP POLICY IF EXISTS authenticated_full_access ON public.notifications;
DROP POLICY IF EXISTS authenticated_full_access ON public.order_item_photos;
DROP POLICY IF EXISTS authenticated_full_access ON public.order_transfers;
DROP POLICY IF EXISTS authenticated_full_access ON public.payment_audit_log;
DROP POLICY IF EXISTS authenticated_full_access ON public.payroll_monthly;
DROP POLICY IF EXISTS authenticated_full_access ON public.payroll_periods;
DROP POLICY IF EXISTS authenticated_full_access ON public.salary_advances;
DROP POLICY IF EXISTS authenticated_full_access ON public.services;
DROP POLICY IF EXISTS authenticated_full_access ON public.settings;
DROP POLICY IF EXISTS authenticated_full_access ON public.transactions;
DROP POLICY IF EXISTS authenticated_full_access ON public.user_sessions;
DROP POLICY IF EXISTS authenticated_full_access ON public.users;

-- Optional: revoke broad grants to PostgREST client roles (uncomment if you do not use direct client access)
-- REVOKE ALL ON ALL TABLES IN SCHEMA public FROM anon, authenticated;
-- REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM anon, authenticated;

COMMIT;
