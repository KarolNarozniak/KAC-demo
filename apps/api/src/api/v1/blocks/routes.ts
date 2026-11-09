import type { FastifyInstance } from 'fastify';
import type { BlockInput, CalendarRepository } from '../../contracts.js';
import { demoScope, type ScopeResolver } from '../../scope.js';

const block = {type:'object',required:['id','userId','title','startTime','endTime','type'],additionalProperties:false,properties:{
  id:{type:'string',format:'uuid'},userId:{type:'string'},title:{type:'string'},
  startTime:{type:'string',format:'date-time'},endTime:{type:'string',format:'date-time'},
  type:{type:'string',enum:['vacation','exam_session','day_off']},
}} as const;
const error = {type:'object',required:['error'],properties:{error:{type:'string'}}} as const;
export async function blockRoutes(app: FastifyInstance, options:{repository:CalendarRepository|null;scope?:ScopeResolver}) {
  const repository=options.repository, scope=options.scope??demoScope;
  app.get('/blocks',{schema:{tags:['Blocks'],summary:'List blocks and exam sessions',operationId:'listBlocks',description:'Lists only the blocks belonging to the server-resolved user. Times are ISO instants with an explicit UTC offset.',response:{200:{type:'array',items:block},503:error}}},async(req,reply)=>{
    if(!repository?.listBlocks)return reply.code(503).send({error:'blocks_not_configured'});
    try{return await repository.listBlocks(scope(req).userId);}catch(e){req.log.error(e);return reply.code(503).send({error:'blocks_unavailable'});}
  });
  app.post<{Body:BlockInput}>('/blocks',{schema:{tags:['Blocks'],summary:'Create a block',operationId:'createBlock',description:'Creates a vacation, exam session or day off for the server-resolved user. The end instant must follow the start instant. Blocks constrain both planning workflows.',body:{type:'object',required:['title','startTime','endTime','type'],additionalProperties:false,properties:{title:{type:'string',minLength:1,maxLength:255},startTime:{type:'string',format:'date-time'},endTime:{type:'string',format:'date-time'},type:{type:'string',enum:['vacation','exam_session','day_off']}}},response:{201:block,400:error,422:error,503:error}}},async(req,reply)=>{
    if(!req.body.title.trim()||Date.parse(req.body.endTime)<=Date.parse(req.body.startTime))return reply.code(422).send({error:'invalid_block'});
    if(!repository?.createBlock)return reply.code(503).send({error:'blocks_not_configured'});
    try{return reply.code(201).send(await repository.createBlock({...req.body,title:req.body.title.trim()},scope(req).userId));}catch(e){req.log.error(e);return reply.code(503).send({error:'block_not_saved'});}
  });
  app.delete<{Params:{id:string}}>('/blocks/:id',{schema:{tags:['Blocks'],summary:'Delete a block',operationId:'deleteBlock',description:'Deletes a block only when it belongs to the server-resolved user; foreign IDs are treated as not found.',params:{type:'object',required:['id'],additionalProperties:false,properties:{id:{type:'string',format:'uuid'}}},response:{204:{type:'null'},400:error,404:error,503:error}}},async(req,reply)=>{
    if(!repository?.deleteBlock)return reply.code(503).send({error:'blocks_not_configured'});
    try{if(!await repository.deleteBlock(req.params.id,scope(req).userId))return reply.code(404).send({error:'block_not_found'});return reply.code(204).send();}catch(e){req.log.error(e);return reply.code(503).send({error:'block_not_deleted'});}
  });
}
