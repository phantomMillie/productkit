import { mkdir, readFile, readdir, lstat, unlink } from 'node:fs/promises';
import path from 'node:path';
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';
import { CliError, ExitCode } from '../errors.js';
import { canonicalJson, sha256Hex } from './hash.js';
import { atomicCreateFile, atomicReplaceIfUnchanged } from './io.js';
import { currentChallengeInputs } from './challenge-store.js';
import { decisionStaleness, readAssumptions, readDecisions, readProposals, readCurrentFindings } from './proposal-decision-store.js';
import { findingContentHash, toFindingInput } from '../schema/finding.js';
import { applicationSchema, applicationPlanSchema, journeySchema, parseApplication, parseJourney, parsePolicy, parseProductDefinition, productArtifactRefSchema, type Application, type ApplicationPlan, type Journey, type Policy, type ProductDefinition } from '../schema/definition.js';
import { parseImpactReport, type ImpactReport } from '../schema/impact.js';
import { computeImpactReport } from './graph.js';
import { resolveFindingsByDecision } from './finding-store.js';
import { loadGraphWorkspace } from './provenance.js';
import { readGraphDocument, readRelationCandidates } from './graph-store.js';

const appDir=(root:string)=>path.join(root,'applications');
async function yamlFiles(dir:string):Promise<string[]>{try{return(await readdir(dir)).filter(f=>f.endsWith('.yaml')).sort();}catch(e){if((e as NodeJS.ErrnoException).code==='ENOENT')return[];throw e;}}
async function atomicSaveApp(file:string,app:Application):Promise<void>{const before=await readFile(file,'utf8');await atomicReplaceIfUnchanged(file,before,stringifyYaml(app));}

export async function addPolicy(root:string,value:unknown):Promise<{policy:Policy;created:boolean}>{
  const policy=parsePolicy(stringifyYaml(value));await validatePolicyReferences(root,policy);
  if(policy.priority){const decisions=await readDecisions(root);const selected=decisions.find(d=>d.id===policy.priority!.decision_ref);if(!selected||!policy.provenance.decision_refs.some(ref=>ref.ref===selected.id)||(await decisionStaleness(root)).some(x=>x.decision.id===selected.id)||decisions.some(d=>d.supersedes_decision_ref===selected.id))throw new CliError('Policy priority requires a current active user Decision in its provenance.',ExitCode.GATE_BLOCKED);}
  if(policy.supersedes_policy_ref&&!await policyExists(root,policy.supersedes_policy_ref))throw new CliError('Superseded Policy does not resolve.',ExitCode.GATE_BLOCKED);
  const dir=path.join(root,'policies');await mkdir(dir,{recursive:true});const file=path.join(dir,`${policy.id}.yaml`);
  if(await atomicCreateFile(file,stringifyYaml(policy)))return{policy,created:true};
  const prior=parsePolicy(await readFile(file,'utf8'));if(prior.content_hash!==policy.content_hash)throw new CliError(`Policy ID collision: ${policy.id}`,ExitCode.GATE_BLOCKED);return{policy:prior,created:false};
}
export async function readPolicies(root:string):Promise<Policy[]>{const out:Policy[]=[];for(const file of await yamlFiles(path.join(root,'policies')))out.push(parsePolicy(await readFile(path.join(root,'policies',file),'utf8')));return out;}
export async function validatePolicyReferences(root:string,policy:Policy):Promise<void>{if(policy.provenance.source_refs.some(ref=>['policy','journey'].includes(ref.kind)))throw new CliError('Policy provenance cannot depend on another Policy/Journey; use supersedes_policy_ref for replacement lineage.',ExitCode.GATE_BLOCKED);const refs=[...policy.provenance.source_refs,...policy.provenance.decision_refs,...policy.provenance.prompt_refs];const index=await currentArtifactHashes(root);for(const ref of refs){if(index.get(`${ref.kind}:${ref.ref}`)!==ref.content_hash)throw new CliError(`Policy provenance is missing or stale: ${ref.kind}:${ref.ref}`,ExitCode.GATE_BLOCKED);}await validateDecisionPromptLineage(root,policy.provenance.decision_refs,policy.provenance.prompt_refs);}
async function policyExists(root:string,id:string):Promise<boolean>{return(await readPolicies(root)).some(p=>p.id===id);}

