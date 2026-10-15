import { createStoredZip, type ZipFile } from './zip-binary.ts';
import { parseValveMaskBoundary, valveMaskPointsToLisp, type ValveMaskPoint } from './valve-mask.ts';

export type PdfPageJob = {
  pageCount: number;
  pdfBytes: Uint8Array;
  discipline: 'PFD' | 'P&ID';
  projectId?: string;
};

export type ApprovedRunnerSymbol = {
  blockName: string;
  blockAssetId: string;
  fallbackCategory: string;
  targetLayer: string;
  discipline: 'PFD' | 'P&ID' | 'Shared';
  sourceId: string;
  projectId?: string;
  wipeoutBoundary?: ValveMaskPoint[];
};
function pageRunner(
  documentNumber: number,
  pageCount: number,
  symbols: Array<ApprovedRunnerSymbol & { sourcePath: string }>,
  standards: ApprovedRunnerStandard[],
): string {
  const commandName = `PDF2DWG${String(documentNumber).padStart(2, '0')}`;
  const helperPrefix = `p2dwg${String(documentNumber).padStart(2, '0')}`;
  const symbolList = symbols.map((symbol) =>
    `(${lispString(symbol.fallbackCategory.toLowerCase())} ${lispString(symbol.blockName)} ${lispString(symbol.sourcePath)} ${lispString(symbol.targetLayer)} ${symbol.wipeoutBoundary ? valveMaskPointsToLisp(symbol.wipeoutBoundary) : 'nil'})`,
  ).join('\n    ');
  const layerList = standards
    .filter((standard) => standard.category === 'layer')
    .filter((standard) => standard.name.trim().toUpperCase() !== '0')
    .map((standard) => {
      const color = Number(standard.detail.match(/(?:^|;)color=(\d+)/i)?.[1] ?? 7);
      const lineweight = Number(standard.detail.match(/(?:^|;)lineweight=(-?\d+)/i)?.[1] ?? 25);
      const validLineweight = [-3, -2, -1].includes(lineweight) ||
        (Number.isInteger(lineweight) && lineweight >= 0 && lineweight <= 211);
      const linetype = standard.detail.match(/(?:^|;)linetype=([^;]+)/i)?.[1] ?? 'CONTINUOUS';
      return `(${lispString(standard.name)} ${Number.isInteger(color) && color > 0 && color <= 255 ? color : 7} ${validLineweight ? lineweight : 25} ${lispString(linetype)})`;
    }).join('\n    ');
  const textStyleList = standards
    .filter((standard) => standard.category === 'textStyle')
    .map((standard) => {
      const rawProperty = (key: string, fallback: string) =>
        standard.detail.match(new RegExp(`(?:^|;)${key}=([^;]*)`, 'i'))?.[1] ?? fallback;
      const numericProperty = (key: string, fallback: number) => {
        const value = Number(rawProperty(key, String(fallback)));
        return Number.isFinite(value) ? String(value) : String(fallback);
      };
      return `(${lispString(standard.name)} ${numericProperty('height', 0)} ${numericProperty('width', 1)} ${numericProperty('oblique', 0)} ${lispString(rawProperty('font', 'txt.shx'))} ${lispString(rawProperty('bigfont', ''))})`;
    }).join('\n    ');
  const linetypeList = standards
    .filter((standard) => standard.category === 'linetype')
    .filter((standard) => !['CONTINUOUS', 'BYLAYER', 'BYBLOCK'].includes(standard.name.trim().toUpperCase()))
    .flatMap((standard) => {
      const definition = parseLinetypeDefinition(standard.name, standard.detail);
      if (!definition) {
        throw new Error(
          `Approved linetype "${standard.name}" has an unsupported or incomplete definition. ` +
          'Re-extract it with the current extractor; the runner will not omit its marks or substitute Continuous.',
        );
      }
      const description = standard.detail.match(/(?:^|;)description=([^;]*)/i)?.[1]?.trim() || standard.name;
      const segments = definition.segments.map((segment) => {
        const values = [String(segment.length), String(segment.flags)];
        if (segment.flags === 4) {
          values.push(
            String(segment.shapeNumber),
            lispString(segment.styleName),
            lispString(segment.shapeFile),
            String(segment.scale),
            String(segment.rotation),
            String(segment.offsetX),
            String(segment.offsetY),
          );
        }
        return `(${values.join(' ')})`;
      }).join(' ');
      return [
        `(${lispString(standard.name)} ${lispString(description)} ${String(definition.patternLength)} (${segments}))`,
      ];
    }).join('\n    ');
  validateApprovedLayerLinetypes(standards);

  return `; Local AutoCAD runner. The matching source PDF is packaged separately.
; Copyright (c) 2026 gaurav.cbiindia.
; Run command ${commandName} in AutoCAD for Windows.
; Each imported entity is stamped with a generic source alias and source page.

(vl-load-com)
(if (not (boundp '*p2dwg-batch-mode*)) (setq *p2dwg-batch-mode* nil))
(setq *p2dwg-approved-symbols* '(
    ${symbolList}
))
(setq *p2dwg-approved-layers* '(
    ${layerList}
))
(setq *p2dwg-approved-text-styles* '(
    ${textStyleList}
))
(setq *p2dwg-approved-linetypes* '(
    ${linetypeList}
))

(defun ${helperPrefix}-pad-page (value / text)
  (setq text (itoa value))
  (while (< (strlen text) 3)
    (setq text (strcat "0" text))
  )
  text
)

(defun ${helperPrefix}-ensure-shape-style (styleName fontFile / data updated styleEntity)
  (if (not (findfile fontFile))
    (error (strcat "Required linetype shape font " fontFile " was not found in AutoCAD's support paths. Install it, then rerun; the shape will not be omitted."))
  )
  (setq data (tblsearch "STYLE" styleName))
  (if data
    (progn
      (setq updated (${helperPrefix}-put-group 3 fontFile data))
      (setq updated (${helperPrefix}-put-group 4 "" updated))
      (setq updated (${helperPrefix}-put-group 40 0.0 updated))
      (setq updated (${helperPrefix}-put-group 41 1.0 updated))
      (setq updated (${helperPrefix}-put-group 50 0.0 updated))
      (setq updated (${helperPrefix}-put-group 71 0 updated))
      (entmod updated)
    )
    (entmake
      (list
        '(0 . "STYLE")
        '(100 . "AcDbSymbolTableRecord")
        '(100 . "AcDbTextStyleTableRecord")
        (cons 2 styleName)
        '(70 . 0)
        '(40 . 0.0)
        '(41 . 1.0)
        '(50 . 0.0)
        '(71 . 0)
        '(42 . 2.5)
        (cons 3 fontFile)
        '(4 . "")
      )
    )
  )
  (setq styleEntity (tblobjname "STYLE" styleName))
  (if (not styleEntity)
    (error (strcat "Could not create the shape text style " styleName "."))
  )
  styleEntity
)

(defun ${helperPrefix}-ensure-layer (name color weight linetype)
  (if (or (= (strcase linetype) "BYLAYER") (= (strcase linetype) "BYBLOCK"))
    (setq linetype "CONTINUOUS")
  )
  (if (not (${helperPrefix}-ensure-linetype linetype))
    (error (strcat "Approved linetype " linetype " could not be loaded. Page canceled; no Continuous fallback was applied."))
  )
  (if (not (${helperPrefix}-set-layer-standard name color weight linetype))
    (error (strcat "Approved layer " name " could not be created or updated. Page canceled."))
  )
)

(defun ${helperPrefix}-ensure-linetype (name / definition description segments total record
                                        existing updated result segment dash flags styleEntity styleHandle)
  (if (member (strcase name) '("CONTINUOUS" "BYLAYER" "BYBLOCK"))
    T
    (progn
      (setq definition
        (car
          (vl-remove-if-not
            '(lambda (entry) (= (strcase (car entry)) (strcase name)))
            *p2dwg-approved-linetypes*
          )
        )
      )
      (if (not definition)
        nil
        (progn
          (setq description (cadr definition))
            (setq total (caddr definition))
            (setq segments (cadddr definition))
          (setq existing (tblsearch "LTYPE" name))
          (if existing
            (setq updated
              (vl-remove-if
                  '(lambda (entry) (member (car entry) '(3 9 40 44 45 46 49 50 72 73 74 75 340)))
                existing
              )
            )
            (setq updated
              (list
                '(0 . "LTYPE")
                '(100 . "AcDbSymbolTableRecord")
                '(100 . "AcDbLinetypeTableRecord")
                (cons 2 name)
                '(70 . 0)
              )
            )
          )
          (setq record
            (append updated
              (list
                (cons 3 description)
                '(72 . 65)
                (cons 73 (length segments))
                (cons 40 total)
              )
            )
            (foreach segment segments
              (setq dash (car segment))
              (setq flags (cadr segment))
              (setq record (append record (list (cons 49 dash) (cons 74 flags))))
              (if (= flags 4)
                (progn
                  (setq styleEntity (${helperPrefix}-ensure-shape-style (nth 3 segment) (nth 4 segment)))
                  (setq styleHandle (cdr (assoc 5 (entget styleEntity))))
                  (if (not styleHandle)
                    (error (strcat "Could not resolve the shape style handle for linetype " name "."))
                  )
                  (setq record
                    (append record
                      (list
                        (cons 75 (nth 2 segment))
                        (cons 340 styleHandle)
                        (cons 46 (nth 5 segment))
                        (cons 50 (nth 6 segment))
                        (cons 44 (nth 7 segment))
                        (cons 45 (nth 8 segment))
                      )
                    )
                  )
                )
              )
            )
            (setq result
              (if existing
                (entmod record)
                (entmake record)
              )
            )
            (and result (tblsearch "LTYPE" name))
          )
        )
      )
    )
  )
)

(defun ${helperPrefix}-put-group (code value data / prior)
  (setq prior (assoc code data))
  (if prior (subst (cons code value) prior data) (append data (list (cons code value))))
)

(defun ${helperPrefix}-set-layer-standard (name color weight linetype / data updated)
  (setq data (tblsearch "LAYER" name))
  (if data
    (progn
      (setq updated (${helperPrefix}-put-group 62 color data))
      (setq updated (${helperPrefix}-put-group 6 linetype updated))
      (setq updated (${helperPrefix}-put-group 370 weight updated))
      (entmod updated)
    )
    (entmake
      (list
        '(0 . "LAYER")
        '(100 . "AcDbSymbolTableRecord")
        '(100 . "AcDbLayerTableRecord")
        (cons 2 name)
        '(70 . 0)
        (cons 62 color)
        (cons 6 linetype)
        (cons 370 weight)
      )
    )
  )
)

(defun ${helperPrefix}-set-insert-layer (entity layer-name / data entity-type)
  (if (and entity (tblsearch "LAYER" layer-name))
    (progn
      (setq data (entget entity))
      (setq entity-type (cdr (assoc 0 data)))
      (if (equal (strcase entity-type) "INSERT")
        (progn
          (if (assoc 8 data)
            (setq data (subst (cons 8 layer-name) (assoc 8 data) data))
            (setq data (append data (list (cons 8 layer-name))))
          )
          (if (entmod data)
            (progn
              (entupd entity)
              (equal (strcase (cdr (assoc 8 (entget entity)))) (strcase layer-name))
            )
            nil
          )
        )
        nil
      )
    )
    nil
  )
)

(defun ${helperPrefix}-make-valve-wipeout (boundary center layer / vertices point polyline result wipeout data)
  (setq vertices nil)
  (foreach point boundary
    (setq vertices
      (append vertices
        (list
          (cons 10
            (list
              (+ (car center) (car point))
              (+ (cadr center) (cadr point))
            )
          )
        )
      )
    )
  )
  (if (and (>= (length vertices) 3) (tblsearch "LAYER" layer))
    (progn
      (setq polyline
        (entmakex
          (append
            (list
              '(0 . "LWPOLYLINE")
              '(100 . "AcDbEntity")
              (cons 8 layer)
              '(100 . "AcDbPolyline")
              (cons 90 (length vertices))
              '(70 . 1)
            )
            vertices
          )
        )
      )
      (if polyline
        (progn
          (setvar "WIPEOUTFRAME" 0)
          (setq result
            (vl-catch-all-apply
              'vl-cmdf
              (list "_.WIPEOUT" "_P" polyline "_Y")
            )
          )
          (setq data (entget (entlast)))
          (if (and
                (not (vl-catch-all-error-p result))
                data
                (= (strcase (cdr (assoc 0 data))) "WIPEOUT")
              )
            (setq wipeout (entlast))
            (progn
              (if (entget polyline) (entdel polyline))
              (setq wipeout nil)
            )
          )
        )
      )
    )
  )
  wipeout
)

(defun ${helperPrefix}-apply-approved-cad-standards (/ entry name color linetype style)
  (foreach linetype *p2dwg-approved-linetypes*
    (if (not (${helperPrefix}-ensure-linetype (car linetype)))
      (error (strcat "Approved linetype " (car linetype) " could not be loaded."))
    )
  )
  (foreach entry *p2dwg-approved-layers*
    (${helperPrefix}-ensure-layer (car entry) (cadr entry) (caddr entry) (cadddr entry))
  )
  (foreach style *p2dwg-approved-text-styles*
    (if (not (tblsearch "STYLE" (car style)))
      (if (or (= (nth 4 style) "") (findfile (nth 4 style)))
        (entmake
          (list
            '(0 . "STYLE")
            '(100 . "AcDbSymbolTableRecord")
            '(100 . "AcDbTextStyleTableRecord")
            (cons 2 (nth 0 style))
            '(70 . 0)
            (cons 40 (atof (nth 1 style)))
            (cons 41 (atof (nth 2 style)))
            (cons 50 (atof (nth 3 style)))
            '(71 . 0)
            '(42 . 2.5)
            (cons 3 (nth 4 style))
            (cons 4 (nth 5 style))
          )
        )
        (prompt (strcat "\\nApproved text style " (car style) " was not added because font " (nth 4 style) " is not installed."))
      )
    )
  )
  (setvar "INSUNITS" 4)
  (setvar "MEASUREMENT" 1)
  (setvar "LTSCALE" 1.0)
  (setvar "CELTSCALE" 1.0)
  (setvar "MSLTSCALE" 1)
  (setvar "PSLTSCALE" 0)
)

(defun ${helperPrefix}-tag-page-entity (entity / data)
  (if (and entity (regapp "PIDPAGE"))
    (progn
      (setq data (entget entity))
      (entmod
        (append
          data
          (list
            (list
              -3
              (list
                "PIDPAGE"
                (cons 1000 *p2dwg-source-alias*)
                (cons 1070 *p2dwg-source-page*)
                (cons 1000 *p2dwg-scale-status*)
                (cons 1040 *p2dwg-effective-scale*)
              )
            )
          )
        )
      )
      (entupd entity)
    )
  )
)

(defun ${helperPrefix}-collect-imported-entities (before-entity / entity data entity-type selection)
  (setq selection (ssadd))
  (setq entity (if before-entity (entnext before-entity) (entnext)))
  (while entity
    (setq data (entget entity))
    (setq entity-type (cdr (assoc 0 data)))
    (if (and
          entity-type
          (member (strcase entity-type)
            '("LINE" "LWPOLYLINE" "POLYLINE" "ARC" "CIRCLE" "ELLIPSE"
              "SPLINE" "POINT" "TEXT" "MTEXT" "INSERT" "HATCH" "SOLID"
              "TRACE" "3DFACE" "DIMENSION" "LEADER" "MLEADER" "WIPEOUT"
              "ACAD_PROXY_ENTITY")
          )
          (not (equal (cdr (assoc 67 data)) 1))
        )
      (ssadd entity selection)
    )
    (setq entity (entnext entity))
  )
  (if (> (sslength selection) 0) selection nil)
)

(defun ${helperPrefix}-tag-review-entity (entity role item category block / data)
  (if (and entity (regapp "PIDREVIEW"))
    (progn
      (setq data (entget entity))
      (entmod
        (append
          data
          (list
            (list
              -3
              (list
                "PIDREVIEW"
                (cons 1000 role)
                (cons 1000 (if item item ""))
                (cons 1000 (if category category ""))
                (cons 1000 (if block block ""))
              )
            )
          )
        )
      )
      (entupd entity)
    )
  )
)

(defun ${helperPrefix}-batch-log (message / handle)
  (if (and *p2dwg-batch-mode* *p2dwg-batch-log-path*)
    (progn
      (setq handle (open *p2dwg-batch-log-path* "a"))
      (if handle
        (progn
          (write-line message handle)
          (close handle)
        )
      )
    )
  )
)

(defun ${helperPrefix}-stamp-page (selection / index entity)
  (if selection
    (progn
      (setq index 0)
      (while (< index (sslength selection))
        (setq entity (ssname selection index))
        (${helperPrefix}-tag-page-entity entity)
        (setq index (1+ index))
      )
    )
  )
)

(defun ${helperPrefix}-selection-bounds (selection / index entity low high result
                                           min-x min-y max-x max-y found)
  (setq index 0)
  (setq found nil)
  (while (< index (sslength selection))
    (setq entity (ssname selection index))
    (setq low nil)
    (setq high nil)
    (setq result
      (vl-catch-all-apply
        'vla-getboundingbox
        (list (vlax-ename->vla-object entity) 'low 'high)
      )
    )
    (if (not (vl-catch-all-error-p result))
      (progn
        (if (= (type low) 'VARIANT) (setq low (vlax-variant-value low)))
        (if (= (type high) 'VARIANT) (setq high (vlax-variant-value high)))
        (setq low (vlax-safearray->list low))
        (setq high (vlax-safearray->list high))
        (if (not found)
          (progn
            (setq min-x (car low))
            (setq min-y (cadr low))
            (setq max-x (car high))
            (setq max-y (cadr high))
            (setq found T)
          )
          (progn
            (setq min-x (min min-x (car low)))
            (setq min-y (min min-y (cadr low)))
            (setq max-x (max max-x (car high)))
            (setq max-y (max max-y (cadr high)))
          )
        )
      )
    )
    (setq index (1+ index))
  )
  (if found (list min-x min-y max-x max-y) nil)
)

(defun ${helperPrefix}-tag-pipe-runs (imported-selection / answer selection index entity
                                     data entity-type valid layer-options layer-index
                                     layer-entry layer-name tag stable-id run-index
                                     selection-index updated)
  (initget "Yes No")
  (setq answer
    (getkword "\\nDo you want to identify any Pipe Runs on this page? [Yes/No] <No>: ")
  )
  (if (/= (strcase (if answer answer "No")) "YES")
    T
    (progn
      (setq layer-options
        (vl-remove-if
          '(lambda (entry) (= (strcase (car entry)) "0"))
          *p2dwg-approved-layers*
        )
      )
      (if (not layer-options)
        (progn
          (prompt "\\nNo reviewed non-zero Legends Library layer is available. This page will not be saved.")
          nil
        )
        (progn
          (setq run-index 1)
          (setq valid T)
          (setq selection T)
          (while selection
            (prompt
              "\\nSelect all PDF-imported 2D line/arc segments for ONE Pipe Run; press Enter when finished."
            )
            (setq selection (ssget))
            (if selection
              (progn
                (setq valid T)
                (setq index 0)
                (while (and valid (< index (sslength selection)))
                  (setq entity (ssname selection index))
                  (setq data (entget entity))
                  (setq entity-type (strcase (if (cdr (assoc 0 data)) (cdr (assoc 0 data)) "")))
                  (if (or
                        (not (ssmemb entity imported-selection))
                        (not (member entity-type '("LINE" "LWPOLYLINE" "POLYLINE" "ARC")))
                      )
                    (setq valid nil)
                  )
                  (setq index (1+ index))
                )
                (if (not valid)
                  (progn
                    (prompt
                      "\\nSelection rejected: choose only imported 2D line/arc segments from this PDF page. No Pipe Run changes were made."
                    )
                    nil
                  )
                  (progn
                    (prompt "\\nApproved non-zero target layers:")
                    (setq index 1)
                    (foreach layer-entry layer-options
                      (prompt (strcat "\\n  " (itoa index) ") " (car layer-entry)))
                      (setq index (1+ index))
                    )
                    (initget 6)
                    (setq layer-index
                      (getint
                        (strcat "\\nChoose layer number [1-" (itoa (length layer-options)) "]: ")
                      )
                    )
                    (if (or (null layer-index) (> layer-index (length layer-options)))
                      (progn
                        (prompt "\\nInvalid layer choice. This page will not be saved.")
                        (setq selection nil)
                        (setq valid nil)
                      )
                    )
                    (if valid
                      (progn
                        (setq layer-entry (nth (1- layer-index) layer-options))
                        (setq layer-name (car layer-entry))
                        (setq tag (getstring T "\\nEnter the Pipe Run tag: "))
                        (if (or (= tag "") (> (strlen tag) 128))
                          (progn
                            (prompt "\\nPipe Run tag must contain 1-128 characters. This page will not be saved.")
                            (setq selection nil)
                            (setq valid nil)
                          )
                        )
                      )
                    )
                    (if valid
                      (progn
                        (setq stable-id
                          (strcat
                            *p2dwg-source-alias*
                            "-P"
                            (${helperPrefix}-pad-page *p2dwg-source-page*)
                            "-R"
                            (${helperPrefix}-pad-page run-index)
                          )
                        )
                        (regapp "PIDPIPE")
                        (setq selection-index 0)
                        (while (< selection-index (sslength selection))
                          (setq entity (ssname selection selection-index))
                          (setq data (entget entity))
                          (setq updated (${helperPrefix}-put-group 8 layer-name data))
                          (setq updated (${helperPrefix}-put-group 6 "BYLAYER" updated))
                          (setq updated
                            (append updated
                              (list
                                (list -3
                                  (list
                                    "PIDPIPE"
                                    (cons 1000 stable-id)
                                    (cons 1000 tag)
                                    (cons 1000 layer-name)
                                    (cons 1000 *p2dwg-source-alias*)
                                    (cons 1070 *p2dwg-source-page*)
                                    (cons 1000 *p2dwg-scale-status*)
                                  )
                                )
                              )
                            )
                          )
                          (if (not (entmod updated))
                            (error "A Pipe Run segment could not be tagged; this page will not be saved.")
                          )
                          (entupd entity)
                          (setq selection-index (1+ selection-index))
                        )
                        (prompt
                          (strcat
                            "\\nTagged "
                            (itoa (sslength selection))
                            " segment(s) as "
                            tag
                            " on "
                            layer-name
                            " with StableID "
                            stable-id
                            "."
                          )
                        )
                        (${helperPrefix}-batch-log
                          (strcat "PIPE_RUN|" stable-id "|" tag "|" layer-name)
                        )
                        (setq run-index (1+ run-index))
                      )
                    )
                  )
                )
              )
            )
          )
          (if valid T nil)
        )
      )
    )
  )
)

(defun ${helperPrefix}-calibrate-import (selection / answer known-length first-point
                                         second-point measured ratio)
  (setq *p2dwg-scale-status* "UNVERIFIED")
  (setq *p2dwg-effective-scale* scaleFactor)
  (initget "Yes No")
  (setq answer
    (getkword
      (strcat
        "\\nCan you verify page "
        (itoa *p2dwg-source-page*)
        " using a known drawing dimension? [Yes/No] <No>: "
      )
    )
  )
  (if (= (strcase (if answer answer "No")) "YES")
    (progn
      (initget 6)
      (setq known-length
        (getreal "\\nEnter that dimension in millimetres: ")
      )
      (setq first-point
        (getpoint "\\nSnap to the first end of that dimension: ")
      )
      (if first-point
        (setq second-point
          (getpoint first-point "\\nSnap to the second end: ")
        )
      )
      (if (or (null known-length) (null first-point) (null second-point))
        (error "Scale calibration was cancelled. This page was not saved.")
      )
      (setq measured (distance first-point second-point))
      (if (or (<= measured 0.0) (<= known-length 0.0))
        (error "Scale calibration needs a measurable line and a positive known length.")
      )
      (setq ratio (/ known-length measured))
      (command "_.SCALE" selection "" '(0.0 0.0 0.0) ratio)
      (setq scaleFactor (* scaleFactor ratio))
      (setq *p2dwg-scale-status* "CALIBRATED")
      (setq *p2dwg-effective-scale* scaleFactor)
      (prompt
        (strcat
          "\\nScale calibrated about 0,0 using "
          (rtos known-length 2 3)
          " mm. Effective PDF scale: "
          (rtos scaleFactor 2 8)
          "."
        )
      )
    )
    (prompt
      "\\nScale left unverified. The DWG will be marked UNVERIFIED; do not use it for dimensions until checked."
    )
  )
  T
)

(defun ${helperPrefix}-cloud-vertices (min-x min-y max-x max-y / step-x step-y
                                       index vertices)
  (setq step-x (/ (- max-x min-x) 8.0))
  (setq step-y (/ (- max-y min-y) 8.0))
  (setq index 0)
  (setq vertices nil)
  (repeat 8
    (setq vertices
      (append vertices
        (list (cons 10 (list (+ min-x (* step-x index)) min-y))
              (cons 42 -0.35)))
    )
    (setq index (1+ index))
  )
  (setq index 0)
  (repeat 8
    (setq vertices
      (append vertices
        (list (cons 10 (list max-x (+ min-y (* step-y index))))
              (cons 42 -0.35)))
    )
    (setq index (1+ index))
  )
  (setq index 0)
  (repeat 8
    (setq vertices
      (append vertices
        (list (cons 10 (list (- max-x (* step-x index)) max-y))
              (cons 42 -0.35)))
    )
    (setq index (1+ index))
  )
  (setq index 0)
  (repeat 8
    (setq vertices
      (append vertices
        (list (cons 10 (list min-x (- max-y (* step-y index))))
              (cons 42 -0.35)))
    )
    (setq index (1+ index))
  )
  vertices
)

(defun ${helperPrefix}-make-review-cloud (bounds item category block / min-x min-y
                                           max-x max-y padding cloud)
  (setq min-x (nth 0 bounds))
  (setq min-y (nth 1 bounds))
  (setq max-x (nth 2 bounds))
  (setq max-y (nth 3 bounds))
  (setq padding (* 0.12 (max (- max-x min-x) (- max-y min-y))))
  (if (< padding 1.0) (setq padding 1.0))
  (setq min-x (- min-x padding))
  (setq min-y (- min-y padding))
  (setq max-x (+ max-x padding))
  (setq max-y (+ max-y padding))
  (${helperPrefix}-ensure-layer "PID-REVIEW-CLOUD" 1 35 "CONTINUOUS")
  (setq cloud
    (entmakex
      (append
        (list
          '(0 . "LWPOLYLINE")
          '(100 . "AcDbEntity")
          '(8 . "PID-REVIEW-CLOUD")
          '(62 . 1)
          '(370 . 35)
          '(100 . "AcDbPolyline")
          '(90 . 32)
          '(70 . 1)
        )
        (${helperPrefix}-cloud-vertices min-x min-y max-x max-y)
      )
    )
  )
  (${helperPrefix}-tag-page-entity cloud)
  (${helperPrefix}-tag-review-entity cloud "RED_REVISION_CLOUD" item category block)
  cloud
)

(defun ${helperPrefix}-choose-approved-symbol (category / options index choice mask-note)
  (setq options
    (vl-remove-if-not
      '(lambda (entry) (= (strcase (car entry)) (strcase category)))
      *p2dwg-approved-symbols*
    )
  )
  (if options
    (progn
      (prompt (strcat "\\nApproved " category " fallback symbols:"))
      (setq index 1)
      (foreach choice options
        (setq mask-note
          (if (and (= (strcase category) "VALVE") (nth 4 choice))
            "  [Reviewed body mask]"
            ""
          )
        )
        (prompt
          (strcat "\\n  " (itoa index) ") " (cadr choice)
            "  [Layer: " (nth 3 choice) "]" mask-note)
        )
        (setq index (1+ index))
      )
      (prompt "\\n  0) Keep the source geometry; no fallback")
      (initget 4)
      (setq index (getint "\\nChoose an approved same-category fallback [0 to keep]: "))
      (if (and index (> index 0) (<= index (length options)))
        (nth (1- index) options)
        nil
      )
    )
    (progn
      (prompt (strcat "\\nNo approved " category " fallback is available for this discipline and project."))
      nil
    )
  )
)

(defun ${helperPrefix}-review-unsupported (/ answer selection bounds index entity
                                            selection-index category block-name target-layer
                                            center fallback replace-answer item
                                            choice source-path insert-result prior-entity
                                            mask-boundary wipeout)
  (${helperPrefix}-ensure-layer "PID-PROVISIONAL-FALLBACK" 1 35 "CONTINUOUS")
  (initget "Yes No")
  (setq answer
    (getkword
      "\\nDid you find unsupported equipment on this page? [Yes/No]: "
    )
  )
  (if (null answer)
    nil
    (progn
      (setq index 1)
      (if (= (strcase answer) "YES")
        (progn
          (prompt
            "\\nSelect only the objects for one unsupported item; press Enter when all items are marked."
          )
          (setq selection T)
          (while selection
            (setq selection (ssget))
            (if selection
              (progn
                (setq bounds (${helperPrefix}-selection-bounds selection))
                (if (null bounds)
                  (prompt "\\nCould not read the selection extents. This item was not clouded.")
                  (progn
                    (setq category
                      (getstring T
                        "\\nEnter the item's category (for example pump, valve, or instrument): "
                      )
                    )
                    (while (= category "")
                      (setq category
                        (getstring T "\\nCategory is required for traceability: ")
                      )
                    )
                    (setq choice (${helperPrefix}-choose-approved-symbol category))
                    (setq block-name (if choice (cadr choice) ""))
                    (setq source-path (if choice (nth 2 choice) ""))
                    (setq target-layer (if choice (nth 3 choice) ""))
                    (setq mask-boundary (if choice (nth 4 choice) nil))
                    (setq item
                      (strcat
                        "REV-${String(documentNumber).padStart(2, '0')}-"
                        (${helperPrefix}-pad-page index)
                      )
                    )
                    (setq center
                      (list
                        (/ (+ (nth 0 bounds) (nth 2 bounds)) 2.0)
                        (/ (+ (nth 1 bounds) (nth 3 bounds)) 2.0)
                        0.0
                      )
                    )
                    (setq fallback nil)
                    (setq replace-answer nil)
                    (if (and choice source-path)
                      (progn
                        (setq source-path
                          (strcat *p2dwg-batch-directory* "\\\\" source-path)
                        )
                        (cond
                          ((or (= target-layer "") (not (tblsearch "LAYER" target-layer)))
                            (prompt "\\nThe approved target layer is not available. Source geometry will be preserved and clouded.")
                          )
                          ((not (findfile source-path))
                            (prompt "\\nThe approved block drawing is missing from the runner folder. Source geometry will be preserved and clouded.")
                          )
                          (T
                            (setq prior-entity (entlast))
                            (setq insert-result
                              (vl-catch-all-apply
                                '(lambda ()
                                  (command
                                    "_.-INSERT"
                                    source-path
                                    center
                                    1.0
                                    1.0
                                    0.0
                                  )
                                )
                                '()
                              )
                            )
                            (if (and (not (vl-catch-all-error-p insert-result))
                                     (not (eq prior-entity (entlast))))
                              (progn
                                (setq fallback (entlast))
                                (if (not (${helperPrefix}-set-insert-layer fallback target-layer))
                                  (progn
                                    (entdel fallback)
                                    (setq fallback nil)
                                    (prompt "\\nThe inserted object was not a verified block reference on the approved layer. Source geometry will be preserved and clouded.")
                                  )
                                )
                              )
                              (prompt
                                "\\nCould not import the approved source block. Source geometry will be preserved and clouded."
                              )
                            )
                          )
                        )
                      )
                    )
                    (if (and fallback (= (strcase category) "VALVE"))
                      (progn
                        (setq wipeout
                          (${helperPrefix}-make-valve-wipeout mask-boundary center target-layer)
                        )
                        (if wipeout
                          (progn
                            (${helperPrefix}-tag-page-entity wipeout)
                            (${helperPrefix}-tag-review-entity
                              wipeout "VALVE_BODY_WIPEOUT" item category block-name
                            )
                            (vl-catch-all-apply
                              'vl-cmdf
                              (list "_.DRAWORDER" fallback "" "_F")
                            )
                          )
                          (progn
                            (entdel fallback)
                            (setq fallback nil)
                            (prompt
                              "\\nValve Wipeout creation failed. The fallback was removed; source geometry will be preserved and clouded."
                            )
                          )
                        )
                      )
                    )
                    (if fallback
                      (progn
                        (${helperPrefix}-tag-page-entity fallback)
                        (${helperPrefix}-tag-review-entity
                          fallback "PROVISIONAL_SAME_CATEGORY_FALLBACK"
                          item category block-name
                        )
                        (prompt
                          "\\nFallback inserted. Type Replace to erase the selected source objects, or Keep to retain them."
                        )
                        (initget "Replace Keep")
                        (setq replace-answer
                          (getkword "\\nSource geometry [Replace/Keep] <Keep>: ")
                        )
                        (if (= (strcase (if replace-answer replace-answer "Keep")) "REPLACE")
                          (command "_.ERASE" selection "")
                        )
                      )
                    )
                    (if (not (and fallback
                                  (= (strcase (if replace-answer replace-answer "Keep"))
                                     "REPLACE")))
                      (progn
                        (setq entity nil)
                        (setq selection-index 0)
                        (while (< selection-index (sslength selection))
                          (setq entity (ssname selection selection-index))
                          (${helperPrefix}-tag-review-entity
                            entity "UNSUPPORTED_SOURCE_RETAINED"
                            item category block-name
                          )
                          (setq selection-index (1+ selection-index))
                        )
                      )
                    )
                    (${helperPrefix}-make-review-cloud
                      bounds item category (if fallback block-name "")
                    )
                    (setq index (1+ index))
                  )
                )
              )
            )
          )
        )
      )
      (initget "Yes No")
      (setq answer
        (getkword
          "\\nConfirm this page was checked for confidential details and unsupported items; every uncertain item is clouded? [Yes/No]: "
        )
      )
      (= (strcase (if answer answer "No")) "YES")
    )
  )
)

(defun c:${commandName} (/ *error* oldFileDia oldCmdEcho acad documents
                            pdfPath templatePath outputChoice outputDirectory
                            outputBase scaleFactor confirmedPages page currentDoc
                             outputPath redactions existingPath keepGoing scrubAnswer
                              reviewConfirmed beforeEntity importedEntities pipeConfirmed)
  (setq oldFileDia (getvar "FILEDIA"))
  (setq oldCmdEcho (getvar "CMDECHO"))
  (setq currentDoc nil)

  (defun *error* (message)
    (if *p2dwg-batch-mode* (setq *p2dwg-batch-stop* T))
    (if currentDoc
      (vl-catch-all-apply 'vla-close (list currentDoc :vlax-false))
    )
    (if oldFileDia (setvar "FILEDIA" oldFileDia))
    (if oldCmdEcho (setvar "CMDECHO" oldCmdEcho))
    (if (and message (/= message "Function cancelled"))
      (prompt
        (strcat
          "\\nPDF-to-DWG stopped. Pages saved before this point may remain in the output folder. "
          message
        )
      )
    )
    (princ)
  )

  (setq pdfPath
    (if *p2dwg-batch-mode*
      *p2dwg-batch-pdf-path*
      (getfiled
        "Select SOURCE_${String(documentNumber).padStart(2, '0')}.pdf from the extracted runner folder"
        ""
        "pdf"
        0
      )
    )
  )
  (if (null pdfPath)
    (prompt "\\nCancelled before importing any pages.")
    (progn
      (setq templatePath
        (if *p2dwg-batch-mode*
          *p2dwg-batch-template-path*
          (progn
            (setq templatePath (findfile "acadiso.dwt"))
            (if (null templatePath) (setq templatePath (findfile "acad.dwt")))
            (getfiled
              "Select a blank DWT template (acadiso.dwt is a metric test template)"
              (if templatePath templatePath "")
              "dwt"
              0
            )
          )
        )
      )
      (if (null templatePath)
        (prompt "\\nCancelled before importing any pages.")
        (progn
          (setq outputChoice
            (if *p2dwg-batch-mode*
              *p2dwg-batch-output-choice*
              (getfiled
                "Choose an output folder and base DWG name"
                (strcat (getvar "DWGPREFIX") "drawing-set.dwg")
                "dwg"
                1
              )
            )
          )
          (if (null outputChoice)
            (prompt "\\nCancelled before importing any pages.")
            (progn
              (setq confirmedPages
                (if *p2dwg-batch-mode*
                  *p2dwg-batch-expected-pages*
                  (getint
                    (strcat
                      "\\nThis runner expects ${pageCount} pages. Confirm the selected PDF page count: "
                    )
                  )
                )
              )
              (if (or (null confirmedPages) (/= confirmedPages ${pageCount}))
                (prompt "\\nPage count did not match. No DWGs were created.")
                (progn
                  (initget 6)
                  (setq scaleFactor
                    (if *p2dwg-batch-mode*
                      *p2dwg-batch-scale*
                      (getreal
                        "\\nPDF import scale factor <1.0; verify against a known dimension>: "
                      )
                    )
                  )
                  (if (null scaleFactor) (setq scaleFactor 1.0))
                  (if (<= scaleFactor 0.0)
                    (prompt "\\nScale must be greater than zero. No DWGs were created.")
                    (progn
                      (setq outputDirectory (vl-filename-directory outputChoice))
                      (if (null outputDirectory)
                        (setq outputDirectory (getvar "DWGPREFIX"))
                      )
                      (setq outputBase (vl-filename-base outputChoice))
                      (setq acad (vlax-get-acad-object))
                      (setq documents (vla-get-Documents acad))
                      (setq page 1)
                      (setq existingPath nil)
                      (if existingPath
                        (progn
                          (prompt
                            (strcat
                              "\\nOutput already exists: "
                              existingPath
                              ". No DWGs were overwritten; choose another base name and run again."
                            )
                          )
                          (if *p2dwg-batch-mode* (setq *p2dwg-batch-stop* T))
                        )
                        (progn
                          (setq page 1)
                          (setq keepGoing T)
                          (setvar "FILEDIA" 0)
                          (setvar "CMDECHO" 0)
                       (setq *p2dwg-batch-directory* (vl-filename-directory pdfPath))
                       (setq *p2dwg-source-alias*
                        (strcat "SOURCE_${String(documentNumber).padStart(2, '0')}.pdf")
                      )
                        (setq *p2dwg-scale-status* "UNVERIFIED")
                        (setq *p2dwg-pipe-sequence* 0)
                          (while (and (<= page ${pageCount}) keepGoing)
                            (setq outputPath
                              (strcat
                                outputDirectory "\\\\"
                                outputBase "_page-"
                                (${helperPrefix}-pad-page page)
                                ".dwg"
                              )
                            )
                            (if (findfile outputPath)
                              (progn
                                (prompt
                                  (strcat "\\nAlready saved; skipping page " (itoa page) ": " outputPath)
                                )
                                (${helperPrefix}-batch-log
                                  (strcat
                                    "SKIPPED_EXISTING|SOURCE_${String(documentNumber).padStart(2, '0')}.pdf|"
                                    (itoa page)
                                    "|"
                                    outputPath
                                  )
                                )
                                (setq page (1+ page))
                              )
                              (progn
                            (setq currentDoc (vla-Add documents templatePath))
                            (vla-Activate currentDoc)
                            (${helperPrefix}-apply-approved-cad-standards)
                            (setq *p2dwg-source-page* page)
                            (prompt
                              (strcat
                                "\\nImporting PDF page "
                                (itoa page)
                                " of ${pageCount}..."
                              )
                            )
                            (setq beforeEntity (entlast))
                            (command
                              "_.-PDFIMPORT"
                              "_File"
                              pdfPath
                              (itoa page)
                              "_non"
                              "0,0"
                              scaleFactor
                              "0"
                            )
                            (setq importedEntities
                              (${helperPrefix}-collect-imported-entities beforeEntity)
                            )
                            (if (null importedEntities)
                              (error
                                (strcat
                                  "PDFIMPORT produced no usable drawing entities on page "
                                  (itoa page)
                                  ". The blank page was discarded instead of saved."
                                )
                              )
                            )
                            (${helperPrefix}-calibrate-import importedEntities)
                            (${helperPrefix}-stamp-page importedEntities)
                            (command "_.ZOOM" "_Extents")
                            (prompt
                              "\\nSelect company/client names, logos, and descriptions from the imported page, then press Enter. Also check drawing properties before confirming."
                            )
                            (setq redactions (ssget))
                            (if redactions
                              (command "_.ERASE" redactions "")
                            )
                            (initget "Yes No")
                            (setq scrubAnswer
                              (getkword
                                "\\nConfirm this page was checked and confidential company/client details removed? [Yes/No] <No>: "
                              )
                            )
                            (if (/= (strcase (if scrubAnswer scrubAnswer "No")) "YES")
                              (progn
                                (vla-Close currentDoc :vlax-false)
                                (setq currentDoc nil)
                                (setq keepGoing nil)
                                (prompt "\\nPage not saved. Batch stopped because confidentiality was not confirmed.")
                              )
                              (progn
                                (setq pipeConfirmed
                                  (${helperPrefix}-tag-pipe-runs importedEntities)
                                )
                                (setq reviewConfirmed
                                  (if pipeConfirmed
                                    (${helperPrefix}-review-unsupported)
                                    nil
                                  )
                                )
                                (if reviewConfirmed
                                  (progn
                                    (setq outputPath
                                      (strcat
                                        outputDirectory
                                        "\\\\"
                                        outputBase
                                        "_page-"
                                        (${helperPrefix}-pad-page page)
                                        ".dwg"
                                      )
                                    )
                                    (vla-SaveAs currentDoc outputPath)
                                    (vla-Close currentDoc :vlax-false)
                                    (setq currentDoc nil)
                                    (prompt (strcat "\\nSaved native DWG: " outputPath))
                                    (${helperPrefix}-batch-log
                                      (strcat
                                        "SAVED|SOURCE_${String(documentNumber).padStart(2, '0')}.pdf|"
                                        (itoa page)
                                        "|"
                                        outputPath
                                        "|SCALE="
                                        *p2dwg-scale-status*
                                        "|"
                                        (rtos *p2dwg-effective-scale* 2 8)
                                      )
                                    )
                                    (setq page (1+ page))
                                  )
                                  (progn
                                    (vla-Close currentDoc :vlax-false)
                                    (setq currentDoc nil)
                                    (setq keepGoing nil)
                                    (prompt
                                      "\\nPage not saved. Review was not confirmed; previously saved pages remain unchanged."
                                    )
                                  )
                                )
                              )
                            )
                          )
                          (setvar "FILEDIA" oldFileDia)
                          (setvar "CMDECHO" oldCmdEcho)
                          (if keepGoing
                            (prompt
                              (strcat
                                 "\\nPage batch finished. Reopen and review every output file before use."
                              )
                            )
                            (prompt
                              (strcat
                                "\\nBatch stopped at page "
                                (itoa page)
                                ". DWGs saved before this page remain in the output folder."
                              )
                            )
                          )
                          (if (and *p2dwg-batch-mode* (not keepGoing))
                            (setq *p2dwg-batch-stop* T)
                          )
                              )
                            )
                        )
                      )
                    )
                  )
                )
              )
            )
          )
        )
      )
    )
  )
  (princ)
)

(princ "\\nLoaded ${commandName}. Run ${commandName} to create native DWGs locally.")
(princ)
`;
}

