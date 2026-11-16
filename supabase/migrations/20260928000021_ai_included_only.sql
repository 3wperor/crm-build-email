-- =============================================================================
-- 0021 AI runs only on YCAReach's DeepSeek key: the "use your own AI key"
-- option is gone. Point every workspace back at the included AI and delete the
-- stored customer keys (secrets nothing reads any more). The columns and the
-- empty ai_credentials table stay so older deployments don't break mid-deploy.
-- =============================================================================

update public.organizations
   set ai_provider = 'included', ai_model = null, ai_base_url = null
 where ai_provider <> 'included' or ai_model is not null or ai_base_url is not null;

delete from public.ai_credentials;

notify pgrst, 'reload schema';
