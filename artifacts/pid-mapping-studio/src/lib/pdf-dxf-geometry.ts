import type { DxfEntity, DxfPoint } from './dxf-writer';

type Matrix = [number, number, number, number, number, number];
type Path = { points: DxfPoint[]; closed: boolean };
type State = {
  matrix: Matrix; stroke: string; fill: string; strokeAlpha: number; fillAlpha: number; dash: number[]; lineWidth: number; annotation: boolean;
  textMatrix: Matrix; textX: number; textY: number; lineX: number; lineY: number;
  fontSize: number; hScale: number; charSpace: number; wordSpace: number; leading: number; rise: number; textMode: number;
};
export type PdfVectorStats = {
  sourcePaths: number; sourceTextRuns: number; basePaths: number; annotationEntities: number;
  images: number; imageAreaRatio: number; clippingPaths: number; shadings: number; omittedWhiteFills: number;
};
export type PdfVectorPage = { entities: DxfEntity[]; width: number; height: number; stats: PdfVectorStats; warnings: string[] };
const IDENTITY: Matrix = [1, 0, 0, 1, 0, 0];
const WEIGHTS = [5, 9, 13, 15, 18, 20, 25, 30, 35, 40, 50, 53, 60, 70, 80, 90, 100, 106, 120, 140, 158, 200, 211];

export function multiply(a: Matrix, b: Matrix): Matrix {
  return [a[0]*b[0]+a[2]*b[1], a[1]*b[0]+a[3]*b[1], a[0]*b[2]+a[2]*b[3], a[1]*b[2]+a[3]*b[3],
    a[0]*b[4]+a[2]*b[5]+a[4], a[1]*b[4]+a[3]*b[5]+a[5]];
}
function point(m: Matrix, x: number, y: number): DxfPoint { return { x: m[0]*x+m[2]*y+m[4], y: m[1]*x+m[3]*y+m[5] }; }
function midpoint(a: DxfPoint, b: DxfPoint): DxfPoint { return { x: (a.x+b.x)/2, y: (a.y+b.y)/2 }; }
function distanceToLine(p: DxfPoint, a: DxfPoint, b: DxfPoint): number {
  const length = Math.hypot(b.x-a.x, b.y-a.y);
  return length ? Math.abs((b.x-a.x)*(a.y-p.y)-(a.x-p.x)*(b.y-a.y))/length : Math.hypot(p.x-a.x,p.y-a.y);
}
function curve(p0: DxfPoint, p1: DxfPoint, p2: DxfPoint, p3: DxfPoint, out: DxfPoint[], tolerance: number, depth = 0): void {
  if (depth >= 12 || Math.max(distanceToLine(p1,p0,p3),distanceToLine(p2,p0,p3)) <= tolerance) { out.push(p3); return; }
  const a=midpoint(p0,p1), b=midpoint(p1,p2), c=midpoint(p2,p3), d=midpoint(a,b), e=midpoint(b,c), f=midpoint(d,e);
  curve(p0,a,d,f,out,tolerance,depth+1); curve(f,e,c,p3,out,tolerance,depth+1);
}
function decodePath(data: ArrayLike<number>, matrix: Matrix, tolerance: number): Path[] {
  const paths: Path[] = [];
  let path: Path | null = null;
  const start = (p: DxfPoint): Path => { const next={points:[p],closed:false}; paths.push(next); return next; };
  for (let i=0;i<data.length;) {
    const op=data[i++];
    if (op===0) path=start(point(matrix,data[i++],data[i++]));
    else if (op===1) {
      const p=point(matrix,data[i++],data[i++]); if (!path) path=start(p); else path.points.push(p);
    } else if (op===2 || op===3) {
      if (!path?.points.length) throw new Error('A PDF curve has no starting point.');
      const p0=path.points.at(-1)!;
      const a=point(matrix,data[i++],data[i++]), b=point(matrix,data[i++],data[i++]);
      if (op===2) curve(p0,a,b,point(matrix,data[i++],data[i++]),path.points,tolerance);
      else curve(p0,{x:p0.x+(a.x-p0.x)*2/3,y:p0.y+(a.y-p0.y)*2/3},{x:b.x+(a.x-b.x)*2/3,y:b.y+(a.y-b.y)*2/3},b,path.points,tolerance);
    } else if (op===4) { if (path) path.closed=true; }
    else throw new Error(`Unsupported PDF path command ${op}; export stopped rather than dropping geometry.`);
  }
  return paths;
}
function initial(matrix: Matrix): State {
  return {matrix,stroke:'#000000',fill:'#000000',strokeAlpha:1,fillAlpha:1,dash:[],lineWidth:1,annotation:false,textMatrix:[...IDENTITY],
    textX:0,textY:0,lineX:0,lineY:0,fontSize:0,hScale:1,charSpace:0,wordSpace:0,leading:0,rise:0,textMode:0};
}
function color(value: unknown): string {
  if (typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value)) return value.toUpperCase();
  throw new Error('A PDF uses an unsupported colour format; export stopped.');
}
function layer(state: State, rgb: string, text = false): string {
  return `${state.annotation ? 'PDF_MARKUP' : text ? 'PDF_TEXT' : 'PDF_GEOMETRY'}_${rgb.slice(1)}`;
}
function asMatrix(value: unknown): Matrix | null {
  return (Array.isArray(value) || ArrayBuffer.isView(value)) && (value as ArrayLike<number>).length === 6
    ? Array.from(value as ArrayLike<number>) as Matrix : null;
}

