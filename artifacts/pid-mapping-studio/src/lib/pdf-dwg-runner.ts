import { createStoredZip, type ZipFile } from '@/lib/zip-binary';

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
  discipline: 'PFD' | 'P&ID' | 'Shared';
  sourceId: string;
  projectId?: string;
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
    `(${lispString(symbol.fallbackCategory.toLowerCase())} ${lispString(symbol.blockName)} ${lispString(symbol.sourcePath)})`,
  ).join('\n    ');
  const layerList = standards
    .filter((standard) => standard.category === 'layer')
    .map((standard) => {
      const color = Number(standard.detail.match(/(?:^|;)color=(\d+)/i)?.[1] ?? 7);
      const linetype = standard.detail.match(/(?:^|;)linetype=([^;]+)/i)?.[1] ?? 'CONTINUOUS';
      return `(${lispString(standard.name)} ${Number.isInteger(color) && color > 0 && color <= 255 ? color : 7} ${lispString(linetype)})`;
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

(defun ${helperPrefix}-pad-page (value / text)
  (setq text (itoa value))
  (while (< (strlen text) 3)
    (setq text (strcat "0" text))
  )
  text
)

(defun ${helperPrefix}-ensure-layer (name color weight linetype)
  (if (or (= (strcase linetype) "BYLAYER") (= (strcase linetype) "BYBLOCK"))
    (setq linetype "CONTINUOUS")
  )
  (if (not (tblsearch "LTYPE" linetype))
    (progn
      (prompt (strcat "\\nApproved linetype " linetype " is not loaded; using CONTINUOUS for layer " name "."))
      (setq linetype "CONTINUOUS")
    )
  )
  (if (not (tblsearch "LAYER" name))
    (entmake
      (list
        '(0 . "LAYER")
        '(100 . "AcDbSymbolTableRecord")
        '(100 . "AcDbLayerTableRecord")
        (cons 2 name)
        '(70 . 0)
        (cons 62 color)
        (cons 6 (if (tblsearch "LTYPE" linetype) linetype "CONTINUOUS"))
        (cons 370 weight)
      )
    )
  )
)

(defun ${helperPrefix}-apply-approved-cad-standards (/ entry name color linetype style)
  (foreach entry *p2dwg-approved-layers*
    (${helperPrefix}-ensure-layer (car entry) (cadr entry) 25 (caddr entry))
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
              )
            )
          )
        )
      )
      (entupd entity)
    )
  )
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

(defun ${helperPrefix}-stamp-page (/ selection index entity)
  (setq selection (ssget "_X" (list (cons 410 (getvar "CTAB")))))
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

(defun ${helperPrefix}-choose-approved-symbol (category / options index choice)
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
        (prompt (strcat "\\n  " (itoa index) ") " (cadr choice)))
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
                                            selection-index category block-name
                                            center fallback replace-answer item
                                            choice source-path insert-result prior-entity)
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
                        (setq prior-entity (entlast))
                        (if (findfile source-path)
                          (progn
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
                              (setq fallback (entlast))
                              (prompt
                                "\\nCould not import the approved source block. Source geometry will be preserved and clouded."
                              )
                            )
                          )
                          (prompt
                            "\\nThe approved block drawing is missing from the runner folder. Source geometry will be preserved and clouded."
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
                             reviewConfirmed)
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
                            (${helperPrefix}-stamp-page)
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
                                (setq reviewConfirmed (${helperPrefix}-review-unsupported))
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
              (setq scaleFactor (getreal "\\nPDF import scale factor <1.0; verify against a known dimension>: "))
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
   an approved blank DWT, a neutral output name, and a scale to verify.
4. The companion processes the queued PDFs sequentially and creates one DWG
   per page. It pauses for the required confidentiality and equipment review
   on each page; keep AutoCAD open until the batch finishes.
5. Check AUTOCAD_BATCH_PROGRESS.log in the output folder for saved pages and
   whether the batch finished or stopped.
6. Close and reopen each DWG. Check linework, tags, scale, markups, and missing
   or shifted objects before treating it as reviewed. Inspect DWG properties and
   confirm no company/client identity remains in the file or its filename.

PRIVACY AND LIMITS
- The web page reads the PDF locally to count pages and places its bytes in
  this local ZIP under a generic filename. It does not upload the PDF to a
  server.
- Every entity in a generated page drawing receives PIDPAGE XData with the
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
- Reviewed layers are added to the new drawing when missing. Reviewed text
  styles are added when their font is installed. PDF-imported geometry is not
  automatically reassigned to those layers/styles. Extracted linetype and
  dimension-style values remain available for review; custom linetypes not
  already loaded are reported and use CONTINUOUS for the added layer.
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
    const jobStandards = approvedStandards.filter((standard) =>
      (standard.discipline === job.discipline || standard.discipline === 'Shared') &&
      (standard.projectId ? standard.projectId === job.projectId : true),
    );
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
  category: 'layer' | 'textStyle';
  detail: string;
  discipline: 'PFD' | 'P&ID' | 'Shared';
  projectId?: string;
};

function lispString(value: string): string {
  return `"${value.replaceAll('\\', '\\\\').replaceAll('"', '\\"')}"`;
}
