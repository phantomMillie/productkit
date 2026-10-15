import { parse as parseYaml } from 'yaml';
import { z } from 'zod';
import { canonicalJson, sha256Hex, trimDeep } from '../clarification/hash.js';
import { impactReportSchema } from './impact.js';

const hash = z.string().regex(/^[0-9a-f]{64}$/);
const id = (prefix: string) => z.string().regex(new RegExp(`^${prefix}-[0-9a-f]{16}$`));
const nodeRef = z.string().regex(/^NOD-\d{3,}-\d+$/);

export const productArtifactRefSchema = z.object({
  kind: z.enum(['prompt','clarification','node_group','node','edge','relation_candidate','impact_report','finding','proposal','decision','policy','journey','definition','application','assumption']),
  ref: z.string().min(1), content_hash: hash,
}).strict();
export type ProductArtifactRef = z.infer<typeof productArtifactRefSchema>;

export const policyConditionSchema: z.ZodType<unknown> = z.lazy(() => z.discriminatedUnion('op', [
  z.object({ op: z.literal('all'), args: z.array(policyConditionSchema).min(1) }).strict(),
  z.object({ op: z.literal('any'), args: z.array(policyConditionSchema).min(1) }).strict(),
  z.object({ op: z.literal('not'), arg: policyConditionSchema }).strict(),
  z.object({ op: z.enum(['eq','ne','gt','gte','lt','lte']), field: z.string().trim().min(1), value_type: z.enum(['string','number','boolean']), value: z.union([z.string(),z.number().finite(),z.boolean()]), unit: z.string().trim().min(1).optional() }).strict(),
]));

const provenance = z.object({
  origin: z.enum(['source','ai_inference','user_decision']),
  source_refs: z.array(productArtifactRefSchema).min(1),
  decision_refs: z.array(productArtifactRefSchema).min(1),
  prompt_refs: z.array(productArtifactRefSchema).min(1),
}).strict().superRefine((value,ctx)=>{
  const allowed=new Set(['prompt','clarification','node_group','node','edge','relation_candidate','impact_report','finding','proposal','decision','assumption','policy','journey']);
  value.source_refs.forEach((ref,index)=>{if(!allowed.has(ref.kind))ctx.addIssue({code:'custom',path:['source_refs',index,'kind'],message:'Provenance source reference must point upstream; generated Policy/Definition/Application cycles are forbidden.'});});
  value.decision_refs.forEach((ref,index)=>{if(ref.kind!=='decision')ctx.addIssue({code:'custom',path:['decision_refs',index,'kind'],message:'decision_refs must contain Decision references only.'});});
  value.prompt_refs.forEach((ref,index)=>{if(ref.kind!=='prompt')ctx.addIssue({code:'custom',path:['prompt_refs',index,'kind'],message:'prompt_refs must contain Prompt references only.'});});
});

export const policySchema = z.object({
  schema_version: z.literal(1), id: id('POL'),
  context: z.string().trim().min(1), actor: z.string().trim().min(1),
  condition_text: z.string().trim().min(1), condition: policyConditionSchema,
  action: z.string().trim().min(1), outcome: z.string().trim().min(1),
  exceptions: z.array(z.object({ statement: z.string().trim().min(1), relation_ref: z.string().regex(/^EDG-[A-Za-z0-9-]+$/).optional(), source_refs: z.array(productArtifactRefSchema).min(1) }).strict()),
  priority: z.object({ value: z.number().finite(), decision_ref: id('DEC') }).strict().optional(),
  provenance, supersedes_policy_ref: id('POL').optional(), content_hash: hash,
}).strict().superRefine((policy, ctx) => {
  const body = { ...policy, content_hash: undefined };
  if (sha256Hex(canonicalJson(body)) !== policy.content_hash) ctx.addIssue({ code:'custom', path:['content_hash'], message:'Policy content hash mismatch.' });
});
export type Policy = z.infer<typeof policySchema>;

