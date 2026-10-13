
BEGIN;

CREATE OR REPLACE FUNCTION public.sync_legacy_user_organization_membership()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
    v_user_id uuid;
    v_org_id uuid;
BEGIN
    -- Resolve the Supabase Auth UUID from the legacy user record.
    IF NEW."openId" IS NULL
       OR NEW."openId" !~*
          '^supabase:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    THEN
        RETURN NEW;
    END IF;

    v_user_id := substring(NEW."openId" FROM 10)::uuid;

    -- Membership requires an existing profile.
    IF NOT EXISTS (
        SELECT 1
        FROM public.profiles p
        WHERE p.id = v_user_id
    ) THEN
        RETURN NEW;
    END IF;

    -- Change this slug if your actual organization slug differs.
    SELECT o.id
    INTO v_org_id
    FROM public.organizations o
    WHERE o.slug = 'aerofly-tours';

    IF v_org_id IS NULL THEN
        RAISE EXCEPTION
            'AeroFly Tours organization not found. Verify public.organizations.slug.';
    END IF;

    -- Legacy "user" means customer: remove the AeroFly membership.
    IF NEW.role::text = 'user' THEN
        DELETE FROM public.organization_memberships
        WHERE user_id = v_user_id
          AND organization_id = v_org_id;

    -- Any other supported legacy role means an organization member.
    ELSE
        INSERT INTO public.organization_memberships (
            user_id,
            organization_id,
            job_title,
            status
        )
        VALUES (
            v_user_id,
            v_org_id,
            CASE NEW.role::text
                WHEN 'admin' THEN 'Administrator'
                WHEN 'owner' THEN 'Owner'
                WHEN 'manager' THEN 'Manager'
                WHEN 'marketing' THEN 'Marketing'
                WHEN 'customer_care' THEN 'Customer Care'
                WHEN 'counsellor' THEN 'Counsellor'
                WHEN 'staff' THEN 'Staff'
                ELSE 'Staff'
            END,
            'active'
        )
        ON CONFLICT (user_id, organization_id)
        DO UPDATE SET
            job_title = EXCLUDED.job_title,
            status = 'active',
            updated_at = now();
    END IF;

    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS
    trg_sync_legacy_user_organization_membership
ON public.users;

CREATE TRIGGER trg_sync_legacy_user_organization_membership
AFTER INSERT OR UPDATE OF role, "openId"
ON public.users
FOR EACH ROW
EXECUTE FUNCTION public.sync_legacy_user_organization_membership();

COMMIT;