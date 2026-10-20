import test from "node:test";
import assert from "node:assert/strict";
import { applyTriage, communityMetadata, crisisMetadata } from "../src/services/triage.js";
import { canAutoReply } from "../src/services/policy.js";
test("Community v2 triage prevents positive sentiment overriding complaints or urgent safety issues",()=>{
  const base={sentiment:'POSITIVE',risk:'LOW',sensitive:false,reply:'Thanks',review:{safe:true,grounded:true,risk:'LOW'}};
  for(const [issueType,urgency] of [['COMPLAINT','LOW'],['SAFETY','HIGH'],['LEGAL','LOW'],['OTHER','HIGH']]) {
    const meta=communityMetadata({issueType,urgency});const r=applyTriage(base,meta);
    assert.equal(canAutoReply({mode:'CONDITIONAL'},r,'Feedback'),false);
  }
  assert.throws(()=>communityMetadata({issueType:'invented',urgency:'LOW'}));
});
test("Crisis references must exist in supplied evidence and include verification steps",()=>{
  const result={evidenceIds:['comment-1'],verificationSteps:['Liên hệ xác minh']};
  assert.equal(crisisMetadata(result,[{id:'comment-1'}]).evidenceIds[0],'comment-1');
  assert.throws(()=>crisisMetadata(result,[{id:'comment-2'}]));
  assert.throws(()=>crisisMetadata({...result,evidenceIds:['comment-1','comment-1']},[{id:'comment-1'}]));
  assert.throws(()=>crisisMetadata({...result,verificationSteps:[]},[{id:'comment-1'}]));
});