function batchRunner(jobs: PdfPageJob[]): string {
  const documentCount = jobs.length;
  const pageCounts = jobs.map((job) => job.pageCount);
  const pageCountsLisp = `(${pageCounts.join(' ')})`;
  return `; Batch companion for AutoCAD for Windows. All selected PDFs run from one command.
; Copyright (c) 2026 gaurav.cbiindia.
(vl-load-com)

(defun c:PDF2DWGBATCH (/ firstPdf batchDirectory templatePath outputChoice
                        outputDirectory outputBase scaleFactor documentNumber
                        documentToken sourcePath scriptPath commandName logHandle)
  (setq firstPdf (getfiled "Select SOURCE_01.pdf from the extracted batch folder" "" "pdf" 0))
  (if firstPdf
    (progn
      (setq batchDirectory (vl-filename-directory firstPdf))
      (setq templatePath (findfile "acadiso.dwt"))
      (if (null templatePath) (setq templatePath (findfile "acad.dwt")))
      (setq templatePath
        (getfiled
          "Select a blank DWT template (acadiso.dwt is a metric test template)"
          (if templatePath templatePath "")
          "dwt"
          0
        )
      )
      (if templatePath
        (progn
          (setq outputChoice
            (getfiled "Choose a neutral output folder and base name" (strcat (getvar "DWGPREFIX") "drawing-batch.dwg") "dwg" 1)
          )
          (if outputChoice
            (progn
              (initget 6)
               (setq scaleFactor (getreal "\\nInitial PDF import scale factor <1.0; you can calibrate from a known dimension on each PDF>: "))
              (if (null scaleFactor) (setq scaleFactor 1.0))
              (setq outputDirectory (vl-filename-directory outputChoice))
              (setq outputBase (vl-filename-base outputChoice))
              (setq *p2dwg-batch-mode* T)
              (setq *p2dwg-batch-stop* nil)
              (setq *p2dwg-batch-template-path* templatePath)
              (setq *p2dwg-batch-scale* scaleFactor)
              (setq *p2dwg-batch-log-path* (strcat outputDirectory "\\\\AUTOCAD_BATCH_PROGRESS.log"))
              (setq logHandle (open *p2dwg-batch-log-path* "a"))
              (if logHandle
                (progn
                  (write-line "BATCH_STARTED" logHandle)
                  (close logHandle)
                )
              )
              (setq documentNumber 1)
              (while (and (<= documentNumber ${documentCount}) (not *p2dwg-batch-stop*))
                (setq documentToken (if (< documentNumber 10)
                  (strcat "0" (itoa documentNumber))
                  (itoa documentNumber)
                ))
                (setq sourcePath
                  (strcat batchDirectory "\\\\SOURCE_" documentToken ".pdf")
                )
                (setq scriptPath
                  (strcat batchDirectory "\\\\DOC_" documentToken ".lsp")
                )
                (if (and (findfile sourcePath) (findfile scriptPath))
                  (progn
                    (setq *p2dwg-batch-pdf-path* sourcePath)
                    (setq *p2dwg-batch-output-choice*
                      (strcat outputDirectory "\\\\" outputBase "_doc-" documentToken ".dwg")
                    )
                    (setq *p2dwg-batch-expected-pages*
                      (nth (1- documentNumber) '${pageCountsLisp})
                    )
                    (setq *p2dwg-batch-stop* nil)
                    (setq logHandle (open *p2dwg-batch-log-path* "a"))
                    (if logHandle
                      (progn
                        (write-line (strcat "DOCUMENT_STARTED|SOURCE_" documentToken ".pdf") logHandle)
                        (close logHandle)
                      )
                    )
                    (prompt
                      (strcat "\\nBatch document " (itoa documentNumber) " of ${documentCount}...")
                    )
                    (load scriptPath)
                    (setq commandName (strcat "C:PDF2DWG" documentToken))
                    (eval (list (read commandName)))
                  )
                  (progn
                    (prompt (strcat "\\nMissing batch input or helper: " sourcePath))
                    (setq *p2dwg-batch-stop* T)
                  )
                )
                (setq documentNumber (1+ documentNumber))
              )
              (setq logHandle (open *p2dwg-batch-log-path* "a"))
              (if logHandle
                (progn
                  (write-line (if *p2dwg-batch-stop* "BATCH_STOPPED" "BATCH_FINISHED") logHandle)
                  (close logHandle)
                )
              )
              (setq *p2dwg-batch-mode* nil)
              (prompt
                (if *p2dwg-batch-stop*
                  "\\nBatch stopped. See AUTOCAD_BATCH_PROGRESS.log; do not overwrite issued DWGs."
                  "\\nBatch finished. Review the progress log, then close and reopen every DWG."
                )
              )
            )
        (prompt "\\nNo output DWG name selected. Batch canceled.")
      )
          )
        (prompt "\\nNo DWT selected. Batch canceled; no DWGs were created.")
        )
      )
    )
  (princ)
)

(princ "\\nLoaded PDF2DWGBATCH. Run PDF2DWGBATCH once to process all queued PDFs.")
(princ)
`;
}