export const journeySchema = z.object({
  schema_version:z.literal(1), id:id('JRN'), actor:z.string().trim().min(1), goal:z.string().trim().min(1),
  entry_state:z.string().trim().min(1), states:z.array(z.string().trim().min(1)).min(1),
  transitions:z.array(z.object({from:z.string().trim().min(1),to:z.string().trim().min(1),trigger:z.string().trim().min(1),decision_refs:z.array(id('DEC')).min(1)}).strict()),
  terminal_states:z.array(z.string().trim().min(1)).min(1), acceptance_criteria:z.array(z.string().trim().min(1)), provenance,
  content_hash:hash,
}).strict().superRefine((journey,ctx)=>{
  const body={...journey,id:undefined,content_hash:undefined};
  if(sha256Hex(canonicalJson(body))!==journey.content_hash||journey.id!==`JRN-${journey.content_hash.slice(0,16)}`)ctx.addIssue({code:'custom',path:['content_hash'],message:'Journey ID/content hash mismatch.'});
  const states=new Set(journey.states); if(!states.has(journey.entry_state)||journey.terminal_states.some(state=>!states.has(state))||journey.transitions.some(t=>!states.has(t.from)||!states.has(t.to)))ctx.addIssue({code:'custom',path:['states'],message:'Journey transitions and terminal states must resolve.'});
});
export type Journey = z.infer<typeof journeySchema>;

export const definitionItemSchema = z.object({
  id: z.string().regex(/^ITM-[0-9a-f]{12}$/), kind: z.enum(['goal','scope','stakeholder','functional_requirement','nonfunctional_requirement','acceptance_criterion','exclusion']),
  text: z.string().trim().min(1), provenance,
  exclusion: z.object({decision_ref:id('DEC'),excluded_scope:z.string().trim().min(1),impact:z.string().trim().min(1),residual_risk:z.string().trim().min(1)}).strict().optional(),
}).strict().superRefine((item,ctx)=>{
  if(item.kind==='exclusion'&&!item.exclusion)ctx.addIssue({code:'custom',path:['exclusion'],message:'Explicit exclusions require scope, impact, residual risk, and Decision reference.'});
  if(item.kind!=='exclusion'&&item.exclusion)ctx.addIssue({code:'custom',path:['exclusion'],message:'Exclusion details may only be attached to exclusion items.'});
});

export const productDefinitionSchema = z.object({
  schema_version: z.literal(1), id: id('DEF'), status: z.literal('draft'),
  product_name: z.string().trim().min(1), items: z.array(definitionItemSchema),
  journey_refs: z.array(id('JRN')), policy_refs: z.array(id('POL')),
  finding_refs: z.array(id('FND')), assumption_refs: z.array(id('ASM')),
  input_snapshot: z.array(productArtifactRefSchema).min(1), rules_version: z.string().min(1),
  content_hash: hash, created_at: z.string().datetime({ offset:true }), history: z.array(z.object({event:z.literal('created'),at:z.string().datetime({offset:true}),content_hash:hash}).strict()).min(1),
}).strict().superRefine((definition, ctx) => {
  const itemIds = definition.items.map(item => item.id);
  if (new Set(itemIds).size !== itemIds.length) ctx.addIssue({code:'custom',path:['items'],message:'Definition item IDs must be unique.'});
  const body = { ...definition, id: undefined, content_hash: undefined, history: undefined, created_at: undefined };
  if (sha256Hex(canonicalJson(body)) !== definition.content_hash || definition.id !== `DEF-${definition.content_hash.slice(0,16)}`) ctx.addIssue({code:'custom',path:['content_hash'],message:'Definition ID/content hash mismatch.'});
  if (definition.history[0]?.content_hash !== definition.content_hash) ctx.addIssue({code:'custom',path:['history'],message:'Definition history must bind its content hash.'});
  definition.input_snapshot.forEach((ref,index)=>{if(ref.kind==='definition'||ref.kind==='application')ctx.addIssue({code:'custom',path:['input_snapshot',index,'kind'],message:'Definition snapshots cannot reference downstream Definition/Application artifacts.'});});
  definition.items.forEach((item,index) => {
    if (!item.provenance.decision_refs.length || !item.provenance.prompt_refs.length) ctx.addIssue({code:'custom',path:['items',index,'provenance'],message:'Definition items require Decision and Prompt provenance.'});
  });
});
export type ProductDefinition = z.infer<typeof productDefinitionSchema>;