export async function addDefinition(root:string,value:unknown):Promise<{definition:ProductDefinition;created:boolean}>{
  const definition=parseProductDefinition(stringifyYaml(value));await validateDefinitionReferences(root,definition);
  const file=path.join(root,'definition.yaml');if(await atomicCreateFile(file,stringifyYaml(definition)))return{definition,created:true};const prior=parseProductDefinition(await readFile(file,'utf8'));if(prior.content_hash!==definition.content_hash)throw new CliError('Product Definition already exists; create a new versioned path rather than overwriting it.',ExitCode.GATE_BLOCKED);return{definition:prior,created:false};
}
export async function validateDefinitionReferences(root:string,definition:ProductDefinition):Promise<void>{const index=await currentArtifactHashes(root);for(const ref of definition.input_snapshot)if(index.get(`${ref.kind}:${ref.ref}`)!==ref.content_hash)throw new CliError(`Definition snapshot is missing or stale: ${ref.kind}:${ref.ref}`,ExitCode.GATE_BLOCKED);for(const item of definition.items){for(const ref of [...item.provenance.source_refs,...item.provenance.decision_refs,...item.provenance.prompt_refs])if(index.get(`${ref.kind}:${ref.ref}`)!==ref.content_hash)throw new CliError(`Definition item provenance is missing or stale: ${ref.kind}:${ref.ref}`,ExitCode.GATE_BLOCKED);await validateDecisionPromptLineage(root,item.provenance.decision_refs,item.provenance.prompt_refs);}}
export async function addJourney(root:string,value:unknown):Promise<{journey:Journey;created:boolean}>{const journey=journeySchema.parse(value);if(journey.provenance.source_refs.some(ref=>['policy','journey'].includes(ref.kind)))throw new CliError('Journey provenance cannot depend on generated Policy/Journey artifacts.',ExitCode.GATE_BLOCKED);const index=await currentArtifactHashes(root);for(const ref of [...journey.provenance.source_refs,...journey.provenance.decision_refs,...journey.provenance.prompt_refs])if(index.get(`${ref.kind}:${ref.ref}`)!==ref.content_hash)throw new CliError(`Journey provenance is missing or stale: ${ref.kind}:${ref.ref}`,ExitCode.GATE_BLOCKED);await validateDecisionPromptLineage(root,journey.provenance.decision_refs,journey.provenance.prompt_refs);const dir=path.join(root,'journeys');await mkdir(dir,{recursive:true});const file=path.join(dir,`${journey.id}.yaml`);if(await atomicCreateFile(file,stringifyYaml(journey)))return{journey,created:true};const prior=parseJourney(await readFile(file,'utf8'));if(prior.content_hash!==journey.content_hash)throw new CliError(`Journey ID collision: ${journey.id}`,ExitCode.GATE_BLOCKED);return{journey:prior,created:false};}
export async function readJourneys(root:string):Promise<Journey[]>{const out:Journey[]=[];for(const file of await yamlFiles(path.join(root,'journeys')))out.push(parseJourney(await readFile(path.join(root,'journeys',file),'utf8')));return out;}
async function validateDecisionPromptLineage(root:string,decisionRefs:Array<{kind:string;ref:string;content_hash:string}>,promptRefs:Array<{kind:string;ref:string;content_hash:string}>):Promise<void>{
  const decisions=await readDecisions(root);const promptSet=new Set(promptRefs.map(p=>`${p.ref}:${p.content_hash}`));
  for(const ref of decisionRefs){if(ref.kind!=='decision')throw new CliError('Decision provenance reference must use kind=decision.',ExitCode.GATE_BLOCKED);const decision=decisions.find(d=>d.id===ref.ref);if(!decision||decision.decision_hash!==ref.content_hash)throw new CliError(`Definition Decision provenance is missing or stale: ${ref.ref}`,ExitCode.GATE_BLOCKED);const linked=decision.input_snapshot.filter(s=>s.kind==='prompt');if(!linked.some(p=>promptSet.has(`${p.ref}:${p.content_hash}`)))throw new CliError(`Decision ${decision.id} does not provide a provenance path to a referenced Prompt.`,ExitCode.GATE_BLOCKED);}
  for(const ref of promptRefs)if(ref.kind!=='prompt')throw new CliError('Prompt provenance reference must use kind=prompt.',ExitCode.GATE_BLOCKED);
}
export async function readDefinition(root:string):Promise<ProductDefinition|undefined>{try{return parseProductDefinition(await readFile(path.join(root,'definition.yaml'),'utf8'));}catch(e){if((e as NodeJS.ErrnoException).code==='ENOENT')return undefined;throw e;}}

