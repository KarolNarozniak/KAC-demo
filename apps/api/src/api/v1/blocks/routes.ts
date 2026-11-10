import type { FastifyInstance } from 'fastify';
import type { BlockInput, CalendarRepository } from '../../contracts.js';
import { demoScope, type ScopeResolver } from '../../scope.js';
import { documented, errorExamples, validationError, withExamples } from '../../examples.js';
import { blockExamples, blockListExamples, createBlockExamples } from './examples.js';

const block = {type:'object',required:['id','userId','title','startTime','endTime','type'],additionalProperties:false,properties:{
  id:{type:'string',format:'uuid'},userId:{type:'string'},title:{type:'string'},
  startTime:{type:'string',format:'date-time'},endTime:{type:'string',format:'date-time'},
  type:{type:'string',enum:['vacation','exam_session','day_off']},
}} as const;
const unavailable = errorExamples('Baza danych niedostępna albo repozytorium nieskonfigurowane.', {blocks_unavailable:'Odczyt blokad nie powiódł się',blocks_not_configured:'Repozytorium blokad nieskonfigurowane'});
export async function blockRoutes(app: FastifyInstance, options:{repository:CalendarRepository|null;scope?:ScopeResolver}) {
  const repository=options.repository, scope=options.scope??demoScope;
  app.get('/blocks',{schema:{tags:['Blocks'],summary:'List blocks and exam sessions',operationId:'listBlocks',description:'Lists only the blocks belonging to the server-resolved user. Times are ISO instants with an explicit UTC offset.',response:{200:documented({type:'array',items:block},'Blokady użytkownika.',blockListExamples),503:unavailable}}},async(req,reply)=>{
    if(!repository?.listBlocks)return reply.code(503).send({error:'blocks_not_configured'});
    try{return await repository.listBlocks(scope(req).userId);}catch(e){req.log.error(e);return reply.code(503).send({error:'blocks_unavailable'});}
  });
  app.post<{Body:BlockInput}>('/blocks',{schema:{tags:['Blocks'],summary:'Create a block',operationId:'createBlock',description:'Creates a vacation, exam session or day off for the server-resolved user. The end instant must follow the start instant. Blocks constrain both planning workflows.',body:withExamples({type:'object',required:['title','startTime','endTime','type'],additionalProperties:false,properties:{title:{type:'string',minLength:1,maxLength:255},startTime:{type:'string',format:'date-time',description:'Początek (włącznie), z offsetem strefy.'},endTime:{type:'string',format:'date-time',description:'Koniec (wyłącznie) – dla całych dni początek następnego dnia.'},type:{type:'string',enum:['vacation','exam_session','day_off']}}},createBlockExamples),response:{201:documented(block,'Zapisana blokada.',blockExamples),400:validationError('body/startTime must match format "date-time"'),422:errorExamples('Pusty tytuł albo koniec nie jest po początku.',{invalid_block:'Koniec nie jest po początku'}),503:errorExamples('Baza danych niedostępna albo repozytorium nieskonfigurowane.',{block_not_saved:'Zapis nie powiódł się',blocks_not_configured:'Repozytorium blokad nieskonfigurowane'})}}},async(req,reply)=>{
    if(!req.body.title.trim()||Date.parse(req.body.endTime)<=Date.parse(req.body.startTime))return reply.code(422).send({error:'invalid_block'});
    if(!repository?.createBlock)return reply.code(503).send({error:'blocks_not_configured'});
    try{return reply.code(201).send(await repository.createBlock({...req.body,title:req.body.title.trim()},scope(req).userId));}catch(e){req.log.error(e);return reply.code(503).send({error:'block_not_saved'});}
  });
  app.delete<{Params:{id:string}}>('/blocks/:id',{schema:{tags:['Blocks'],summary:'Delete a block',operationId:'deleteBlock',description:'Deletes a block only when it belongs to the server-resolved user; foreign IDs are treated as not found.',params:{type:'object',required:['id'],additionalProperties:false,properties:{id:{type:'string',format:'uuid'}}},response:{204:{type:'null',description:'Blokada usunięta.'},400:validationError('params/id must match format "uuid"'),404:errorExamples('Blokada nie istnieje albo należy do innego użytkownika.',{block_not_found:'Brak blokady'}),503:errorExamples('Baza danych niedostępna albo repozytorium nieskonfigurowane.',{block_not_deleted:'Usunięcie nie powiodło się',blocks_not_configured:'Repozytorium blokad nieskonfigurowane'})}}},async(req,reply)=>{
    if(!repository?.deleteBlock)return reply.code(503).send({error:'blocks_not_configured'});
    try{if(!await repository.deleteBlock(req.params.id,scope(req).userId))return reply.code(404).send({error:'block_not_found'});return reply.code(204).send();}catch(e){req.log.error(e);return reply.code(503).send({error:'block_not_deleted'});}
  });
}
