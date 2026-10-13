/** Neutral R2004 database structure. Contains no project or Legends Library data. */
export type DxfPairWriter = (code: number, value: string | number) => void;

export function createDxfStructure(nextHandle: () => string, width: number, height: number) {
  const root = nextHandle();
  const groups = nextHandle();
  const layouts = nextHandle();
  const plotStyles = nextHandle();
  const normalPlotStyle = nextHandle();
  const modelSpace = nextHandle();
  const paperSpace = nextHandle();
  const modelLayout = nextHandle();
  const paperLayout = nextHandle();

  function beginTable(pair: DxfPairWriter, name: string, count: number) {
    const handle = nextHandle();
    pair(0, 'TABLE'); pair(2, name); pair(5, handle); pair(330, '0');
    pair(100, 'AcDbSymbolTable'); pair(70, count);
    return handle;
  }

  function tableRecord(pair: DxfPairWriter, type: string, owner: string, subclass: string, handle = nextHandle()) {
    pair(0, type); pair(type === 'DIMSTYLE' ? 105 : 5, handle); pair(330, owner);
    pair(100, 'AcDbSymbolTableRecord'); pair(100, subclass);
    return handle;
  }

  function writeViewport(pair: DxfPairWriter) {
    const owner = beginTable(pair, 'VPORT', 1);
    tableRecord(pair, 'VPORT', owner, 'AcDbViewportTableRecord');
    pair(2, '*ACTIVE'); pair(70, 0);
    pair(10, 0); pair(20, 0); pair(11, 1); pair(21, 1);
    pair(12, width / 2); pair(22, height / 2);
    pair(13, 0); pair(23, 0); pair(14, 10); pair(24, 10); pair(15, 10); pair(25, 10);
    pair(16, 0); pair(26, 0); pair(36, 1);
    pair(17, 0); pair(27, 0); pair(37, 0);
    pair(40, height * 1.1); pair(41, width / height); pair(42, 50);
    pair(43, 0); pair(44, 0); pair(50, 0); pair(51, 0);
    pair(71, 0); pair(72, 1000); pair(73, 1); pair(74, 3);
    pair(75, 0); pair(76, 0); pair(77, 0); pair(78, 0); pair(281, 0);
    pair(0, 'ENDTAB');
  }

  function writeRemainingTables(pair: DxfPairWriter, standardStyle: string) {
    for (const name of ['VIEW', 'UCS']) {
      beginTable(pair, name, 0); pair(0, 'ENDTAB');
    }
    const appId = beginTable(pair, 'APPID', 1);
    tableRecord(pair, 'APPID', appId, 'AcDbRegAppTableRecord');
    pair(2, 'ACAD'); pair(70, 0); pair(0, 'ENDTAB');
    const dimStyle = beginTable(pair, 'DIMSTYLE', 1);
    pair(100, 'AcDbDimStyleTable'); pair(71, 0);
    tableRecord(pair, 'DIMSTYLE', dimStyle, 'AcDbDimStyleTableRecord');
    pair(2, 'STANDARD'); pair(70, 0); pair(40, 1); pair(140, 2.5); pair(340, standardStyle);
    pair(0, 'ENDTAB');
    const blocks = beginTable(pair, 'BLOCK_RECORD', 2);
    for (const [name, handle, layout] of [
      ['*Model_Space', modelSpace, modelLayout],
      ['*Paper_Space', paperSpace, paperLayout],
    ]) {
      tableRecord(pair, 'BLOCK_RECORD', blocks, 'AcDbBlockTableRecord', handle);
      pair(2, name); pair(340, layout); pair(70, 4); pair(280, 1); pair(281, 0);
    }
    pair(0, 'ENDTAB');
  }

  function writeBlocks(pair: DxfPairWriter) {
    pair(0, 'SECTION'); pair(2, 'BLOCKS');
    for (const [name, owner] of [['*Model_Space', modelSpace], ['*Paper_Space', paperSpace]]) {
      pair(0, 'BLOCK'); pair(5, nextHandle()); pair(330, owner);
      pair(100, 'AcDbEntity'); pair(8, '0'); pair(100, 'AcDbBlockBegin');
      pair(2, name); pair(70, 0); pair(10, 0); pair(20, 0); pair(30, 0); pair(3, name); pair(1, '');
      pair(0, 'ENDBLK'); pair(5, nextHandle()); pair(330, owner);
      pair(100, 'AcDbEntity'); pair(8, '0'); pair(100, 'AcDbBlockEnd');
    }
    pair(0, 'ENDSEC');
  }

  function dictionary(pair: DxfPairWriter, handle: string, owner: string, entries: [string, string][], withDefault = false) {
    pair(0, withDefault ? 'ACDBDICTIONARYWDFLT' : 'DICTIONARY');
    pair(5, handle); pair(330, owner); pair(100, 'AcDbDictionary'); pair(280, 0); pair(281, 1);
    for (const [name, target] of entries) { pair(3, name); pair(350, target); }
    if (withDefault) { pair(100, 'AcDbDictionaryWithDefault'); pair(340, normalPlotStyle); }
  }

  function layout(pair: DxfPairWriter, name: string, handle: string, block: string, tab: number) {
    pair(0, 'LAYOUT'); pair(5, handle); pair(330, layouts); pair(100, 'AcDbPlotSettings');
    pair(1, ''); pair(4, ''); pair(6, '');
    for (const code of [40, 41, 42, 43]) pair(code, 0);
    pair(44, width); pair(45, height);
    for (const code of [46, 47, 48, 49, 140, 141]) pair(code, 0);
    pair(142, 1); pair(143, 1); pair(70, tab === 0 ? 1024 : 0);
    pair(72, 1); pair(73, 0); pair(74, 5); pair(7, '');
    pair(75, 16); pair(76, 0); pair(77, 2); pair(78, 300);
    pair(147, 1); pair(148, 0); pair(149, 0);
    pair(100, 'AcDbLayout'); pair(1, name); pair(70, 1); pair(71, tab);
    pair(10, 0); pair(20, 0); pair(11, width); pair(21, height);
    pair(12, 0); pair(22, 0); pair(32, 0);
    pair(14, 0); pair(24, 0); pair(34, 0);
    pair(15, width); pair(25, height); pair(35, 0); pair(146, 0);
    pair(13, 0); pair(23, 0); pair(33, 0);
    pair(16, 1); pair(26, 0); pair(36, 0); pair(17, 0); pair(27, 1); pair(37, 0);
    pair(76, 1); pair(330, block);
  }

  function writeObjects(pair: DxfPairWriter) {
    pair(0, 'SECTION'); pair(2, 'OBJECTS');
    dictionary(pair, root, '0', [['ACAD_GROUP', groups], ['ACAD_LAYOUT', layouts], ['ACAD_PLOTSTYLENAME', plotStyles]]);
    dictionary(pair, groups, root, []);
    dictionary(pair, layouts, root, [['Model', modelLayout], ['Layout1', paperLayout]]);
    dictionary(pair, plotStyles, root, [['Normal', normalPlotStyle]], true);
    pair(0, 'ACDBPLACEHOLDER'); pair(5, normalPlotStyle); pair(330, plotStyles);
    layout(pair, 'Model', modelLayout, modelSpace, 0);
    layout(pair, 'Layout1', paperLayout, paperSpace, 1);
    pair(0, 'ENDSEC');
  }

  function writeClasses(pair: DxfPairWriter) {
    pair(0, 'SECTION'); pair(2, 'CLASSES');
    for (const [name, subclass, instances] of [
      ['LAYOUT', 'AcDbLayout', 2],
      ['ACDBDICTIONARYWDFLT', 'AcDbDictionaryWithDefault', 1],
      ['ACDBPLACEHOLDER', 'AcDbPlaceHolder', 1],
    ] as const) {
      pair(0, 'CLASS'); pair(1, name); pair(2, subclass); pair(3, 'ObjectDBX Classes');
      pair(90, 0); pair(91, instances); pair(280, 0); pair(281, 0);
    }
    pair(0, 'ENDSEC');
  }

  return { modelSpace, normalPlotStyle, beginTable, tableRecord, writeViewport, writeRemainingTables, writeBlocks, writeObjects, writeClasses };
}
