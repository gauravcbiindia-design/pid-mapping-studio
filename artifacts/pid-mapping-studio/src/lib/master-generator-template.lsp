; P&ID Mapping Studio - reusable local AutoLISP drawing generator
; Copyright (c) 2026 gaurav.cbiindia.
; Loads pid_mapping_data.lsp first. It expects *PID-MAPPING* to contain a
; versioned mapping document prepared from JSON by the browser-side adapter.
; This code has not been run in AutoCAD.

(vl-load-com)

(defun pid-get (key row fallback / pair)
  (setq pair (assoc key row))
  (if pair (cdr pair) fallback)
)

(defun pid-find-by-id (id rows / result)
  (if rows
    (if (= (pid-get "id" (car rows) "") id)
      (car rows)
      (pid-find-by-id id (cdr rows))
    )
  )
)

(defun pid-layer-name (layer-id / layer)
  (setq layer (pid-find-by-id layer-id (pid-get "layers" *PID-MAPPING* nil)))
  (if layer
    (pid-get "name" layer "0")
    "0"
  )
)

(defun pid-ensure-layer (layer / name existing)
  (setq name (pid-get "name" layer "DEMO-UNRESOLVED"))
  (setq existing (tblsearch "LAYER" name))
  (if (not existing)
    (entmake
      (list
        '(0 . "LAYER")
        '(100 . "AcDbSymbolTableRecord")
        '(100 . "AcDbLayerTableRecord")
        (cons 2 name)
        '(70 . 0)
        (cons 62 (pid-get "aciColor" layer 7))
        (cons 6 (pid-get "linetype" layer "CONTINUOUS"))
        (cons 370 (pid-get "lineweight" layer 13))
      )
    )
  )
)

(defun pid-map-point
  (point geometry entity / drawing transform origin scale local-scale angle local-x local-y
    rotated-x rotated-y world-x world-y x y rotation)
  (setq drawing (pid-get "drawing" *PID-MAPPING* nil))
  (setq transform (pid-get "coordinateTransform" drawing nil))
  (setq origin (pid-get "origin" transform nil))
  (setq scale (pid-get "scale" transform 1.0))
  (setq local-scale (pid-get "scale" entity 1.0))
  (setq rotation (* pi (/ (pid-get "rotation" entity 0.0) 180.0)))
  (setq local-x (* (pid-get "x" point 0.0) local-scale))
  (setq local-y (* (pid-get "y" point 0.0) local-scale))
  (setq rotated-x (- (* local-x (cos rotation)) (* local-y (sin rotation))))
  (setq rotated-y (+ (* local-x (sin rotation)) (* local-y (cos rotation))))
  (setq world-x (+ (pid-get "x" geometry 0.0) rotated-x))
  (setq world-y (+ (pid-get "y" geometry 0.0) rotated-y))
  (setq x (+ (* world-x scale) (pid-get "x" origin 0.0)))
  (setq y
    (if (= (pid-get "yAxis" transform "up") "down")
      (- (pid-get "y" origin 0.0) (* world-y scale))
      (+ (* world-y scale) (pid-get "y" origin 0.0))
    )
  )
  (list x y 0.0)
)

(defun pid-block-line (start-point end-point)
  (entmake
    (list
      '(0 . "LINE")
      '(8 . "0")
      (cons 10 start-point)
      (cons 11 end-point)
    )
  )
)