function readme(jobs: PdfPageJob[]): string {
  const pageSummary = jobs
    .map((job, index) => `- PDF ${index + 1} (${job.discipline}): ${job.pageCount} page(s) -> ${job.pageCount} native DWG file(s)`)
    .join('\n');
  return `LOCAL AUTOCAD PDF-TO-DWG RUNNER
=================================

This package contains the selected source PDFs and AutoLISP helpers. It does
not contain pre-generated DWG files. The ZIP is prepared in your browser and
is not uploaded to the app. Keep it private because it contains source PDFs.

${pageSummary}

REQUIREMENTS
- Windows desktop AutoCAD with AutoLISP, ActiveX, and the -PDFIMPORT command.
- An approved blank DWT template available on the same workstation.

RUN
1. Extract this package on the Windows workstation that has AutoCAD.
2. Start AutoCAD, run APPLOAD, and load RUN_BATCH.lsp.
3. Run PDF2DWGBATCH once. Select SOURCE_01.pdf to locate the extracted batch,
   an approved blank DWT, a neutral output name, and an initial import scale.
4. The companion processes the queued PDFs sequentially and creates one DWG
   per page. Each page asks about scale calibration, confidential-detail
   review, optional Pipe Run tagging, and unsupported equipment; keep AutoCAD
   open until the batch finishes.
5. Check AUTOCAD_BATCH_PROGRESS.log in the output folder for saved pages and
   whether the batch finished or stopped.
6. Close and reopen each DWG. Check linework, tags, scale, markups, and missing
   or shifted objects before treating it as reviewed. For any manually placed
   Legends Library fallback, confirm Properties shows Type = Block Reference
   and Layer = the approved target layer; do not explode it during this check.
   Confirm no company/client identity remains in the file or its filename.

PRIVACY AND LIMITS
- The web page reads the PDF locally to count pages and places its bytes in
  this local ZIP under a generic filename. It does not upload the PDF to a
  server.
- Every PDF-imported entity in a generated page drawing receives PIDPAGE XData with the
  generic source alias and page number. PIDREVIEW XData records the review item
  ID, category, selected block, and whether an entity is a fallback or cloud.
- AutoCAD imports the selected source PDF and writes native DWGs locally.
- The browser cannot confirm that AutoCAD opened, saved, or reopened a DWG.
- PDF text, raster content, and review markups may import differently. Inspect
  every output; scanned pages may not become editable vector geometry.
- Confidential-detail removal is manual. The runner asks for a page-by-page
  confirmation, but cannot detect hidden metadata or nested logos. Inspect the
  visible drawing and drawing properties before confirming.
- For each page, manually select unsupported equipment to add a red scalloped
  revision cloud. The runner offers only reviewed symbol mappings matching the
  selected PFD/P&ID discipline and project. It imports an individually exported,
  neutrally named block drawing; it does not package original source DWGs. If
  no approved block is available, the source geometry is retained and clouded.
- Reviewed layers are created or updated to their approved color, lineweight,
  and linetype. Reviewed text
  styles are added when their font is installed. PDF-imported geometry remains
  on its PDF-imported layers unless a reviewer explicitly tags a Pipe Run.
  Before saving each page, the runner offers to calibrate its scale using a
  known dimension in millimetres and two snapped points. If skipped, page XData
  and the progress log say UNVERIFIED; scale must then be checked manually.
  Calibration applies to imported geometry about 0,0,0. Each page is checked
  independently; the last effective scale is the next page's starting point.
  Drawings use metric insertion units and approved reviewed linetype patterns.
  Simple dash/gap patterns and shape-based SHX segments are preserved. A missing
  SHX font or unsupported pattern stops the run rather than dropping its marks
  or silently substituting Continuous.
- The optional Pipe Run step is manual: select only 2D PDF-imported LINE,
  LWPOLYLINE, POLYLINE, or ARC segments for one run, choose a reviewed
  non-zero Legends Library layer, and enter the run tag. The runner applies
  that layer with BYLAYER linetype and adds PIDPIPE XData with one StableID to
  every selected segment. It does not infer line routes and does not create
  native Plant 3D intelligence or an automatic EDE row.
- An approved valve mapping must contain a reviewed block-local body outline.
  The runner creates a polygonal AutoCAD WIPEOUT from that outline, then brings
  the valve block in front of it. Missing/invalid outlines stop packaging or
  preserve the source geometry; no bounding-box mask is guessed.
- To replace selected source geometry with an available fallback, explicitly
  choose Replace. Otherwise the source stays and the fallback is marked
  provisional. Outputs already on disk are never overwritten; use a new base
  name to create a new issue or trial.
- The runner does not automatically detect unmatched symbols. A person must
  identify each item, enter its category, and choose among approved mappings
  for that category. Retained geometry and cloud marks carry page and review
  XData for later manual replacement.
- Existing output files are never overwritten. When rerunning with the same
  neutral output base, completed page DWGs are skipped and only missing pages
  are processed. The local progress log records saved and skipped pages.
- This helper uses AutoCAD for Windows. Native DWG generation is not performed
  by the web page itself.
`;
}