export const applicationTargetSchema = z.object({
  ref: productArtifactRefSchema,
  path: z.string().regex(/^product\/(definition\.yaml|policies\/[A-Za-z0-9._-]+\.yaml|journeys\/[A-Za-z0-9._-]+\.yaml)$/),
  before_hash: hash.nullable(), after_hash: hash, before_content: z.string().nullable(), after_content: z.string(),
}).strict().superRefine((target,ctx)=>{
  if (target.before_content === null && target.before_hash !== null) ctx.addIssue({code:'custom',path:['before_hash'],message:'New target has null before hash.'});
  if (target.before_content !== null && sha256Hex(target.before_content) !== target.before_hash) ctx.addIssue({code:'custom',path:['before_hash'],message:'Before content hash mismatch.'});
  if (sha256Hex(target.after_content) !== target.after_hash) ctx.addIssue({code:'custom',path:['after_hash'],message:'After content hash mismatch.'});
});

export const applicationPlanSchema = z.object({
  decision_ref: id('DEC'), decision_hash: hash, scope: z.string().trim().min(1), rationale: z.string().trim().min(1),
  targets: z.array(applicationTargetSchema).min(1), finding_refs: z.array(id('FND')), residual_risks: z.array(z.string().trim().min(1)),
  before_impact_refs: z.array(z.string().min(1)),
}).strict().superRefine((plan,ctx)=>{
  const paths=plan.targets.map(t=>t.path); if(new Set(paths).size!==paths.length) ctx.addIssue({code:'custom',path:['targets'],message:'Application target paths must be unique.'});
  if(new Set(plan.before_impact_refs).size!==plan.before_impact_refs.length)ctx.addIssue({code:'custom',path:['before_impact_refs'],message:'ImpactReport references must be unique.'});
});
export type ApplicationPlan = z.infer<typeof applicationPlanSchema>;

