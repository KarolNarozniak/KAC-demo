import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import sharp from 'sharp';
import { readClassImage } from '../src/import/classes/image-reader.js';
import { parseWatTimetable } from '../src/import/classes/wat.js';
import { buildApi } from '../src/app.js';

const cases = [['zima-2026-2027',37],['lato-2025-2026',166],['zima-2025-2026',212]] as const;
const bytes = (name: string) => readFileSync(new URL(`./fixtures/ocr/wat-mini-${name}.png`,import.meta.url));
const slot = (row: {date:string;startTime:string;endTime:string}) => `${row.date} ${row.startTime} ${row.endTime}`;
for(const [name,count] of cases) {
  test(`offline OCR ${name}: every occupied cell has the expected date and time`, async () => {
    const expected = parseWatTimetable(JSON.parse(readFileSync(new URL(`./fixtures/timetables/wat-plan-${name}.json`,import.meta.url),'utf8')));
    const result = await readClassImage(bytes(name));
    assert.equal(result.academicYear,expected.academicYear);
    assert.equal(result.rows.length,count);
    assert.deepEqual(result.rows.map(slot).sort(),expected.rows.map(slot).sort());
    assert.ok(result.rows.every(row=>row.reviewRequired && row.location===''));
    assert.ok(result.rows.filter(row=>row.title).length >= count*.9, 'At least 90% of subject codes should be readable; all require review.');
    assert.ok(result.warnings.length);
    if(name==='zima-2026-2027') {
      for(const row of result.rows) {
        const original=expected.rows.find(other=>slot(other)===slot(row))!;
        assert.equal(row.title, original.title.startsWith('Projekt')?'pzST':'Ztel');
      }
    }
  });
}

test('image upload uses detected type, creates only a review session, and retains invalid rows for correction',async()=>{
  let sessions=0;
  const app=buildApi({checkConnection:async()=>{},getOverview:async()=>null,listEventsForImport:async()=>[],
    createImportSession:async input=>{
      sessions++;
      assert.equal(input.format,'Zdjęcie');
      assert.equal(input.source,'classes');
      assert.equal(input.rows.length,37);
      return {id:'ocr-preview',expiresAt:new Date()};
    }});
  try {
    const response=await app.inject({method:'POST',url:'/api/import/classes/read',payload:{fileName:'misleading.pdf',dataBase64:bytes('zima-2026-2027').toString('base64')}});
    assert.equal(response.statusCode,201);
    assert.equal(response.json().importSessionId,'ocr-preview');
    assert.ok(response.json().rows.every((row:{reviewRequired:boolean})=>row.reviewRequired));
    const broken=await app.inject({method:'POST',url:'/api/import/classes/read',payload:{fileName:'broken.png',dataBase64:Buffer.from([137,80,78,71,13,10,26,10,0]).toString('base64')}});
    assert.equal(broken.statusCode,422);
    assert.equal(sessions,1);
  } finally {await app.close();}
});

test('blank, corrupt and oversized decoded images fail safely and release the reader',async()=>{
  await assert.rejects(readClassImage(Buffer.from('invalid')),/unreadable-image/);
  const blank=await sharp({create:{width:100,height:100,channels:3,background:'white'}}).png().toBuffer();
  await assert.rejects(readClassImage(blank),/unsupported-image-layout/);
  const oversized=await sharp({create:{width:5000,height:5000,channels:3,background:'white'}}).png().toBuffer();
  await assert.rejects(readClassImage(oversized),/unreadable-image/);
});

test('concurrent OCR is bounded to one worker',async()=>{
  const first=readClassImage(bytes('zima-2026-2027'));
  await assert.rejects(readClassImage(bytes('zima-2026-2027')),/reader-busy/);
  assert.equal((await first).rows.length,37);
});


test('JPEG decoding applies EXIF orientation before detecting the grid',async()=>{
  const rotated=await sharp(bytes('zima-2026-2027')).rotate(90).withMetadata({orientation:8}).jpeg({quality:90}).toBuffer();
  const result=await readClassImage(rotated);
  const expected=parseWatTimetable(JSON.parse(readFileSync(new URL('./fixtures/timetables/wat-plan-zima-2026-2027.json',import.meta.url),'utf8')));
  assert.deepEqual(result.rows.map(slot).sort(),expected.rows.map(slot).sort());
});