async function currentArtifactHashes(root:string,includeApplications=true):Promise<Map<string,string>>{
  const current=await currentChallengeInputs(root);const hashes=new Map(current.inputs.map(i=>[`${i.kind}:${i.ref}`,i.content_hash]));
  for(const decision of await readDecisions(root))hashes.set(`decision:${decision.id}`,decision.decision_hash);
  for(const proposal of await readProposals(root))hashes.set(`proposal:${proposal.id}`,proposal.claim_hash);
  for(const assumption of await readAssumptions(root))hashes.set(`assumption:${assumption.id}`,sha256Hex(canonicalJson(assumption)));
  for(const finding of await readCurrentFindings(root))hashes.set(`finding:${finding.id}`,findingContentHash(toFindingInput(finding)));
  for(const policy of await readPolicies(root))hashes.set(`policy:${policy.id}`,policy.content_hash);
  for(const journey of await readJourneys(root))hashes.set(`journey:${journey.id}`,journey.content_hash);
  const definition=await readDefinition(root);if(definition)hashes.set(`definition:${definition.id}`,definition.content_hash);
  if(includeApplications)for(const application of await readApplications(root))hashes.set(`application:${application.id}`,sha256Hex(canonicalJson(application)));
  return hashes;
}

function targetNodeSeeds(plan:ApplicationPlan):string[]{const result=new Set<string>();for(const target of plan.targets){const value=parseYaml(target.after_content) as Record<string,unknown>;const refs=(value.provenance as {source_refs?:Array<{kind:string;ref:string}>}|undefined)?.source_refs??[];for(const ref of refs)if(ref.kind==='node')result.add(ref.ref);for(const item of (Array.isArray(value.items)?value.items:[]) as Array<{provenance?:{source_refs?:Array<{kind:string;ref:string}>}}>)for(const ref of item.provenance?.source_refs??[])if(ref.kind==='node')result.add(ref.ref);}return[...result].sort();}
async function storedImpactReport(root:string,id:string):Promise<ImpactReport|undefined>{const paths=[path.join(root,'graph'),path.join(root,'graph','reports')];for(const dir of paths)for(const file of await yamlFiles(dir)){if(file==='edges.yaml')continue;const raw=await readFile(path.join(dir,file),'utf8');try{const report=parseImpactReport(raw);if(report.analysis_id===id)return report;}catch{}}return undefined;}
async function currentImpactReport(root:string,seed:string):Promise<ImpactReport>{const workspace=await loadGraphWorkspace(root);const {graph}=await readGraphDocument(root);const candidates=await readRelationCandidates(root);return computeImpactReport({seedNodeId:seed,graphEdges:graph.edges,candidates,workspace,createdAt:new Date().toISOString()});}
function impactSnapshot(phase:'before'|'after',report:ImpactReport){return{phase,seed_node_ref:report.seed_node_ref,report,report_hash:sha256Hex(canonicalJson(report)),input_fingerprint:report.input_fingerprint};}