export function buildAutoCadDwgRunnerPackage(
  jobs: PdfPageJob[],
  approvedSymbols: ApprovedRunnerSymbol[] = [],
  blockAssets: RunnerBlockAsset[] = [],
  approvedStandards: ApprovedRunnerStandard[] = [],
): Blob {
  if (jobs.length === 0 || jobs.some((job) =>
    !Number.isInteger(job.pageCount) ||
    job.pageCount < 1 ||
    !['PFD', 'P&ID'].includes(job.discipline) ||
    !(job.pdfBytes instanceof Uint8Array) ||
    job.pdfBytes.length === 0
  )) {
    throw new Error('Add at least one readable PDF before preparing an AutoCAD runner.');
  }

  for (const symbol of approvedSymbols) {
    if (symbol.fallbackCategory.trim().toLowerCase() !== 'valve') continue;
    if (!symbol.wipeoutBoundary) {
      throw new Error(
        `Valve "${symbol.blockName}" has no reviewed body mask outline. Re-review the valve in the Legends Library before preparing the AutoCAD runner.`,
      );
    }
    try {
      parseValveMaskBoundary(
        symbol.wipeoutBoundary.map(([x, y]) => `${x},${y}`).join(';'),
      );
    } catch (error) {
      throw new Error(
        `Valve "${symbol.blockName}" has an invalid reviewed body mask outline. ${
          error instanceof Error ? error.message : 'Re-review the valve mask.'
        }`,
      );
    }
  }

  const sourceIds = new Set(blockAssets.map((source) => source.id));
  const symbolsByJob = jobs.map((job) => approvedSymbols.filter((symbol) =>
    (symbol.discipline === job.discipline || symbol.discipline === 'Shared') &&
    (symbol.projectId ? symbol.projectId === job.projectId : true),
  ));
  const usedSymbols = [...new Map(symbolsByJob.flat().map((symbol) => [
    `${symbol.blockAssetId}|${symbol.blockName}|${symbol.fallbackCategory}`,
    symbol,
  ])).values()];
  if (usedSymbols.some((symbol) => !sourceIds.has(symbol.blockAssetId))) {
    throw new Error('An approved symbol refers to a missing locally extracted block drawing.');
  }
  if (usedSymbols.some((symbol) => !symbol.targetLayer.trim() || symbol.targetLayer.trim().toUpperCase() === '0')) {
    throw new Error('Every approved block needs an approved non-zero target CAD layer before the AutoCAD runner can be prepared.');
  }
  const sourcePathById = new Map<string, string>();
  const usedSourceIds = [...new Set(usedSymbols.map((symbol) => symbol.blockAssetId))];
  usedSourceIds.forEach((id, index) => sourcePathById.set(id, `CAD_SYMBOLS/SYMBOL_${String(index + 1).padStart(3, '0')}.dwg`));

  const files: ZipFile[] = [
    {
      path: 'RUN_BATCH.lsp',
      content: new TextEncoder().encode(batchRunner(jobs)),
    },
    ...blockAssets
      .filter((source) => usedSourceIds.includes(source.id))
      .map((source) => ({
        path: sourcePathById.get(source.id) as string,
        content: source.content,
      })),
    ...jobs.flatMap((job, index) => {
    const number = String(index + 1).padStart(2, '0');
    const jobSymbols = approvedSymbols
      .filter((symbol) => (symbol.discipline === job.discipline || symbol.discipline === 'Shared') &&
        (symbol.projectId ? symbol.projectId === job.projectId : true) &&
        (symbol.blockAssetId && sourcePathById.has(symbol.blockAssetId)))
      .map((symbol) => {
        const sourcePath = sourcePathById.get(symbol.blockAssetId) as string;
        const neutralName = sourcePath.split('/').at(-1)?.replace(/\.dwg$/i, '') ?? 'APPROVED_SYMBOL';
        return { ...symbol, blockName: neutralName, sourcePath };
      });
    const applicableStandards = approvedStandards.filter((standard) =>
      (standard.discipline === job.discipline || standard.discipline === 'Shared') &&
      (standard.projectId ? standard.projectId === job.projectId : true),
    );
    const jobStandards = [...new Map(applicableStandards.map((standard) => [
      `${standard.category}:${standard.name.toLowerCase()}`,
      standard,
    ])).values()];
    const missingLayer = jobSymbols.find((symbol) => !jobStandards.some((standard) =>
      standard.category === 'layer' &&
      standard.name.toLowerCase() === symbol.targetLayer.toLowerCase(),
    ));
    if (missingLayer) {
      throw new Error(`Approved CAD layer "${missingLayer.targetLayer}" is not included in this runner page's approved standards.`);
    }
    return [
      {
        path: `DOC_${number}.lsp`,
        content: new TextEncoder().encode(pageRunner(index + 1, job.pageCount, jobSymbols, jobStandards)),
      },
      {
        path: `SOURCE_${number}.pdf`,
        content: job.pdfBytes,
      },
    ];
    }),
  ];
  files.push({
    path: 'README_LOCAL_AUTOCAD.txt',
    content: new TextEncoder().encode(readme(jobs)),
  });

  return createStoredZip(files);
}