(defun pid-define-blocks (/ block-name)
  (if (not (tblsearch "BLOCK" "DEMO_PUMP"))
    (progn
      (setq block-name "DEMO_PUMP")
      (entmake
        (list '(0 . "BLOCK") (cons 2 block-name) '(70 . 0)
          '(10 0.0 0.0 0.0) (cons 3 block-name) (cons 1 ""))
      )
      (entmake (list '(0 . "CIRCLE") '(8 . "0") '(10 0.0 0.0 0.0) '(40 . 25.0)))
      (entmake
        (list '(0 . "LWPOLYLINE") '(100 . "AcDbEntity") '(8 . "0")
          '(100 . "AcDbPolyline") '(90 . 3) '(70 . 1)
          '(10 -15.0 -16.0) '(10 14.0 0.0) '(10 -15.0 16.0))
      )
      (pid-block-line '(-31.0 -33.0 0.0) '(31.0 -33.0 0.0))
      (pid-block-line '(-23.0 -27.0 0.0) '(23.0 -27.0 0.0))
      (entmake '((0 . "ENDBLK") (8 . "0")))
    )
  )

  (if (not (tblsearch "BLOCK" "DEMO_VALVE"))
    (progn
      (setq block-name "DEMO_VALVE")
      (entmake
        (list '(0 . "BLOCK") (cons 2 block-name) '(70 . 0)
          '(10 0.0 0.0 0.0) (cons 3 block-name) (cons 1 ""))
      )
      (entmake
        (list '(0 . "LWPOLYLINE") '(100 . "AcDbEntity") '(8 . "0")
          '(100 . "AcDbPolyline") '(90 . 3) '(70 . 0)
          '(10 -28.0 -20.0) '(10 0.0 0.0) '(10 -28.0 20.0))
      )
      (entmake
        (list '(0 . "LWPOLYLINE") '(100 . "AcDbEntity") '(8 . "0")
          '(100 . "AcDbPolyline") '(90 . 3) '(70 . 0)
          '(10 28.0 -20.0) '(10 0.0 0.0) '(10 28.0 20.0))
      )
      (pid-block-line '(0.0 0.0 0.0) '(0.0 27.0 0.0))
      (pid-block-line '(-11.0 27.0 0.0) '(11.0 27.0 0.0))
      (entmake '((0 . "ENDBLK") (8 . "0")))
    )
  )

  (if (not (tblsearch "BLOCK" "DEMO_PI"))
    (progn
      (setq block-name "DEMO_PI")
      (entmake
        (list '(0 . "BLOCK") (cons 2 block-name) '(70 . 0)
          '(10 0.0 0.0 0.0) (cons 3 block-name) (cons 1 ""))
      )
      (entmake (list '(0 . "CIRCLE") '(8 . "0") '(10 0.0 0.0 0.0) '(40 . 23.0)))
      (pid-block-line '(-23.0 0.0 0.0) '(23.0 0.0 0.0))
      (entmake '((0 . "ENDBLK") (8 . "0")))
    )
  )
)

(defun pid-existing-id (target / selection index entity app-data found)
  (setq selection (ssget "_X" (list (list -3 (list "PIDMAP")))))
  (setq index 0)
  (setq found nil)
  (if selection
    (while (and (< index (sslength selection)) (not found))
      (setq entity (ssname selection index))
      (setq app-data (cadr (assoc -3 (entget entity '("PIDMAP")))))
      (if (= (cdr (assoc 1000 (cdr app-data))) target)
        (setq found entity)
      )
      (setq index (1+ index))
    )
  )
  found
)

(defun pid-id-attached-p (entity target / app-data)
  (setq app-data (cadr (assoc -3 (entget entity '("PIDMAP")))))
  (and app-data (= (cdr (assoc 1000 (cdr app-data))) target))
)

(defun pid-attach-id (entity target)
  (if (and entity (regapp "PIDMAP"))
    (progn
      (entmod
        (append
          (entget entity)
          (list (list -3 (list "PIDMAP" (cons 1000 target))))
        )
      )
      (entupd entity)
    )
  )
)

(defun pid-escape-csv (value / result code)
  (setq result "\"")
  (foreach code (vl-string->list (if value value ""))
    (cond
      ((= code 34) (setq result (strcat result "\"\"")))
      ((or (= code 9) (= code 10) (= code 13))
        (setq result (strcat result " ")))
      (t (setq result (strcat result (chr code))))
    )
  )
  (strcat result "\"")
)

(defun pid-write-report (id handle kind tag status / report)
  (setq report (open *PID-REPORT-PATH* "a"))
  (if report
    (progn
      (write-line
        (strcat
          (pid-escape-csv id) ","
          (pid-escape-csv handle) ","
          (pid-escape-csv kind) ","
          (pid-escape-csv tag) ","
          (pid-escape-csv status)
        )
        report
      )
      (close report)
    )
  )
)

(defun pid-make-polyline (entity / geometry points dxf-points point)
  (setq geometry (pid-get "geometry" entity nil))
  (setq points (pid-get "points" geometry nil))
  (setq dxf-points nil)
  (foreach point points
    (setq point (pid-map-point point geometry entity))
    (setq dxf-points
      (append dxf-points (list (cons 10 (list (car point) (cadr point)))))
    )
  )
  (if (> (length points) 1)
    (entmakex
      (append
        (list
          '(0 . "LWPOLYLINE")
          '(100 . "AcDbEntity")
          (cons 8 (pid-layer-name (pid-get "layerId" entity "")))
          '(100 . "AcDbPolyline")
          (cons 90 (length points))
          '(70 . 0)
        )
        dxf-points
      )
    )
  )
)

(defun pid-make-insert (entity / geometry position block-name scale rotation)
  (setq geometry (pid-get "geometry" entity nil))
  (setq position (pid-map-point nil geometry entity))
  (setq block-name (pid-get "blockName" entity ""))
  (setq scale (pid-get "scale" entity 1.0))
  (setq rotation (* pi (/ (pid-get "rotation" entity 0.0) 180.0)))
  (if (and
        (member block-name (list "DEMO_PUMP" "DEMO_VALVE" "DEMO_PI"))
        (tblsearch "BLOCK" block-name))
    (entmakex
      (list
        '(0 . "INSERT")
        '(100 . "AcDbEntity")
        (cons 8 (pid-layer-name (pid-get "layerId" entity "")))
        '(100 . "AcDbBlockReference")
        (cons 2 block-name)
        (cons 10 position)
        (cons 41 scale)
        (cons 42 scale)
        (cons 43 scale)
        (cons 50 rotation)
      )
    )
  )
)

(defun pid-make-text (entity / geometry position height scale rotation value)
  (setq geometry (pid-get "geometry" entity nil))
  (setq position (pid-map-point nil geometry entity))
  (setq scale (pid-get "scale" entity 1.0))
  (setq height (* (pid-get "height" geometry 18.0) scale
    (pid-get "scale" (pid-get "coordinateTransform"
      (pid-get "drawing" *PID-MAPPING* nil) nil) 1.0)))
  (setq rotation (* pi (/ (pid-get "rotation" entity 0.0) 180.0)))
  (setq value (pid-get "label" entity ""))
  (if (= value "") (setq value (pid-get "tag" entity "")))
  (if (= value "") (setq value "UNLABELLED"))
  (entmakex
    (list
      '(0 . "TEXT")
      '(100 . "AcDbEntity")
      (cons 8 (pid-layer-name (pid-get "layerId" entity "")))
      '(100 . "AcDbText")
      (cons 10 position)
      (cons 40 height)
      (cons 1 value)
      (cons 50 rotation)
      (cons 7 "Standard")
      '(72 . 1)
      '(73 . 2)
      (cons 11 position)
    )
  )
)

(defun pid-create-entity (entity / kind)
  (setq kind (pid-get "kind" entity ""))
  (cond
    ((= kind "line") (pid-make-polyline entity))
    ((= kind "label") (pid-make-text entity))
    ((member kind (list "equipment" "valve" "instrument"))
      (pid-make-insert entity))
    (t nil)
  )
)

(defun pid-generate-one (entity / id prior created handle status)
  (setq id (pid-get "id" entity ""))
  (setq prior (pid-existing-id id))
  (cond
    (prior
      (setq handle (cdr (assoc 5 (entget prior))))
      (pid-write-report id handle
        (pid-get "kind" entity "") (pid-get "tag" entity "")
        "SKIPPED_EXISTING_DO_NOT_DUPLICATE")
      'skipped
    )
    (t
      (setq created (pid-create-entity entity))
      (if created
        (progn
          (pid-attach-id created id)
          (if (pid-id-attached-p created id)
            (progn
              (setq handle (cdr (assoc 5 (entget created))))
              (pid-write-report id handle
                (pid-get "kind" entity "") (pid-get "tag" entity "")
                "CREATED_XDATA_READBACK_OK")
              'created
            )
            (progn
              (pid-write-report id ""
                (pid-get "kind" entity "") (pid-get "tag" entity "")
                "FAILED_XDATA_READBACK")
              'failed
            )
          )
        )
        (progn
          (pid-write-report id ""
            (pid-get "kind" entity "") (pid-get "tag" entity "")
            "FAILED_UNSUPPORTED_OR_INVALID")
          'failed
        )
      )
    )
  )
)

(defun c:PIDGEN (/ index entities result created skipped failed report layer)
  (if (not (and *PID-MAPPING* (pid-get "entities" *PID-MAPPING* nil)))
    (progn
      (alert "No mapping data found. Load pid_mapping_data.lsp before PIDGEN.")
      (princ)
    )
    (progn
      (setq *PID-PREVIOUS-ERROR* *error*)
      (setq *PID-OLD-CMDECHO* (getvar "CMDECHO"))
      (setq *PID-UNDO-OPEN* nil)
      (setq *PID-REPORT-PATH*
        (strcat (getvar "DWGPREFIX") "pid_generation_report.csv"))
      (defun *error* (message)
        (if *PID-UNDO-OPEN*
          (progn (command "_.UNDO" "_END") (setq *PID-UNDO-OPEN* nil))
        )
        (if *PID-OLD-CMDECHO* (setvar "CMDECHO" *PID-OLD-CMDECHO*))
        (setq *error* *PID-PREVIOUS-ERROR*)
        (if message (princ (strcat "\nPIDGEN stopped: " message)))
        (princ)
      )
      (setvar "CMDECHO" 0)
      (if (not (regapp "PIDMAP")) (princ "\nCould not register PIDMAP XData."))
      (pid-define-blocks)
      (foreach layer (pid-get "layers" *PID-MAPPING* nil)
        (pid-ensure-layer layer)
      )
      (setq report (open *PID-REPORT-PATH* "w"))
      (if report
        (progn
          (write-line "application_entity_id,autocad_handle,entity_kind,tag,status" report)
          (close report)
        )
      )
      (command "_.UNDO" "_BEGIN")
      (setq *PID-UNDO-OPEN* t)
      (setq entities (pid-get "entities" *PID-MAPPING* nil))
      (setq index 0 created 0 skipped 0 failed 0)
      (while (< index (length entities))
        (setq result (pid-generate-one (nth index entities)))
        (cond
          ((eq result 'created) (setq created (1+ created)))
          ((eq result 'skipped) (setq skipped (1+ skipped)))
          (t (setq failed (1+ failed)))
        )
        (setq index (1+ index))
      )
      (command "_.UNDO" "_END")
      (setq *PID-UNDO-OPEN* nil)
      (setvar "CMDECHO" *PID-OLD-CMDECHO*)
      (setq *error* *PID-PREVIOUS-ERROR*)
      (command "_.REGEN")
      (princ
        (strcat
          "\nPIDGEN complete. Created with XData read-back: " (itoa created)
          "; skipped existing IDs: " (itoa skipped)
          "; failed: " (itoa failed)
          "\nRead-back report: " *PID-REPORT-PATH*
          "\nSave the drawing manually, close and reopen it, then verify the DWG."
        )
      )
      (princ)
    )
  )
)

(princ "\nP&ID Mapping Studio generator loaded. Run PIDGEN in a fresh local drawing.")
(princ)
