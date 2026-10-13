import assert from 'node:assert/strict';
import { test } from 'node:test';
import { extractPdfVectorPage } from '../src/lib/pdf-dxf-geometry';
import { dxfText, writeDxf } from '../src/lib/dxf-writer';

const ops={save:10,restore:11,transform:12,stroke:20,fill:22,endPath:28,constructPath:91,
  setStrokeRGBColor:58,setFillRGBColor:59,beginAnnotation:80,endAnnotation:81,beginText:31,setFont:37,setTextMatrix:42,showText:44};
const viewport={transform:[1,0,0,-1,0,72],width:72,height:72};

test('exports PDF geometry at physical paper scale in millimetres with transforms and colours',()=>{
  const page=extractPdfVectorPage({
    fnArray:[12,58,91],
    argsArray:[[2,0,0,2,5,6],['#ff0000'],[20,[new Float32Array([0,0,0,1,10,0,1,10,10])],[0,0,10,10]]],
  },ops,viewport);
  const entity=page.entities[0];
  assert.equal(entity.kind,'polyline');
  if(entity.kind!=='polyline')throw new Error('Expected polyline');
  assert.equal(entity.color,'#FF0000');
  assert.ok(Math.abs(entity.points[0].x-5*25.4/72)<1e-8);
  assert.ok(Math.abs(entity.points[2].y-26*25.4/72)<1e-8);
  assert.equal(page.width,25.4);
  const dxf=writeDxf(page.entities,page.width,page.height);
  assert.match(dxf,/LWPOLYLINE/);assert.match(dxf,/AC1018/);assert.match(dxf,/420\r\n16711680/);
});

test('keeps annotations in separate layers and preserves source state after selection scopes',()=>{
  const data=[20,[new Float32Array([0,0,0,1,10,0])],null];
  const page=extractPdfVectorPage({fnArray:[80,58,91,81,91],argsArray:[['id',[0,0,10,10],[1,0,0,1,0,0],[1,0,0,1,0,0],false],['#ff0000'],data,[],data]},ops,viewport);
  assert.match(page.entities[0].layer,/PDF_MARKUP/);
  assert.match(page.entities[1].layer,/PDF_GEOMETRY/);
  assert.equal(page.entities[1].color,'#000000');
});

test('creates editable fitted text and escapes DXF control strings',()=>{
  const page=extractPdfVectorPage({fnArray:[31,37,42,44],argsArray:[[],['font',10],[[1,0,0,1,12,20]],[[{unicode:'P-101',width:2500}]]]},ops,viewport);
  assert.equal(page.entities[0].kind,'text');
  assert.match(writeDxf(page.entities,page.width,page.height),/TEXT/);
  assert.equal(dxfText('A\nB°'),'A B\\U+00B0');
});

test('curves are real editable polyline geometry, not image placeholders',()=>{
  const page=extractPdfVectorPage({fnArray:[91],argsArray:[[20,[new Float32Array([0,0,0,2,0,10,10,10,10,0])],null]]},ops,viewport);
  const entity=page.entities[0];
  assert.equal(entity.kind,'polyline');
  if(entity.kind==='polyline')assert.ok(entity.points.length>4);
  assert.equal(page.stats.images,0);
  assert.throws(()=>extractPdfVectorPage({fnArray:[],argsArray:[]},ops,viewport,0),/greater than zero/);
});

test('keeps green and blue true colours instead of treating their packed RGB values as black',()=>{
  const dxf=writeDxf([
    {kind:'polyline',points:[{x:0,y:0},{x:10,y:10}],closed:false,lineWeight:10,color:'#00FF00',layer:'GREEN'},
    {kind:'polyline',points:[{x:0,y:0},{x:10,y:10}],closed:false,lineWeight:10,color:'#0000FF',layer:'BLUE'},
    {kind:'hatch',loops:[[{x:0,y:0},{x:5,y:0},{x:5,y:5}]],color:'#00FF00',layer:'MARKUP',opacity:0.5},
  ],20,20);
  assert.match(dxf,/420\r\n65280/); assert.match(dxf,/420\r\n255/);
  assert.match(dxf,/440\r\n33554560/);
});