function relativeTarget(root:string,relative:string):string{
  const normalized=path.posix.normalize(relative);if(normalized!==relative||!/^product\/(definition\.yaml|policies\/[A-Za-z0-9._-]+\.yaml|journeys\/[A-Za-z0-9._-]+\.yaml)$/.test(relative))throw new CliError(`Unsupported application target path: ${relative}`,ExitCode.GATE_BLOCKED);
  const absolute=path.resolve(root,'..',...relative.split('/'));const product=path.resolve(root);if(!absolute.startsWith(product+path.sep)&&absolute!==product)throw new CliError('Application target escapes product workspace.',ExitCode.GATE_BLOCKED);return absolute;
}
async function assertNoSymlinkAncestors(root:string,relative:string):Promise<void>{let cursor=path.resolve(root,'..');for(const component of relative.split('/')){cursor=path.join(cursor,component);try{if((await lstat(cursor)).isSymbolicLink())throw new CliError(`Symlink in application target path rejected: ${relative}`,ExitCode.GATE_BLOCKED);}catch(e){if((e as NodeJS.ErrnoException).code!=='ENOENT')throw e;}}}

function validateAfterTarget(target:ApplicationPlan['targets'][number]):void{
  const name=path.basename(target.path);
  if(target.path==='product/definition.yaml'){const definition=parseProductDefinition(target.after_content);if(target.ref.kind!=='definition'||target.ref.ref!==definition.id)throw new CliError('Definition target reference does not match its content.',ExitCode.GATE_BLOCKED);}
  else if(target.path.startsWith('product/policies/')){const policy=parsePolicy(target.after_content);if(target.ref.kind!=='policy'||target.ref.ref!==policy.id||name!==`${policy.id}.yaml`)throw new CliError('Policy target reference/path does not match its content.',ExitCode.GATE_BLOCKED);}
  else {const journey=parseJourney(target.after_content);if(target.ref.kind!=='journey'||target.ref.ref!==journey.id||name!==`${journey.id}.yaml`)throw new CliError('Journey target path/reference does not match its content.',ExitCode.GATE_BLOCKED);}
}
function validateTargetDecision(target:ApplicationPlan['targets'][number],decisionId:string):void{
  if(target.path==='product/definition.yaml'){const definition=parseProductDefinition(target.after_content);if(!definition.items.some(item=>item.provenance.decision_refs.some(ref=>ref.ref===decisionId)))throw new CliError('Definition application target does not cite the applying Decision.',ExitCode.GATE_BLOCKED);}
  else if(target.path.startsWith('product/policies/')){const policy=parsePolicy(target.after_content);if(!policy.provenance.decision_refs.some(ref=>ref.ref===decisionId))throw new CliError('Policy application target does not cite the applying Decision.',ExitCode.GATE_BLOCKED);}
  else {const journey=parseJourney(target.after_content);if(!journey.provenance.decision_refs.some(ref=>ref.ref===decisionId))throw new CliError('Journey application target does not cite the applying Decision.',ExitCode.GATE_BLOCKED);}
}

