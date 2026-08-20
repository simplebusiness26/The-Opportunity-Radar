export function createGovernor(env={}){
  const limits={
    prospectsPerRun:Math.max(5,Math.min(30,Number(env.RH_PROSPECTS_PER_RUN||20))),
    deepAuditsPerRun:Math.max(2,Math.min(15,Number(env.RH_DEEP_AUDITS_PER_RUN||8))),
    browserActionsPerRun:Math.max(0,Math.min(20,Number(env.RH_BROWSER_ACTIONS_PER_RUN||6))),
    auditPagesPerSite:Math.max(1,Math.min(5,Number(env.RH_AUDIT_PAGES_PER_SITE||4))),
    cacheHours:Math.max(1,Math.min(720,Number(env.RH_CACHE_HOURS||72)))
  };
  const usage={prospects:0,deepAudits:0,browserActions:0,cacheHits:0};
  return {
    limits,usage,
    allowProspect(){if(usage.prospects>=limits.prospectsPerRun)return false;usage.prospects++;return true},
    allowDeepAudit(){if(usage.deepAudits>=limits.deepAuditsPerRun)return false;usage.deepAudits++;return true},
    allowBrowser(cost=1){if(usage.browserActions+cost>limits.browserActionsPerRun)return false;usage.browserActions+=cost;return true},
    cacheHit(){usage.cacheHits++},
    snapshot(){return {mode:'free-first',limits:{...limits},usage:{...usage},paidDependenciesRequired:false}}
  };
}

export function shouldPremiumProcess(prospect={}){
  const score=Number(prospect.score||0),price=Number(prospect.offer_price||0),confidence=Number(prospect.identity_confidence||0);
  return score>=82||price>=900||confidence>=85;
}
