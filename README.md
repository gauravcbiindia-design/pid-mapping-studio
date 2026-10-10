# P&ID Mapping Studio

Private source snapshot for a responsive PFD/P&ID web workbench. It does not include customer PDFs, drawing files, CAD symbol libraries, stored records, passwords, or the workspace's previous Git history. CAD-standard seed records are empty in this export.

## Current web features

- Add individual PDFs to the PFD or P&ID workspace; files stay in the current browser profile.
- Preview and inspect source pages; save manual engineering records by discipline.
- Import/export engineering records as CSV and export formatted Excel workbooks.
- Build and run the responsive web interface on Windows with Node.js and pnpm.

## Windows web preview

1. Install an IT-approved Node.js 20+ release and pnpm 10.
2. From this folder, run `pnpm install`.
3. Copy `.env.example` to `.env`; configure an authorized Clerk publishable key if your sign-in setup requires one. Never commit `.env`.
4. Run `pnpm dev` and open `http://127.0.0.1:5173`. Stop the server with Ctrl+C.
5. Check the frontend production build with `pnpm build`.

The web preview binds only to the local computer. It saves PDFs and engineering records in that browser profile; use the built-in backups before changing computers or clearing browser data.

## Important limits

This is not a native Windows desktop installer. This source does not yet perform verified PDF-to-DWG conversion, extract tags automatically from PDFs, or connect to a licensed local AutoCAD installation. It does not ship a company CAD library. The authenticated admin-library API requires a separately configured database and private-file-storage service; this web-only run command does not start that service. Do not use this snapshot as proof of working DWG conversion.

The listed application features are project source, not a warranty that every Windows network permits package downloads, sign-in, or the required private services. Test only with non-confidential sample PDFs until the local services and access controls are verified.

Copyright (c) 2026 gaurav.cbiindia for original project materials. Third-party packages remain subject to their own licenses and terms.