export async function createApplication(root:string,value:unknown,now=new Date()):Promise<{application:Application;created:boolean}>{
  const plan=applicationPlanSchema.parse(value);const decisions=await readDecisions(root);const decision=decisions.find(d=>d.id===plan.decision_ref);
  if(!decision||decision.decision_hash!==plan.decision_hash)throw new CliError('Application Decision reference/hash is missing or stale.',ExitCode.GATE_BLOCKED);
  if((await decisionStaleness(root)).some(x=>x.decision.id===decision.id))throw new CliError('Stale Decision cannot be applied.',ExitCode.GATE_BLOCKED);
  if(decisions.some(d=>d.supersedes_decision_ref===decision.id))throw new CliError('Superseded Decision cannot be applied.',ExitCode.GATE_BLOCKED);
  const decisionFindings=new Set(decision.finding_refs.map(x=>x.finding_ref));if(plan.finding_refs.some(id=>!decisionFindings.has(id)))throw new CliError('Application names a Finding not targeted by this Decision.',ExitCode.GATE_BLOCKED);
  if(decision.decision_type==='scope_exclusion'){const exclusion=decision.scope_exclusion!;if(!plan.residual_risks.includes(exclusion.residual_risk))throw new CliError('Application must preserve the Decision scope-exclusion residual risk.',ExitCode.GATE_BLOCKED);const target=plan.targets.find(t=>t.path==='product/definition.yaml');if(!target)throw new CliError('Scope-exclusion application must update Product Definition exclusions.',ExitCode.GATE_BLOCKED);const definition=parseProductDefinition(target.after_content);if(!definition.items.some(item=>item.kind==='exclusion'&&item.exclusion?.decision_ref===decision.id&&item.exclusion.excluded_scope===exclusion.excluded_scope&&item.exclusion.impact===exclusion.impact&&item.exclusion.residual_risk===exclusion.residual_risk))throw new CliError('Product Definition does not preserve the explicit scope-exclusion Decision and residual risk.',ExitCode.GATE_BLOCKED);}
  const findings=await readCurrentFindings(root);for(const ref of decision.finding_refs){const finding=findings.find(f=>f.id===ref.finding_ref);if(!finding||findingContentHash(toFindingInput(finding))!==ref.claim_hash)throw new CliError(`Decision Finding is missing or stale: ${ref.finding_ref}`,ExitCode.GATE_BLOCKED);}
  for(const target of plan.targets){validateAfterTarget(target);validateTargetDecision(target,decision.id);const file=relativeTarget(root,target.path);await assertNoSymlinkAncestors(root,target.path);let before:string|null=null;try{before=await readFile(file,'utf8');}catch(e){if((e as NodeJS.ErrnoException).code!=='ENOENT')throw e;}
    const actual=before===null?null:sha256Hex(before);if(actual!==target.before_hash||before!==target.before_content)throw new CliError(`Application target changed since preview: ${target.path}`,ExitCode.GATE_BLOCKED);
  }
  const seeds=targetNodeSeeds(plan);const beforeSnapshots:Application['impact_snapshots']=[];
  for(const ref of plan.before_impact_refs){const report=await storedImpactReport(root,ref);if(!report)throw new CliError(`Before ImpactReport reference does not resolve: ${ref}`,ExitCode.GATE_BLOCKED);if(!seeds.includes(report.seed_node_ref))throw new CliError(`ImpactReport seed is not affected by this Application: ${report.seed_node_ref}`,ExitCode.GATE_BLOCKED);const fresh=await currentImpactReport(root,report.seed_node_ref);if(fresh.input_fingerprint!==report.input_fingerprint)throw new CliError(`Before ImpactReport is stale: ${ref}`,ExitCode.GATE_BLOCKED);beforeSnapshots.push(impactSnapshot('before',report));}
  if(seeds.some(seed=>!beforeSnapshots.some(snapshot=>snapshot.seed_node_ref===seed)))throw new CliError('A current before-ImpactReport is required for every Node seed changed by this Application.',ExitCode.GATE_BLOCKED);
  const plan_hash=sha256Hex(canonicalJson(plan));const id=`APP-${plan_hash.slice(0,16)}`;const at=now.toISOString();const impact_status=seeds.length===0?'unassessed':beforeSnapshots.every(snapshot=>snapshot.report.completeness==='complete')?'complete':'incomplete';const app=applicationSchema.parse({schema_version:1,id,plan,plan_hash,status:'pending',verification_status:'pending',verification_history:[],impact_status,impact_snapshots:beforeSnapshots,target_states:plan.targets.map(t=>({path:t.path,state:'pending',current_hash:t.before_hash})),created_at:at,updated_at:at,history:[{event:'planned',at,statement:'Application preview validated; no target has been changed.',plan_hash}]});
  await mkdir(appDir(root),{recursive:true});const file=path.join(appDir(root),`${id}.yaml`);if(await atomicCreateFile(file,stringifyYaml(app)))return{application:app,created:true};const prior=parseApplication(await readFile(file,'utf8'));if(prior.plan_hash!==plan_hash)throw new CliError(`Application ID collision: ${id}`,ExitCode.GATE_BLOCKED);return{application:prior,created:false};
}

