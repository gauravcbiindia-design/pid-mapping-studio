export type DxfPoint = { x: number; y: number };
type Appearance = { color: string; layer: string; opacity?: number };
export type DxfEntity =
  | (Appearance & { kind: 'polyline'; points: DxfPoint[]; closed: boolean; lineWeight: number; dash?: number[] })
  | (Appearance & { kind: 'hatch'; loops: DxfPoint[][] })
  | (Appearance & { kind: 'text'; text: string; start: DxfPoint; end: DxfPoint; height: number; rotation: number });

function number(value: number): string {
  if (!Number.isFinite(value)) throw new Error('A PDF coordinate is not a finite number.');
  return Number(value.toFixed(7)).toString();
}

/** DXF strings must not be able to inject new group-code lines. */
export function dxfText(value: string): string {
  return value.replace(/[\r\n\t]/g, ' ').replace(/\\/g, '\\\\')
    .replace(/[^\x20-\x7e]/g, (char) => `\\U+${char.charCodeAt(0).toString(16).toUpperCase().padStart(4, '0')}`);
}

function colorCode(color: string): number {
  const value = Number.parseInt(color.replace('#', ''), 16);
  return Number.isFinite(value) ? value : 0;
}

/** AutoCAD 2004 ASCII DXF; coordinates and INSUNITS are millimetres. */
export function writeDxf(entities: DxfEntity[], width: number, height: number): string {
  const lines: string[] = [];
  const pair = (code: number, value: string | number) => lines.push(String(code), typeof value === 'number' ? number(value) : value);
  let handle = 0x100;
  const nextHandle = () => (handle++).toString(16).toUpperCase();
  const dashPatterns = new Map<string, { name: string; pattern: number[] }>();
  for (const entity of entities) if (entity.kind === 'polyline' && entity.dash?.some((n) => n > 0)) {
    const key = entity.dash.map((n) => number(n)).join(',');
    if (!dashPatterns.has(key)) dashPatterns.set(key, { name: `PDF_DASH_${dashPatterns.size + 1}`, pattern: entity.dash });
  }
  const appearance = (entity: Appearance) => {
    pair(5, nextHandle());
    pair(100, 'AcDbEntity');
    pair(8, entity.layer);
    // ACI 7 makes source black legible on either a white or black CAD canvas.
    const rgb = colorCode(entity.color);
    const nearBlack = (rgb >> 16 & 255) < 16 && (rgb >> 8 & 255) < 16 && (rgb & 255) < 16;
    if (nearBlack) pair(62, 7);
    else { pair(62, 256); pair(420, rgb); }
    if (entity.opacity !== undefined && entity.opacity < 1) pair(440, 0x02000000 | Math.round(Math.max(0, entity.opacity) * 255));
  };
  pair(0, 'SECTION'); pair(2, 'HEADER');
  pair(9, '$ACADVER'); pair(1, 'AC1018');
  pair(9, '$INSUNITS'); pair(70, 4);
  pair(9, '$MEASUREMENT'); pair(70, 1);
  pair(9, '$EXTMIN'); pair(10, 0); pair(20, 0); pair(30, 0);
  pair(9, '$EXTMAX'); pair(10, width); pair(20, height); pair(30, 0);
  pair(0, 'ENDSEC');
  pair(0, 'SECTION'); pair(2, 'TABLES');
  pair(0, 'TABLE'); pair(2, 'LTYPE'); pair(5, nextHandle()); pair(100, 'AcDbSymbolTable'); pair(70, 1 + dashPatterns.size);
  pair(0, 'LTYPE'); pair(5, nextHandle()); pair(100, 'AcDbSymbolTableRecord');
  pair(100, 'AcDbLinetypeTableRecord'); pair(2, 'CONTINUOUS'); pair(70, 0);
  pair(3, 'Solid line'); pair(72, 65); pair(73, 0); pair(40, 0);
  for (const { name, pattern: sourcePattern } of dashPatterns.values()) {
    const pattern = sourcePattern.length % 2 ? [...sourcePattern, ...sourcePattern] : sourcePattern;
    pair(0, 'LTYPE'); pair(5, nextHandle()); pair(100, 'AcDbSymbolTableRecord'); pair(100, 'AcDbLinetypeTableRecord');
    pair(2, name); pair(70, 0); pair(3, 'Source PDF dash pattern'); pair(72, 65); pair(73, pattern.length);
    pair(40, pattern.reduce((sum, n) => sum + Math.abs(n), 0));
    pattern.forEach((length, index) => { pair(49, index % 2 ? -length : length); pair(74, 0); });
  }
  pair(0, 'ENDTAB');
  const layers = [...new Set(['0', ...entities.map((entity) => entity.layer)])];
  pair(0, 'TABLE'); pair(2, 'LAYER'); pair(5, nextHandle()); pair(100, 'AcDbSymbolTable'); pair(70, layers.length);
  for (const layer of layers) {
    pair(0, 'LAYER'); pair(5, nextHandle()); pair(100, 'AcDbSymbolTableRecord');
    pair(100, 'AcDbLayerTableRecord'); pair(2, layer); pair(70, 0); pair(62, 7); pair(6, 'CONTINUOUS');
  }
  pair(0, 'ENDTAB');
  pair(0, 'TABLE'); pair(2, 'STYLE'); pair(5, nextHandle()); pair(100, 'AcDbSymbolTable'); pair(70, 1);
  pair(0, 'STYLE'); pair(5, nextHandle()); pair(100, 'AcDbSymbolTableRecord'); pair(100, 'AcDbTextStyleTableRecord');
  pair(2, 'STANDARD'); pair(70, 0); pair(40, 0); pair(41, 1); pair(50, 0); pair(71, 0); pair(42, 2.5);
  pair(3, 'txt'); pair(4, ''); pair(0, 'ENDTAB'); pair(0, 'ENDSEC');
  pair(0, 'SECTION'); pair(2, 'BLOCKS'); pair(0, 'ENDSEC');
  pair(0, 'SECTION'); pair(2, 'ENTITIES');
  for (const entity of entities) {
    if (entity.kind === 'polyline') {
      if (entity.points.length < 2) continue;
      pair(0, 'LWPOLYLINE'); appearance(entity); pair(370, entity.lineWeight);
      const dash = entity.dash?.length ? dashPatterns.get(entity.dash.map((n) => number(n)).join(',')) : undefined;
      if (dash) pair(6, dash.name);
      pair(100, 'AcDbPolyline');
      pair(90, entity.points.length); pair(70, (entity.closed ? 1 : 0) | (dash ? 128 : 0));
      for (const point of entity.points) { pair(10, point.x); pair(20, point.y); }
    } else if (entity.kind === 'hatch') {
      const loops = entity.loops.filter((loop) => loop.length >= 3);
      if (!loops.length) continue;
      pair(0, 'HATCH'); appearance(entity); pair(100, 'AcDbHatch');
      pair(10, 0); pair(20, 0); pair(30, 0); pair(210, 0); pair(220, 0); pair(230, 1);
      pair(2, 'SOLID'); pair(70, 1); pair(71, 0); pair(91, loops.length);
      for (const loop of loops) {
        pair(92, 2); pair(72, 0); pair(73, 1); pair(93, loop.length);
        for (const point of loop) { pair(10, point.x); pair(20, point.y); }
        pair(97, 0);
      }
      pair(75, 0); pair(76, 1); pair(98, 0);
    } else {
      if (!entity.text.trim() || !(entity.height > 0)) continue;
      // Keep long notes intact; split long TEXT into contiguous fitted runs.
      const chunks = entity.text.match(/[\s\S]{1,180}/g) ?? [];
      let offset = 0;
      for (const text of chunks) {
        const a = offset / entity.text.length;
        const b = (offset + text.length) / entity.text.length;
        const start = { x: entity.start.x + (entity.end.x - entity.start.x) * a, y: entity.start.y + (entity.end.y - entity.start.y) * a };
        const end = { x: entity.start.x + (entity.end.x - entity.start.x) * b, y: entity.start.y + (entity.end.y - entity.start.y) * b };
        pair(0, 'TEXT'); appearance(entity); pair(100, 'AcDbText');
        pair(10, start.x); pair(20, start.y); pair(30, 0); pair(40, entity.height);
        pair(1, dxfText(text)); pair(50, entity.rotation); pair(7, 'STANDARD');
        pair(72, Math.hypot(end.x - start.x, end.y - start.y) > 1e-8 ? 5 : 0);
        pair(11, end.x); pair(21, end.y); pair(31, 0); pair(100, 'AcDbText'); pair(73, 0);
        offset += text.length;
      }
    }
  }
  pair(0, 'ENDSEC'); pair(0, 'EOF');
  return `${lines.join('\r\n')}\r\n`;
}