export type RunnerBlockAsset = {
  id: string;
  content: Uint8Array;
};

export type ApprovedRunnerStandard = {
  name: string;
  category: 'layer' | 'textStyle' | 'linetype';
  detail: string;
  discipline: 'PFD' | 'P&ID' | 'Shared';
  projectId?: string;
};

type ParsedLinetypeSegment = {
  length: number;
  flags: 0;
} | {
  length: number;
  flags: 4;
  shapeNumber: number;
  styleName: string;
  shapeFile: string;
  scale: number;
  rotation: number;
  offsetX: number;
  offsetY: number;
};

type ParsedLinetypeDefinition = {
  patternLength: number;
  segments: ParsedLinetypeSegment[];
};

function parseDetailList(detail: string, key: string): string[] | null {
  const match = detail.match(new RegExp(`(?:^|;)${key}=\\(([^)]*)\\)`, 'i'));
  if (!match) return null;
  const values = match[1].trim();
  if (!values || /^nil$/i.test(values)) return [];
  return values.split(/[\s,]+/);
}

type LispPair = { code: number; value: string };

function parseLispPairs(detail: string, key: string): LispPair[] | null {
  const match = detail.match(new RegExp(`(?:^|;)${key}=(.*?)(?=;[A-Za-z][A-Za-z0-9_]*=|$)`, 'i'));
  if (!match) return null;
  const pairs: LispPair[] = [];
  const expression = /\(\s*(\d+)\s*\.\s*(?:"((?:\\.|[^"])*)"|([^\s)]+))\s*\)/g;
  let pairMatch: RegExpExecArray | null;
  while ((pairMatch = expression.exec(match[1])) !== null) {
    const value = pairMatch[2] === undefined
      ? pairMatch[3]
      : pairMatch[2].replaceAll('\\"', '"').replaceAll('\\\\', '\\');
    pairs.push({ code: Number(pairMatch[1]), value });
  }
  return pairs;
}

