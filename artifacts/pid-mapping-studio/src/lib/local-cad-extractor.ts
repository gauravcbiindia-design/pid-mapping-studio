import { createStoredZip, type ZipFile } from '@/lib/zip-binary';
import type { LocalCadSource } from '@/lib/local-cad-sources';
import { getLocalCadSourceContent } from '@/lib/local-cad-sources';

const extractorLisp = String.raw`; Local CAD standards extractor. Run in Windows AutoCAD on each source drawing.
(vl-load-com)
(defun c:PIDEXTRACTSTANDARDS (/ output alias handle table row kind name detail flags index assetName assetPath fontName bigFontName)
  (setq alias (vl-filename-base (getvar "DWGNAME")))
  (if (= alias "") (setq alias "SOURCE_LOCAL"))
  (setq output (getfiled "Save extracted CAD standards locally" (strcat (getvar "DWGPREFIX") "CAD_STANDARDS.tsv") "tsv" 1))
  (if output
    (progn
      (setq handle (open output "w"))
      (if handle
        (progn
          (write-line "SOURCE\tKIND\tNAME\tDETAIL" handle)
          (setq index 0)
          (foreach table '("BLOCK" "LAYER" "STYLE" "LTYPE" "DIMSTYLE")
            (setq row (tblnext table T))
            (while row
              (setq name (cdr (assoc 2 row)))
              (setq flags (cdr (assoc 70 row)))
              (if (and name
                       (or (/= table "BLOCK")
                           (and (/= (strcase name) "*MODEL_SPACE")
                                (/= (strcase name) "*PAPER_SPACE")
                                (/= (substr name 1 1) "*"))))
                (progn
                  (setq kind
                    (cond
                      ((= table "BLOCK") "BLOCK")
                      ((= table "LAYER") "LAYER")
                      ((= table "STYLE") "TEXT_STYLE")
                      ((= table "LTYPE") "LINETYPE")
                      ((= table "DIMSTYLE") "DIMENSION_STYLE")
                    )
                  )
                  (setq detail
                    (cond
                      ((= table "LAYER")
                        (strcat "color=" (itoa (abs (cdr (assoc 62 row))))
                                ";linetype=" (if (cdr (assoc 6 row)) (cdr (assoc 6 row)) "BYLAYER")))
                      ((= table "BLOCK")
                        (strcat "flags=" (itoa (if flags flags 0))))
                      ((= table "STYLE")
                        (setq fontName (if (cdr (assoc 3 row)) (vl-filename-nondirectory (cdr (assoc 3 row))) ""))
                        (setq bigFontName (if (cdr (assoc 4 row)) (vl-filename-nondirectory (cdr (assoc 4 row))) ""))
                        (strcat "font=" fontName ";bigfont=" bigFontName
                                ";height=" (rtos (if (cdr (assoc 40 row)) (cdr (assoc 40 row)) 0.0) 2 4)
                                ";width=" (rtos (if (cdr (assoc 41 row)) (cdr (assoc 41 row)) 1.0) 2 4)
                                ";oblique=" (rtos (if (cdr (assoc 50 row)) (cdr (assoc 50 row)) 0.0) 2 4)))
                      ((= table "LTYPE")
                        (strcat "description=" (if (cdr (assoc 3 row)) (cdr (assoc 3 row)) "")
                                ";patternLength=" (rtos (if (cdr (assoc 40 row)) (cdr (assoc 40 row)) 0.0) 2 4)))
                      ((= table "DIMSTYLE")
                        (strcat "scale=" (rtos (if (cdr (assoc 40 row)) (cdr (assoc 40 row)) 1.0) 2 4)
                                ";arrowSize=" (rtos (if (cdr (assoc 41 row)) (cdr (assoc 41 row)) 0.0) 2 4)
                                ";textHeight=" (rtos (if (cdr (assoc 140 row)) (cdr (assoc 140 row)) 0.0) 2 4)))
                      (T ""))
                  )
                  (if (= table "BLOCK")
                    (progn
                      (setq index (1+ index))
                      (setq assetName
                        (strcat alias "_BLOCK_" (if (< index 10) "000" "")
                          (if (and (>= index 10) (< index 100)) "00" "")
                          (if (and (>= index 100) (< index 1000)) "0" "")
                          (itoa index) ".dwg")
                      )
                      (setq assetPath
                        (strcat (vl-filename-directory output) "\\" assetName)
                      )
                      (vl-catch-all-apply
                        '(lambda () (command "_.-WBLOCK" assetPath name))
                        '()
                      )
                      (setq detail (strcat detail ";asset=" assetName))
                    )
                  )
                  (write-line (strcat alias "\t" kind "\t" name "\t" detail) handle)
                )
              )
              (setq row (tblnext table))
            )
          )
          (close handle)
          (prompt (strcat "\nLocal extraction saved: " output))
        )
        (prompt "\nCould not create the extraction file.")
      )
    )
  )
  (princ)
)
(princ "\nLoaded PIDEXTRACTSTANDARDS. Run PIDEXTRACTSTANDARDS on this source drawing.")
(princ)
`;

function neutralSourceName(index: number): string {
  return `SOURCE_${String(index + 1).padStart(3, '0')}.dwg`;
}

export async function buildLocalCadExtractorPackage(sources: LocalCadSource[]): Promise<Blob> {
  if (sources.length === 0) throw new Error('There are no eligible local source drawings to package.');
  const files: ZipFile[] = [
    {
      path: 'EXTRACT_CAD_STANDARDS.lsp',
      content: new TextEncoder().encode(extractorLisp),
    },
    {
      path: 'README_LOCAL_EXTRACTION.txt',
      content: new TextEncoder().encode(
        `LOCAL CAD STANDARDS EXTRACTION\n\n` +
        `This package is created in your browser and is not uploaded. It contains neutral copies of the selected DWGs and an AutoLISP extractor.\n\n` +
        `1. Extract this ZIP on the workstation running Windows AutoCAD.\n` +
        `2. Open one SOURCE_###.dwg at a time. In AutoCAD, run APPLOAD and load EXTRACT_CAD_STANDARDS.lsp.\n` +
        `3. Run PIDEXTRACTSTANDARDS and save the TSV locally. The script reads the neutral source drawing name automatically.\n` +
        `4. The script writes one neutral *_BLOCK_####.dwg for each source block, alongside the TSV. Zip the TSV and generated block DWGs together, then import that ZIP into the matching discipline's CAD source library.\n` +
        `5. Do not treat block names as approved mappings until a reviewer approves them. The script reads drawing tables only; it does not modify source drawings.\n`,
      ),
    },
  ];
  const contents = await Promise.all(sources.map((source) => getLocalCadSourceContent(source.id)));
  sources.forEach((_source, index) => {
    files.push({
      path: neutralSourceName(index),
      content: contents[index],
    });
  });
  return createStoredZip(files);
}

