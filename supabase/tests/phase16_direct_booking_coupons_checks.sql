
-- Run after applying the direct booking and coupons migration.

do $$
begin
  if to_regclass('public.coupons') is null then
    raise exception 'Missing public.coupons';
  end if;

  if to_regclass('public.coupon_redemptions') is null then
    raise exception 'Missing public.coupon_redemptions';
  end if;

  if to_regprocedure(
    'public.customer_create_direct_booking(integer,integer,text,text,text,integer,integer,integer,text[],text)'
  ) is null then
    raise exception 'Missing customer_create_direct_booking RPC';
  end if;

  if to_regprocedure(
    'public.customer_apply_coupon(integer,text)'
  ) is null then
    raise exception 'Missing customer_apply_coupon RPC';
  end if;

  if to_regprocedure(
    'public.admin_list_coupons()'
  ) is null then
    raise exception 'Missing admin_list_coupons RPC';
  end if;

  if to_regprocedure(
    'public.admin_upsert_coupon(bigint,text,text,text,numeric,numeric,numeric,timestamp with time zone,timestamp with time zone,integer,integer,boolean)'
  ) is null then
    raise exception 'Missing admin_upsert_coupon RPC';
  end if;

  if to_regprocedure(
    'public.admin_set_coupon_active(bigint,boolean)'
  ) is null then
    raise exception 'Missing admin_set_coupon_active RPC';
  end if;

  if not (
    select relrowsecurity
    from pg_class
    where oid = 'public.coupons'::regclass
  ) then
    raise exception 'RLS must be enabled on coupons';
  end if;

  if not (
    select relrowsecurity
    from pg_class
    where oid = 'public.coupon_redemptions'::regclass
  ) then
    raise exception 'RLS must be enabled on coupon_redemptions';
  end if;
end $$;
