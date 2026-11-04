-- Functions the app calls (run once in the Supabase SQL Editor)

-- Create a new order with its 10 steps
create or replace function public.create_order(
  p_location text, p_party text, p_brand text, p_party_location text, p_po text,
  p_trade text, p_grn boolean, p_days numeric, p_d2c boolean
) returns bigint
language plpgsql security definer set search_path = '' as $$
declare
  v_so bigint; v_id bigint; v_name text; n int; v_req boolean;
begin
  if not (public.is_admin() or public.can_do_step(p_location, 1)) then
    raise exception 'You are not allowed to create orders for %', p_location;
  end if;
  if coalesce(trim(p_party), '') = '' then raise exception 'Party name is required'; end if;
  perform pg_advisory_xact_lock(hashtext('so_' || p_location));
  select coalesce(max(so_no), 0) + 1 into v_so from public.orders where location = p_location;
  select full_name into v_name from public.app_users where user_id = (select auth.uid());

  insert into public.orders (location, so_no, received_at, party_name, brand, party_location, po_number,
                             trade_category, grn_required, delivery_days, is_d2c, source)
  values (p_location, v_so, now(), trim(p_party), nullif(trim(p_brand), ''), nullif(trim(p_party_location), ''),
          nullif(trim(p_po), ''), p_trade, coalesce(p_grn, false), p_days, coalesce(p_d2c, false), 'app')
  returning id into v_id;

  for n in 1..10 loop
    v_req := case n
      when 3 then false
      when 6 then false
      when 7 then (p_trade = 'Modern Trade' and coalesce(p_grn, false))
      when 8 then false
      when 9 then (p_trade = 'General Trade' and not coalesce(p_d2c, false))
      when 10 then (p_trade = 'General Trade' and not coalesce(p_d2c, false))
      else true end;
    insert into public.order_steps (order_id, step_no, required, state, actual_at, done_by, done_by_name)
    values (v_id, n, v_req,
            case when n = 1 then 'done' when v_req then 'pending' else 'not_required' end,
            case when n = 1 then now() end,
            case when n = 1 then (select auth.uid()) end,
            case when n = 1 then v_name end);
  end loop;

  insert into public.order_events (order_id, step_no, action, by_user, detail)
  values (v_id, 1, 'created', (select auth.uid()), jsonb_build_object('so_no', v_so));
  return v_id;
end $$;

-- Complete the current step of an order (with the FMS rules)
create or replace function public.complete_step(p_order bigint, p_step int, p_data jsonb)
returns void
language plpgsql security definer set search_path = '' as $$
declare
  o public.orders; v_name text; v_val numeric;
begin
  select * into o from public.orders where id = p_order;
  if o.id is null then raise exception 'Order not found'; end if;
  if not public.can_do_step(o.location, p_step) then raise exception 'You are not allowed to do step %', p_step; end if;
  if o.status <> 'active' then raise exception 'This order is not active'; end if;
  if o.current_step is distinct from p_step then raise exception 'Step % is not the current step', p_step; end if;
  select full_name into v_name from public.app_users where user_id = (select auth.uid());

  update public.order_steps
     set state = 'done', actual_at = now(), done_by = (select auth.uid()), done_by_name = v_name,
         data = coalesce(p_data, '{}'::jsonb)
   where order_id = p_order and step_no = p_step;

  if p_step = 2 then
    v_val := nullif(p_data ->> 'invoice_value', '')::numeric;
    update public.orders
       set invoice_no = coalesce(nullif(p_data ->> 'invoice_no', ''), invoice_no),
           invoice_value = coalesce(v_val, invoice_value)
     where id = p_order;
    if coalesce(v_val, 0) > 50000 then
      update public.order_steps set required = true, state = 'pending'
       where order_id = p_order and step_no = 3 and state = 'not_required';
    end if;
  end if;

  if p_step = 5 and coalesce((p_data ->> 'has_return')::boolean, false) then
    update public.order_steps set required = true, state = 'pending'
     where order_id = p_order and step_no in (6, 8) and state = 'not_required';
  end if;

  insert into public.order_events (order_id, step_no, action, by_user, detail)
  values (p_order, p_step, 'step_done', (select auth.uid()), p_data);
end $$;

revoke all on function public.create_order(text, text, text, text, text, text, boolean, numeric, boolean) from public, anon;
revoke all on function public.complete_step(bigint, int, jsonb) from public, anon;
grant execute on function public.create_order(text, text, text, text, text, text, boolean, numeric, boolean) to authenticated;
grant execute on function public.complete_step(bigint, int, jsonb) to authenticated;