export const applicationSchema = z.object({
  schema_version:z.literal(1), id:id('APP'), plan:applicationPlanSchema, plan_hash:hash,
  status:z.enum(['pending','applying','partially_applied','applied','failed','recovery_required','rolled_back']),
  verification_status:z.enum(['pending','verified','failed','inconclusive','stale']),
  verification_history:z.array(z.object({id:z.string().regex(/^AVF-[0-9a-f]{16}$/),status:z.enum(['verified','failed','inconclusive','stale']),assessor:z.enum(['ai','user']),summary:z.string().trim().min(1),evidence_refs:z.array(productArtifactRefSchema),uncertainty:z.array(z.string().trim().min(1)).min(1),input_fingerprint:hash,recorded_at:z.string().datetime({offset:true}),entry_hash:hash}).strict()).default([]),
  impact_status:z.enum(['unassessed','incomplete','complete']),
  impact_snapshots:z.array(z.object({phase:z.enum(['before','after']),seed_node_ref:nodeRef,report:impactReportSchema,report_hash:hash,input_fingerprint:hash}).strict()).default([]),
  target_states:z.array(z.object({path:z.string(),state:z.enum(['pending','published','verified','restored']),current_hash:hash.nullable()}).strict()),
  created_at:z.string().datetime({offset:true}), updated_at:z.string().datetime({offset:true}),
  history:z.array(z.object({event:z.enum(['planned','started','target_published','applied','failed','recovery_required','resumed','rolled_back','verified','invalidated']),at:z.string().datetime({offset:true}),statement:z.string().trim().min(1),plan_hash:hash}).strict()).min(1),
}).strict().superRefine((app,ctx)=>{
  const h=sha256Hex(canonicalJson(app.plan)); if(app.plan_hash!==h||app.id!==`APP-${h.slice(0,16)}`)ctx.addIssue({code:'custom',path:['plan_hash'],message:'Application ID/plan hash mismatch.'});
  if(app.history.some(entry=>entry.plan_hash!==h))ctx.addIssue({code:'custom',path:['history'],message:'Application history must bind the current immutable plan.'});
  if(app.status==='applied'&&app.target_states.some(t=>t.state!=='verified'))ctx.addIssue({code:'custom',path:['target_states'],message:'Application cannot be applied before all targets are verified.'});
  const impactSeeds=new Set<string>();for(const target of app.plan.targets){try{const doc=target.path.startsWith('product/policies/')?parseYaml(target.after_content):target.path.startsWith('product/journeys/')?parseYaml(target.after_content):parseYaml(target.after_content);const raw=doc as Record<string,unknown>;const provenance=(raw.provenance&&typeof raw.provenance==='object'?raw.provenance:null) as {source_refs?:ProductArtifactRef[]}|null;for(const ref of provenance?.source_refs??[])if(ref.kind==='node')impactSeeds.add(ref.ref);const items=raw.items;if(Array.isArray(items))for(const item of items){const refs=(item as {provenance?:{source_refs?:ProductArtifactRef[]}}).provenance?.source_refs??[];for(const ref of refs)if(ref.kind==='node')impactSeeds.add(ref.ref);}}catch{}}
  for(const snapshot of app.impact_snapshots){if(snapshot.report.input_fingerprint!==snapshot.input_fingerprint||sha256Hex(canonicalJson(snapshot.report))!==snapshot.report_hash||snapshot.report.seed_node_ref!==snapshot.seed_node_ref)ctx.addIssue({code:'custom',path:['impact_snapshots'],message:'Impact snapshot ID/hash/seed mismatch.'});}
  if(app.impact_status==='complete'&&app.impact_snapshots.some(s=>s.report.completeness!=='complete'))ctx.addIssue({code:'custom',path:['impact_status'],message:'Complete impact status requires complete reports.'});
  if(app.status==='applied'&&[...impactSeeds].some(seed=>!app.impact_snapshots.some(s=>s.phase==='after'&&s.seed_node_ref===seed)))ctx.addIssue({code:'custom',path:['impact_snapshots'],message:'Applied Application is missing after-impact reports for a changed Node seed.'});
  if(app.impact_status==='unassessed'&&app.impact_snapshots.length)ctx.addIssue({code:'custom',path:['impact_status'],message:'Unassessed impact status cannot have captured snapshots.'});
  const latest=app.verification_history.at(-1);
  if(app.verification_status!==(latest?.status??'pending'))ctx.addIssue({code:'custom',path:['verification_status'],message:'Verification status must match its latest append-only record.'});
  app.verification_history.forEach((entry,index)=>{const {entry_hash,...body}=entry;if(sha256Hex(canonicalJson(body))!==entry_hash)ctx.addIssue({code:'custom',path:['verification_history',index],message:'Verification entry hash mismatch.'});});
});
export type Application = z.infer<typeof applicationSchema>;

export function parseProductDefinition(text:string):ProductDefinition{return productDefinitionSchema.parse(parseYaml(text));}
export function parsePolicy(text:string):Policy{return policySchema.parse(parseYaml(text));}
export function parseJourney(text:string):Journey{return journeySchema.parse(parseYaml(text));}
export function parseApplication(text:string):Application{return applicationSchema.parse(parseYaml(text));}

export function createPolicy(raw:Omit<Policy,'content_hash'>):Policy { const input=trimDeep(raw); return policySchema.parse({...input,content_hash:sha256Hex(canonicalJson(input))}); }
export function createJourney(raw:Omit<Journey,'id'|'content_hash'>):Journey { const input=trimDeep(raw); const content_hash=sha256Hex(canonicalJson({...input,id:undefined,content_hash:undefined})); return journeySchema.parse({...input,id:`JRN-${content_hash.slice(0,16)}`,content_hash}); }
export function createProductDefinition(raw:Omit<ProductDefinition,'id'|'content_hash'|'history'|'created_at'>,now=new Date()):ProductDefinition {
  const input=trimDeep(raw); const created_at=now.toISOString(); const body={...input,created_at}; const content_hash=sha256Hex(canonicalJson({...body,created_at:undefined})); const id=`DEF-${content_hash.slice(0,16)}`;
  return productDefinitionSchema.parse({...body,id,content_hash,history:[{event:'created',at:created_at,content_hash}]});
}