/** Interpret PDF.js 5's vector display list; no AutoCAD process is needed. */
export function extractPdfVectorPage(
  list: { fnArray: number[]; argsArray: unknown[][] }, ops: Record<string, number>,
  viewport: { transform: number[]; width: number; height: number }, scale = 1,
): PdfVectorPage {
  if (!Number.isFinite(scale) || scale <= 0) throw new Error('DXF scale must be greater than zero.');
  const unit=25.4/72*scale;
  const root=multiply([unit,0,0,-unit,0,viewport.height*unit],viewport.transform as Matrix);
  let state=initial(root);
  const stack: State[]=[];
  const entities: DxfEntity[]=[];
  const stats: PdfVectorStats={sourcePaths:0,sourceTextRuns:0,basePaths:0,annotationEntities:0,images:0,imageAreaRatio:0,clippingPaths:0,shadings:0,omittedWhiteFills:0};
  const save=()=>stack.push({...state,matrix:[...state.matrix],textMatrix:[...state.textMatrix]});
  const restore=()=>{state=stack.pop()??initial(root);};
  const moveText=(x:number,y:number)=>{state.lineX+=x;state.lineY+=y;state.textX=state.lineX;state.textY=state.lineY;};
  const add=(entity:DxfEntity)=>{if(entity.opacity===0)return;entities.push(entity);if(state.annotation)stats.annotationEntities++;};
  const showText=(glyphs: unknown[])=>{
    if (!glyphs || !state.fontSize) return;
    let text='',advance=0;
    for (const glyph of glyphs) {
      if (typeof glyph==='number') advance-=glyph*state.fontSize/1000;
      else if (glyph && typeof glyph==='object') {
        const g=glyph as { unicode?: string; width?: number; isSpace?: boolean };
        text+=g.unicode??'';
        advance+=(g.width??0)*state.fontSize/1000+state.charSpace+(g.isSpace?state.wordSpace:0);
      }
    }
    const m=multiply(state.matrix,state.textMatrix);
    const start=point(m,state.textX,state.textY+state.rise);
    const end=point(m,state.textX+advance*state.hScale,state.textY+state.rise);
    const height=Math.abs(state.fontSize)*Math.hypot(m[2],m[3]);
    if (text.trim() && state.textMode!==3 && state.textMode!==7) {
      add({kind:'text',text,start,end,height,rotation:Math.atan2(m[1],m[0])*180/Math.PI,color:state.fill,opacity:state.fillAlpha,layer:layer(state,state.fill,true)});
      stats.sourceTextRuns++;
    }
    state.textX+=advance*state.hScale;
  };
  for (let i=0;i<list.fnArray.length;i++) {
    const op=list.fnArray[i],args=list.argsArray[i]??[];
    if(op===ops.save)save();
    else if(op===ops.restore)restore();
    else if(op===ops.transform)state.matrix=multiply(state.matrix,args as Matrix);
    else if(op===ops.paintFormXObjectBegin || op===ops.beginGroup) {
      save();
      const matrix=asMatrix(op===ops.beginGroup?(args[0] as {matrix?:unknown})?.matrix:args[0]);
      if(matrix)state.matrix=multiply(state.matrix,matrix);
    } else if(op===ops.paintFormXObjectEnd || op===ops.endGroup)restore();
    else if(op===ops.beginAnnotation) {
      save();state=initial(root);state.annotation=true;
      for(const value of [args[2],args[3]]) {const matrix=asMatrix(value);if(matrix)state.matrix=multiply(state.matrix,matrix);}
    } else if(op===ops.endAnnotation)restore();
    else if(op===ops.setStrokeRGBColor)state.stroke=color(args[0]);
    else if(op===ops.setFillRGBColor)state.fill=color(args[0]);
    else if(op===ops.setStrokeTransparent)state.strokeAlpha=0;
    else if(op===ops.setFillTransparent)state.fillAlpha=0;
    else if(op===ops.setDash)state.dash=Array.from(args[0] as ArrayLike<number>);
    else if(op===ops.setLineWidth)state.lineWidth=Number(args[0]);
    else if(op===ops.setGState) {
      for(const [key,value] of (args[0] as Array<[string,unknown]>)??[]) {
        if(key==='LW')state.lineWidth=Number(value);
        else if(key==='ca')state.fillAlpha=Number(value);
        else if(key==='CA')state.strokeAlpha=Number(value);
        else if(key==='Font'&&Array.isArray(value))state.fontSize=Number(value[1]);
      }
    } else if(op===ops.clip || op===ops.eoClip)stats.clippingPaths++;
    else if(op===ops.shadingFill)stats.shadings++;
    else if(op===ops.constructPath) {
      const paint=Number(args[0]);
      if(paint===ops.endPath)continue;
      const data=(args[1] as ArrayLike<ArrayLike<number>>)?.[0];
      if(!data?.length)continue;
      const paths=decodePath(data,state.matrix,0.025*scale);
      stats.sourcePaths++;if(!state.annotation)stats.basePaths++;
      const stroke=[ops.stroke,ops.closeStroke,ops.fillStroke,ops.eoFillStroke,ops.closeFillStroke,ops.closeEOFillStroke].includes(paint);
      const fill=[ops.fill,ops.eoFill,ops.fillStroke,ops.eoFillStroke,ops.closeFillStroke,ops.closeEOFillStroke].includes(paint);
      if(!stroke&&!fill)throw new Error(`Unsupported PDF paint operator ${paint}.`);
      const closed=[ops.closeStroke,ops.closeFillStroke,ops.closeEOFillStroke].includes(paint);
      if(fill) {
        if(state.fill==='#FFFFFF')stats.omittedWhiteFills++;
        else {
          const loops=paths.map(p=>p.points).filter(p=>p.length>=3);
          if(loops.length)add({kind:'hatch',loops,color:state.fill,opacity:state.fillAlpha,layer:layer(state,state.fill)});
        }
      }
      if(stroke) {
        const weight=state.lineWidth*Math.sqrt(Math.abs(state.matrix[0]*state.matrix[3]-state.matrix[1]*state.matrix[2]))*100;
        const lineWeight=WEIGHTS.reduce((best,n)=>Math.abs(n-weight)<Math.abs(best-weight)?n:best,WEIGHTS[0]);
        const dashScale=Math.sqrt(Math.abs(state.matrix[0]*state.matrix[3]-state.matrix[1]*state.matrix[2]));
        for(const p of paths)if(p.points.length>1)add({kind:'polyline',points:p.points,closed:p.closed||closed,lineWeight,dash:state.dash.map(n=>n*dashScale),color:state.stroke,opacity:state.strokeAlpha,layer:layer(state,state.stroke)});
      }
    } else if([ops.paintImageXObject,ops.paintInlineImageXObject,ops.paintImageMaskXObject,ops.paintImageXObjectRepeat,ops.paintInlineImageXObjectGroup,ops.paintImageMaskXObjectGroup].includes(op)) {
      stats.images++;
      if(op===ops.paintImageXObject||op===ops.paintInlineImageXObject)
        stats.imageAreaRatio+=Math.abs(state.matrix[0]*state.matrix[3]-state.matrix[1]*state.matrix[2])/(viewport.width*viewport.height*unit*unit);
    } else if(op===ops.beginText) {state.textX=state.textY=state.lineX=state.lineY=0;state.textMatrix=[...IDENTITY];}
    else if(op===ops.setFont)state.fontSize=Number(args[1]);
    else if(op===ops.setTextMatrix) {state.textMatrix=asMatrix(args[0])??args as Matrix;state.textX=state.textY=state.lineX=state.lineY=0;}
    else if(op===ops.setCharSpacing)state.charSpace=Number(args[0]);
    else if(op===ops.setWordSpacing)state.wordSpace=Number(args[0]);
    else if(op===ops.setHScale)state.hScale=Number(args[0])/100;
    else if(op===ops.setLeading)state.leading=-Number(args[0]);
    else if(op===ops.setTextRise)state.rise=Number(args[0]);
    else if(op===ops.setTextRenderingMode)state.textMode=Number(args[0]);
    else if(op===ops.moveText)moveText(Number(args[0]),Number(args[1]));
    else if(op===ops.setLeadingMoveText) {state.leading=Number(args[1]);moveText(Number(args[0]),Number(args[1]));}
    else if(op===ops.nextLine)moveText(0,state.leading);
    else if(op===ops.showText||op===ops.showSpacedText)showText(args[0] as unknown[]);
    else if(op===ops.nextLineShowText) {moveText(0,state.leading);showText(args[0] as unknown[]);}
  }
  const warnings=[
    'Raw source geometry only. Legends Library symbol replacement is not applied.',
    'Units are millimetres at PDF paper size multiplied by the selected scale; engineering scale is unverified.',
    'Curves are approximated by polylines within 0.025 mm at paper scale.',
  ];
  if(stats.sourceTextRuns)warnings.push('Native text is editable, but PDF fonts are replaced by the STANDARD CAD font; check text fitting.');
  if(stats.images)warnings.push(`${stats.images} raster image operation(s) are not included as editable CAD geometry.`);
  if(stats.clippingPaths)warnings.push('PDF clipping is not fully reproduced; check crop boundaries and masked areas.');
  if(stats.shadings)warnings.push('Gradient/shading areas are not exported.');
  if(stats.omittedWhiteFills)warnings.push('White/background fills are omitted to keep CAD linework visible.');
  warnings.push('PDF dash phase, complex fill rules and some transparency effects may differ; compare the source before use.');
  warnings.push('PDF decoding can skip damaged or unsupported appearance streams without failing the whole page. A valid DXF is not proof that every PDF detail transferred; compare against the source.');
  return {entities,width:viewport.width*unit,height:viewport.height*unit,stats,warnings};
}