export async function readApplications(root:string):Promise<Application[]>{const out:Application[]=[];for(const f of await yamlFiles(appDir(root)))out.push(parseApplication(await readFile(path.join(appDir(root),f),'utf8')));return out;}

export async function applyApplication(root:string,id:string,now=new Date()):Promise<Application>{
  const file=path.join(appDir(root),`${id}.yaml`);const original=await readFile(file,'utf8');let app=parseApplication(original);if(app.status==='applied')return app;if(app.status==='rolled_back')throw new CliError('Rolled-back Application cannot be replayed; create a new Application.',ExitCode.GATE_BLOCKED);
  const decision=(await readDecisions(root)).find(d=>d.id===app.plan.decision_ref);if(!decision||decision.decision_hash!==app.plan.decision_hash||(await decisionStaleness(root)).some(x=>x.decision.id===app.plan.decision_ref))throw new CliError('Application Decision is stale; no target was written.',ExitCode.GATE_BLOCKED);
  for(const target of app.plan.targets){validateAfterTarget(target);validateTargetDecision(target,decision.id);await assertNoSymlinkAncestors(root,target.path);const filePath=relativeTarget(root,target.path);let current:string|null=null;try{current=await readFile(filePath,'utf8');}catch(e){if((e as NodeJS.ErrnoException).code!=='ENOENT')throw e;}
    const hash=current===null?null:sha256Hex(current);if(hash!==target.before_hash&&hash!==target.after_hash)throw new CliError(`Target is neither expected before nor after state: ${target.path}`,ExitCode.GATE_BLOCKED);
  }
  const at=now.toISOString();app=applicationSchema.parse({...app,status:'applying',updated_at:at,history:[...app.history,{event:'started',at,statement:'Validated every target before publishing any change.',plan_hash:app.plan_hash}]});await atomicSaveApp(file,app);
  let published=app.target_states.filter((state,index)=>state.state==='published'||state.state==='verified'&&app.plan.targets[index]!.before_hash!==app.plan.targets[index]!.after_hash).length;
  try{
    for(let i=0;i<app.plan.targets.length;i++){
      const target=app.plan.targets[i]!;const dest=relativeTarget(root,target.path);await mkdir(path.dirname(dest),{recursive:true});await assertNoSymlinkAncestors(root,target.path);let current:string|null=null;try{current=await readFile(dest,'utf8');}catch(e){if((e as NodeJS.ErrnoException).code!=='ENOENT')throw e;}
      if(current===target.after_content){app.target_states[i]={path:target.path,state:'verified',current_hash:target.after_hash};continue;}
      if(current!==target.before_content)throw new CliError(`Concurrent target edit detected: ${target.path}`,ExitCode.GATE_BLOCKED);
      const backupDir=path.join(appDir(root),'backups',id);await mkdir(backupDir,{recursive:true});if(target.before_content!==null){const backup=path.join(backupDir,`${String(i).padStart(3,'0')}.before`);if(!await atomicCreateFile(backup,target.before_content)&&await readFile(backup,'utf8')!==target.before_content)throw new CliError(`Backup collision for ${target.path}`,ExitCode.GATE_BLOCKED);}
      if(current===null){if(!await atomicCreateFile(dest,target.after_content))throw new CliError(`Target appeared during application: ${target.path}`,ExitCode.GATE_BLOCKED);}else await atomicReplaceIfUnchanged(dest,current,target.after_content);
      published++;app.target_states[i]={path:target.path,state:'published',current_hash:target.after_hash};const stamp=new Date().toISOString();app=applicationSchema.parse({...app,updated_at:stamp,history:[...app.history,{event:'target_published',at:stamp,statement:`Published target ${target.path}.`,plan_hash:app.plan_hash}]});await atomicSaveApp(file,app);
    }
    for(let i=0;i<app.plan.targets.length;i++){const target=app.plan.targets[i]!;const current=await readFile(relativeTarget(root,target.path),'utf8');if(sha256Hex(current)!==target.after_hash)throw new CliError(`Post-apply hash mismatch: ${target.path}`,ExitCode.GATE_BLOCKED);app.target_states[i]={path:target.path,state:'verified',current_hash:target.after_hash};}
    const afterSnapshots=[];for(const seed of targetNodeSeeds(app.plan)){afterSnapshots.push(impactSnapshot('after',await currentImpactReport(root,seed)));}
    const impactSnapshots=[...app.impact_snapshots,...afterSnapshots];const impactStatus=afterSnapshots.length===0?'unassessed':impactSnapshots.every(snapshot=>snapshot.report.completeness==='complete')?'complete':'incomplete';
    const stamp=new Date().toISOString();app=applicationSchema.parse({...app,status:'applied',impact_status:impactStatus,impact_snapshots:impactSnapshots,updated_at:stamp,target_states:app.target_states,history:[...app.history,{event:'applied',at:stamp,statement:'All target after hashes, artifact structures, and post-application ImpactReports were captured.',plan_hash:app.plan_hash}]});await atomicSaveApp(file,app);return app;
  }catch(error){const stamp=new Date().toISOString();const status=published?'partially_applied':'failed';const changed=applicationSchema.parse({...app,status,updated_at:stamp,history:[...app.history,{event:'failed',at:stamp,statement:error instanceof Error?error.message:'Application failed.',plan_hash:app.plan_hash}]});await atomicSaveApp(file,changed);throw error;}
}