function records(dxf: string) {
  const lines = dxf.trimEnd().split(/\r?\n/);
  const result: { type: string; tags: [number, string][] }[] = [];
  for (let i = 0; i < lines.length; i += 2) {
    const code = Number(lines[i]), value = lines[i + 1];
    if (code === 0) result.push({ type: value, tags: [] });
    else result.at(-1)?.tags.push([code, value]);
  }
  return result;
}

test('writes complete Model/Paper Space ownership, layouts and resolvable database handles', () => {
  const dxf = writeDxf([
    {kind:'polyline',points:[{x:0,y:0},{x:10,y:10}],closed:false,lineWeight:10,color:'#000000',layer:'LINE'},
    {kind:'text',text:'TEST',start:{x:1,y:1},end:{x:9,y:1},height:2,rotation:0,color:'#000000',layer:'TEXT'},
    {kind:'hatch',loops:[[{x:0,y:0},{x:5,y:0},{x:5,y:5}]],color:'#00FF00',layer:'FILL'},
  ],420,297);
  const all = records(dxf);
  const tag = (r: typeof all[number], code: number) => r.tags.find(t => t[0] === code)?.[1];
  const blocks = all.filter(r => r.type === 'BLOCK_RECORD');
  assert.equal(blocks.length, 2);
  const model = blocks.find(r => tag(r, 2) === '*Model_Space')!;
  const paper = blocks.find(r => tag(r, 2) === '*Paper_Space')!;
  assert.ok(model && paper);
  const layouts = all.filter(r => r.type === 'LAYOUT');
  assert.equal(layouts.length, 2);
  for (const block of blocks) {
    const layout = layouts.find(r => tag(r, 5) === tag(block, 340));
    assert.ok(layout);
    assert.equal(layout.tags.filter(t => t[0] === 330).at(-1)?.[1], tag(block, 5));
  }
  for (const entity of all.filter(r => ['LWPOLYLINE','TEXT','HATCH'].includes(r.type))) {
    assert.equal(tag(entity, 330), tag(model, 5));
    assert.equal(tag(entity, 67), '0');
    assert.equal(tag(entity, 410), 'Model');
  }
  const graph = all.filter(r => !['SECTION','ENDSEC','ENDTAB','EOF','CLASS'].includes(r.type));
  const handles = graph.map(r => tag(r, r.type === 'DIMSTYLE' ? 105 : 5)).filter(Boolean) as string[];
  assert.equal(new Set(handles).size, handles.length);
  const known = new Set(handles);
  for (const record of graph) {
    for (const [code, value] of record.tags) {
      if ([330,340,350,390].includes(code) && value !== '0') assert.ok(known.has(value), `Unresolved ${code} reference`);
    }
  }
  const seed = dxf.match(/\$HANDSEED\r\n5\r\n([A-F0-9]+)/)?.[1];
  assert.ok(seed);
  assert.ok(parseInt(seed,16) > Math.max(...handles.map(h => parseInt(h,16))));
});

test('opens the Model layout with a fitted active view and rejects invalid page dimensions', () => {
  const dxf = writeDxf([],420,297);
  assert.match(dxf,/\$TILEMODE\r\n70\r\n1/);
  assert.match(dxf,/\$CTAB\r\n1\r\nModel/);
  assert.match(dxf,/\$INSBASE\r\n10\r\n0\r\n20\r\n0\r\n30\r\n0/);
  const active = records(dxf).find(r => r.type === 'VPORT')!;
  assert.equal(active.tags.find(t => t[0] === 12)?.[1], '210');
  assert.equal(active.tags.find(t => t[0] === 22)?.[1], '148.5');
  assert.ok(Number(active.tags.find(t => t[0] === 40)?.[1]) > 297);
  assert.throws(() => writeDxf([],0,297), /positive finite/);
  assert.throws(() => writeDxf([],420,Infinity), /positive finite/);
});