function linetypeShapeStyleName(linetypeName: string): string {
  let hash = 0;
  for (const character of linetypeName.toUpperCase()) {
    hash = (hash * 31 + character.charCodeAt(0)) >>> 0;
  }
  const safeName = linetypeName.toUpperCase().replace(/[^A-Z0-9_-]/g, '_').slice(0, 16) || 'SHAPE';
  return `P2DWG_${safeName}_${hash.toString(36).toUpperCase()}`;
}

export function parseLinetypeDefinition(
  linetypeName: string,
  detail: string,
): ParsedLinetypeDefinition | null {
  const rawPattern = parseDetailList(detail, 'pattern');
  const rawFlags = parseDetailList(detail, 'patternFlags') ?? [];
  if (!rawPattern?.length || (rawFlags.length > 0 && rawFlags.length !== rawPattern.length)) return null;
  const pattern = rawPattern.map(Number);
  const flags = rawFlags.map(Number);
  if (
    pattern.some((length) => !Number.isFinite(length)) ||
    pattern.every((length) => length === 0) ||
    pattern.reduce((sum, length) => sum + Math.abs(length), 0) <= 0 ||
    flags.some((flag) => !Number.isInteger(flag))
  ) return null;

  const complexData = parseLispPairs(detail, 'complexData');
  // Extractor serializes shape-font handle/file mappings as dotted pairs:
  // (("HANDLE" . "font.shx") ...). Parse them separately from DXF code/value pairs.
  const shapeFontByHandle = new Map<string, string>();
  const shapeFontExpression = /\(\s*"((?:\\.|[^"])*)"\s*\.\s*"((?:\\.|[^"])*)"\s*\)/g;
  const shapeFontMatch = detail.match(/(?:^|;)shapeFonts=(.*)$/i);
  let fontMatch: RegExpExecArray | null;
  if (shapeFontMatch) {
    while ((fontMatch = shapeFontExpression.exec(shapeFontMatch[1])) !== null) {
      shapeFontByHandle.set(
        fontMatch[1].replaceAll('\\"', '"').toUpperCase(),
        fontMatch[2].replaceAll('\\"', '"'),
      );
    }
  }

  const segments: ParsedLinetypeSegment[] = [];
  let cursor = 0;
  for (let index = 0; index < pattern.length; index += 1) {
    const declaredFlag = flags[index] ?? 0;
    let patternIndex = complexData?.findIndex((pair, pairIndex) =>
      pairIndex >= cursor && pair.code === 49) ?? -1;
    if (patternIndex < 0 || !complexData) {
      if (declaredFlag !== 0) return null;
      segments.push({ length: pattern[index], flags: 0 });
      continue;
    }
    const patternTag = complexData[patternIndex];
    if (Math.abs(Number(patternTag.value) - pattern[index]) > 1e-8) return null;
    const flagTag = complexData[patternIndex + 1];
    if (!flagTag || flagTag.code !== 74) return null;
    const actualFlag = Number(flagTag.value);
    if (!Number.isInteger(actualFlag) || actualFlag !== declaredFlag) return null;
    cursor = patternIndex + 2;

    if (actualFlag === 0) {
      segments.push({ length: pattern[index], flags: 0 });
      continue;
    }
    if (actualFlag !== 4) return null;

    const takeProperty = (code: number): string | null => {
      while (cursor < complexData.length && complexData[cursor].code !== code &&
             complexData[cursor].code !== 49) cursor += 1;
      if (cursor >= complexData.length || complexData[cursor].code !== code) return null;
      const value = complexData[cursor].value;
      cursor += 1;
      return value;
    };
    const shapeNumber = Number(takeProperty(75));
    const styleHandle = takeProperty(340);
    const scale = Number(takeProperty(46));
    const rotation = Number(takeProperty(50));
    const offsetX = Number(takeProperty(44));
    const offsetY = Number(takeProperty(45));
    const shapeFile = styleHandle ? shapeFontByHandle.get(styleHandle.toUpperCase()) : undefined;
    if (
      !Number.isInteger(shapeNumber) || shapeNumber <= 0 || !styleHandle || !shapeFile ||
      !/^[a-z0-9_.-]+\.shx$/i.test(shapeFile) ||
      ![scale, rotation, offsetX, offsetY].every(Number.isFinite) ||
      scale <= 0
    ) return null;
    segments.push({
      length: pattern[index],
      flags: 4,
      shapeNumber,
      styleName: linetypeShapeStyleName(linetypeName),
      shapeFile,
      scale,
      rotation,
      offsetX,
      offsetY,
    });
  }

  const calculatedLength = pattern.reduce((sum, length) => sum + Math.abs(length), 0);
  const declaredLengthRaw = detail.match(/(?:^|;)patternLength=([^;]+)/i)?.[1];
  const declaredLength = declaredLengthRaw === undefined ? calculatedLength : Number(declaredLengthRaw);
  if (
    !Number.isFinite(declaredLength) || declaredLength <= 0 ||
    Math.abs(declaredLength - calculatedLength) > Math.max(1e-7, calculatedLength * 1e-7)
  ) return null;
  return { patternLength: declaredLength, segments };
}

export function parseLinetypePattern(detail: string): number[] | null {
  const rawPattern = parseDetailList(detail, 'pattern');
  const flags = parseDetailList(detail, 'patternFlags') ?? [];
  if (!rawPattern?.length ||
      (flags.length > 0 && flags.some((flag) => Number(flag) !== 0))) return null;
  const pattern = rawPattern.map(Number);
  if (pattern.some((length) => !Number.isFinite(length)) ||
      pattern.every((length) => length === 0) ||
      pattern.reduce((sum, length) => sum + Math.abs(length), 0) <= 0) return null;
  if (flags.length > 0 && flags.length !== pattern.length) return null;
  return pattern;
}

function validateApprovedLayerLinetypes(standards: ApprovedRunnerStandard[]): void {
  const builtIn = new Set(['CONTINUOUS', 'BYLAYER', 'BYBLOCK']);
  const definitions = new Map(standards
    .filter((standard) => standard.category === 'linetype')
    .map((standard) => [standard.name.trim().toUpperCase(), standard]));
  for (const layer of standards.filter((standard) => standard.category === 'layer')) {
    const linetype = layer.detail.match(/(?:^|;)linetype=([^;]+)/i)?.[1]?.trim();
    if (!linetype || builtIn.has(linetype.toUpperCase())) continue;
    const definition = definitions.get(linetype.toUpperCase());
    if (!definition || !parseLinetypeDefinition(definition.name, definition.detail)) {
      throw new Error(
        `Layer "${layer.name}" requires linetype "${linetype}", but its complete supported definition is not approved. ` +
        'Review/re-extract that linetype first; the runner will not silently substitute Continuous.',
      );
    }
  }
}

function lispString(value: string): string {
  return `"${value.replaceAll('\\', '\\\\').replaceAll('"', '\\"')}"`;
}