export async function rollbackApplication(root:string,id:string,now=new Date()):Promise<Application>{
  const file=path.join(appDir(root),`${id}.yaml`);let app=parseApplication(await readFile(file,'utf8'));if(app.status==='rolled_back')return app;
  const start=now.toISOString();app=applicationSchema.parse({...app,status:'recovery_required',updated_at:start,history:[...app.history,{event:'recovery_required',at:start,statement:'Guarded rollback requested; each target will be restored only from its expected after hash.',plan_hash:app.plan_hash}]});await atomicSaveApp(file,app);
  for(let i=app.plan.targets.length-1;i>=0;i--){const target=app.plan.targets[i]!;await assertNoSymlinkAncestors(root,target.path);const dest=relativeTarget(root,target.path);let current:string|null=null;try{current=await readFile(dest,'utf8');}catch(e){if((e as NodeJS.ErrnoException).code!=='ENOENT')throw e;}
    if(current===target.before_content){app.target_states[i]={path:target.path,state:'restored',current_hash:target.before_hash};continue;}if(current===null||sha256Hex(current)!==target.after_hash)throw new CliError(`Rollback stopped to preserve an externally changed target: ${target.path}`,ExitCode.GATE_BLOCKED);
    if(target.before_content===null)await unlink(dest);else await atomicReplaceIfUnchanged(dest,current,target.before_content);app.target_states[i]={path:target.path,state:'restored',current_hash:target.before_hash};const checkpoint=new Date().toISOString();app=applicationSchema.parse({...app,updated_at:checkpoint,history:[...app.history,{event:'rolled_back',at:checkpoint,statement:`Restored transaction-owned target ${target.path}.`,plan_hash:app.plan_hash}]});await atomicSaveApp(file,app);
  }
  const at=now.toISOString();app=applicationSchema.parse({...app,status:'rolled_back',updated_at:at,target_states:app.target_states,history:[...app.history,{event:'rolled_back',at,statement:'Only transaction-owned after-hash targets were restored.',plan_hash:app.plan_hash}]});await atomicSaveApp(file,app);return app;
}

export async function recordApplicationVerification(root:string,id:string,input:{status:'verified'|'failed'|'inconclusive';assessor:'ai'|'user';summary:string;evidence_refs:unknown[];uncertainty:string[]},now=new Date()):Promise<Application>{
  const file=path.join(appDir(root),`${id}.yaml`);let app=parseApplication(await readFile(file,'utf8'));if(app.status!=='applied')throw new CliError('Application must be applied before post-application verification.',ExitCode.GATE_BLOCKED);
  const fresh=await applicationFreshness(root,app);if(fresh.stale)throw new CliError(`Application is stale and cannot be verified: ${fresh.reasons.join('; ')}`,ExitCode.GATE_BLOCKED);
  const current=await currentArtifactHashes(root,false);const refs=input.evidence_refs.map(x=>productArtifactRefSchema.parse(x));for(const ref of refs)if(current.get(`${ref.kind}:${ref.ref}`)!==ref.content_hash)throw new CliError(`Verification evidence is missing or stale: ${ref.kind}:${ref.ref}`,ExitCode.GATE_BLOCKED);
  const input_fingerprint=sha256Hex(canonicalJson({plan_hash:app.plan_hash,targets:app.target_states,current:[...current.entries()].sort()}));const at=now.toISOString();const body={id:`AVF-${sha256Hex(canonicalJson({app:id,input_fingerprint,status:input.status,at})).slice(0,16)}`,status:input.status,assessor:input.assessor,summary:input.summary,evidence_refs:refs,uncertainty:input.uncertainty,input_fingerprint,recorded_at:at};const entry={...body,entry_hash:sha256Hex(canonicalJson(body))};
  app=applicationSchema.parse({...app,verification_status:input.status,verification_history:[...app.verification_history,entry],updated_at:at,history:[...app.history,{event:'verified',at,statement:`Post-application assessment recorded as ${input.status}; CLI checked structure and hashes only.`,plan_hash:app.plan_hash}]});await atomicSaveApp(file,app);
  // Finding claim hashes (not their resolution state) feed artifact hashes, so resolving here leaves this
  // and other verifications current. ChallengeRuns do see the change and need a fresh review.
  if(input.status==='verified'){const decision=(await readDecisions(root)).find(d=>d.id===app.plan.decision_ref);if(decision)await resolveFindingsByDecision(root,decision,app.id,now);}
  return app;
}

export async function applicationFreshness(root:string,app:Application):Promise<{stale:boolean;reasons:string[]}>{const reasons:string[]=[];const decision=(await readDecisions(root)).find(d=>d.id===app.plan.decision_ref);if(!decision||decision.decision_hash!==app.plan.decision_hash)reasons.push('Decision missing or changed');if((await decisionStaleness(root)).some(x=>x.decision.id===app.plan.decision_ref))reasons.push('Decision input snapshot stale');if(app.status==='applied'||app.verification_history.length){for(const target of app.plan.targets){let content:string|null=null;try{content=await readFile(relativeTarget(root,target.path),'utf8');}catch(e){if((e as NodeJS.ErrnoException).code!=='ENOENT')reasons.push(`${target.path}: unreadable`);}const current=content===null?null:sha256Hex(content);if(current!==target.after_hash)reasons.push(`${target.path}: changed since application`);}}if(app.verification_history.length){const latest=app.verification_history.at(-1)!;const current=await currentArtifactHashes(root,false);const fingerprint=sha256Hex(canonicalJson({plan_hash:app.plan_hash,targets:app.target_states,current:[...current.entries()].sort()}));if(fingerprint!==latest.input_fingerprint)reasons.push('Post-application verification inputs changed');}return{stale:reasons.length>0,reasons};}
